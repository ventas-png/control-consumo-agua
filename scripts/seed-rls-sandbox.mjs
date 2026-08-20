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
 * Tamaño de página de la consulta FILTRADA.
 *
 * No tiene nada que ver con el listado general: ahí el problema es un registro
 * concreto que revienta la respuesta, y por eso ese camino se abandonó. Aquí el
 * conjunto ya viene acotado por el filtro, y lo que se busca es no depender de
 * que quepa en una sola respuesta.
 */
export const PAGINA_FILTRO = 50

/**
 * Tope de páginas filtradas. Un email con más de mil coincidencias parciales no
 * es un caso a soportar: es un estado que no se entiende, y se aborta.
 */
const MAX_PAGINAS_FILTRO = 20

/**
 * Busca un usuario de Auth por email con una consulta FILTRADA al endpoint
 * administrativo, paginada.
 *
 * ─── POR QUÉ NO SE PAGINA EL LISTADO GENERAL ────────────────────────────────
 * La hipótesis «perPage 1000 es demasiado, con 50 se arregla» quedó REFUTADA.
 * Con sólo 4 usuarios en el sandbox:
 *
 *   page=1 per_page=1  → 200      page=1 per_page=4  → AuthRetryableFetchError 500
 *   page=1 per_page=2  → 200      page=4 per_page=1  → AuthRetryableFetchError 500
 *   page=1 per_page=3  → 200
 *
 * No hay límite de tamaño que respetar: rompe **incluir un registro concreto**
 * en la respuesta. `per_page=3` cabe porque se detiene antes de él. Bajar el
 * tamaño sólo movía la frontera. La consulta filtrada no lo materializa.
 *
 * ─── POR QUÉ NO BASTA UNA SOLA PÁGINA FILTRADA ──────────────────────────────
 * `filter` es una búsqueda PARCIAL: GoTrue lo aplica aproximadamente como
 *
 *     email LIKE '%filter%' OR full_name ILIKE '%filter%'
 *
 * Con `per_page=1`, una coincidencia parcial más reciente —`otro-rls-a@…`, o un
 * usuario cuyo `full_name` contenga el texto— puede ocupar el ÚNICO resultado y
 * dejar fuera al usuario exacto. El seed concluiría que no existe, intentaría
 * crearlo y rompería la idempotencia: dos identidades para el mismo email.
 *
 * Así que se recorren las páginas del conjunto FILTRADO y se recogen TODAS las
 * coincidencias exactas antes de decidir. La identidad la decide la comparación
 * exacta e insensible a mayúsculas, nunca la posición en la respuesta.
 *
 * @param {{ url: string, serviceKey: string, fetchImpl?: Function }} destino
 *   Inyectados a propósito: sin esto no habría forma de probar la función.
 * @returns el usuario, o null si no existe.
 */
export async function buscarUsuarioPorEmail({ url, serviceKey, fetchImpl }, email) {
  const doFetch = fetchImpl ?? globalThis.fetch
  const base = String(url ?? '').replace(/\/+$/, '')
  const buscado = String(email ?? '').toLowerCase()
  const exactas = []

  for (let page = 1; page <= MAX_PAGINAS_FILTRO; page++) {
    const endpoint =
      `${base}/auth/v1/admin/users` +
      `?page=${page}&per_page=${PAGINA_FILTRO}&filter=${encodeURIComponent(email)}`

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
      // Fallo de red/DNS. Se reporta el mensaje del error y NUNCA la petición:
      // la URL lleva el email y las cabeceras llevan la service_role.
      throw new Error(`buscarUsuario(${email}): la petición falló en la página ${page} — ${e?.message ?? e}`)
    }

    // Fail-closed: cualquier respuesta que no sea 2xx aborta. NO se imprime el
    // cuerpo, que puede traer eco de la petición o de las cabeceras.
    if (!respuesta || respuesta.ok !== true) {
      throw new Error(
        `buscarUsuario(${email}): respuesta HTTP ${respuesta?.status ?? 'desconocida'} ` +
        `${respuesta?.statusText ?? ''}`.trim() +
        ` en la página ${page}. No se continúa: con el listado filtrado incompleto no se ` +
        'puede decidir si el usuario existe, y crearlo a ciegas duplicaría la identidad.',
      )
    }

    let cuerpo
    try {
      cuerpo = await respuesta.json()
    } catch {
      throw new Error(
        `buscarUsuario(${email}): la página ${page} no es JSON válido. Fail-closed: no se ` +
        'asume que el usuario no existe.',
      )
    }

    // Fail-closed también ante una forma inesperada: `users` ausente o no-arreglo
    // NO significa "no existe", significa "no lo sé".
    if (!Array.isArray(cuerpo?.users)) {
      throw new Error(
        `buscarUsuario(${email}): la página ${page} no trae un arreglo \`users\` ` +
        `(recibido: ${typeof cuerpo?.users}). Fail-closed: no se asume que el usuario no existe.`,
      )
    }

    const usuarios = cuerpo.users

    // Una página con MÁS filas de las pedidas es una respuesta que no se
    // entiende: no se sabe cuántas faltan ni si la paginación es coherente.
    if (usuarios.length > PAGINA_FILTRO) {
      throw new Error(
        `buscarUsuario(${email}): la página ${page} devolvió ${usuarios.length} filas ` +
        `habiendo pedido ${PAGINA_FILTRO}. Paginación incoherente: se aborta.`,
      )
    }

    for (const u of usuarios) {
      if (String(u?.email ?? '').toLowerCase() === buscado) exactas.push(u)
    }

    // Página incompleta (o vacía) ⇒ no hay más resultados filtrados.
    if (usuarios.length < PAGINA_FILTRO) {
      if (exactas.length > 1) {
        throw new Error(
          `buscarUsuario(${email}): hay ${exactas.length} usuarios con ese email exacto. ` +
          'Es un estado inconsistente del proyecto: no se elige uno al azar.',
        )
      }
      return exactas[0] ?? null
    }
  }

  throw new Error(
    `buscarUsuario(${email}): el listado filtrado supera ${MAX_PAGINAS_FILTRO} páginas de ` +
    `${PAGINA_FILTRO}. Resultado ambiguo: se aborta en vez de adivinar.`,
  )
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

