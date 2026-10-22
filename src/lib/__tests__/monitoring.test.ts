// Qué datos personales se mandan a Sentry. Sentry 11 retiró `sendDefaultPii` y
// sus valores por defecto de `dataCollection` recogen IP, cookies, cabeceras y
// cuerpos; si un upgrade vuelve a dejar la configuración por defecto, la IP del
// usuario empieza a llegar a Sentry sin que nada falle. Lo que se vigila:
//
//   1. Sin DSN no se inicializa nada.
//   2. Con DSN, init lleva la equivalencia de `sendDefaultPii: false`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
}))
vi.mock('@sentry/react', () => sentry)

async function cargarMonitoring() {
  vi.resetModules()
  return import('../monitoring')
}

beforeEach(() => { sentry.init.mockClear() })
afterEach(() => { vi.unstubAllEnvs() })

describe('initMonitoring', () => {
  it('sin VITE_SENTRY_DSN no inicializa Sentry', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initMonitoring } = await cargarMonitoring()
    initMonitoring()
    expect(sentry.init).not.toHaveBeenCalled()
  })

  it('no infiere la IP ni manda cuerpos HTTP, y quita las claves de IP o proxy', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://clave@o0.ingest.sentry.io/1')
    const { initMonitoring } = await cargarMonitoring()
    initMonitoring()

    expect(sentry.init).toHaveBeenCalledTimes(1)
    const opciones = sentry.init.mock.calls[0][0]
    expect(opciones).not.toHaveProperty('sendDefaultPii')
    const pii = { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }
    expect(opciones.dataCollection).toEqual({
      userInfo: false,
      cookies: pii,
      httpHeaders: pii,
      httpBodies: [],
      urlQueryParams: pii,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
    })
  })
})
