#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿Existe en PRODUCCIÓN cada columna que declara una migración YA APLICADA?
// ════════════════════════════════════════════════════════════════════════════
// EL AGUJERO QUE ESTO TAPA. El 2026-08-27 el merge de #782 aplicó su serie a
// producción y falló a medias (run 33095288091):
//
//   20260904000100 → HTTP 400
//   ERROR: 42703: column "activo" of relation "areas_condominio" does not exist
//
// La causa no estaba en ese PR. `20260424000059` CREA `areas_condominio` con
// una columna `activo` que la tabla real de producción nunca tuvo: esa tabla no
// la creó esa migración. La cabecera de scripts/backfill-schema-migrations.sql
// explica el mecanismo — las 257 migraciones anteriores al 2026-06-05 «se
// aplicaron en su día por otra vía (CLI, panel, a mano)» y el historial se
// rellenó como papeleo, sin ejecutar el SQL. O sea: hay migraciones REGISTRADAS
// COMO APLICADAS cuyo DDL nunca corrió.
//
// Todo el CI estaba verde, y no mentía: en un esquema construido desde
// supabase/migrations esa columna SÍ existe. Lo que nadie miraba es el otro
// sentido. columnas-vs-migraciones.mjs compara app → migraciones;
// security-guard.mjs mira aislamiento; types-drift.yml es advisory y semanal.
// Este script cubre migraciones → producción.
//
// EL INVARIANTE, Y POR QUÉ ESTÁ ACOTADO ASÍ:
//
//   Para cada migración REGISTRADA en supabase_migrations.schema_migrations,
//   toda tabla y columna que declara tiene que existir en producción.
//
// Acotarlo a las registradas es lo que lo hace usable. Una migración nueva en
// un PR todavía no se aplicó y declara columnas que producción legítimamente no
// tiene; sin ese filtro la guarda fallaría en CADA PR con migración y se
// aprendería a ignorarla — el destino de types-drift. Con el filtro el
// invariante es exactamente cierto, y es justo el que se rompió: 20260424000059
// está registrada y su `activo` no está.
//
// El esquema esperado se calcula SÓLO con las registradas y en orden de versión,
// no con todas: una migración pendiente que dropea una columna no debe hacer que
// dejemos de exigirla, porque no ha corrido.
//
// SOLO LECTURA: tres consultas de catálogo. Jamás muta datos ni esquema.
//
// Credencial-gated, igual que security-guard.mjs: sin SUPABASE_PROJECT_ID /
// SUPABASE_ACCESS_TOKEN sale 0 (no-op) con un aviso. Con credenciales y una
// consulta que falla, sale 1 (fail-closed): una guarda que no puede verificar no
// debe pasar en silencio — es la lección de #710, donde un 401 salió verde.
//
// Uso:
//   SUPABASE_PROJECT_ID=<ref> SUPABASE_ACCESS_TOKEN=<token> \
//     node scripts/migraciones-vs-produccion.mjs [--reporte]
//
//   --reporte  imprime los hallazgos y sale 0. Es el modo para SEMBRAR el
//              allowlist desde una corrida real antes de volverla bloqueante.
// ════════════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { columnasDeLasMigracionesConOrigen } from './columnas-vs-migraciones.mjs'

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

const __dirname = dirname(fileURLToPath(import.meta.url))
const ALLOWLIST_PATH = join(__dirname, 'migraciones-vs-produccion.allowlist.json')
const MIGRACIONES_DIR = join(__dirname, '..', 'supabase', 'migrations')

// Se lee el CATÁLOGO (pg_class/pg_attribute) y no information_schema, por la
// misma razón que security-guard.mjs: las vistas de information_schema filtran
// por los privilegios del rol que consulta, así que un cambio de rol en la
// Management API haría desaparecer objetos y la guarda reportaría como drift lo
// que sólo es invisible. Una guarda que da rojos falsos se aprende a ignorar.
//
// relkind 'r' y 'p' — tablas y particionadas. Las vistas quedan FUERA a
// propósito: si una migración declara una tabla y en producción hay una vista
// con ese nombre, eso ES drift y tiene que salir.
export const QUERIES = {
  registradas: `select version from supabase_migrations.schema_migrations order by version;`,
  columnas: `
    select c.relname as table_name, a.attname as column_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped
    order by 1, 2;`,
  tablas: `
    select c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1;`,
}