/**
 * Fila de app_users que ata el usuario a su empresa (lo que lee
 * get_my_company_id) y le fija el ROL, que es lo que resuelven
 * `current_user_role()` y el atajo de `user_has_permission` para
 * admin/company_owner.
 */
async function upsertAppUser(admin, userId, companyId, nombre, role = 'company_owner') {
  const { error } = await admin.from('app_users').upsert({
    id: userId, company_id: companyId, role,
    full_name: nombre, activo: true,
  }, { onConflict: 'id' })
  if (error) throw new Error(`app_users upsert: ${error.message}`)
}

// ── Gate por CLASE de paquetes_recibidos ────────────────────────────────────
// El motor único (20260829000000) resuelve el permiso POR FILA con un CASE
// sobre `clase`, y su suite de comportamiento necesita CUATRO usuarios de la
// MISMA empresa. No sirven A y B: son de empresas distintas, así que cualquier
// "no ve la otra clase" podría estar pasando por aislamiento de tenant y no por
// el gate que se quiere comprobar.
//
//   · paq / corr — rol NO administrativo (`operator`) con UN permiso granular
//     cada uno. Tienen que ser no administrativos porque `user_has_permission`
//     le dice true a TODO a admin/company_owner (20260518000008): con un admin,
//     el gate de SELECT/INSERT/UPDATE sencillamente no se vería.
//   · admin      — para el caso central de DELETE: mismo tenant, permiso
//     efectivo sobre todo, y aun así NO puede borrar correspondencia.
//   · owner      — control positivo de ese mismo DELETE.
const CLASE_EMPRESA = 'RLS Sandbox — Gate por clase'
const CLASE_ROLES = {
  paq: { nombre: 'RLS Paquetería', permiso: 'condominios.tab.paqueteria' },
  corr: { nombre: 'RLS Correspondencia', permiso: 'condominios.tab.correspondencia' },
}
export const CLASE_USUARIOS = [
  { key: 'PAQ', email: 'rls-paq@sandbox.invalid', role: 'operator', rbac: 'paq', nombre: 'Operador de paquetería' },
  { key: 'CORR', email: 'rls-corr@sandbox.invalid', role: 'operator', rbac: 'corr', nombre: 'Operador de correspondencia' },
  { key: 'ADMIN', email: 'rls-admin@sandbox.invalid', role: 'admin', rbac: null, nombre: 'Administrador' },
  { key: 'OWNER', email: 'rls-owner@sandbox.invalid', role: 'company_owner', rbac: null, nombre: 'Dueña' },
]

/**
 * Crea (idempotentemente) el rol de empresa con SU ÚNICO permiso.
 *
 * El permiso se fija con delete+insert en vez de con un upsert ciego: si una
 * corrida anterior dejó al rol una clave de más, el rol concedería dos clases y
 * la prueba de "no ve la otra" pasaría a ser imposible de fallar. El fixture
 * tiene que converger al estado declarado, no acumular.
 */
