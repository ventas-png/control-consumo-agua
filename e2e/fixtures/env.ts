// Centraliza la lectura de env para los E2E + los flags de "gating".
//
// El gating es una comodidad LOCAL: correr sin variables en tu máquina skipea
// con un mensaje claro en vez de reventar. En CI ya NO produce verde: el
// preflight (scripts/e2e-preflight.mjs) falla el job ANTES de Playwright si
// faltan las variables obligatorias, y el verificador (scripts/e2e-verificar.mjs)
// lo falla DESPUÉS si estos skips dejaron un spec sin ejecutar.
//
// YA NO HAY SPECS CONDICIONALES. Los dos que había —invitación y fiscal— se
// omitían por una variable que declaraba una precondición externa
// (E2E_INVITE_TOKEN, E2E_FISCAL_SANDBOX_READY). Ambos fabrican ahora su propia
// precondición: la invitación se crea por la Edge Function `invite-user` en
// cada intento, y el comprobante fiscal se emite dentro de la propia prueba.
// Las dos variables desaparecieron del repositorio: ver e2e/README.md.

function env(name: string): string {
  return process.env[name] || ''
}

export const E2E_BASE_URL = env('E2E_BASE_URL')
export const hasBaseUrl = Boolean(E2E_BASE_URL)

// Usuario existente para el login y los flujos autenticados (agua/condominios/fiscal).
// Tiene que ser `admin` o `company_owner` del tenant sembrado: el spec de
// invitación llama a `invite-user`, que exige ese rol.
export const LOGIN = {
  email: env('E2E_LOGIN_EMAIL'),
  password: env('E2E_LOGIN_PASSWORD'),
}
export const hasLoginCreds = Boolean(LOGIN.email && LOGIN.password)

// API del Supabase al que apunta el despliegue de pruebas. La usan los specs
// que necesitan preparar o limpiar su propio dato por fuera del navegador
// (crear la invitación, borrar el usuario que creó).
//
// LA PUBLISHABLE KEY, NUNCA UNA SECRET KEY. Es la misma clave que el navegador
// ya lleva en el bundle del Preview: no concede nada que un visitante no tenga.
// Todo lo que estos specs hacen con ella pasa por el JWT del admin y por la
// RLS, exactamente como lo haría la aplicación. Meter `service_role` aquí
// convertiría la suite en un bypass de RLS con forma de prueba, y de paso
// pondría una llave de administrador en los secretos de CI.
export const SUPABASE = {
  url: env('E2E_SUPABASE_URL').replace(/\/$/, ''),
  publishableKey: env('E2E_SUPABASE_PUBLISHABLE_KEY'),
}
export const hasSupabaseApi = Boolean(SUPABASE.url && SUPABASE.publishableKey)

// Usuario de rol RESTRINGIDO (viewer/operator — NO admin ni owner) para los
// tests de acceso denegado autenticado (P2 #8). Debe pertenecer al mismo
// tenant sembrado que E2E_LOGIN_*.
export const RESTRICTED = {
  email: env('E2E_RESTRICTED_EMAIL'),
  password: env('E2E_RESTRICTED_PASSWORD'),
}
export const hasRestrictedCreds = Boolean(RESTRICTED.email && RESTRICTED.password)

// Usuario de rol CLIENTE (residente/cliente final) para el portal del cliente —
// fuera del shell administrativo. Idealmente sembrado con un cargo pendiente
// y pago en línea (Stripe) activo — si falta, el spec se skipea en runtime.
export const PORTAL = {
  email: env('E2E_PORTAL_EMAIL'),
  password: env('E2E_PORTAL_PASSWORD'),
}
export const hasPortalCreds = Boolean(PORTAL.email && PORTAL.password)

// Helpers de gating para usar en `test.skip(...)`.
export const reasons = {
  baseUrl: 'define E2E_BASE_URL (preview/sandbox) — ver e2e/README.md',
  login: 'define E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD — ver e2e/README.md',
  supabaseApi: 'define E2E_SUPABASE_URL / E2E_SUPABASE_PUBLISHABLE_KEY — ver e2e/README.md',
  restricted: 'define E2E_RESTRICTED_EMAIL / E2E_RESTRICTED_PASSWORD (rol viewer/operator) — ver e2e/README.md',
  portal: 'define E2E_PORTAL_EMAIL / E2E_PORTAL_PASSWORD (usuario rol cliente) — ver e2e/README.md',
}