/** `20260424000059_rutas_ronda.sql` → `20260424000059`. */
export function versionDe(nombre) {
  return nombre.replace(/\.sql$/, '').split('_')[0]
}

/** Migraciones locales, en orden de versión, como {nombre, sql}. */
export function leerMigracionesConNombre(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ nombre: f, sql: readFileSync(join(dir, f), 'utf8') }))
}

/**
 * Compara el esquema que declaran las migraciones YA APLICADAS contra el real.
 *
 * @param {object} p
 * @param {Set<string>}  p.registradas   versiones presentes en schema_migrations
 * @param {{nombre:string, sql:string}[]} p.migraciones  TODAS las locales, ordenadas
 * @param {Map<string, Set<string>>} p.columnasProd  tabla → columnas reales
 * @param {Set<string>}  p.tablasProd    tablas reales de `public`
 * @param {{columnas?: any[], tablas?: any[]}} [p.allowlist]
 * @returns {{columnasFaltantes: string[], tablasFaltantes: string[],
 *            allowlistObsoleto: string[], aplicadas: number, comprobadas: number}}
 */
export function comparar({ registradas, migraciones, columnasProd, tablasProd, allowlist = {} }) {
  const aplicadas = migraciones.filter((m) => registradas.has(versionDe(m.nombre)))
  const { porTabla, origen, origenTabla } = columnasDeLasMigracionesConOrigen(aplicadas)

  const permitidasCol = new Set(
    (allowlist.columnas ?? []).map((e) =>
      typeof e === 'string' ? e : `${e.tabla}.${e.columna}`,
    ),
  )
  const permitidasTabla = new Set(
    (allowlist.tablas ?? []).map((e) => (typeof e === 'string' ? e : e.tabla)),
  )

  const columnasFaltantes = []
  const tablasFaltantes = []
  const usadasCol = new Set()
  const usadasTabla = new Set()
  let comprobadas = 0

  for (const [tabla, columnas] of porTabla) {
    // Una tabla ausente se reporta UNA vez, no como N columnas sueltas: la
    // diferencia entre "falta una tabla" y "faltan 14 columnas" es la diferencia
    // entre un informe legible y una pared de texto.
    if (!tablasProd.has(tabla)) {
      if (permitidasTabla.has(tabla)) usadasTabla.add(tabla)
      else tablasFaltantes.push(`${tabla} — creada en ${origenTabla.get(tabla) ?? '?'}`)
      // Sus columnas allowlistadas siguen vigentes: faltan porque falta la tabla
      // entera. Sin esto se reportarían como «entrada obsoleta» y el aviso
      // mandaría a retirar una excepción que sí hace falta.
      for (const columna of columnas) {
        const clave = `${tabla}.${columna}`
        if (permitidasCol.has(clave)) usadasCol.add(clave)
      }
      continue
    }
    const reales = columnasProd.get(tabla) ?? new Set()
    for (const columna of columnas) {
      comprobadas += 1
      if (reales.has(columna)) continue
      const clave = `${tabla}.${columna}`
      if (permitidasCol.has(clave)) usadasCol.add(clave)
      else columnasFaltantes.push(`${clave} — declarada en ${origen.get(clave) ?? '?'}`)
    }
  }

  // Una entrada que ya no aplica es basura que tapa hallazgos futuros: si nadie
  // la retira, la lista crece hasta volverse un "permitir todo" de facto.
  const allowlistObsoleto = [
    ...[...permitidasCol].filter((c) => !usadasCol.has(c)).map((c) => `columna ${c}`),
    ...[...permitidasTabla].filter((t) => !usadasTabla.has(t)).map((t) => `tabla ${t}`),
  ]

  return {
    columnasFaltantes,
    tablasFaltantes,
    allowlistObsoleto,
    aplicadas: aplicadas.length,
    comprobadas,
  }
}

