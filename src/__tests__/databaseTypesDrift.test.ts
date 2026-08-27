import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guard de DERIVA entre las migraciones y `src/types/database.types.ts`.
//
// POR QUÉ EXISTE. El archivo de tipos se llama "generado" pero en este repo se
// mantiene A MANO: `supabase gen types` necesita credenciales del proyecto
// remoto (o un stack local con Docker), así que en la práctica cada migración
// que agrega una columna depende de que alguien se acuerde de reflejarla. No se
// acuerda. Hoy `tareas_bloque` declara en tipos tres columnas que NO existen en
// la base (`completado_en`, `foto_url`, `icono`) y le faltan catorce que sí, y
// `asignaciones_turno`/`plantillas_horario` no figuran en absoluto. Eso no lo
// atrapa `tsc`: los tipos compilan perfectamente, solo mienten — y una consulta
// escrita contra una columna inventada revienta en producción con 42703.
//
// ALCANCE HONESTO. La deriva es de repo entero (102 tablas con diferencias, 24
// ausentes) y arreglarla toda exige la regeneración real. Este guard NO afirma
// que el archivo esté al día: afirma que las tablas del motor operativo de
// Condominios —las que esta serie de PRs toca y de las que dependerá la
// materialización de rutinas— están alineadas, y que quien agregue una columna
// ahí la refleje en el mismo commit. Es una cabeza de playa, no una bandera de
// victoria; ampliar TABLAS_VIGILADAS es la forma de ir ganando terreno.
//
// LÍMITE. Compara NOMBRES de columna, no tipos ni nulabilidad: eso sí requiere
// la base. Un `text` declarado como `number` no lo ve nadie más que el
// generador de verdad.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const TIPOS = resolve('src/types/database.types.ts')

/**
 * Tablas del motor operativo de Condominios (catálogos de limpieza, turnos y
 * lo que ambos comparten). Agregar una tabla aquí es gratis si está alineada, y
 * si no lo está el fallo dice exactamente qué columna falta.
 */
const TABLAS_VIGILADAS = [
  // Catálogos canónicos y sus puentes (PR de catálogos operativos)
  'areas_condominio',
  'plantillas_tarea_cargo',
  'plantilla_tarea_suministros',
  'plantilla_tarea_herramientas',
  'suministros_condominio',
  'inventario_condominio',
  // Limpieza
  'programacion_limpieza',
  'ejecuciones_limpieza',
  // Motor de turnos (destino de la materialización de rutinas)
  'plantillas_horario',
  'asignaciones_turno',
  'bloques_turno',
  'tareas_bloque',
  'revisiones_tarea',
  // Rondas y personal: comparten el catálogo de áreas
  'rutas_ronda',
  'puntos_control_ruta',
  'personal_condominio',
] as const

// ── Lectura del SQL ────────────────────────────────────────────────────────

/** Quita comentarios de línea sin tocar `->`, `->>` ni `::`. */
const sinComentarios = (sql: string) =>
  sql.replace(/^[ \t]*--.*$/gm, '').replace(/([^-:])--(?![>-]).*$/gm, '$1')

const ES_CONSTRAINT = /^(primary|foreign|unique|check|constraint|exclude|like|deferrable)\b/i

/** Contenido del paréntesis que abre en `desde`, respetando anidamiento. */
function cuerpoBalanceado(txt: string, desde: number): string {
  let prof = 0
  for (let i = desde; i < txt.length; i++) {
    if (txt[i] === '(') prof++
    else if (txt[i] === ')') {
      prof--
      if (prof === 0) return txt.slice(desde + 1, i)
    }
  }
  return ''
}

/** Parte por comas de nivel 1: `numeric(10,2)` no cuenta como dos columnas. */
function partirNivel1(cuerpo: string): string[] {
  const out: string[] = []
  let prof = 0
  let act = ''
  for (const ch of cuerpo) {
    if (ch === '(') prof++
    if (ch === ')') prof--
    if (ch === ',' && prof === 0) {
      out.push(act)
      act = ''
    } else act += ch
  }
  if (act.trim()) out.push(act)
  return out
}

/**
 * Reconstruye el juego de columnas de cada tabla recorriendo las migraciones en
 * orden: CREATE TABLE, más ADD/DROP/RENAME COLUMN acumulados.
 */
