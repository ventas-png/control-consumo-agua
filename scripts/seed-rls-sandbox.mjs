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
//   SEED_EXPECTED_REF=<ref> \
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
// Más SEED_CONFIRM=si como confirmación interactiva. Los tres primeros son la
// MISMA función pura que usan el preflight del workflow y el propio harness
// (`scripts/rls-destino.mjs`): una sola regla, no tres copias que divergen.
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

import { validarDestino } from './rls-destino.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))

// Manifiesto compartido con el harness: no puede desincronizarse.
const COBERTURA = JSON.parse(
  readFileSync(join(AQUI, '..', 'src', 'test', 'rls', 'coverage.json'), 'utf8'),
)
const NO_TRIVIALES = COBERTURA.noTriviales
const FIX = COBERTURA.fixtures

// ── Salvaguardas ────────────────────────────────────────────────────────────
// La validación del destino NO vive aquí: está en `scripts/rls-destino.mjs`,
// compartida con el preflight del workflow y con el propio harness. Tres copias
// de esta comprobación divergen con el tiempo, y la copia que se quede corta es
// justo la que escribe donde no debe. Se re-exportan con los nombres históricos
// para no romper a quien ya los importe.

export { refDeUrl } from './rls-destino.mjs'

/**
 * Valida que la URL apunte al sandbox declarado en `SEED_EXPECTED_REF`.
 * Envoltura fina sobre `validarDestino` que sólo fija el nombre de la variable,
 * para que el mensaje de error diga cuál hay que corregir.
 *
 * @returns {{ ok: true, ref: string } | { ok: false, motivo: string }}
 */