async function runQuery(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  )
  const text = await res.text()
  if (res.status === 401 || res.status === 403) {
    // Mismo criterio que security-guard.mjs: es la única causa de rojo que NO se
    // arregla en el repositorio. Sin nombrarla aparte, un token muerto se lee
    // como "producción tiene drift" y manda a investigar el esquema equivocado.
    const err = new Error(`Management API ${res.status}: ${text.slice(0, 300)}`)
    err.authStatus = res.status
    throw err
  }
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 500)}`)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Respuesta no-JSON de Management API: ${text.slice(0, 500)}`)
  }
  if (body && body.error) throw new Error(`Error de consulta: ${JSON.stringify(body.error)}`)
  if (!Array.isArray(body)) {
    throw new Error(`Respuesta inesperada (se esperaba array de filas): ${text.slice(0, 500)}`)
  }
  return body
}

async function main() {
  const soloReporte = process.argv.includes('--reporte')

  if (!PROJECT_ID || !ACCESS_TOKEN) {
    console.log(
      '⏭️  migraciones-vs-produccion: faltan SUPABASE_PROJECT_ID / SUPABASE_ACCESS_TOKEN — omitido (no-op verde).',
    )
    console.log('   Define ambos para comparar contra el esquema real (solo lectura).')
    process.exit(0)
  }

  const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'))

  let filasRegistradas, filasColumnas, filasTablas
  try {
    ;[filasRegistradas, filasColumnas, filasTablas] = await Promise.all([
      runQuery(QUERIES.registradas),
      runQuery(QUERIES.columnas),
      runQuery(QUERIES.tablas),
    ])
  } catch (err) {
    console.error(`❌ migraciones-vs-produccion: no se pudo leer el esquema — ${err.message}`)
    if (err.authStatus) {
      console.error('')
      console.error('   CREDENCIAL, NO HALLAZGO: el esquema no se leyó, así que este rojo')
      console.error('   no dice nada sobre el estado de producción.')
    }
    process.exit(1)
  }

  const registradas = new Set(filasRegistradas.map((r) => String(r.version)))
  const tablasProd = new Set(filasTablas.map((r) => r.table_name))
  const columnasProd = new Map()
  for (const r of filasColumnas) {
    if (!columnasProd.has(r.table_name)) columnasProd.set(r.table_name, new Set())
    columnasProd.get(r.table_name).add(r.column_name)
  }

  const migraciones = leerMigracionesConNombre(MIGRACIONES_DIR)
  const r = comparar({ registradas, migraciones, columnasProd, tablasProd, allowlist })

  console.log(
    `Migraciones locales: ${migraciones.length} · registradas en producción: ${r.aplicadas} · columnas comprobadas: ${r.comprobadas}`,
  )

  if (r.allowlistObsoleto.length > 0) {
    console.log('')
    console.log('⚠️  Entradas del allowlist que YA NO aplican (retirarlas):')
    for (const e of r.allowlistObsoleto) console.log(`   · ${e}`)
  }

  const hallazgos = r.tablasFaltantes.length + r.columnasFaltantes.length
  if (hallazgos === 0) {
    console.log('')
    console.log('✅ migraciones-vs-produccion: producción tiene todo lo que declaran las')
    console.log('   migraciones ya aplicadas.')
    process.exit(0)
  }

  console.log('')
  if (r.tablasFaltantes.length > 0) {
    console.log(`❌ ${r.tablasFaltantes.length} tabla(s) declarada(s) por una migración aplicada y AUSENTE(S) en producción:`)
    for (const t of r.tablasFaltantes) console.log(`   · ${t}`)
    console.log('')
  }
  if (r.columnasFaltantes.length > 0) {
    console.log(`❌ ${r.columnasFaltantes.length} columna(s) declarada(s) por una migración aplicada y AUSENTE(S) en producción:`)
    for (const c of r.columnasFaltantes) console.log(`   · ${c}`)
    console.log('')
  }
  console.log('Cada una es un 42703 esperando a que alguien la escriba. Para cada hallazgo:')
  console.log('  · reponerla con una migración forward-only (patrón 20260904000500), o')
  console.log('  · declararla como deuda en scripts/migraciones-vs-produccion.allowlist.json,')
  console.log('    con su `reason`.')

  process.exit(soloReporte ? 0 : 1)
}

// Solo corre como CLI; importarlo desde las pruebas no dispara nada.
if (process.argv[1] && process.argv[1].endsWith('migraciones-vs-produccion.mjs')) {
  main().catch((err) => {
    console.error(`❌ migraciones-vs-produccion: ${err.stack || err.message}`)
    process.exit(1)
  })
}
