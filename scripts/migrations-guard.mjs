#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Migrations guard — análisis ESTÁTICO de supabase/migrations/ (auditoría
// 2026-07-28, Bloque A · PR-9). Corre en cada PR, sin credenciales ni red.
//
// POR QUÉ EXISTE, SIENDO QUE YA HAY UN security-guard.mjs
// `security-guard.mjs` valida el catálogo de PRODUCCIÓN. Eso es justo donde el
// drift NO se ve: si alguien habilita RLS a mano en el dashboard, prod queda
// verde para siempre y el repo puede quedarse sin la migración correspondiente.
// Cualquier deploy fresco, preview branch o staging provisionado desde el repo
// nace entonces con el hueco. Este guard mira el REPO, no prod, y corre en PR
// (antes del merge), no de noche (después).
//
// Los dos hallazgos que motivan cada regla son reales y de este repo:
//
//   (a) `fuentes_agua`, `empresa` y `user_sessions` llevaban desde marzo sin
//       `ENABLE ROW LEVEL SECURITY` en ninguna de las 352 migraciones.
//       `fuentes_agua` tenía además 8 policies que eran código muerto.
//
//   (b) `get_company_effective_limits` recibió un guard anti cross-tenant en
//       20260606150000 y lo PERDIÓ seis días después en 20260612210000, porque
//       un `CREATE OR REPLACE` de la misma firma reescribió el cuerpo sin él
//       (y conservó el GRANT). Un guard copiado dentro de cada cuerpo se puede
//       perder por omisión; por eso ahora se exige la llamada nombrada a
//       `assert_company_scope()`.
//
// LECCIÓN INCORPORADA: la regla (a) descuenta las tablas DROPEADAS. Durante esta
// misma auditoría se reportó como vulnerable una policy de
// `user_module_permissions` sin notar que la tabla se había dropeado con CASCADE
// un mes antes. Un guard que no modele el DROP repetiría ese falso positivo.
//
// Uso:  node scripts/migrations-guard.mjs
// ════════════════════════════════════════════════════════════════════════════

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')
const ALLOWLIST_PATH = join(__dirname, 'migrations-guard.allowlist.json')

// ── Utilidades de parseo ────────────────────────────────────────────────────
// Las migraciones son SQL con comentarios `--` extensos (convención del repo).
// Se despojan antes de aplicar los patrones para que un ejemplo citado dentro
// de un comentario no cuente como código real — esto importa mucho aquí,
// porque varias migraciones citan el SQL vulnerable que vienen a arreglar.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

const RE_CREATE_TABLE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi
const RE_DROP_TABLE =
  /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi
// El nombre de la policy puede ir entre comillas Y LLEVAR ESPACIOS
// ("No direct access to user_sessions"), y el ON suele caer en la línea
// siguiente. Un patrón que asuma nombre sin espacios se salta esas policies y
// declara "sin policy" tablas que sí la tienen — falso positivo peligroso,
// porque empuja a añadir una policy permisiva donde ya hay una deny-all.
const RE_CREATE_POLICY =
  /CREATE\s+POLICY\s+(?:"[^"]+"|[\w]+)\s+ON\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi
const RE_ENABLE_RLS =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi

function collect(re, text) {
  const out = []
  let m
  re.lastIndex = 0
  while ((m = re.exec(text)) !== null) out.push(m[1].toLowerCase())
  return out
}

// Extrae definiciones de función con su cuerpo, para poder inspeccionar si el
// cuerpo lleva el guard. Soporta $$ y $etiqueta$ como delimitadores.
function extractFunctions(sql) {
  const out = []
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?\s*\(([^)]*)\)/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    const name = m[1].toLowerCase()
    const args = m[2]
    const rest = sql.slice(m.index)
    // Cuerpo entre el primer par de delimitadores dollar-quoted.
    const dq = /\$([a-zA-Z_]*)\$/.exec(rest)
    let body = ''
    let header = rest.slice(0, dq ? dq.index : 400)
    if (dq) {
      const tag = `$${dq[1]}$`
      const start = dq.index + tag.length
      const end = rest.indexOf(tag, start)
      body = end === -1 ? rest.slice(start) : rest.slice(start, end)
    }
    out.push({ name, args, header, body })
  }
  return out
}

