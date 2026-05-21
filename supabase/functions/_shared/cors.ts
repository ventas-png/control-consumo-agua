/**
 * CORS utilities for Edge Functions
 * Restricts CORS to allowed origins for improved security
 */

// Get allowed origins from environment or use defaults
function getAllowedOrigins(): string[] {
  // Production domains are always allowed (independent of the ALLOWED_ORIGINS secret).
  const origins = new Set<string>([
    'https://administratodo.com',
    'https://www.administratodo.com',
    'https://administratodo.app',
    'https://www.administratodo.app',
  ])

  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    for (const origin of envOrigins.split(',')) {
      const trimmed = origin.trim()
      if (trimmed) origins.add(trimmed)
    }
  } else {
    // Default: localhost for development
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://127.0.0.1:3000')
  }

  // Always allow the configured public app URL so production CORS works even
  // when ALLOWED_ORIGINS is unset (APP_URL is already set for Google OAuth).
  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) {
    try { origins.add(new URL(appUrl).origin) } catch { /* ignore malformed APP_URL */ }
  }

  return [...origins]
}

/**
 * Validate request origin against allowed list
 * @param origin - The origin from request headers
 * @returns true if origin is allowed, false otherwise
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false

  const allowedOrigins = getAllowedOrigins()
  return allowedOrigins.includes(origin)
}

/**
 * Get safe CORS headers with origin validation
 * @param origin - The origin from request headers
 * @returns CORS headers object
 */
export function getCorsHeaders(origin: string | null) {
  const allowedOrigins = getAllowedOrigins()
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }
}

/**
 * Validate request origin and return error if not allowed
 * @param origin - The origin from request headers
 * @param corsHeaders - CORS headers object
 * @returns Response if origin is not allowed, null if allowed
 */
export function validateOrigin(origin: string | null, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  if (!isOriginAllowed(origin)) {
    return new Response(
      JSON.stringify({
        error: 'Origin not allowed',
        origin: origin
      }),
      {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
  return null
}
