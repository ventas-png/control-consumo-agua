// Acceso a la API de Supabase desde los specs, para PREPARAR y LIMPIAR el dato
// que una prueba necesita y el navegador no puede fabricar por sí solo.
//
// POR QUÉ EXISTE. Dos specs se omitían por una variable que declaraba una
// precondición externa: E2E_INVITE_TOKEN (un token fresco que alguien tenía que
// generar a mano antes de cada corrida) y E2E_FISCAL_SANDBOX_READY. Una prueba
// que sólo corre cuando alguien preparó el terreno no es una prueba: es una
// foto. Con estos helpers, la invitación se crea DENTRO de la prueba, en cada
// intento y cada retry.
//
// LA CLAVE ES LA PUBLISHABLE, NUNCA UNA SECRET KEY. Es la misma que el bundle
// del Preview ya lleva: no concede nada que un visitante no tenga. Todo lo que
// se hace aquí viaja con el JWT del administrador y lo autoriza la RLS o el
// propio Edge Function, igual que si lo hiciera la aplicación. Con
// `service_role` esto sería un bypass de RLS disfrazado de prueba, y además
// pondría una llave de administrador entre los secretos de CI.
//
// EL TOKEN DE ACCESO Y EL DE INVITACIÓN NO SE IMPRIMEN NUNCA. No se devuelven
// en mensajes de error, no se interpolan en aserciones y no viajan al reporte:
// los errores de aquí nombran el paso y el status, jamás el material sensible.
// `token` viaja sólo en la URL que el navegador visita, que es su destino real.

import { type APIRequestContext } from '@playwright/test'

import { E2E_BASE_URL, LOGIN, SUPABASE } from './env'

/** El Origin que la app usa de verdad. Los Edge Functions validan Origin contra
 *  su allowlist (supabase/functions/_shared/cors.ts) y responden 403 si no
 *  coincide, así que llamarlas sin Origin —como haría un cliente de servidor—
 *  fallaría. Mandamos el mismo que manda el navegador del Preview. */
function origenDeLaApp(): string {
  try {
    return new URL(E2E_BASE_URL).origin
  } catch {
    return E2E_BASE_URL
  }
}

function cabecerasBase(): Record<string, string> {
  return {
    apikey: SUPABASE.publishableKey,
    'Content-Type': 'application/json',
    Origin: origenDeLaApp(),
  }
}

/** Correo único por intento. `.invalid` es un TLD reservado (RFC 2606): ningún
 *  correo puede salir de ahí, y el envío es fire-and-forget en `invite-user`,
 *  así que su fallo no afecta a la invitación creada. El sufijo aleatorio evita
 *  que dos corridas simultáneas del mismo minuto colisionen. */
export function correoDePrueba(prefijo = 'e2e-invitacion'): string {
  const marca = new Date().toISOString().replace(/[^0-9]/g, '')
  const azar = Math.random().toString(36).slice(2, 10)
  return `${prefijo}+${marca}-${azar}@e2e.invalid`
}

async function fallar(paso: string, res: { status(): number; text(): Promise<string> }): Promise<never> {
  // El cuerpo puede traer el mensaje del Edge Function («Origin not allowed»,
  // «Insufficient permissions»), que es justo lo que hace falta para no tener
  // que adivinar. Nunca contiene el token: los que emitimos no lo devuelven en
  // el error, y el de acceso no se manda a ningún sitio que responda texto.
  const cuerpo = (await res.text().catch(() => '')).slice(0, 400)
  throw new Error(`${paso} respondió ${res.status()}${cuerpo ? ` — ${cuerpo}` : ''}`)
}

/**
 * Inicia sesión contra GoTrue y devuelve el access token. En memoria: no se
 * escribe a disco, no se imprime y no se devuelve en ningún error.
 */
export async function iniciarSesionApi(
  request: APIRequestContext,
  email: string = LOGIN.email,
  password: string = LOGIN.password,
): Promise<string> {
  const res = await request.post(`${SUPABASE.url}/auth/v1/token?grant_type=password`, {
    headers: cabecerasBase(),
    data: { email, password },
  })
  if (!res.ok()) {
    await fallar(
      'El login por API (auth/v1/token) falló. Revisá que E2E_LOGIN_EMAIL/PASSWORD ' +
      'existan en el Supabase que declara E2E_SUPABASE_URL',
      res,
    )
  }
  const cuerpo = (await res.json()) as { access_token?: string }
  if (!cuerpo.access_token) throw new Error('auth/v1/token respondió 200 sin access_token')
  return cuerpo.access_token
}

function autorizado(jwt: string): Record<string, string> {
  return { ...cabecerasBase(), Authorization: `Bearer ${jwt}` }
}

export interface InvitacionCreada {
  /** id de la fila en user_invitations, para poder borrarla al limpiar. */
  id: string
  /** Correo invitado. No es sensible: lo generamos nosotros y es de un TLD inválido. */
  email: string
  /** Token de un solo uso. NO IMPRIMIR. Su único destino es la URL que visita el navegador. */
  token: string
}

/**
 * Crea una invitación nueva llamando al Edge Function `invite-user` con el JWT
 * del administrador — el mismo camino que usa la pantalla de usuarios.
 *
 * El token sale de `accept_url`, que la función devuelve para que el frontend
 * pueda ofrecer el enlace cuando el correo no se envía. No se inventa ni se
 * lee de la base: es exactamente el que recibiría el invitado.
 */
