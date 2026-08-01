#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Security guard (T8) — verifica, contra el catálogo de PRODUCCIÓN (solo LECTURA,
// sin mutación), que NO se haya abierto un hueco multi-tenant. Regresa-guarda la
// clase de bug de #378/#380 (RPCs SECURITY DEFINER ejecutables por `anon` vía
// DEFAULT PRIVILEGES) y exige RLS+policy en TODA tabla de `public`.
//
// Corre 3 consultas de catálogo vía Management API de Supabase:
//   (a) NINGUNA función SECURITY DEFINER de `public` debe ser anon-ejecutable.
//   (b) TODA tabla de `public` debe tener RLS habilitado.
//   (c) TODA tabla de `public` debe tener ≥1 policy.
// A cada resultado se le RESTA el allowlist revisado (security-guard.allowlist.json).
// Si queda CUALQUIER fila no permitida → exit 1 (falla CI).
//
// Es complemento de apply-migrations-prod.yml: tras aplicar migraciones a prod,
// este guard confirma que el esquema sigue cerrado. SOLO lee catálogo (pg_proc /
// pg_class / pg_policy) — jamás muta datos ni esquema.
//
// Credencial-gated: sin SUPABASE_PROJECT_ID / SUPABASE_ACCESS_TOKEN, sale 0 (no-op)
// con un aviso, para que correrlo sin secretos (local / CI sin wiring) no rompa.
// Cuando hay credenciales y una consulta falla (red/API), sale 1 (fail-closed):
// un guard de seguridad que no puede verificar NO debe pasar en silencio.
//
// Uso:  SUPABASE_PROJECT_ID=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/security-guard.mjs
// ════════════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

const __dirname = dirname(fileURLToPath(import.meta.url))
const ALLOWLIST_PATH = join(__dirname, 'security-guard.allowlist.json')

// ── Consultas de catálogo (idénticas a la spec T8) ──────────────────────────
const QUERIES = {
  anonSecurityDefiner: `
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by p.proname;`,
  tablesWithoutRls: `
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    order by c.relname;`,
  tablesWithoutPolicy: `
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and not exists (select 1 from pg_policy pol where pol.polrelid=c.oid)
    order by c.relname;`,
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
    // Se nombra aparte porque es la ÚNICA causa de fallo del guard que no se
    // arregla en el repo: no hay hueco de aislamiento que investigar, hay una
    // credencial que atender. Sin esto el rojo se lee como hallazgo de seguridad.
    //
    // 401 y 403 NO son el mismo problema y no se colapsan: 401 es el token
    // muerto (lo que pasó el 2026-08-01); un 403 puede ser falta de permiso
    // sobre el proyecto o —fuera de Actions— un proxy de egreso contestando por
    // Supabase. Decir "token revocado" ante un 403 manda a rotar un token sano.
    const err = new Error(`Management API ${res.status}: ${text.slice(0, 300)}`)
    err.authStatus = res.status
    throw err
  }
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text.slice(0, 500)}`)
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Respuesta no-JSON de Management API: ${text.slice(0, 500)}`)
  }
  if (body && body.error) {
    throw new Error(`Error de consulta: ${JSON.stringify(body.error)}`)
  }
  if (!Array.isArray(body)) {
    throw new Error(`Respuesta inesperada (se esperaba array de filas): ${text.slice(0, 500)}`)
  }
  return body
}

function fnKey(row) {
  // Clave canónica de función: proname(args). Permite allowlistar una sobrecarga
  // específica; allowlistar solo por nombre también funciona (ver subtract()).
  return row.args ? `${row.proname}(${row.args})` : row.proname
}