async function upsertRolDeClase(admin, companyId, { nombre, permiso }) {
  const roleId = await upsertPorMatch(
    admin, 'roles',
    { company_id: companyId, name: nombre },
    { company_id: companyId, name: nombre, description: 'Fixture del harness RLS', is_system: false },
  )

  const { error: eDel } = await admin.from('role_permissions')
    .delete().eq('role_id', roleId).neq('permission_key', permiso)
  if (eDel) throw new Error(`role_permissions limpieza: ${eDel.message}`)

  const { error: eIns } = await admin.from('role_permissions')
    .upsert({ role_id: roleId, permission_key: permiso, effect: 'allow' },
            { onConflict: 'role_id,permission_key' })
  if (eIns) throw new Error(`role_permissions upsert: ${eIns.message}`)
  return roleId
}

/**
 * Siembra la empresa del gate por clase con sus cuatro usuarios, un proyecto y
 * una unidad. Devuelve lo necesario para verificarlo e imprimir los secretos.
 */
async function seedGateDeClase(admin, buscarUsuario) {
  const companyId = await upsertPorMatch(
    admin, 'companies', { nombre: CLASE_EMPRESA }, { nombre: CLASE_EMPRESA },
  )

  // El harness siembra sus propias filas desechables y necesita un proyecto y
  // una unidad VÁLIDOS: `paquetes_unidad_por_clase_chk` exige unidad para la
  // clase 'paquete', así que sin unidad la mitad de los escenarios no se puede
  // ni montar.
  const projectId = await upsertPorMatch(
    admin, 'projects',
    { company_id: companyId, nombre: 'Proyecto sandbox CLASE' },
    { company_id: companyId, nombre: 'Proyecto sandbox CLASE', estado: 'activo' },
  )
  const unidadId = await upsertPorMatch(
    admin, 'unidades',
    { company_id: companyId, project_id: projectId, nombre: 'Unidad sandbox CLASE' },
    { company_id: companyId, project_id: projectId, nombre: 'Unidad sandbox CLASE' },
  )

  const roles = {}
  for (const [k, def] of Object.entries(CLASE_ROLES)) {
    roles[k] = await upsertRolDeClase(admin, companyId, def)
  }

  const usuarios = []
  for (const u of CLASE_USUARIOS) {
    const pass = password()
    const userId = await upsertUsuario(admin, u.email, pass, buscarUsuario)
    await upsertAppUser(admin, userId, companyId, `RLS ${u.nombre}`, u.role)

    // Las asignaciones de rol también CONVERGEN: se borra cualquier otra para
    // que un fixture de una corrida anterior no le regale permisos de más.
    const rolEsperado = u.rbac ? roles[u.rbac] : null
    let q = admin.from('user_roles').delete().eq('user_id', userId)
    if (rolEsperado) q = q.neq('role_id', rolEsperado)
    const { error: eDel } = await q
    if (eDel) throw new Error(`user_roles limpieza: ${eDel.message}`)

    if (rolEsperado) {
      const { error } = await admin.from('user_roles')
        .upsert({ user_id: userId, role_id: rolEsperado }, { onConflict: 'user_id,role_id' })
      if (error) throw new Error(`user_roles upsert: ${error.message}`)
    }
    usuarios.push({ ...u, userId, pass })
  }

  return { companyId, projectId, unidadId, usuarios }
}

/**
 * Entra como cada uno de los cuatro y comprueba que el fixture ES el que el
 * harness supone. No basta con que el login funcione: si `corr` acabara con el
 * permiso de paquetería, la suite seguiría verde probando lo contrario de lo
 * que dice probar.
 *
 * @returns {Promise<string[]>} lista de fallos (vacía = todo correcto).
 */
async function verificarGateDeClase(url, anon, clase) {
  const fallos = []
  const esperado = {
    PAQ: { 'condominios.tab.paqueteria': true, 'condominios.tab.correspondencia': false },
    CORR: { 'condominios.tab.paqueteria': false, 'condominios.tab.correspondencia': true },
    // Para admin y owner el helper dice true a todo: es el rasgo por el que el
    // reparto de DELETE va por ROL y no por permiso, así que se afirma.
    ADMIN: { 'condominios.tab.paqueteria': true, 'condominios.tab.correspondencia': true },
    OWNER: { 'condominios.tab.paqueteria': true, 'condominios.tab.correspondencia': true },
  }

  for (const u of clase.usuarios) {
    const cli = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: eLogin } = await cli.auth.signInWithPassword({ email: u.email, password: u.pass })
    if (eLogin) {
      fallos.push(`${u.key} (${u.email}): no se pudo iniciar sesión — ${eLogin.message}`)
      continue
    }

    const { data: empresa, error: eEmp } = await cli.rpc('get_my_company_id')
    if (eEmp) fallos.push(`${u.key}: get_my_company_id falló (${eEmp.message})`)
    else if (empresa !== clase.companyId) {
      fallos.push(`${u.key}: está en la empresa ${empresa}, no en la del gate (${clase.companyId})`)
    }

    for (const [clave, quiero] of Object.entries(esperado[u.key])) {
      const { data, error } = await cli.rpc('user_has_permission', { perm_key: clave })
      if (error) fallos.push(`${u.key}: user_has_permission(${clave}) falló (${error.message})`)
      else if (data !== quiero) {
        fallos.push(`${u.key}: user_has_permission(${clave}) = ${data}, se esperaba ${quiero}`)
      }
    }
    await cli.auth.signOut()
    log(`✔ ${u.key} (${u.role}): login OK y permisos efectivos como se esperaba`)
  }
  return fallos
}

