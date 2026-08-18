#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Seed del sandbox para el harness de RLS.
//
// POR QUÉ EXISTE
// `src/test/rls/rlsHarness.test.ts` verifica el aislamiento multi-tenant contra
// un Supabase REAL: dos usuarios de DISTINTA empresa, y la afirmación de que los
// conjuntos de `company_id` que ve cada uno son disjuntos.
//
// ⚠️ EL DETALLE QUE HACE QUE ESTO NO SEA COSMÉTICO
// La aserción de aislamiento es:
//
//     for (const co of bCos) expect(aCos.has(co)).toBe(false)
//
// Si A y B no ven NINGUNA fila, ambos conjuntos son vacíos, el bucle no itera y
// **el test pasa sin probar nada**. Por eso este script no se limita a crear
// usuarios: siembra filas reales en TODAS las tablas declaradas como cobertura
// no trivial (`src/test/rls/coverage.json` → `noTriviales`) y luego VERIFICA,
// entrando como cada usuario con la anon key, que cada uno ve ≥1 fila propia y
// CERO filas de la otra empresa, tabla por tabla. Si no puede demostrarlo, sale
// con error: nunca deja un sandbox que produzca un verde vacío.
//
// USO
//   SEED_SUPABASE_URL=https://<ref>.supabase.co \
//   SEED_SERVICE_ROLE_KEY=<service_role del SANDBOX> \
//   SEED_ANON_KEY=<anon public del SANDBOX> \
//   SEED_CONFIRM=si \
//   node scripts/seed-rls-sandbox.mjs
//
// Es idempotente: se puede volver a correr sin duplicar nada.
//
// ⚠️ NUNCA CONTRA PRODUCCIÓN. Se niega a correr contra el ref de prod y exige
// confirmación explícita para cualquier proyecto.
//
// ⚠️ LA service_role SÓLO SE USA AQUÍ, en la máquina del operador. NO va a
// ningún secreto de GitHub: CI sólo recibe la anon key y las credenciales de
// los dos usuarios de prueba, que son de bajo privilegio (company_owner de una
// empresa de juguete en un proyecto desechable).
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const AQUI = dirname(fileURLToPath(import.meta.url))

// Manifiesto compartido con el harness: no puede desincronizarse.
const COBERTURA = JSON.parse(
  readFileSync(join(AQUI, '..', 'src', 'test', 'rls', 'coverage.json'), 'utf8'),
)
const NO_TRIVIALES = COBERTURA.noTriviales

// ── Salvaguardas ────────────────────────────────────────────────────────────
// El ref de producción, quemado a propósito: este script CREA usuarios y datos
// de prueba, y hacerlo en prod contaminaría el tenant real de un cliente.
const PROD_REF = 'nnsqmeigtgewatameexo'

const URL = process.env.SEED_SUPABASE_URL ?? ''
const KEY = process.env.SEED_SERVICE_ROLE_KEY ?? ''
const ANON = process.env.SEED_ANON_KEY ?? ''

function abortar(mensaje) {
  console.error(`\n${mensaje}\n`)
  process.exit(1)
}

if (!URL || !KEY) {
  abortar(`❌ Faltan variables.

   SEED_SUPABASE_URL=https://<ref>.supabase.co
   SEED_SERVICE_ROLE_KEY=<service_role key del SANDBOX>

   La service_role está en: Dashboard → Project Settings → API → service_role.
   NO la pegues en el repo ni en un secreto de GitHub: sólo se usa aquí, en local.`)
}

// SEED_ANON_KEY es OBLIGATORIA: sin ella el script podría sembrar y salir
// "verde" sin haber comprobado el aislamiento desde un cliente autenticado, que
// es justo la garantía por la que existe. Antes era opcional y ese era el hueco.
if (!ANON) {
  abortar(`❌ Falta SEED_ANON_KEY (obligatoria).

   SEED_ANON_KEY=<anon public key del SANDBOX>   (Dashboard → API → anon public)

   Es la clave con la que el script entra como cada usuario para DEMOSTRAR el
   aislamiento. Sin ella sólo podría insertar filas y afirmar que todo está bien
   sin haberlo comprobado — exactamente el verde hueco que este seed evita.`)
}

if (URL.includes(PROD_REF)) {
  abortar(`❌ ABORTADO: la URL apunta al proyecto de PRODUCCIÓN (${PROD_REF}).

   Este script crea empresas y usuarios de prueba. Creá un proyecto Supabase
   aparte para el sandbox y volvé a intentarlo con su URL.`)
}

if (process.env.SEED_CONFIRM !== 'si') {
  abortar(`⚠️  Confirmación requerida.

   Vas a crear 2 empresas, 2 usuarios y datos de prueba en:
     ${URL}

   Si es el sandbox correcto, repetí el comando añadiendo SEED_CONFIRM=si`)
}