async function main() {
  if (!PROJECT_ID || !ACCESS_TOKEN) {
    console.log(
      '⏭️  security-guard: faltan SUPABASE_PROJECT_ID / SUPABASE_ACCESS_TOKEN — omitido (no-op verde).',
    )
    console.log('   Define ambos para verificar el catálogo de prod (solo lectura).')
    process.exit(0)
  }

  const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'))
  const allowFns = new Set(
    (allowlist.anon_executable_security_definer_functions ?? []).map((e) =>
      typeof e === 'string' ? e : e.fn ?? e.name,
    ),
  )
  const allowNoRls = new Set(
    (allowlist.tables_without_rls ?? []).map((e) => (typeof e === 'string' ? e : e.table)),
  )
  const allowNoPolicy = new Set(
    (allowlist.tables_without_policy ?? []).map((e) => (typeof e === 'string' ? e : e.table)),
  )

  let anonFns, noRls, noPolicy
  try {
    ;[anonFns, noRls, noPolicy] = await Promise.all([
      runQuery(QUERIES.anonSecurityDefiner),
      runQuery(QUERIES.tablesWithoutRls),
      runQuery(QUERIES.tablesWithoutPolicy),
    ])
  } catch (err) {
    console.error(`❌ security-guard: no se pudo consultar el catálogo — ${err.message}`)
    if (err.authStatus) {
      console.error('')
      console.error('   CREDENCIAL, NO HALLAZGO: el catálogo no se leyó, así que este rojo')
      console.error('   no dice nada sobre el aislamiento multi-tenant.')
      if (err.authStatus === 401) {
        console.error('   401 = SUPABASE_ACCESS_TOKEN inválido, expirado o revocado.')
        console.error('   Rotar en Supabase → Account → Access Tokens y actualizar el secret')
        console.error('   del repo (Settings → Secrets and variables → Actions).')
      } else {
        console.error('   403 = el token existe pero no tiene permiso sobre este proyecto')
        console.error('   (o, fuera de Actions, un proxy de egreso contestó por Supabase).')
        console.error('   Revisar el scope del token y SUPABASE_PROJECT_ID antes de rotar nada.')
      }
      console.error('   El mismo token lo comparten apply-migration, apply-migrations-prod,')
      console.error('   deploy-functions, types-drift, auth-hardening y cleanup-preview-branches:')
      console.error('   los seis fallan igual hasta que se resuelva.')
      console.error('')
    }
    console.error('   Fail-closed: un guard que no puede verificar NO pasa.')
    process.exit(1)
  }

  // (a) Funciones SECURITY DEFINER anon-ejecutables, restando el allowlist (por
  //     firma exacta `name(args)` o solo por nombre).
  const fnViolations = anonFns.filter(
    (r) => !allowFns.has(fnKey(r)) && !allowFns.has(r.proname),
  )
  const rlsViolations = noRls.filter((r) => !allowNoRls.has(r.relname))
  const policyViolations = noPolicy.filter((r) => !allowNoPolicy.has(r.relname))

  const report = []
  report.push('🔒 Security guard — catálogo de prod (solo lectura)')
  report.push('')
  report.push(`(a) SECURITY DEFINER anon-ejecutables: ${anonFns.length} hallada(s), ${fnViolations.length} no permitida(s)`)
  for (const r of fnViolations) report.push(`    ✗ ${fnKey(r)}  [anon NO debe ejecutar SECURITY DEFINER de public — ver #378/#380]`)
  report.push(`(b) tablas de public SIN RLS: ${noRls.length} hallada(s), ${rlsViolations.length} no permitida(s)`)
  for (const r of rlsViolations) report.push(`    ✗ ${r.relname}  [tabla de public sin RLS habilitado]`)
  report.push(`(c) tablas de public SIN policy: ${noPolicy.length} hallada(s), ${policyViolations.length} no permitida(s)`)
  for (const r of policyViolations) report.push(`    ✗ ${r.relname}  [tabla de public con RLS pero sin ninguna policy]`)

  const total = fnViolations.length + rlsViolations.length + policyViolations.length
  console.log(report.join('\n'))
  console.log('')

  if (total > 0) {
    console.error(`❌ security-guard: ${total} violación(es) de aislamiento multi-tenant.`)
    console.error('   Si alguna es intencional y revisada, agrégala a scripts/security-guard.allowlist.json con justificación.')
    process.exit(1)
  }
  console.log('✅ security-guard: catálogo cerrado — sin huecos de aislamiento.')
  process.exit(0)
}

main().catch((err) => {
  console.error(`❌ security-guard: error inesperado — ${err.stack || err.message}`)
  process.exit(1)
})