export function validarUrlSandbox(url, esperado, cobertura) {
  return validarDestino({ url, esperado, cobertura, variable: 'SEED_EXPECTED_REF' })
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

/**
 * Detalle de un error de Auth, seguro para imprimir.
 *
 * Los errores de GoTrue no siempre traen un `message` legible —en el fallo del
 * listado llega literalmente `"{}"`— así que quedarse con `.message` borra la
 * única pista útil: el `status`. Aquí se conservan `name`, `status`, `code` y
 * `message`, y se serializa `message` cuando no es una cadena.
 *
 * Sólo se leen esos cuatro campos: nunca `headers`, ni el cuerpo crudo de la
 * respuesta, ni nada que pueda arrastrar la service_role o un token.
 */
export function detalleErrorAuth(error) {
  if (!error) return 'error desconocido (sin objeto)'

  const mensaje =
    typeof error.message === 'string' && error.message.length > 0
      ? error.message
      : safeJson(error.message)

  const partes = [
    error.name ? `name=${error.name}` : null,
    error.status !== undefined && error.status !== null ? `status=${error.status}` : null,
    error.code ? `code=${error.code}` : null,
    `message=${mensaje}`,
  ].filter(Boolean)

  return partes.join(' ')
}

/** JSON.stringify que nunca lanza (referencias cíclicas, getters raros…). */
function safeJson(valor) {
  if (valor === undefined) return '(sin mensaje)'
  try {
    const texto = JSON.stringify(valor)
    return texto === undefined ? String(valor) : texto
  } catch {
    return String(valor)
  }
}

/**
 * Busca un usuario de Auth por email con una consulta FILTRADA al endpoint
 * administrativo, en vez de recorrer el listado general.
 *
 * ─── POR QUÉ NO SE PAGINA EL LISTADO ────────────────────────────────────────
 * La primera hipótesis —«perPage 1000 es demasiado, con 50 se arregla»— quedó
 * REFUTADA por la evidencia del sandbox. Con sólo 4 usuarios en el proyecto:
 *
 *   page=1 per_page=1  → 200
 *   page=1 per_page=2  → 200
 *   page=1 per_page=3  → 200
 *   page=1 per_page=4  → AuthRetryableFetchError 500
 *   page=4 per_page=1  → AuthRetryableFetchError 500
 *
 * No hay ningún límite fijo que respetar: lo que rompe es **incluir en la
 * respuesta un registro concreto** del listado general. `per_page=3` cabe
 * porque se queda antes de él; `page=4, per_page=1` falla porque cae justo
 * encima. Bajar el tamaño de página sólo mueve la frontera — con otro orden, o
 * con un usuario más, el mismo registro vuelve a entrar y el seed vuelve a
 * morir. Paginar es tratar el síntoma.
 *
 * La búsqueda filtrada nunca materializa ese registro:
 *
 *   GET /auth/v1/admin/users?page=1&per_page=1&filter=rls-a%40sandbox.invalid → 200
 *
 * y con ella el seed llegó a imprimir «Sandbox listo y VERIFICADO como ambos
 * usuarios».
 *
 * ─── POR QUÉ FETCH DIRECTO Y NO EL SDK ──────────────────────────────────────
 * `admin.auth.admin.listUsers()` no expone el parámetro `filter`, que es justo
 * lo que evita el registro venenoso. Se llama al endpoint REST a mano.
 *
 * `filter` es una búsqueda PARCIAL del lado del servidor: sirve para acotar la
 * consulta, no para decidir identidad. La igualdad final se comprueba aquí,
 * exacta y sin distinguir mayúsculas (los emails no son sensibles a caja), para
 * que "rls-a@sandbox.invalid" jamás case con "otro-rls-a@sandbox.invalid".
 *
 * @param {{ url: string, serviceKey: string, fetchImpl?: Function }} destino
 *   Inyectados a propósito: sin esto no habría forma de probar la función.
 * @returns el usuario, o null si no existe.
 */
export async function buscarUsuarioPorEmail({ url, serviceKey, fetchImpl }, email) {
  const doFetch = fetchImpl ?? globalThis.fetch
  const base = String(url ?? '').replace(/\/+$/, '')
  const endpoint =
    `${base}/auth/v1/admin/users?page=1&per_page=1&filter=${encodeURIComponent(email)}`

  let respuesta
  try {
    respuesta = await doFetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    })
  } catch (e) {
    // Fallo de red/DNS. Se reporta el mensaje del error, nunca la petición:
    // la URL lleva el email y las cabeceras llevan la service_role.
    throw new Error(`buscarUsuario(${email}): la petición falló — ${e?.message ?? e}`)
  }

  // Fail-closed: cualquier respuesta que no sea 2xx aborta. NO se imprime el
  // cuerpo, que puede traer eco de la petición o de las cabeceras.
  if (!respuesta || respuesta.ok !== true) {
    throw new Error(
      `buscarUsuario(${email}): respuesta HTTP ${respuesta?.status ?? 'desconocida'} ` +
      `${respuesta?.statusText ?? ''}`.trim() +
      '. No se continúa: sin un listado fiable no se puede decidir si el usuario existe, ' +
      'y crearlo a ciegas duplicaría la identidad.',
    )
  }

  let cuerpo
  try {
    cuerpo = await respuesta.json()
  } catch {
    throw new Error(
      `buscarUsuario(${email}): la respuesta no es JSON válido. Fail-closed: no se asume ` +
      'que el usuario no existe.',
    )
  }

  // Fail-closed también ante una forma inesperada: `users` ausente o no-arreglo
  // NO significa "no existe", significa "no lo sé".
  if (!Array.isArray(cuerpo?.users)) {
    throw new Error(
      `buscarUsuario(${email}): la respuesta no trae un arreglo \`users\` ` +
      `(recibido: ${typeof cuerpo?.users}). Fail-closed: no se asume que el usuario no existe.`,
    )
  }

  // `filter` es parcial: la identidad la decide esta comparación, no el servidor.
  const buscado = email.toLowerCase()
  return cuerpo.users.find((u) => String(u?.email ?? '').toLowerCase() === buscado) ?? null
}

/**
 * Usuario de auth por email, creándolo si no existe. Devuelve su id.
 *
 * `buscar` se inyecta (misma razón que en `buscarUsuarioPorEmail`: probarlo).
 */
