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
// ⚠️ NUNCA CONTRA PRODUCCIÓN. Tres cerrojos independientes, todos obligatorios:
//   1. la URL debe ser de un dominio Supabase reconocido (coverage.json);
//   2. el ref NO puede ser el de producción (lista negra explícita);
//   3. SEED_EXPECTED_REF debe COINCIDIR con el ref de la URL — hay que declarar
//      de antemano contra qué sandbox se va a sembrar, así que un copiar-pegar
//      de la URL equivocada no basta para ejecutar nada.
// Más SEED_CONFIRM=si como confirmación interactiva.
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

/** Ref del proyecto a partir de la URL `https://<ref>.<dominio>`. */
export function refDeUrl(url) {
  const m = /^https:\/\/([a-z0-9-]+)\.([a-z0-9.-]+)$/i.exec((url ?? '').trim().replace(/\/+$/, ''))
  return m ? { ref: m[1], dominio: m[2] } : null
}

/**
 * Valida que la URL apunte a un sandbox DECLARADO. Pura, para poder probarla.
 *
 * El bloqueo del ref de producción no basta por sí solo: protege contra UN
 * proyecto conocido y deja pasar cualquier otro, incluido el de otro cliente o
 * un dominio que no sea Supabase. Por eso se exige además que el operador
 * declare `SEED_EXPECTED_REF` y que coincida con el ref de la URL.
 *
 * @returns {{ ok: true, ref: string } | { ok: false, motivo: string }}
 */
export function validarUrlSandbox(url, esperado, cobertura) {
  const partes = refDeUrl(url)
  if (!partes) {
    return { ok: false, motivo: `la URL "${url}" no tiene la forma https://<ref>.<dominio>` }
  }

  const dominiosOk = cobertura?.dominiosSandboxPermitidos ?? []
  if (!dominiosOk.some((d) => partes.dominio === d || partes.dominio.endsWith(`.${d}`))) {
    return {
      ok: false,
      motivo:
        `el dominio "${partes.dominio}" no está reconocido como Supabase ` +
        `(permitidos: ${dominiosOk.join(', ')}). No se siembra contra un host desconocido.`,
    }
  }

  const refProd = cobertura?.refProduccionProhibido
  if (refProd && partes.ref === refProd) {
    return {
      ok: false,
      motivo:
        `la URL apunta al proyecto de PRODUCCIÓN (${refProd}). Este script crea ` +
        'empresas y usuarios de prueba: creá un proyecto Supabase aparte.',
    }
  }

  if (!esperado) {
    return {
      ok: false,
      motivo:
        'falta SEED_EXPECTED_REF. Declará de antemano el ref del sandbox contra el que ' +
        `vas a sembrar (aquí sería "${partes.ref}"): sin esa declaración, un copiar-pegar ` +
        'de la URL equivocada bastaría para escribir en el proyecto que no es.',
    }
  }

  if (esperado !== partes.ref) {
    return {
      ok: false,
      motivo:
        `SEED_EXPECTED_REF="${esperado}" NO coincide con el ref de la URL ("${partes.ref}"). ` +
        'Abortado: uno de los dos está mal y no se adivina cuál.',
    }
  }

  return { ok: true, ref: partes.ref }
}

// ── Datos a crear ───────────────────────────────────────────────────────────
// Contraseñas generadas por corrida: no se versiona ninguna credencial. Se
// imprimen al final para que las pegues en los secretos del repo.
function password() {
  // 24 chars base64url a partir de 18 bytes de aleatoriedad criptográfica.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')
}

const log = (...a) => console.log('  ', ...a)

/** Inserta si no existe una fila que case con `match`. Devuelve su id. */
async function upsertPorMatch(admin, tabla, match, fila) {
  let q = admin.from(tabla).select('id')
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
  const { data: found, error: eSel } = await q.maybeSingle()
  if (eSel) throw new Error(`${tabla} select: ${eSel.message}`)
  if (found) return found.id

  const { data, error } = await admin.from(tabla).insert(fila).select('id').single()
  if (error) throw new Error(`${tabla} insert: ${error.message}`)
  return data.id
}

