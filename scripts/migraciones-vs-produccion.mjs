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
// SEGUNDO INVARIANTE (2026-08-28): para los CONSTRAINTS CRÍTICOS declarados en
// CONSTRAINTS_CRITICOS, producción tiene que tener la DEFINICIÓN canónica
// (pg_get_constraintdef) y no solo un constraint con ese nombre. La lección es
// tareas_bloque_estado_check: el guard por conname de 20260907000100 dio por
// bueno un homónimo con el vocabulario legacy, y existir, existía — rechazando
// los cierres canónicos con 23514. Mismo acotamiento: la definición solo se
// exige cuando la migración que la declara ya está registrada.
//
// SOLO LECTURA: cuatro consultas de catálogo. Jamás muta datos ni esquema.
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
  // pg_get_constraintdef y no conname a secas: la lección de
  // tareas_bloque_estado_check es que el NOMBRE puede coincidir con una
  // definición incompatible (guard por conname de 20260907000100), y un guard
  // que mire solo la existencia daría verde exactamente ahí.
  constraints: `
    select rel.relname as table_name, con.conname as constraint_name,
           pg_get_constraintdef(con.oid) as definition, con.convalidated
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and con.contype = 'c'
    order by 1, 2;`,
}

// ── Constraints críticos: la definición se exige, no solo el nombre ─────────
//
// EL AGUJERO QUE ESTO TAPA. 20260907000100 agregó su CHECK de estado guardado
// por conname: `IF NOT EXISTS (... WHERE conname = 'tareas_bloque_estado_check')`.
// En un entorno donde ese nombre ya existía con OTRO vocabulario (el legacy en
// masculino: 'completado', 'omitido', 'en_curso'), el guard se saltó el ADD y
// producción quedó rechazando los cierres canónicos con 23514 — con este
// script en verde, porque tablas y columnas estaban todas. 20260907000700
// reemplaza el homónimo y lo valida; esta lista vigila que NADIE lo restaure.
//
// `desdeVersion` acota igual que el invariante de columnas: antes de que la
// migración que declara la definición esté REGISTRADA, producción tiene
// legítimamente la forma vieja y exigir la nueva daría rojos falsos en cada
// despliegue. `definicion` es la salida de pg_get_constraintdef del servidor
// (forma compilada: IN se imprime como `= ANY (ARRAY[...])`), comparada tras
// normalizar espacios y el sufijo NOT VALID.
export const CONSTRAINTS_CRITICOS = [
  {
    tabla: 'tareas_bloque',
    constraint: 'tareas_bloque_estado_check',
    // Cualquier OTRO CHECK de la tabla cuya definición nombre esta columna se
    // reporta también: un segundo CHECK legacy bajo otro nombre aplicaría A LA
    // VEZ que el canónico y volvería a rechazar los cierres con 23514, con el
    // canónico intacto — el mismo incidente por la puerta de al lado.
    columna: 'estado',
    desdeVersion: '20260907000700',
    // `definicion` es la salida de pg_get_constraintdef para `estado text`
    // (el tipo que declara 20260424000060), estable en PG 15/16/17 —
    // run.sh de reparar_estado_tareas_bloque la coteja contra un servidor
    // real en cada corrida de CI. Si producción tuviera la columna con OTRO
    // tipo (varchar imprime la forma con casts), esto daría rojo: a
    // PROPÓSITO — un tipo distinto del declarado es drift que ninguna otra
    // guarda ve, y el mensaje imprime ambas definiciones para que se lea.
    definicion:
      "CHECK ((estado = ANY (ARRAY['pendiente'::text, 'completada'::text, 'con_observacion'::text, 'omitida'::text])))",
    // 20260907000700 hace VALIDATE: un constraint canónico pero NOT VALID
    // significa que la validación del histórico se perdió por el camino.
    validado: true,
  },
]

