// domain/auth/oauthCallbackError.ts — Parsing puro del error que GoTrue añade
// a la URL al volver de un proveedor OAuth (o de un enlace de recuperación).
//
// Cuando el callback server-side falla (ej.: el client secret de Google
// configurado en Supabase es inválido y el intercambio de código devuelve
// `invalid_client`), GoTrue NO entrega sesión: redirige de vuelta a la app con
// `error`, `error_code` y `error_description` en el fragment (flujo implícito)
// o en el query string. supabase-js no emite ningún evento en ese caso, así
// que sin capturar estos parámetros el usuario rebota a la landing sin ver
// ningún mensaje — exactamente el bug "hago los pasos de Google y nunca entro".
//
// Sin dependencias ni acceso a window: recibe hash/search como strings para
// ser testeable de forma aislada. La captura real (y la limpieza de la URL)
// vive en lib/supabase.ts, ANTES de crear el cliente.

export interface OAuthCallbackError {
  /** `error_code` de GoTrue si vino; si no, el `error` genérico (ej. server_error). */
  code: string | null
  /** `error_description` legible; cae a `error` si no vino descripción. */
  description: string
}

const ERROR_KEYS = ['error', 'error_code', 'error_description'] as const

/**
 * Extrae el error OAuth de un hash/search de URL (si existe) y devuelve las
 * versiones limpias de ambos (sin las claves de error, preservando el resto,
 * p.ej. `?lang=en`). Prioriza el fragment: es donde GoTrue reporta en el flujo
 * implícito; el query se revisa como fallback (versiones nuevas de GoTrue).
 */
export function extractOAuthCallbackError(hash: string, search: string): {
  error: OAuthCallbackError | null
  cleanedHash: string
  cleanedSearch: string
} {
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(search.replace(/^\?/, ''))

  const hasError = (p: URLSearchParams) => !!(p.get('error') || p.get('error_description'))
  const source = hasError(hashParams) ? hashParams : hasError(searchParams) ? searchParams : null

  if (!source) return { error: null, cleanedHash: hash, cleanedSearch: search }

  const error: OAuthCallbackError = {
    code: source.get('error_code') ?? source.get('error'),
    description: source.get('error_description') ?? source.get('error') ?? 'unknown_error',
  }

  for (const key of ERROR_KEYS) {
    hashParams.delete(key)
    searchParams.delete(key)
  }
  const cleanedHash = hashParams.toString()
  const cleanedSearch = searchParams.toString()
  return {
    error,
    cleanedHash: cleanedHash ? `#${cleanedHash}` : '',
    cleanedSearch: cleanedSearch ? `?${cleanedSearch}` : '',
  }
}

/**
 * Traduce el error crudo del callback a un mensaje accionable para el usuario.
 * Se conserva el detalle técnico: es lo que permite diagnosticar (p.ej.
 * distinguir un secret inválido de un usuario que canceló el consent).
 */
export function describeOAuthCallbackError(err: OAuthCallbackError): string {
  const detail = err.description || err.code || 'unknown_error'
  const haystack = `${err.code ?? ''} ${detail}`

  // Intercambio de código rechazado por el proveedor: configuración del
  // proveedor en Supabase (client secret de Google inválido/rotado). El
  // usuario no puede resolverlo — debe llegar al administrador.
  if (/unable to exchange external code|invalid_client/i.test(haystack)) {
    return 'Google autorizó el acceso, pero el servidor no pudo completar el inicio de sesión por un error de configuración. Reporte este mensaje al administrador. Detalle: ' + detail
  }

  if (/access_denied/i.test(haystack)) {
    return 'El acceso con Google fue cancelado. Intente de nuevo.'
  }

  if (/otp_expired|invalid or has expired/i.test(haystack)) {
    return 'El enlace ya expiró o no es válido. Solicite uno nuevo.'
  }

  return `No se pudo completar el inicio de sesión. Detalle: ${detail}`
}