// ── Datos a crear ───────────────────────────────────────────────────────────
// Contraseñas generadas por corrida: no se versiona ninguna credencial. Se
// imprimen al final para que las pegues en los secretos del repo.
function password() {
  // 24 chars base64url a partir de 18 bytes de aleatoriedad criptográfica.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')
}

const TENANTS = [
  { key: 'A', empresa: 'RLS Sandbox — Empresa A', email: 'rls-a@sandbox.invalid', pass: password() },
  { key: 'B', empresa: 'RLS Sandbox — Empresa B', email: 'rls-b@sandbox.invalid', pass: password() },
]

const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const log = (...a) => console.log('  ', ...a)

/** Inserta si no existe una fila que case con `match`. Devuelve su id. */
async function upsertPorMatch(tabla, match, fila) {
  let q = admin.from(tabla).select('id')
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
  const { data: found, error: eSel } = await q.maybeSingle()
  if (eSel) throw new Error(`${tabla} select: ${eSel.message}`)
  if (found) return found.id

  const { data, error } = await admin.from(tabla).insert(fila).select('id').single()
  if (error) throw new Error(`${tabla} insert: ${error.message}`)
  return data.id
}

/** Empresa por nombre, creándola si no existe (idempotente). */
async function upsertEmpresa(nombre) {
  return upsertPorMatch('companies', { nombre }, { nombre })
}

/** Usuario de auth por email, creándolo si no existe. Devuelve su id. */
async function upsertUsuario(email, pass) {
  // No hay getUserByEmail en la API admin; se pagina el listado. El sandbox
  // tiene pocos usuarios, así que una página basta y evita depender de filtros.
  const { data: list, error: eList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (eList) throw new Error(`listUsers: ${eList.message}`)
  const existing = list.users.find((u) => u.email === email)

  if (existing) {
    // Se reescribe la contraseña para que la impresa al final sea siempre la
    // válida, aunque el usuario venga de una corrida anterior.
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: pass })
    if (error) throw new Error(`updateUserById: ${error.message}`)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email, password: pass, email_confirm: true,
  })
  if (error) throw new Error(`createUser: ${error.message}`)
  return data.user.id
}

/** Fila de app_users que ata el usuario a su empresa (lo que lee get_my_company_id). */
async function upsertAppUser(userId, companyId, nombre) {
  const { error } = await admin.from('app_users').upsert({
    id: userId, company_id: companyId, role: 'company_owner',
    full_name: nombre, activo: true,
  }, { onConflict: 'id' })
  if (error) throw new Error(`app_users upsert: ${error.message}`)
}

/**
 * Siembra TODAS las tablas declaradas como cobertura no trivial.
 *
 * `proveedores` y `conta_cuentas` sólo necesitan company_id. `cuotas_condominio`
 * exige proyecto (y se le da unidad, para que la fila sea realista) y
 * `documentos_fiscales` exige régimen: por eso el seed crea antes un proyecto y
 * una unidad por empresa. Esa dependencia es la razón por la que la versión
 * anterior las dejaba fuera y su aserción de disjunción era trivial.
 */
async function seedDatos(companyId, key) {
  // Proyecto y unidad: prerequisitos de cuotas_condominio.
  const projectId = await upsertPorMatch(
    'projects',
    { company_id: companyId, nombre: `Proyecto sandbox ${key}` },
    { company_id: companyId, nombre: `Proyecto sandbox ${key}`, estado: 'activo' },
  )

  const unidadId = await upsertPorMatch(
    'unidades',
    { company_id: companyId, project_id: projectId, nombre: `Unidad sandbox ${key}` },
    { company_id: companyId, project_id: projectId, nombre: `Unidad sandbox ${key}` },
  )

  await upsertPorMatch(
    'proveedores',
    { company_id: companyId, nombre: `Proveedor sandbox ${key}` },
    { company_id: companyId, nombre: `Proveedor sandbox ${key}` },
  )

  await upsertPorMatch(
    'conta_cuentas',
    { company_id: companyId, codigo: `1000-${key}` },
    {
      company_id: companyId, codigo: `1000-${key}`, nombre: `Caja sandbox ${key}`,
      tipo: 'activo', naturaleza: 'deudora', nivel: 1,
    },
  )

  await upsertPorMatch(
    'cuotas_condominio',
    { company_id: companyId, project_id: projectId, periodo: '2099-01' },
    {
      company_id: companyId, project_id: projectId, unidad_id: unidadId,
      concepto: `Cuota sandbox ${key}`, monto: 100, periodo: '2099-01', estado: 'pendiente',
    },
  )

  await upsertPorMatch(
    'documentos_fiscales',
    { company_id: companyId, serie: `SANDBOX-${key}` },
    {
      company_id: companyId, regimen: 'general', tipo: 'factura',
      serie: `SANDBOX-${key}`, numero: '1',
    },
  )

  return { projectId, unidadId }
}