/** Usuario de auth por email, creándolo si no existe. Devuelve su id. */
async function upsertUsuario(admin, email, pass) {
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
async function upsertAppUser(admin, userId, companyId, nombre) {
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
 * exige proyecto (y se le da unidad, porque el harness lee de ahí los recursos
 * reales del tenant B) y `documentos_fiscales` exige régimen: por eso el seed
 * crea antes un proyecto y una unidad por empresa. Esa dependencia es la razón
 * por la que la versión anterior las dejaba fuera y su disjunción era trivial.
 */
async function seedDatos(admin, companyId, key) {
  const projectId = await upsertPorMatch(
    admin, 'projects',
    { company_id: companyId, nombre: `Proyecto sandbox ${key}` },
    { company_id: companyId, nombre: `Proyecto sandbox ${key}`, estado: 'activo' },
  )

  const unidadId = await upsertPorMatch(
    admin, 'unidades',
    { company_id: companyId, project_id: projectId, nombre: `Unidad sandbox ${key}` },
    { company_id: companyId, project_id: projectId, nombre: `Unidad sandbox ${key}` },
  )

  await upsertPorMatch(
    admin, 'proveedores',
    { company_id: companyId, nombre: `Proveedor sandbox ${key}` },
    { company_id: companyId, nombre: `Proveedor sandbox ${key}` },
  )

  await upsertPorMatch(
    admin, 'conta_cuentas',
    { company_id: companyId, codigo: `1000-${key}` },
    {
      company_id: companyId, codigo: `1000-${key}`, nombre: `Caja sandbox ${key}`,
      tipo: 'activo', naturaleza: 'deudora', nivel: 1,
    },
  )

  // unidad_id es obligatorio aquí: el harness lo lee para construir sus
  // negative-write con FKs válidas.
  await upsertPorMatch(
    admin, 'cuotas_condominio',
    { company_id: companyId, project_id: projectId, periodo: '2099-01' },
    {
      company_id: companyId, project_id: projectId, unidad_id: unidadId,
      concepto: `Cuota sandbox ${key}`, monto: 100, periodo: '2099-01', estado: 'pendiente',
    },
  )

  await upsertPorMatch(
    admin, 'documentos_fiscales',
    { company_id: companyId, serie: `SANDBOX-${key}` },
    {
      company_id: companyId, regimen: 'general', tipo: 'factura',
      serie: `SANDBOX-${key}`, numero: '1',
    },
  )

  return { projectId, unidadId }
}

// ── Ejecución ───────────────────────────────────────────────────────────────
async function main(env) {
  const URL = env.SEED_SUPABASE_URL ?? ''
  const KEY = env.SEED_SERVICE_ROLE_KEY ?? ''
  const ANON = env.SEED_ANON_KEY ?? ''
  const ESPERADO = env.SEED_EXPECTED_REF ?? ''

  const abortar = (mensaje) => {
    console.error(`\n${mensaje}\n`)
    return 1
  }

  if (!URL || !KEY) {
    return abortar(`❌ Faltan variables.

   SEED_SUPABASE_URL=https://<ref>.supabase.co
   SEED_SERVICE_ROLE_KEY=<service_role key del SANDBOX>

   La service_role está en: Dashboard → Project Settings → API → service_role.
   NO la pegues en el repo ni en un secreto de GitHub: sólo se usa aquí, en local.`)
  }

  // SEED_ANON_KEY es OBLIGATORIA: sin ella el script podría sembrar y salir
  // "verde" sin haber comprobado el aislamiento desde un cliente autenticado,
  // que es justo la garantía por la que existe.
  if (!ANON) {
    return abortar(`❌ Falta SEED_ANON_KEY (obligatoria).

   SEED_ANON_KEY=<anon public key del SANDBOX>   (Dashboard → API → anon public)

   Es la clave con la que el script entra como cada usuario para DEMOSTRAR el
   aislamiento. Sin ella sólo podría insertar filas y afirmar que todo está bien
   sin haberlo comprobado — exactamente el verde hueco que este seed evita.`)
  }

  const destino = validarUrlSandbox(URL, ESPERADO, COBERTURA)
  if (!destino.ok) {
    return abortar(`❌ ABORTADO: ${destino.motivo}`)
  }

  if (env.SEED_CONFIRM !== 'si') {
    return abortar(`⚠️  Confirmación requerida.

   Vas a crear 2 empresas, 2 usuarios y datos de prueba en el sandbox
   "${destino.ref}":
     ${URL}

   Si es el sandbox correcto, repetí el comando añadiendo SEED_CONFIRM=si`)
  }

  const TENANTS = [
    { key: 'A', empresa: 'RLS Sandbox — Empresa A', email: 'rls-a@sandbox.invalid', pass: password() },
    { key: 'B', empresa: 'RLS Sandbox — Empresa B', email: 'rls-b@sandbox.invalid', pass: password() },
  ]

  const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log('\n🌱 Seed del sandbox RLS\n')
  console.log(`   Proyecto: ${URL}  (ref ${destino.ref})`)
  console.log(`   Tablas con cobertura NO TRIVIAL: ${NO_TRIVIALES.join(', ')}\n`)

  const creado = []
  for (const t of TENANTS) {
    const companyId = await upsertPorMatch(admin, 'companies', { nombre: t.empresa }, { nombre: t.empresa })
    const userId = await upsertUsuario(admin, t.email, t.pass)
    await upsertAppUser(admin, userId, companyId, `Usuario RLS ${t.key}`)
    const { projectId, unidadId } = await seedDatos(admin, companyId, t.key)
    creado.push({ ...t, companyId, userId, projectId, unidadId })
    log(`✔ ${t.key}: empresa ${companyId}  usuario ${userId}`)
  }

  // ── Verificación: que el sandbox NO produzca un verde vacío ───────────────
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
      return abortar(`❌ No se pudo autenticar ${t.email}: ${eLogin.message}
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
    return 1
  }

  // ── Salida ────────────────────────────────────────────────────────────────
  // Sólo se llega aquí si CADA usuario fue autenticado y CADA tabla no trivial
  // quedó verificada en ambos sentidos.
  console.log('\n📋 Cobertura demostrada (A y B con datos propios y sin fuga):\n')
  for (const r of resumen) console.log(`   • ${r}`)

  console.log(`
📋 Cobertura ESTRUCTURAL (tablas que quedan VACÍAS — su disjunción NO demuestra
   aislamiento; el harness sólo comprueba que la policy responde sin fuga):
`)
  for (const e of COBERTURA.estructurales) {
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
  return 0
}

// Sólo se ejecuta como script; importarlo desde las pruebas no siembra nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.env))
}
