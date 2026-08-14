import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// Guard estructural del loader de Condominios (auditoría 2026-07-28, PR-26/PR-27)
//
// `sectionData.ts` es un Promise.all de ~140 colecciones, todas con la misma
// forma: `.eq('project_id', pid).eq('company_id', cid)`. La auditoría encontró
// SEIS que se habían quedado sin el filtro de proyecto:
//
//   PR-26  bitacora_acciones          (tenía la columna; solo faltaba el filtro)
//   PR-27  reservas_amenidades ×2, registro_asistentes_evento, movimientos_caja,
//          cuotas_plan_pago, movimientos_suministro
//          (no tenían la columna; la migración 20260729000600 la añade)
//
// Ninguna revisión humana va a contar 140 líneas casi idénticas buscando la que
// no encaja — por eso el bug sobrevivió a varias auditorías. Este test hace ese
// conteo: cada `.from()` dentro de las funciones que reciben `(pid, cid)` debe
// acotar por proyecto, o estar en la lista de excepciones justificadas.
//
// Es un test SOBRE EL TEXTO del módulo, no sobre su ejecución, y eso es
// deliberado: lo que hay que fijar es la forma de las ~140 consultas, no el
// resultado de una. Ejecutarlas exigiría un mock por tabla y no diría nada de
// las 139 restantes.
// ════════════════════════════════════════════════════════════════════════════

// Se despojan los comentarios `//` antes de escanear. Mismo motivo que en
// `scripts/migrations-guard.mjs`: los comentarios de este repo CITAN el patrón
// defectuoso que vienen a explicar, y sin esto el guard se acusa a sí mismo
// (pasó de verdad al escribir este test: el comentario de `puntos_control_ruta`
// menciona `.eq('areas_condominio.project_id', pid)` sin `!inner`, que es
// justamente lo que la última aserción prohíbe).
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'sectionData.ts'),
  'utf8',
)
  .split('\n')
  .map((l) => (/^\s*\/\//.test(l) ? '' : l))
  .join('\n')

/** Funciones del módulo que reciben `(pid, cid)` y por tanto DEBEN acotar. */
const FUNCIONES_CON_PROYECTO = [
  'fetchCondominiosPanelData',
  'fetchCondominiosSectionData',
  'fetchCondominiosRondasData',
  'fetchCondominiosTareasData',
  'fetchCondominiosLimpiezaData',
  'fetchCondominiosTurnosData',
]

/**
 * Tablas que acotan por proyecto de una forma DISTINTA a `.eq('project_id', pid)`,
 * cada una con el motivo. Añadir aquí exige justificar; es el punto del guard.
 */
const EXCEPCIONES: Record<string, string> = {
  // Acota por el embed inner del área, que sí tiene project_id: la tabla no
  // tiene project_id ni company_id propios (PR-27).
  puntos_control_ruta: "areas_condominio!inner + .eq('areas_condominio.project_id', pid)",
}

/** Extrae el cuerpo de `export async function <nombre>(...) { ... }`. */
function cuerpoDe(nombre: string): string {
  const i = SRC.indexOf(`export async function ${nombre}(`)
  expect(i, `no se encontró la función ${nombre}`).toBeGreaterThan(-1)
  const desde = SRC.indexOf('{', i)
  let nivel = 0
  for (let j = desde; j < SRC.length; j++) {
    if (SRC[j] === '{') nivel++
    else if (SRC[j] === '}') {
      nivel--
      if (nivel === 0) return SRC.slice(desde, j + 1)
    }
  }
  throw new Error(`no se pudo delimitar el cuerpo de ${nombre}`)
}

/** Una entrada del Promise.all: desde `db.from(` / `supabase.from(` hasta el fin de línea. */
function consultasDe(cuerpo: string): Array<{ tabla: string; linea: string }> {
  return cuerpo
    .split('\n')
    .filter((l) => /\b(?:db|supabase)\.from\(/.test(l))
    .map((l) => ({
      tabla: /\.from\('([^']+)'\)/.exec(l)?.[1] ?? '???',
      linea: l.trim(),
    }))
}

describe('sectionData — toda consulta del loader acota por proyecto', () => {
  for (const fn of FUNCIONES_CON_PROYECTO) {
    it(`${fn}: ninguna colección se queda solo con company_id`, () => {
      const consultas = consultasDe(cuerpoDe(fn))
      expect(consultas.length).toBeGreaterThan(0)

      const sinFiltro = consultas
        .filter((c) => !EXCEPCIONES[c.tabla])
        .filter((c) => !c.linea.includes(".eq('project_id', pid)"))
        .map((c) => c.tabla)

      expect(sinFiltro, `sin filtro de proyecto en ${fn}: ${sinFiltro.join(', ')}`).toEqual([])
    })
  }

  it('las 6 tablas del hallazgo quedan acotadas', () => {
    // Fijadas por nombre: si alguien revierte una, este test lo dice sin que
    // haya que leer el diff de un archivo de 270 líneas.
    const cuerpo = cuerpoDe('fetchCondominiosSectionData') + cuerpoDe('fetchCondominiosPanelData')
    for (const tabla of [
      'reservas_amenidades',
      'registro_asistentes_evento',
      'movimientos_caja',
      'cuotas_plan_pago',
      'movimientos_suministro',
      'bitacora_acciones',
    ]) {
      const lineas = cuerpo.split('\n').filter((l) => l.includes(`.from('${tabla}')`))
      expect(lineas.length, `no hay consultas de ${tabla}`).toBeGreaterThan(0)
      for (const l of lineas) {
        expect(l, `${tabla} sin filtro de proyecto`).toContain(".eq('project_id', pid)")
      }
    }
  })

  it('un filtro por columna embebida sin `!inner` no cuenta como filtro', () => {
    // La trampa concreta de PR-27: en PostgREST, filtrar por una columna del
    // embed NO filtra las filas de arriba salvo que el embed sea inner. Toda
    // línea que use `.eq('<algo>.<col>', ...)` debe llevar `!inner`.
    const cuerpo = FUNCIONES_CON_PROYECTO.map(cuerpoDe).join('\n')
    const conFiltroEmbebido = cuerpo
      .split('\n')
      .filter((l) => /\.eq\('[a-z_]+\.[a-z_]+'/.test(l))

    expect(conFiltroEmbebido.length).toBeGreaterThan(0)
    for (const l of conFiltroEmbebido) {
      const rel = /\.eq\('([a-z_]+)\./.exec(l)?.[1]
      expect(l, `filtro sobre ${rel} sin !inner: no filtra nada`).toContain(`${rel}!inner`)
    }
  })
})