/** Normaliza una definición para comparar: espacios y sufijo NOT VALID. */
export function normalizarDef(def) {
  return (def ?? '')
    .replace(/\s+NOT\s+VALID\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compara los constraints críticos declarados contra el catálogo real.
 * Un constraint con el nombre correcto y definición distinta ES un hallazgo —
 * es exactamente el caso que el guard por conname no ve.
 *
 * @param {object} p
 * @param {Set<string>} p.registradas  versiones presentes en schema_migrations
 * @param {{table_name:string, constraint_name:string, definition:string,
 *          convalidated:boolean}[]} p.constraintsProd  CHECKs reales de `public`
 * @returns {string[]}  hallazgos legibles (vacío = sin drift)
 */
export function compararConstraints({ registradas, constraintsProd, criticos = CONSTRAINTS_CRITICOS }) {
  const hallazgos = []
  for (const esperado of criticos) {
    if (!registradas.has(esperado.desdeVersion)) continue

    // Los CHECKs aplican TODOS a la vez: uno legacy bajo OTRO nombre volvería
    // a rechazar las escrituras canónicas aunque el nombrado esté perfecto.
    // Se reporta cualquier otro CHECK de la tabla que constriña la columna.
    if (esperado.columna) {
      const reColumna = new RegExp(`\\b${esperado.columna}\\b`)
      for (const extra of constraintsProd.filter(
        (c) =>
          c.table_name === esperado.tabla &&
          c.constraint_name !== esperado.constraint &&
          reColumna.test(c.definition ?? ''),
      )) {
        hallazgos.push(
          `${esperado.tabla}.${extra.constraint_name} — CHECK ADICIONAL sobre «${esperado.columna}» junto a ${esperado.constraint}: ` +
            `los CHECKs aplican todos a la vez, así que éste puede rechazar lo que el canónico permite. Definición: ${extra.definition}`,
        )
      }
    }

    const real = constraintsProd.find(
      (c) => c.table_name === esperado.tabla && c.constraint_name === esperado.constraint,
    )
    if (!real) {
      hallazgos.push(
        `${esperado.tabla}.${esperado.constraint} — AUSENTE en producción y lo declara ${esperado.desdeVersion} (ya registrada)`,
      )
      continue
    }
    if (normalizarDef(real.definition) !== normalizarDef(esperado.definicion)) {
      hallazgos.push(
        `${esperado.tabla}.${esperado.constraint} — el NOMBRE coincide pero la DEFINICIÓN no es la de ${esperado.desdeVersion}:\n` +
          `        esperada: ${esperado.definicion}\n` +
          `        real:     ${real.definition}`,
      )
      continue
    }
    if (esperado.validado && real.convalidated !== true) {
      hallazgos.push(
        `${esperado.tabla}.${esperado.constraint} — definición correcta pero NOT VALID (convalidated=false); ${esperado.desdeVersion} lo valida`,
      )
    }
  }
  return hallazgos
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

  let filasRegistradas, filasColumnas, filasTablas, filasConstraints
  try {
    ;[filasRegistradas, filasColumnas, filasTablas, filasConstraints] = await Promise.all([
      runQuery(QUERIES.registradas),
      runQuery(QUERIES.columnas),
      runQuery(QUERIES.tablas),
      runQuery(QUERIES.constraints),
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
  const constraintsConDrift = compararConstraints({
    registradas,
    constraintsProd: filasConstraints,
  })

  console.log(
    `Migraciones locales: ${migraciones.length} · registradas en producción: ${r.aplicadas} · columnas comprobadas: ${r.comprobadas} · constraints críticos: ${CONSTRAINTS_CRITICOS.length}`,
  )

  if (r.allowlistObsoleto.length > 0) {
    console.log('')
    console.log('⚠️  Entradas del allowlist que YA NO aplican (retirarlas):')
    for (const e of r.allowlistObsoleto) console.log(`   · ${e}`)
  }

  const hallazgos =
    r.tablasFaltantes.length + r.columnasFaltantes.length + constraintsConDrift.length
  if (hallazgos === 0) {
    console.log('')
    console.log('✅ migraciones-vs-produccion: producción tiene todo lo que declaran las')
    console.log('   migraciones ya aplicadas, y los constraints críticos conservan su definición.')
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
  if (constraintsConDrift.length > 0) {
    console.log(`❌ ${constraintsConDrift.length} constraint(s) crítico(s) con drift de DEFINICIÓN (el nombre no basta):`)
    for (const c of constraintsConDrift) console.log(`   · ${c}`)
    console.log('')
    console.log('   Un CHECK con otro vocabulario rechaza escrituras legítimas con 23514 (la')
    console.log('   clase de tareas_bloque_estado_check). Reponer la definición canónica —o')
    console.log('   retirar el CHECK adicional— con una migración forward-only que valide,')
    console.log('   patrón 20260907000700. El allowlist NO cubre constraints: no hay deuda')
    console.log('   declarable aquí, solo reparación.')
    console.log('')
  }
  if (r.tablasFaltantes.length + r.columnasFaltantes.length > 0) {
    console.log('Para cada tabla o columna ausente (un 42703 esperando a que alguien la escriba):')
    console.log('  · reponerla con una migración forward-only (patrón 20260904000500), o')
    console.log('  · declararla como deuda en scripts/migraciones-vs-produccion.allowlist.json,')
    console.log('    con su `reason`.')
  }

  process.exit(soloReporte ? 0 : 1)
}

// Solo corre como CLI; importarlo desde las pruebas no dispara nada.
if (process.argv[1] && process.argv[1].endsWith('migraciones-vs-produccion.mjs')) {
  main().catch((err) => {
    console.error(`❌ migraciones-vs-produccion: ${err.stack || err.message}`)
    process.exit(1)
  })
}