export async function upsertUsuario(admin, email, pass, buscar) {
  const existing = await buscar(email)

  if (existing) {
    // Se reescribe la contraseña para que la impresa al final sea siempre la
    // válida, aunque el usuario venga de una corrida anterior. Nunca se crea un
    // segundo usuario con el mismo email: eso rompería la idempotencia y dejaría
    // dos identidades compitiendo por la misma fila de app_users.
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: pass })
    if (error) throw new Error(`updateUserById: ${detalleErrorAuth(error)}`)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email, password: pass, email_confirm: true,
  })
  if (error) throw new Error(`createUser: ${detalleErrorAuth(error)}`)
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
 * Siembra las tablas de cobertura no trivial MÁS los recursos reales que el
 * harness necesita para sus pruebas negativas.
 *
 * POR QUÉ HACEN FALTA LOS RECURSOS "EXTRA"
 * Las RPC del ERP y del portal reciben ids (asiento, movimiento bancario,
 * amenidad, reserva, cliente). Pasarles el company_id como si fuera un
 * asiento_id hacía que la RPC fallara por "no existe", no por autorización: el
 * rechazo era real pero no probaba aislamiento. Aquí se crean de verdad, en el
 * tenant B, para que el harness pueda pedir a A que los toque y comprobar que
 * el guard los niega por PERTENENCIA.
 *
 * Todos los valores respetan los CHECK del esquema. En particular
 * `documentos_fiscales.regimen` sólo admite 'fel_gt' | 'cfdi_mx'
 * (20260604220000): un valor fuera de esa lista aborta por CHECK y nunca
 * llegaría a evaluarse RLS.
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

  // ── Cobertura NO TRIVIAL ────────────────────────────────────────────────
  await upsertPorMatch(
    admin, 'proveedores',
    { company_id: companyId, nombre: `${FIX.nombreProveedor} ${key}` },
    { company_id: companyId, nombre: `${FIX.nombreProveedor} ${key}` },
  )

  const cuentaId = await upsertPorMatch(
    admin, 'conta_cuentas',
    { company_id: companyId, codigo: `${FIX.codigoCuenta}-${key}` },
    {
      company_id: companyId, codigo: `${FIX.codigoCuenta}-${key}`,
      nombre: `Caja sandbox ${key}`, tipo: 'activo', naturaleza: 'deudora', nivel: 1,
    },
  )

  // El harness localiza ESTA fila por (periodo, concepto) para apuntar su
  // UPDATE cross-tenant a un id exacto, en vez de a "todas las filas de A".
  const cuotaId = await upsertPorMatch(
    admin, 'cuotas_condominio',
    { company_id: companyId, project_id: projectId, periodo: FIX.periodoCuota },
    {
      company_id: companyId, project_id: projectId, unidad_id: unidadId,
      concepto: `${FIX.conceptoCuota} ${key}`, monto: 100,
      periodo: FIX.periodoCuota, estado: 'pendiente',
    },
  )

  await upsertPorMatch(
    admin, 'documentos_fiscales',
    { company_id: companyId, serie: `${FIX.serieDocumento}-${key}` },
    {
      company_id: companyId, regimen: FIX.regimenDocumento, tipo: FIX.tipoDocumento,
      serie: `${FIX.serieDocumento}-${key}`, numero: '1',
    },
  )

  // ── Recursos reales para las RPC ────────────────────────────────────────
  // Estas tablas quedan declaradas como cobertura ESTRUCTURAL: el fixture
  // existe para que las RPC reciban ids que EXISTEN, no para afirmar
  // aislamiento de la tabla en sí.
  const asientoId = await upsertPorMatch(
    admin, 'conta_asientos',
    { company_id: companyId, concepto: `${FIX.conceptoAsiento} ${key}` },
    {
      company_id: companyId, concepto: `${FIX.conceptoAsiento} ${key}`,
      fecha: '2099-01-01', tipo: 'diario', estado: 'borrador',
      origen: 'manual', moneda_base: 'GTQ',
    },
  )

  const cuentaBancariaId = await upsertPorMatch(
    admin, 'cuentas_bancarias',
    { company_id: companyId, nombre: `${FIX.nombreCuentaBancaria} ${key}` },
    {
      company_id: companyId, nombre: `${FIX.nombreCuentaBancaria} ${key}`,
      banco: 'Banco Sandbox', cuenta_contable_id: cuentaId,
    },
  )

  const movimientoId = await upsertPorMatch(
    admin, 'banco_movimientos',
    { company_id: companyId, cuenta_bancaria_id: cuentaBancariaId, fecha: '2099-01-02' },
    {
      company_id: companyId, cuenta_bancaria_id: cuentaBancariaId,
      fecha: '2099-01-02', monto: 50, descripcion: `${FIX.descripcionMovimiento} ${key}`,
    },
  )

  const amenidadId = await upsertPorMatch(
    admin, 'amenidades',
    { company_id: companyId, project_id: projectId, nombre: `${FIX.nombreAmenidad} ${key}` },
    { company_id: companyId, project_id: projectId, nombre: `${FIX.nombreAmenidad} ${key}` },
  )

  const reservaId = await upsertPorMatch(
    admin, 'reservas_amenidades',
    { company_id: companyId, amenidad_id: amenidadId, fecha: FIX.fechaReserva },
    {
      company_id: companyId, project_id: projectId, amenidad_id: amenidadId,
      unidad_id: unidadId, fecha: FIX.fechaReserva,
      hora_inicio: '10:00', hora_fin: '11:00',
    },
  )

  // `clientes` NO lleva company_id: la pertenencia vive en la tabla puente
  // `company_clientes` (20260326000001). Sin esa fila, el cliente no sería de
  // NINGÚN tenant y un rechazo de las RPC que lo reciben sería ambiguo — podría
  // venir de "no existe asociación" en vez de "es de otra empresa".
  const clienteId = await upsertPorMatch(
    admin, 'clientes',
    { codigo: `${FIX.codigoCliente}-${key}` },
    { codigo: `${FIX.codigoCliente}-${key}`, nombre: `Cliente sandbox ${key}`, project_id: projectId },
  )

  await upsertPorMatch(
    admin, 'company_clientes',
    { company_id: companyId, cliente_id: clienteId },
    { company_id: companyId, cliente_id: clienteId },
  )

  return {
    projectId, unidadId, cuotaId, asientoId, cuentaBancariaId,
    movimientoId, amenidadId, reservaId, clienteId,
  }
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

  // Búsqueda de usuarios por consulta FILTRADA al endpoint admin. El listado
  // general de este proyecto revienta con 500 en cuanto la respuesta incluye
  // cierto registro (ver `buscarUsuarioPorEmail`), así que no se pagina.
  const buscarUsuario = (email) => buscarUsuarioPorEmail({ url: URL, serviceKey: KEY }, email)

  console.log('\n🌱 Seed del sandbox RLS\n')
  console.log(`   Proyecto: ${URL}  (ref ${destino.ref})`)
  console.log(`   Tablas con cobertura NO TRIVIAL: ${NO_TRIVIALES.join(', ')}\n`)

  const creado = []
  for (const t of TENANTS) {
    const companyId = await upsertPorMatch(admin, 'companies', { nombre: t.empresa }, { nombre: t.empresa })
    const userId = await upsertUsuario(admin, t.email, t.pass, buscarUsuario)
    await upsertAppUser(admin, userId, companyId, `Usuario RLS ${t.key}`)
    const recursos = await seedDatos(admin, companyId, t.key)
    creado.push({ ...t, companyId, userId, ...recursos })
    log(`✔ ${t.key}: empresa ${companyId}  usuario ${userId}  cuota ${recursos.cuotaId}`)
    // Los ids de los recursos de las RPC se imprimen porque son la diferencia
    // entre "la RPC falló porque el id no existe" y "la RPC rechazó por
    // pertenencia". El harness los vuelve a resolver por su marcador, así que
    // esto es traza para el operador, no un canal de paso de parámetros.
    log(`   recursos RPC de ${t.key}: proyecto ${recursos.projectId} · unidad ${recursos.unidadId} · ` +
        `asiento ${recursos.asientoId} · movimiento ${recursos.movimientoId} · ` +
        `amenidad ${recursos.amenidadId} · reserva ${recursos.reservaId} · cliente ${recursos.clienteId}`)
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

  // Las RPC no se agrupan por dominio sino por lo que su rechazo DEMUESTRA. Un
  // informe que sume las 23 como "aislamiento verificado" estaría contando
  // rechazos por privilegio de ejecución y por rol de portal.
  const porGarantia = {}
  for (const r of COBERTURA.rpcsObligatorias) (porGarantia[r.garantia] ??= []).push(r.nombre)
  console.log(`
📋 RPC críticas por lo que su rechazo demuestra:
`)
  console.log(`   • tenant     (${(porGarantia.tenant ?? []).length}) — aislamiento REAL: ${(porGarantia.tenant ?? []).join(', ')}`)
  console.log(`   • rol        (${(porGarantia.rol ?? []).length}) — rechazo por rol de portal, NO aislamiento: ${(porGarantia.rol ?? []).join(', ')}`)
  console.log(`   • privilegio (${(porGarantia.privilegio ?? []).length}) — no ejecutable por el navegador, NO aislamiento: ${(porGarantia.privilegio ?? []).join(', ')}`)
  console.log(`
   Por qué las de «rol» no llegan a tenant: ${COBERTURA.motivoRpcRol}
`)

  console.log(`
✅ Sandbox listo y VERIFICADO como ambos usuarios.

Pegá estos 7 secretos en el repo
(Settings → Secrets and variables → Actions → New repository secret):

  RLS_SUPABASE_URL          ${URL}
  RLS_SUPABASE_ANON_KEY     <anon public key del sandbox>
  RLS_EXPECTED_PROJECT_REF  ${destino.ref}
  RLS_USER_A_EMAIL          ${creado[0].email}
  RLS_USER_A_PASSWORD       ${creado[0].pass}
  RLS_USER_B_EMAIL          ${creado[1].email}
  RLS_USER_B_PASSWORD       ${creado[1].pass}

RLS_EXPECTED_PROJECT_REF no es una credencial: es la DECLARACIÓN del proyecto
contra el que puede operar el harness. Sin ella, cambiar RLS_SUPABASE_URL
bastaría para que las escrituras de prueba fueran a parar a otro proyecto.
El preflight exige que ambas coincidan y aborta si no.

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
