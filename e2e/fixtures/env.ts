// Centraliza la lectura de env para los E2E + los flags de "gating".
//
// Filosofía: cada spec se SKIPEA con un mensaje claro si le faltan datos, en vez
// de fallar. Así la suite queda verde sin secretos (CI sin wiring) y, cuando se
// cablean contra el preview/sandbox, los caminos corren de verdad.

function env(name: string): string {
  return process.env[name] || ''
}

export const E2E_BASE_URL = env('E2E_BASE_URL')
export const hasBaseUrl = Boolean(E2E_BASE_URL)

// Usuario existente para el login y los flujos autenticados (agua/condominios/fiscal).
export const LOGIN = {
  email: env('E2E_LOGIN_EMAIL'),
  password: env('E2E_LOGIN_PASSWORD'),
}
export const hasLoginCreds = Boolean(LOGIN.email && LOGIN.password)

// Token de invitación FRESCO (efímero) para /aceptar-invitacion. Lo genera el
// seed del preview (insert en user_invitations + edge invite-user). Sin esto el
// spec de invitación se skipea.
export const INVITE_TOKEN = env('E2E_INVITE_TOKEN')
export const hasInviteToken = Boolean(INVITE_TOKEN)

// Para timbrado contra Sandbox: confirma que el preview tiene PAC sandbox + config
// fiscal lista. Es un flag explícito porque depende de credenciales del PAC.
export const FISCAL_SANDBOX_READY = env('E2E_FISCAL_SANDBOX_READY') === '1'

// Helpers de gating para usar en `test.skip(...)`.
export const reasons = {
  baseUrl: 'define E2E_BASE_URL (preview/sandbox) — ver e2e/README.md',
  login: 'define E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD — ver e2e/README.md',
  invite: 'define E2E_INVITE_TOKEN (token fresco) — ver e2e/README.md',
  fiscal: 'define E2E_FISCAL_SANDBOX_READY=1 (+ login) — ver e2e/README.md',
}
