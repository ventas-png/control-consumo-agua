// Validación del payload de signup-company. Extraída del handler para poder testearla
// en aislamiento (infra:I22). Pura: sin Deno ni supabase-js → corre directo en vitest.

export interface SignupPayload {
  email?: string
  password?: string
  full_name?: string
  company_name?: string
  phone?: string
  // Moneda de cobro de la empresa (ISO 4217 minusculas). Opcional: el handler
  // cae a 'gtq' si no viene. Debe estar en MONEDAS_SIGNUP (espejo del CHECK
  // valid_currency + catalogo src/lib/monedas.ts).
  default_currency?: string
  // Modulo inicial elegido en el formulario para personalizar el dashboard
  servicio_agua?: boolean
  servicio_condominios?: boolean
  // Aceptacion click-wrap (RGPD/CCPA): debe venir en true. El handler registra la
  // evidencia (version + IP + timestamp + user-agent) en legal_acceptances.
  legal_accepted?: boolean
}

/** Monedas elegibles en el alta self-service (subset del CHECK valid_currency). */
export const MONEDAS_SIGNUP = new Set([
  'gtq', 'usd', 'mxn', 'hnl', 'nio', 'crc', 'pab', 'dop',
  'cop', 'pen', 'clp', 'ars', 'brl', 'bob', 'pyg', 'uyu', 'eur',
])

/** Devuelve un mensaje de error (es) si el payload es inválido, o `null` si es válido. */
export function validatePayload(p: SignupPayload): string | null {
  if (!p.email || typeof p.email !== 'string') return 'Email es requerido'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return 'Formato de email invalido'
  if (!p.password || typeof p.password !== 'string') return 'Contrasena es requerida'
  if (p.password.length < 8) return 'La contrasena debe tener al menos 8 caracteres'
  // Validacion basica de fortaleza: al menos una letra y un numero
  if (!/[a-zA-Z]/.test(p.password) || !/[0-9]/.test(p.password)) {
    return 'La contrasena debe contener al menos una letra y un numero'
  }
  if (!p.full_name || typeof p.full_name !== 'string' || p.full_name.trim().length < 2) {
    return 'Nombre completo es requerido'
  }
  if (!p.company_name || typeof p.company_name !== 'string' || p.company_name.trim().length < 2) {
    return 'Nombre de la empresa es requerido'
  }
  if (p.servicio_agua !== true && p.servicio_condominios !== true) {
    return 'Selecciona al menos un servicio (agua o condominios)'
  }
  if (p.default_currency !== undefined) {
    if (typeof p.default_currency !== 'string' || !MONEDAS_SIGNUP.has(p.default_currency.trim().toLowerCase())) {
      return 'Moneda de cobro invalida'
    }
  }
  if (p.legal_accepted !== true) {
    return 'Debes aceptar los Términos de Servicio, la Política de Privacidad y el Anexo DPA'
  }
  return null
}
