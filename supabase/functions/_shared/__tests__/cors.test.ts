// Tests del allow-list de orígenes CORS (infra:I22). Es una frontera de seguridad:
// define qué orígenes pueden invocar las edge functions. cors.ts lee Deno.env al
// evaluar, así que stubeamos el global Deno (mismo patrón que auth.test.ts).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function stubDeno(env: Record<string, string | undefined>) {
  ;(globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: (k: string) => env[k] },
  }
}

beforeEach(() => stubDeno({})) // sin ALLOWED_ORIGINS ni APP_URL → defaults (prod + localhost)
afterEach(() => { delete (globalThis as unknown as { Deno?: unknown }).Deno })

describe('_shared/cors — isOriginAllowed', () => {
  it('permite los dominios de producción siempre', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://administratodo.com')).toBe(true)
    expect(isOriginAllowed('https://www.administratodo.app')).toBe(true)
  })

  it('rechaza orígenes desconocidos y null', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://evil.example')).toBe(false)
    expect(isOriginAllowed(null)).toBe(false)
  })

  it('incluye localhost cuando NO hay ALLOWED_ORIGINS', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('http://localhost:5173')).toBe(true)
  })

  it('respeta ALLOWED_ORIGINS del entorno y excluye localhost', async () => {
    stubDeno({ ALLOWED_ORIGINS: 'https://staging.example, https://qa.example' })
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://staging.example')).toBe(true)
    expect(isOriginAllowed('https://qa.example')).toBe(true)
    expect(isOriginAllowed('http://localhost:5173')).toBe(false)
  })
})

describe('_shared/cors — headers y validación', () => {
  it('getCorsHeaders refleja el origin permitido', async () => {
    const { getCorsHeaders } = await import('../cors.ts')
    expect(getCorsHeaders('https://administratodo.com')['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })

  it('getCorsHeaders cae al primer permitido si el origin no está en la lista', async () => {
    const { getCorsHeaders } = await import('../cors.ts')
    expect(getCorsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })

  it('validateOrigin devuelve null si permitido y 403 si no', async () => {
    const { validateOrigin, getCorsHeaders } = await import('../cors.ts')
    const headers = getCorsHeaders('https://administratodo.com')
    expect(validateOrigin('https://administratodo.com', headers)).toBeNull()
    const res = validateOrigin('https://evil.example', headers)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })
})