export async function crearInvitacion(
  request: APIRequestContext,
  jwt: string,
  opciones: { email?: string; rol?: string; nombre?: string } = {},
): Promise<InvitacionCreada> {
  const email = opciones.email ?? correoDePrueba()
  const res = await request.post(`${SUPABASE.url}/functions/v1/invite-user`, {
    headers: autorizado(jwt),
    data: {
      email,
      role: opciones.rol ?? 'viewer',
      full_name: opciones.nombre ?? 'QA Invitado E2E',
    },
  })
  if (!res.ok()) {
    await fallar(
      'invite-user falló. Necesita que E2E_LOGIN_EMAIL sea admin o company_owner ' +
      'del tenant, y que el Origin del Preview esté en ALLOWED_ORIGINS del proyecto',
      res,
    )
  }
  const cuerpo = (await res.json()) as { invitation_id?: string; accept_url?: string }
  if (!cuerpo.invitation_id || !cuerpo.accept_url) {
    throw new Error('invite-user respondió 200 sin invitation_id o accept_url')
  }
  const token = new URL(cuerpo.accept_url).searchParams.get('token')
  if (!token) throw new Error('accept_url de invite-user no trae el parámetro token')
  return { id: cuerpo.invitation_id, email, token }
}

/**
 * Busca en app_users el id del usuario recién creado por su correo. Va por RLS
 * con el JWT del admin (user_invitations/app_users acotan por company_id), no
 * por service_role. Devuelve null si no existe: la prueba puede haber fallado
 * antes de crearlo, y la limpieza no debe romper por eso.
 */
export async function idDeUsuarioPorCorreo(
  request: APIRequestContext,
  jwt: string,
  email: string,
): Promise<string | null> {
  const res = await request.get(
    `${SUPABASE.url}/rest/v1/app_users?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: autorizado(jwt) },
  )
  if (!res.ok()) return null
  const filas = (await res.json()) as Array<{ id: string }>
  return filas[0]?.id ?? null
}

/** Borra el usuario creado por la prueba vía el Edge `delete-user` (que exige
 *  admin/owner y valida que el objetivo sea de la misma company). Sin
 *  service_role. No lanza: la limpieza informa, no rompe. */
export async function eliminarUsuario(
  request: APIRequestContext,
  jwt: string,
  userId: string,
): Promise<boolean> {
  const res = await request.post(`${SUPABASE.url}/functions/v1/delete-user`, {
    headers: autorizado(jwt),
    data: { user_id: userId },
  })
  return res.ok()
}

/**
 * Máximo `lectura_actual` registrado para un contador. Es el dato que la
 * captura necesita para elegir un valor libre a la PRIMERA, y que la pantalla
 * NO da: «Última Lectura» sale de un historial ordenado sólo por `fecha`, así
 * que entre las lecturas del mismo día muestra una cualquiera (ver
 * `ultimaLecturaMostrada` en sembrar.ts).
 *
 * SE PIDE EL MÁXIMO DEL CONTADOR, NO EL DEL DÍA. La llave natural es
 * (contador_id, lectura_actual, fecha), así que para no chocar bastaría con el
 * máximo de esa fecha; pero `validarLectura` exige ADEMÁS que el valor supere
 * al anterior para no leerlo como retroceso del medidor. El máximo del contador
 * es ≥ el del día y cumple las dos condiciones de una sola vez, con una sola
 * consulta. Ordena la base (`order=lectura_actual.desc&limit=1`), no el cliente.
 *
 * El filtro `deleted_at=is.null` no es cosmético: espeja el predicado del
 * índice, que es PARCIAL (`WHERE deleted_at IS NULL AND contador_id IS NOT
 * NULL`). Una lectura borrada no ocupa la llave, así que contarla inflaría el
 * valor sin motivo.
 *
 * Devuelve null si el contador no tiene lecturas o si la consulta no responde
 * 2xx: el caller cae entonces a lo que muestra la pantalla, que sigue siendo
 * una cota inferior válida.
 */
export async function maxLecturaDeContador(
  request: APIRequestContext,
  jwt: string,
  contadorId: string,
): Promise<number | null> {
  const res = await request.get(
    `${SUPABASE.url}/rest/v1/registros` +
    `?select=lectura_actual&contador_id=eq.${encodeURIComponent(contadorId)}` +
    '&deleted_at=is.null&order=lectura_actual.desc&limit=1',
    { headers: autorizado(jwt) },
  )
  if (!res.ok()) return null
  const filas = (await res.json()) as Array<{ lectura_actual: number | string | null }>
  const valor = Number(filas[0]?.lectura_actual)
  return Number.isFinite(valor) ? valor : null
}

/** Borra la fila de user_invitations. La policy `user_invitations_delete`
 *  autoriza a admin/owner sobre las de su company. No lanza. */
export async function eliminarInvitacion(
  request: APIRequestContext,
  jwt: string,
  invitacionId: string,
): Promise<boolean> {
  const res = await request.delete(
    `${SUPABASE.url}/rest/v1/user_invitations?id=eq.${encodeURIComponent(invitacionId)}`,
    { headers: autorizado(jwt) },
  )
  return res.ok()
}