// ── Esquema del motor único de recepción ────────────────────────────────────
// POR QUÉ ESTE CHEQUEO EXISTE.
// El seed crea empresas, proyectos, unidades, roles y usuarios. NINGUNA de esas
// cosas toca `paquetes_recibidos`, así que un sandbox al que le falten las
// migraciones de recepción pasa el seed ENTERO sin un solo fallo — y el script
// remataba con su banner final de éxito. Verificado a medias: los usuarios sí,
// el esquema que el harness necesita no.
//
// Pasó de verdad. Con los quince secretos ya puestos, el harness falló ocho
// veces con `column paquetes_recibidos.clase does not exist` mientras el seed
// daba el sandbox por bueno. El seed es quien tiene que detectarlo ANTES, y
// decirlo con el remedio.
//
// Se comprueban las DOS columnas que introduce 20260829000000 y sin las cuales
// el gate por clase no existe: `clase` (gobierna las cuatro policies vía CASE) y
// `destinatario_tipo` (distingue pieza de unidad de pieza de administración).
export const COLUMNAS_RECEPCION = ['clase', 'destinatario_tipo']

/** Primera y última de la cadena que hay que aplicar entera. */
export const CADENA_RECEPCION = { desde: '20260828000000', hasta: '20260902000000' }

/**
 * Traduce el error de PostgREST a algo accionable. Se mira el CÓDIGO, no sólo
 * el texto: un mensaje puede cambiar de redacción entre versiones.
 *
 * `42703` lo devuelve Postgres cuando la columna no existe de verdad.
 * `PGRST204`/`PGRST205` los devuelve PostgREST cuando no la encuentra en su
 * caché de esquema. Los dos se tratan igual —falta aplicar la cadena— porque
 * desde fuera no se distinguen con certeza, y el remedio de la caché sólo
 * aplica si las migraciones YA constan aplicadas.
 *
 * @returns {'ausente'|'otro'}
 */
export function clasificarErrorEsquema(error) {
  const code = String(error?.code ?? '')
  if (code === '42703' || code === 'PGRST204' || code === 'PGRST205') return 'ausente'
  if (/does not exist|schema cache/i.test(String(error?.message ?? ''))) return 'ausente'
  return 'otro'
}

/** El texto que hay que leer cuando falta el esquema. Se prueba tal cual. */
export function mensajeEsquemaAusente(columnas, ref) {
  const { desde, hasta } = CADENA_RECEPCION
  return [
    `a \`paquetes_recibidos\` le faltan columnas del motor único (${columnas.join(', ')}).`,
    `   Aplicá la cadena COMPLETA ${desde}…${hasta} al proyecto ${ref || 'de SEED_EXPECTED_REF'},`,
    '   en orden y entera: son seis migraciones y las de en medio no son opcionales.',
    '   Sin ellas el harness no puede probar el gate por clase, que es justo lo que viene a probar.',
    "   Sólo si esas migraciones YA constan aplicadas y el error persiste, la caché de PostgREST",
    "   está desactualizada: recargala con  NOTIFY pgrst, 'reload schema'.",
  ].join('\n')
}

/**
 * Comprueba que el esquema de recepción está en el sandbox. Se consulta CADA
 * columna por separado —con el cliente admin, para que un 0 filas por RLS no se
 * confunda con una columna ausente— y se mira el error, no el conteo: una tabla
 * vacía es perfectamente válida y no dice nada del esquema.
 *
 * @returns {Promise<string[]>} lista de fallos (vacía = esquema correcto).
 */
