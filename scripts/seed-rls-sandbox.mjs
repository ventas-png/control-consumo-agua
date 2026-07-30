#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Seed del sandbox para el harness de RLS (auditoría 2026-07-28).
//
// POR QUÉ EXISTE
// `src/test/rls/rlsHarness.test.ts` verifica el aislamiento multi-tenant contra
// un Supabase REAL: dos usuarios de DISTINTA empresa, y la afirmación de que los
// conjuntos de `company_id` que ve cada uno son disjuntos. Es la comprobación
// que respalda todo el Bloque A de la auditoría… y NUNCA se ha ejecutado, porque
// nadie tenía dos usuarios de dos empresas con contraseña conocida. El job está
// verde por omisión desde que se creó.
//
// Este script crea exactamente eso, para que activar el harness sea "correr esto
// y pegar 6 secretos" en vez de un proyecto manual.
//
// ⚠️ EL DETALLE QUE HACE QUE ESTO NO SEA COSMÉTICO
// La aserción de aislamiento es:
//
//     for (const co of bCos) expect(aCos.has(co)).toBe(false)
//
// Si A y B no ven NINGUNA fila, ambos conjuntos son vacíos, el bucle no itera y
// **el test pasa sin probar nada**. Sería exactamente el mismo verde hueco que
// venimos persiguiendo. Por eso el seed no se limita a crear usuarios: siembra
// filas reales en tablas tenant-scoped para las DOS empresas, y al final
// VERIFICA que cada usuario ve las suyas y no las de la otra. Si el seed no
// puede demostrar eso, sale con error en vez de dejar un sandbox que produzca
// un verde vacío.
//
// USO
//   SEED_SUPABASE_URL=https://<ref>.supabase.co \
//   SEED_SERVICE_ROLE_KEY=<service_role del SANDBOX> \
//   node scripts/seed-rls-sandbox.mjs
//
// Es idempotente: se puede volver a correr sin duplicar nada.
//
// ⚠️ NUNCA CONTRA PRODUCCIÓN. El script se niega a correr contra el ref de prod
// y exige una confirmación explícita para cualquier proyecto (abajo).
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

// ── Salvaguardas ────────────────────────────────────────────────────────────
// El ref de producción, quemado a propósito: este script CREA usuarios y datos
// de prueba, y hacerlo en prod contaminaría el tenant real de un cliente.
const PROD_REF = 'nnsqmeigtgewatameexo'

const URL = process.env.SEED_SUPABASE_URL ?? ''
const KEY = process.env.SEED_SERVICE_ROLE_KEY ?? ''

if (!URL || !KEY) {
  console.error(`
❌ Faltan variables.

   SEED_SUPABASE_URL=https://<ref>.supabase.co
   SEED_SERVICE_ROLE_KEY=<service_role key del SANDBOX>

   La service_role key está en: Dashboard → Project Settings → API → service_role.
   NO la pegues en el repo ni en un secreto de GitHub: sólo se usa aquí, en local.
`)
  process.exit(1)
}

if (URL.includes(PROD_REF)) {
  console.error(`
❌ ABORTADO: la URL apunta al proyecto de PRODUCCIÓN (${PROD_REF}).

   Este script crea empresas y usuarios de prueba. Creá un proyecto Supabase
   aparte para el sandbox y volvé a intentarlo con su URL.
`)
  process.exit(1)
}