async function main() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort() // el timestamp del nombre define el orden de aplicación

  const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'))
  // Las entradas pueden ser string o {fn|table, reason}: se exige `reason` en
  // forma de objeto para que ninguna excepción entre sin justificación escrita.
  const norm = (list, key) =>
    new Set((list ?? []).map((e) => (typeof e === 'string' ? e : e[key] ?? e.fn ?? e.name)))
  const allowNoRls = norm(allowlist.tables_without_rls, 'table')
  const allowNoScope = norm(allowlist.functions_without_company_scope, 'fn')
  const allowNoPolicy = norm(allowlist.tables_without_policy, 'table')

  // Estado acumulado aplicando las migraciones en orden.
  const liveTables = new Set() // creadas y no dropeadas
  const rlsEnabled = new Set()
  const createdIn = new Map() // tabla → primera migración que la crea
  const functions = new Map() // nombre → última definición (last writer gana)
  const grantedToAuthenticated = new Set()
  const tablesWithPolicy = new Set()

  for (const file of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const sql = stripComments(raw)

    for (const t of collect(RE_CREATE_TABLE, sql)) {
      if (!liveTables.has(t)) createdIn.set(t, file)
      liveTables.add(t)
    }
    for (const t of collect(RE_DROP_TABLE, sql)) {
      liveTables.delete(t)
      rlsEnabled.delete(t)
    }
    for (const t of collect(RE_ENABLE_RLS, sql)) rlsEnabled.add(t)

    // Policies, en sus DOS formas. Contar solo las estáticas daría un falso
    // positivo enorme: TODO el ERP financiero (conta_*, cxp_*, presupuesto_*,
    // bancos) crea sus policies dentro de bloques `DO $$ ... FOREACH t IN ARRAY
    // ARRAY['tabla_a','tabla_b'] ... EXECUTE format('CREATE POLICY ...') $$`.
    // Un escaneo ingenuo declara "sin policy" 11 tablas que sí las tienen.
    for (const t of collect(RE_CREATE_POLICY, sql)) tablesWithPolicy.add(t)
    for (const doBlock of sql.match(/DO\s*\$\$[\s\S]*?END\s*\$\$/gi) ?? []) {
      if (!/CREATE\s+POLICY/i.test(doBlock)) continue
      for (const arr of doBlock.match(/ARRAY\s*\[([^\]]*)\]/gi) ?? []) {
        for (const lit of arr.match(/'([\w]+)'/g) ?? []) {
          tablesWithPolicy.add(lit.replace(/'/g, '').toLowerCase())
        }
      }
    }

    for (const fn of extractFunctions(sql)) {
      functions.set(fn.name, { ...fn, file })
    }
    // GRANT EXECUTE ... TO ... authenticated
    const grantRe =
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?[^;]*?\bauthenticated\b/gi
    let g
    while ((g = grantRe.exec(sql)) !== null) {
      grantedToAuthenticated.add(g[1].toLowerCase())
    }
  }

  // ── Regla (a): toda tabla viva de public debe tener RLS ───────────────────
  const missingRls = [...liveTables]
    .filter((t) => !rlsEnabled.has(t) && !allowNoRls.has(t))
    .sort()

  // ── Regla (c): RLS habilitada pero SIN ninguna policy ────────────────────
  // Es fail-closed (nadie lee), así que no es un agujero — pero sí un estado
  // ambiguo: no se distingue "deny-all a propósito" de "se olvidó la policy",
  // y el repo deja de reproducir prod, donde el guard nocturno exige ≥1 policy.
  // Exigir una deny-all EXPLÍCITA vuelve la intención auditable.
  const rlsNoPolicy = [...liveTables]
    .filter((t) => rlsEnabled.has(t) && !tablesWithPolicy.has(t) && !allowNoPolicy.has(t))
    .sort()

  // ── Regla (b): RPC SECURITY DEFINER con p_company_id/p_project_id,
  //    ejecutable por `authenticated`, debe llamar a assert_company_scope() ──
  const missingScope = []
  for (const [name, fn] of functions) {
    if (allowNoScope.has(name)) continue
    if (!/SECURITY\s+DEFINER/i.test(fn.header)) continue
    if (!/\bp_(company|project)_id\b/i.test(fn.args)) continue
    if (!grantedToAuthenticated.has(name)) continue
    // Lo que se exige NO es una forma concreta de guard, sino que el cuerpo
    // consulte la identidad REAL del caller en algún punto. Hay dos patrones
    // válidos y ambos se aceptan:
    //
    //   · RECHAZAR  → assert_company_scope() / RAISE 42501  (get_company_*)
    //   · FILTRAR   → WHERE ... = get_my_company_id()       (agua_*, kpis_*)
    //
    // Filtrar es incluso preferible en RPCs de reporte: devuelve vacío en vez
    // de reventar. Exigir solo el RAISE marcaba como vulnerables funciones
    // correctamente acotadas (agua_anomalias_consumo, get_kpis_tenant_mensual,
    // agua_consumo_comunidad) — y un guard que grita en falso acaba apagado.
    //
    // Lo que SÍ se caza: un cuerpo que use el id que le pasa el cliente sin
    // referirse jamás a quién es el caller.
    const guarded =
      /assert_company_scope|get_my_company_id|get_my_cliente_id|get_my_user_id|is_super_admin/i.test(
        fn.body,
      )
    if (!guarded) missingScope.push({ name, file: fn.file })
  }

  // ── Reporte ───────────────────────────────────────────────────────────────
  const report = ['🔎 Migrations guard — análisis estático del repo', '']
  report.push(
    `(a) tablas de public vivas SIN ENABLE ROW LEVEL SECURITY: ${missingRls.length}`,
  )
  for (const t of missingRls) {
    report.push(`    ✗ ${t}  [creada en ${createdIn.get(t)} — sin RLS en ninguna migración]`)
  }
  report.push(`(c) tablas con RLS pero SIN ninguna policy: ${rlsNoPolicy.length}`)
  for (const t of rlsNoPolicy) {
    report.push(`    ✗ ${t}  [RLS habilitada y ninguna policy — declara una deny-all explícita]`)
  }
  report.push(
    `(b) RPCs SECURITY DEFINER con p_company_id/p_project_id ejecutables por authenticated y SIN guard de scope: ${missingScope.length}`,
  )
  for (const f of missingScope) {
    report.push(`    ✗ ${f.name}  [última definición en ${f.file} — falta assert_company_scope()]`)
  }

  console.log(report.join('\n'))
  console.log('')

  const total = missingRls.length + rlsNoPolicy.length + missingScope.length
  if (total > 0) {
    console.error(`❌ migrations-guard: ${total} hallazgo(s) en el repo.`)
    console.error('   Añade la migración que falta, o —si la excepción es intencional y revisada—')
    console.error('   documéntala en scripts/migrations-guard.allowlist.json con su `reason`.')
    process.exit(1)
  }
  console.log('✅ migrations-guard: RLS + policies declaradas y RPCs con scope.')
  process.exit(0)
}

main().catch((err) => {
  console.error(`❌ migrations-guard: error inesperado — ${err.stack || err.message}`)
  process.exit(1)
})