export async function verificarEsquemaRecepcion(admin, ref) {
  const ausentes = []
  for (const col of COLUMNAS_RECEPCION) {
    const { error } = await admin.from('paquetes_recibidos').select(col).limit(1)
    if (!error) continue
    if (clasificarErrorEsquema(error) === 'ausente') {
      ausentes.push(col)
      continue
    }
    // Un error que NO es de columna ausente tampoco se traga: no saber si el
    // esquema está bien es motivo suficiente para no decir «listo».
    return [`no se pudo verificar la columna \`${col}\` de paquetes_recibidos: ${error.message ?? 'error sin mensaje'}`]
  }
  return ausentes.length > 0 ? [mensajeEsquemaAusente(ausentes, ref)] : []
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

   Vas a crear 3 empresas, 6 usuarios y datos de prueba en el sandbox
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

  // ── Empresa del gate por clase (cuatro usuarios, MISMA empresa) ──────────
  console.log('\n🌱 Empresa del gate por clase de paquetes_recibidos\n')
  const clase = await seedGateDeClase(admin, buscarUsuario)
  log(`✔ empresa ${clase.companyId}  proyecto ${clase.projectId}  unidad ${clase.unidadId}`)
  for (const u of clase.usuarios) log(`   ${u.key.padEnd(5)} ${u.role.padEnd(14)} ${u.email}`)

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

  console.log('\n🔍 Verificando los cuatro usuarios del gate por clase\n')
  fallos.push(...await verificarGateDeClase(URL, ANON, clase))

  // El esquema, al final y SIEMPRE: es lo único que el resto del seed no toca,
  // y por tanto lo único que podía faltar sin que nada fallara antes.
  console.log('\n🔍 Verificando el esquema del motor único de recepción\n')
  const fallosEsquema = await verificarEsquemaRecepcion(admin, destino.ref)
  if (fallosEsquema.length === 0) {
    log(`✔ paquetes_recibidos expone ${COLUMNAS_RECEPCION.join(' y ')}`)
  }
  fallos.push(...fallosEsquema)

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

Pegá estos 15 secretos en el repo
(Settings → Secrets and variables → Actions → New repository secret):

  RLS_SUPABASE_URL          ${URL}
  RLS_SUPABASE_ANON_KEY     <anon public key del sandbox>
  RLS_EXPECTED_PROJECT_REF  ${destino.ref}
  RLS_USER_A_EMAIL          ${creado[0].email}
  RLS_USER_A_PASSWORD       ${creado[0].pass}
  RLS_USER_B_EMAIL          ${creado[1].email}
  RLS_USER_B_PASSWORD       ${creado[1].pass}

Y estos OCHO, del gate por clase (los cuatro son de la MISMA empresa
"${CLASE_EMPRESA}"):

${clase.usuarios.map((u) =>
  `  RLS_USER_${u.key}_EMAIL${' '.repeat(Math.max(1, 15 - u.key.length))}${u.email}\n` +
  `  RLS_USER_${u.key}_PASSWORD${' '.repeat(Math.max(1, 12 - u.key.length))}${u.pass}`,
).join('\n')}

Los ocho son OBLIGATORIOS: sin ellos el preflight del workflow falla y el job
queda en rojo. No hay ruta verde sin ejecutar — la suite del gate por clase no
se auto-salta.

RLS_EXPECTED_PROJECT_REF no es una credencial: es la DECLARACIÓN del proyecto
contra el que puede operar el harness. Sin ella, cambiar RLS_SUPABASE_URL
bastaría para que las escrituras de prueba fueran a parar a otro proyecto.
El preflight exige que ambas coincidan y aborta si no.

⚠️  La service_role NO va a GitHub, ni se imprime aquí, ni se guarda en ningún
   archivo: entra por SEED_SERVICE_ROLE_KEY y se queda en esta máquina. CI sólo
   recibe la anon key y estas SEIS cuentas de bajo privilegio (usuarios de dos
   empresas de juguete y de una tercera para el gate, en un proyecto
   desechable).

⚠️  ACTUALIZÁ LOS QUINCE, NO SÓLO LOS OCHO DEL GATE.

Esta corrida rotó las SEIS contraseñas —A y B incluidas, aunque ya existieran—,
así que RLS_USER_A_PASSWORD y RLS_USER_B_PASSWORD también quedaron obsoletas.
Pegar sólo los ocho nuevos cambia el motivo del rojo: el harness pasaría de
faltarle secretos a fallar el login de A y B.

Las contraseñas no se guardan en ningún sitio: si las perdés, volvé a correr el
script y usá las nuevas. Después de actualizar los quince, relanzá el job
"RLS harness (server-side)".
`)
  return 0
}

// Sólo se ejecuta como script; importarlo desde las pruebas no siembra nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.env))
}