if (process.env.SEED_CONFIRM !== 'si') {
  console.error(`
⚠️  Confirmación requerida.

   Vas a crear 2 empresas, 2 usuarios y datos de prueba en:
     ${URL}

   Si es el sandbox correcto, repetí el comando añadiendo SEED_CONFIRM=si
`)
  process.exit(1)
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

/** Empresa por nombre, creándola si no existe (idempotente). */
async function upsertEmpresa(nombre) {
  const { data: found, error: e1 } = await admin
    .from('companies').select('id').eq('nombre', nombre).maybeSingle()
  if (e1) throw new Error(`companies select: ${e1.message}`)
  if (found) return found.id

  const { data, error } = await admin
    .from('companies').insert({ nombre }).select('id').single()
  if (error) throw new Error(`companies insert: ${error.message}`)
  return data.id
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

/** Fila de app_users que ata el usuario a su empresa (es lo que lee get_my_company_id). */
async function upsertAppUser(userId, companyId, nombre) {
  const { error } = await admin.from('app_users').upsert({
    id: userId, company_id: companyId, role: 'company_owner',
    full_name: nombre, activo: true,
  }, { onConflict: 'id' })
  if (error) throw new Error(`app_users upsert: ${error.message}`)
}

/**
 * Filas en tablas TENANT_SCOPED para que la aserción de disjunción tenga algo
 * que comparar. Se eligen `proveedores` y `conta_cuentas` porque están en la
 * lista del harness y sólo necesitan `company_id` — `cuotas_condominio` exigiría
 * montar proyecto y unidades.
 */
async function seedDatos(companyId, key) {
  const prov = { company_id: companyId, nombre: `Proveedor sandbox ${key}` }
  const { data: pExist } = await admin
    .from('proveedores').select('id').eq('company_id', companyId).eq('nombre', prov.nombre).maybeSingle()
  if (!pExist) {
    const { error } = await admin.from('proveedores').insert(prov)
    if (error) throw new Error(`proveedores insert: ${error.message}`)
  }

  const cta = {
    company_id: companyId, codigo: `1000-${key}`, nombre: `Caja sandbox ${key}`,
    tipo: 'activo', naturaleza: 'deudora',
  }
  const { data: cExist } = await admin
    .from('conta_cuentas').select('id').eq('company_id', companyId).eq('codigo', cta.codigo).maybeSingle()
  if (!cExist) {
    const { error } = await admin.from('conta_cuentas').insert(cta)
    if (error) throw new Error(`conta_cuentas insert: ${error.message}`)
  }
}

// ── Ejecución ───────────────────────────────────────────────────────────────
console.log('\n🌱 Seed del sandbox RLS\n')
console.log(`   Proyecto: ${URL}\n`)

const creado = []
for (const t of TENANTS) {
  const companyId = await upsertEmpresa(t.empresa)
  const userId = await upsertUsuario(t.email, t.pass)
  await upsertAppUser(userId, companyId, `Usuario RLS ${t.key}`)
  await seedDatos(companyId, t.key)
  creado.push({ ...t, companyId, userId })
  log(`✔ ${t.key}: empresa ${companyId}  usuario ${userId}`)
}

// ── Verificación: que el sandbox NO produzca un verde vacío ─────────────────
// Se entra como cada usuario con la anon key y se comprueba que (1) ve filas
// suyas y (2) no ve ninguna de la otra empresa. Sin esto, un seed a medias
// dejaría un harness que pasa sin comparar nada.
console.log('\n🔍 Verificando que el aislamiento sea COMPROBABLE (no vacío)\n')

const ANON = process.env.SEED_ANON_KEY ?? ''
if (!ANON) {
  console.log('   ⚠️  Sin SEED_ANON_KEY no se puede verificar como usuario final.')
  console.log('       Añadila (Dashboard → API → anon public) y volvé a correr para')
  console.log('       comprobar el aislamiento de verdad antes de fiarte del harness.\n')
} else {
  let fallos = 0
  for (const t of creado) {
    const cli = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: eLogin } = await cli.auth.signInWithPassword({ email: t.email, password: t.pass })
    if (eLogin) throw new Error(`login ${t.email}: ${eLogin.message}`)

    const { data: provs, error } = await cli.from('proveedores').select('company_id')
    if (error) throw new Error(`select proveedores como ${t.key}: ${error.message}`)

    const vistos = new Set((provs ?? []).map((r) => r.company_id))
    const propias = vistos.has(t.companyId)
    const ajenas = creado.filter((o) => o.key !== t.key).some((o) => vistos.has(o.companyId))

    if (!propias) { console.log(`   ❌ ${t.key} NO ve sus propias filas — la disjunción sería trivial`); fallos++ }
    else if (ajenas) { console.log(`   ❌ ${t.key} VE filas de la otra empresa — fuga real de tenant`); fallos++ }
    else console.log(`   ✔ ${t.key} ve sus filas y ninguna de la otra empresa`)
  }
  if (fallos > 0) {
    console.error('\n❌ El sandbox no está en condiciones: el harness daría un verde sin significado.\n')
    process.exit(1)
  }
}

// ── Salida ──────────────────────────────────────────────────────────────────
console.log(`
✅ Sandbox listo.

Pegá estos 6 secretos en el repo
(Settings → Secrets and variables → Actions → New repository secret):

  RLS_SUPABASE_URL        ${URL}
  RLS_SUPABASE_ANON_KEY   <anon public key del sandbox>
  RLS_USER_A_EMAIL        ${creado[0].email}
  RLS_USER_A_PASSWORD     ${creado[0].pass}
  RLS_USER_B_EMAIL        ${creado[1].email}
  RLS_USER_B_PASSWORD     ${creado[1].pass}

Con eso, el job "RLS harness (server-side)" deja de ser un no-op y pasa a
verificar el aislamiento multi-tenant de verdad en cada PR.

Las contraseñas se generan nuevas en cada corrida y NO se guardan en ningún
sitio: si las perdés, volvé a correr el script y usá las nuevas.
`)
