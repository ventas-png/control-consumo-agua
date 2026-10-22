import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// Guards ESTÁTICOS de los mapas «escribir exige la ACCIÓN del tab»
// (supabase/rls-acciones/<sección>.json → scripts/rls-acciones/generar.mjs).
//
// ALCANCE Y LÍMITE. Esto lee el mapa, el registro de tabs y el código; no
// ejecuta nada. Que la migración aplique EXACTAMENTE el mapa —quién crea, edita
// y borra cada tabla, otra empresa, el residente— lo prueba
// supabase/tests/rls_acciones/run.mjs contra un Postgres real, en cada PR.
//
// Lo que ese arnés no puede afirmar —porque prueba la base contra el mapa— es
// que el MAPA describa la pantalla. Eso se vigila aquí, en los dos sentidos:
//
//   1. COMPLETO. Toda pestaña del registro que escribe una tabla del mapa
//      tiene su tab en el comando correspondiente. Si falta, esa pantalla
//      ofrece un botón que la base rechaza.
//   2. JUSTIFICADO. Todo tab AJENO a la tabla que el mapa deja escribir trae
//      `evidencia`: la cadena de imports desde el componente de ese tab en el
//      registro hasta el archivo que escribe. Sin ella, el mapa ampliaría
//      quién escribe sin que ninguna pantalla lo pida.
//   3. BORRAR. Toda pestaña que borra una tabla del mapa recibe canDelete:
//      el botón Eliminar y la base exigen la misma acción.
//   4. CI. El arnés de cada sección está cableado en coverage.yml.
// ════════════════════════════════════════════════════════════════════════════

const SRC = resolve('src')
const DIR_MAPAS = resolve('supabase/rls-acciones')
const REGISTRO = readFileSync(join(SRC, 'components/condominios/tabRegistry.tsx'), 'utf8')
const ACCION: Record<string, string> = { INSERT: 'create', UPDATE: 'edit', DELETE: 'delete' }

interface Tabla {
  tab: string
  INSERT?: string[]
  UPDATE?: string[]
  DELETE?: string[]
  evidencia?: Record<string, string[]>
}
interface Mapa { _migracion: string; tablas: Record<string, Tabla> }

const mapas: [string, Mapa][] = readdirSync(DIR_MAPAS)
  .filter(f => f.endsWith('.json'))
  .map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(DIR_MAPAS, f), 'utf8')) as Mapa])

const pares = (t: Tabla, cmd: string) => t[cmd as 'INSERT'] ?? [`${t.tab}.${ACCION[cmd]}`]
const tabsDe = (t: Tabla, cmd: string) => new Set(pares(t, cmd).map(p => p.split('.')[0]))

// ── Registro: componente → archivo y → tabs de sus props de permiso ─────────
const archivoDe = new Map<string, string>()
for (const m of REGISTRO.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/([^']+)'\)/g)) {
  const base = join(SRC, 'components/condominios', m[2])
  const archivo = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx')].find(existsSync)
  if (archivo) archivoDe.set(m[1], archivo)
}
const propsDe = new Map<string, Record<string, string>>()
for (const m of REGISTRO.matchAll(/<(\w+)\s([^\n]*?)\/>/g)) {
  const props = Object.fromEntries([...m[2].matchAll(/(can\w+)=\{ctx\.can\w+\('([a-z_]+)'\)\}/g)].map(x => [x[1], x[2]]))
  if (Object.keys(props).length) propsDe.set(m[1], { ...(propsDe.get(m[1]) ?? {}), ...props })
}
/** Componentes del registro cuyos props usan el tab. */
const componentesDelTab = (tab: string) => [...propsDe].filter(([, p]) => Object.values(p).includes(tab)).map(([c]) => c)

// ── Escrituras directas en un archivo ───────────────────────────────────────
const OPS: Record<string, string[]> = {
  createCondominioRow: ['INSERT'], createCondominioRowReturning: ['INSERT'], validatedInsert: ['INSERT'], validatedInsertMany: ['INSERT'],
  updateCondominioRow: ['UPDATE'], updateCondominioRowAfectando: ['UPDATE'], updateCondominioRowsByIds: ['UPDATE'], validatedUpdate: ['UPDATE'],
  softDelete: ['UPDATE'],
  deleteCondominioRow: ['DELETE'], deleteCondominioRowAfectando: ['DELETE'], deleteCondominioRowBy: ['DELETE'], deleteCondominioRowsByIds: ['DELETE'],
  upsertCondominioRow: ['INSERT', 'UPDATE'],
}
const VERBO: Record<string, string[]> = { insert: ['INSERT'], update: ['UPDATE'], delete: ['DELETE'], upsert: ['INSERT', 'UPDATE'] }
function escrituras(archivo: string): { tabla: string; cmd: string }[] {
  const s = readFileSync(archivo, 'utf8')
  const out: { tabla: string; cmd: string }[] = []
  for (const m of s.matchAll(new RegExp(`\\b(${Object.keys(OPS).join('|')})\\(\\s*['"]([a-z_]+)['"]`, 'g'))) {
    for (const cmd of OPS[m[1]]) out.push({ tabla: m[2], cmd })
  }
  const plano = s.replace(/\s+/g, ' ')
  for (const m of plano.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)((?:\s*\.\s*\w+\([^()]*(?:\([^()]*\)[^()]*)*\))*?)\s*\.\s*(insert|update|delete|upsert)\b/g)) {
    for (const cmd of VERBO[m[3]]) out.push({ tabla: m[1], cmd })
  }
  return out
}