// ── Ejecución ───────────────────────────────────────────────────────────────
console.log('\n🌱 Seed del sandbox RLS\n')
console.log(`   Proyecto: ${URL}`)
console.log(`   Tablas con cobertura NO TRIVIAL: ${NO_TRIVIALES.join(', ')}\n`)

const creado = []
for (const t of TENANTS) {
  const companyId = await upsertEmpresa(t.empresa)
  const userId = await upsertUsuario(t.email, t.pass)
  await upsertAppUser(userId, companyId, `Usuario RLS ${t.key}`)
  const { projectId } = await seedDatos(companyId, t.key)
  creado.push({ ...t, companyId, userId, projectId })
  log(`✔ ${t.key}: empresa ${companyId}  usuario ${userId}`)
}

// ── Verificación: que el sandbox NO produzca un verde vacío ─────────────────
// Se entra como CADA usuario con la anon key y se comprueba, TABLA POR TABLA,
// que (1) ve ≥1 fila suya y (2) no ve NINGUNA de la otra empresa. Un fallo en
// cualquiera de las dos condiciones aborta: la primera dejaría una disjunción
// trivial (verde hueco); la segunda sería una fuga real de tenant.
console.log('\n🔍 Verificando el aislamiento como cada usuario (anon key + login)\n')

const fallos = []
const resumen = []

for (const t of creado) {
  const cli = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: eLogin } = await cli.auth.signInWithPassword({ email: t.email, password: t.pass })
  if (eLogin) {
    // Fail-closed: sin poder autenticar no hay nada demostrado.
    abortar(`❌ No se pudo autenticar ${t.email}: ${eLogin.message}
   El sandbox no queda verificado; no se emite "Sandbox listo".`)
  }

  const ajenas = creado.filter((o) => o.key !== t.key).map((o) => o.companyId)

  for (const tabla of NO_TRIVIALES) {
    const { data, error } = await cli.from(tabla).select('company_id')
    if (error) {
      fallos.push(`${t.key} · ${tabla}: error leyendo (${error.message})`)
      continue
    }
    const vistos = new Set((data ?? []).map((r) => r.company_id))
    const propias = vistos.has(t.companyId)
    const fuga = ajenas.filter((c) => vistos.has(c))

    if (!propias) {
      fallos.push(`${t.key} · ${tabla}: NO ve ninguna fila propia → la disjunción sería trivial`)
    } else if (fuga.length > 0) {
      fallos.push(`${t.key} · ${tabla}: VE filas de otra empresa (${fuga.join(', ')}) → fuga real de tenant`)
    } else {
      resumen.push(`${t.key} · ${tabla}: ${vistos.size} company_id visible (sólo el propio)`)
      log(`✔ ${t.key} · ${tabla}: ve lo suyo y nada ajeno`)
    }
  }

  await cli.auth.signOut()
}

if (fallos.length > 0) {
  console.error('\n❌ El sandbox NO está en condiciones. El harness daría un verde sin significado:\n')
  for (const f of fallos) console.error(`   • ${f}`)
  console.error(`
   Si alguna de estas tablas no se puede sembrar en tu esquema, NO la dejes
   declarada como cobertura real: movela de "noTriviales" a "estructurales" en
   src/test/rls/coverage.json y documentá la limitación. Lo que no se puede
   demostrar no se declara demostrado.
`)
  process.exit(1)
}

// ── Salida ──────────────────────────────────────────────────────────────────
// Sólo se llega aquí si CADA usuario fue autenticado y CADA tabla no trivial
// quedó verificada en ambos sentidos.
console.log('\n📋 Cobertura demostrada (A y B con datos propios y sin fuga):\n')
for (const r of resumen) console.log(`   • ${r}`)

const estructurales = COBERTURA.estructurales
console.log(`
📋 Cobertura ESTRUCTURAL (tablas que quedan VACÍAS — su disjunción NO demuestra
   aislamiento; el harness sólo comprueba que la policy responde sin fuga):
`)
for (const e of estructurales) {
  console.log(`   • ${e} — ${COBERTURA.motivoEstructural[e] ?? 'sin sembrar'}`)
}

console.log(`
✅ Sandbox listo y VERIFICADO como ambos usuarios.

Pegá estos 6 secretos en el repo
(Settings → Secrets and variables → Actions → New repository secret):

  RLS_SUPABASE_URL        ${URL}
  RLS_SUPABASE_ANON_KEY   <anon public key del sandbox>
  RLS_USER_A_EMAIL        ${creado[0].email}
  RLS_USER_A_PASSWORD     ${creado[0].pass}
  RLS_USER_B_EMAIL        ${creado[1].email}
  RLS_USER_B_PASSWORD     ${creado[1].pass}

⚠️  La service_role NO va a GitHub. CI sólo recibe la anon key y estas dos
   cuentas de bajo privilegio.

Las contraseñas se generan nuevas en cada corrida y NO se guardan en ningún
sitio: si las perdés, volvé a correr el script y usá las nuevas.
`)