function columnasDeclaradas(): Map<string, Set<string>> {
  const tablas = new Map<string, Set<string>>()
  const archivos = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

  for (const archivo of archivos) {
    const sql = sinComentarios(readFileSync(join(MIGRATIONS_DIR, archivo), 'utf8'))

    const reCreate = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi
    let m: RegExpExecArray | null
    while ((m = reCreate.exec(sql))) {
      const cols = tablas.get(m[1]) ?? new Set<string>()
      for (const item of partirNivel1(cuerpoBalanceado(sql, reCreate.lastIndex - 1))) {
        const t = item.trim()
        if (!t || ES_CONSTRAINT.test(t)) continue
        const nom = t.match(/^"?([a-z0-9_]+)"?/i)
        if (nom) cols.add(nom[1].toLowerCase())
      }
      tablas.set(m[1], cols)
    }

    const reAlter = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi
    while ((m = reAlter.exec(sql))) {
      const cols = tablas.get(m[1]) ?? new Set<string>()
      const acciones = m[2]
      let a: RegExpExecArray | null
      const reAdd = /\badd\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi
      while ((a = reAdd.exec(acciones))) cols.add(a[1].toLowerCase())
      const reDrop = /\bdrop\s+column\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?/gi
      while ((a = reDrop.exec(acciones))) cols.delete(a[1].toLowerCase())
      const reRen = /\brename\s+column\s+"?([a-z0-9_]+)"?\s+to\s+"?([a-z0-9_]+)"?/gi
      while ((a = reRen.exec(acciones))) {
        if (cols.delete(a[1].toLowerCase())) cols.add(a[2].toLowerCase())
      }
      if (cols.size) tablas.set(m[1], cols)
    }

    // Altas DINÁMICAS. 20260731000000 agrega columnas dentro de bucles
    // `DO $$ … EXECUTE format(…)`. Es el ÚNICO archivo de los 430 que lo hace
    // (lo verifica la prueba de más abajo); sin interpretarlo, el guard acusaría
    // de faltantes a columnas que sí existen. Se replica su GUARDA, no solo su
    // ALTER: por eso `tareas_bloque.completado_por` NO aparece por esta vía —
    // su hito `completado_en` nunca existió, y ese es justamente el bug que la
    // migración de paridad viene a cerrar.
    if (archivo.startsWith('20260731000000_')) {
      const lista = sql.match(/v_tablas\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/)
      for (const q of lista?.[1].matchAll(/'([a-z0-9_]+)'/gi) ?? []) {
        tablas.get(q[1])?.add('creado_por')
      }
      const pares = sql.match(/v_pares\s+text\[\]\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/)
      const rePar = /\[\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*\]/gi
      for (const q of pares?.[1].matchAll(rePar) ?? []) {
        const cols = tablas.get(q[1])
        if (cols?.has(q[2])) cols.add(q[3])
      }
    }
  }
  return tablas
}

// ── Lectura del archivo de tipos ───────────────────────────────────────────

/** Columnas del `Row` de cada tabla en `database.types.ts`. */
function columnasEnTipos(): Map<string, Set<string>> {
  const tipos = readFileSync(TIPOS, 'utf8')
  const filas = new Map<string, Set<string>>()
  const re = /^ {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(tipos))) {
    const cols = new Set<string>()
    for (const linea of m[2].split('\n')) {
      const c = linea.match(/^ {10}([a-z0-9_]+)\??:/)
      if (c) cols.add(c[1])
    }
    filas.set(m[1], cols)
  }
  return filas
}

const DECLARADAS = columnasDeclaradas()
const EN_TIPOS = columnasEnTipos()

describe('database.types.ts refleja las migraciones (motor operativo)', () => {
  it('el lector de migraciones no se quedó mudo', () => {
    // Si un cambio de formato rompiera el parser, todas las tablas quedarían
    // vacías y el guard pasaría vacunado. Esto lo delata.
    expect(DECLARADAS.size).toBeGreaterThan(200)
    expect(EN_TIPOS.size).toBeGreaterThan(200)
  })

  it('20260731000000 sigue siendo la única migración que agrega columnas por SQL dinámico', () => {
    // El parser interpreta ESE archivo a mano. Si aparece otro con el mismo
    // truco, el guard empieza a dar falsos positivos y hay que enseñárselo.
    const dinamicas = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .filter(f => /add\s+column\s+(if\s+not\s+exists\s+)?%[IsL]/i.test(
        readFileSync(join(MIGRATIONS_DIR, f), 'utf8'),
      ))
    expect(dinamicas).toEqual(['20260731000000_trazabilidad_creado_por.sql'])
  })

  it.each(TABLAS_VIGILADAS)('%s: los tipos declaran exactamente las columnas migradas', tabla => {
    const migradas = DECLARADAS.get(tabla)
    expect(migradas, `ninguna migración crea la tabla ${tabla}`).toBeDefined()

    const tipadas = EN_TIPOS.get(tabla)
    expect(
      tipadas,
      `${tabla} no existe en database.types.ts. Agregá su bloque con las columnas: ` +
        [...migradas!].sort().join(', '),
    ).toBeDefined()

    const faltan = [...migradas!].filter(c => !tipadas!.has(c)).sort()
    const sobran = [...tipadas!].filter(c => !migradas!.has(c)).sort()

    expect(
      faltan,
      `${tabla}: columnas migradas que faltan en los tipos (una consulta a estas ` +
        'compila pero devuelve `never`)',
    ).toEqual([])
    expect(
      sobran,
      `${tabla}: columnas que los tipos inventan y la base NO tiene (una consulta ` +
        'a estas compila y revienta en runtime con 42703)',
    ).toEqual([])
  })
})