/** ¿`de` importa (relativo) a `a`? */
function importa(de: string, a: string): boolean {
  const s = readFileSync(de, 'utf8')
  return [...s.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].some(m => {
    const base = resolve(dirname(de), m[1])
    return [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx')].includes(a)
  })
}

describe('mapas de rls-acciones', () => {
  it('hay al menos un mapa y cada uno tiene su migración', () => {
    expect(mapas.length).toBeGreaterThan(0)
    for (const [, m] of mapas) expect(existsSync(resolve('supabase/migrations', m._migracion))).toBe(true)
  })
})

describe.each(mapas)('mapa %s', (seccion, mapa) => {
  const tablas = Object.keys(mapa.tablas)

  it('1 · COMPLETO: toda pestaña que escribe una tabla del mapa tiene su tab en ese comando', () => {
    const faltan: string[] = []
    for (const [comp, archivo] of archivoDe) {
      const props = propsDe.get(comp)
      if (!props) continue
      const tabsComp = new Set(Object.values(props))
      for (const { tabla, cmd } of escrituras(archivo)) {
        const t = mapa.tablas[tabla]
        if (!t) continue
        const permitidos = tabsDe(t, cmd)
        if (![...tabsComp].some(x => permitidos.has(x))) faltan.push(`${tabla} ${cmd} ← ${comp} (${[...tabsComp].join(', ')})`)
      }
    }
    expect(faltan).toEqual([])
  })

  it('2 · JUSTIFICADO: todo tab ajeno trae su evidencia, y la evidencia se sostiene', () => {
    const problemas: string[] = []
    for (const tabla of tablas) {
      const t = mapa.tablas[tabla]
      const ajenos = new Set(['INSERT', 'UPDATE', 'DELETE'].flatMap(c => [...tabsDe(t, c)]).filter(x => x !== t.tab))
      for (const tab of ajenos) {
        const cadena = t.evidencia?.[tab]?.map(f => join(SRC, f))
        if (!cadena?.length) { problemas.push(`${tabla}: tab ajeno «${tab}» sin evidencia`); continue }
        const raiz = componentesDelTab(tab).map(c => archivoDe.get(c))
        if (!raiz.includes(cadena[0])) problemas.push(`${tabla}/${tab}: ${t.evidencia![tab][0]} no es el componente del tab «${tab}» en el registro`)
        for (let i = 0; i + 1 < cadena.length; i++) {
          if (!importa(cadena[i], cadena[i + 1])) problemas.push(`${tabla}/${tab}: ${t.evidencia![tab][i]} no importa ${t.evidencia![tab][i + 1]}`)
        }
        const cmds = ['INSERT', 'UPDATE', 'DELETE'].filter(c => tabsDe(t, c).has(tab))
        const escribe = escrituras(cadena[cadena.length - 1]).filter(e => e.tabla === tabla).map(e => e.cmd)
        for (const c of cmds) {
          if (!escribe.includes(c)) problemas.push(`${tabla}/${tab}: ${t.evidencia![tab].at(-1)} no hace ${c} sobre ${tabla}`)
        }
      }
    }
    expect(problemas).toEqual([])
  })

  it('3 · BORRAR: toda pestaña que borra una tabla del mapa recibe canDelete', () => {
    const sin: string[] = []
    for (const [comp, archivo] of archivoDe) {
      const borra = escrituras(archivo).some(e => e.cmd === 'DELETE' && mapa.tablas[e.tabla])
      if (borra && !propsDe.get(comp)?.canDelete) sin.push(comp)
    }
    expect(sin).toEqual([])
  })

  it('4 · CI: el arnés de la sección corre en coverage.yml', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain(`node supabase/tests/rls_acciones/run.mjs ${seccion}`)
  })
})
