// El registro de push nativo solo corre con VITE_PUSH_ENABLED=true. Sin Firebase
// configurado, `register()` en Android hace caer la app (el puente de Capacitor
// relanza la excepción de Firebase en el hilo del plugin; ver src/lib/push.ts),
// así que con la variable apagada no debe tocarse el plugin en absoluto: ni el
// permiso ni el registro.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Se mockea @capacitor/core (no src/lib/platform) para recorrer el camino real:
// platform.ts → Capacitor.isNativePlatform() / Capacitor.getPlatform().
const capacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(),
  getPlatform: vi.fn<() => string>(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }))

const push = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  addListener: vi.fn(),
  register: vi.fn(),
}))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }))

vi.mock('../supabase', () => ({
  supabase: { rpc: vi.fn(() => Promise.resolve({ error: null })) },
}))

import { initPushNotifications, pushHabilitado } from '../push'

function simularPlataforma(plataforma: 'web' | 'android' | 'ios') {
  capacitor.isNativePlatform.mockReturnValue(plataforma !== 'web')
  capacitor.getPlatform.mockReturnValue(plataforma)
}

beforeEach(() => {
  vi.clearAllMocks()
  push.requestPermissions.mockResolvedValue({ receive: 'granted' })
  push.addListener.mockResolvedValue({ remove: vi.fn() })
  push.register.mockResolvedValue(undefined)
  vi.stubEnv('VITE_PUSH_ENABLED', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('pushHabilitado', () => {
  it.each(['true', 'TRUE', '1', ' true '])('acepta %j', (v) => {
    vi.stubEnv('VITE_PUSH_ENABLED', v)
    expect(pushHabilitado()).toBe(true)
  })
  it.each(['', 'false', '0', 'yes'])('rechaza %j', (v) => {
    vi.stubEnv('VITE_PUSH_ENABLED', v)
    expect(pushHabilitado()).toBe(false)
  })
})

describe('initPushNotifications', () => {
  it('Android sin la variable: no pide permiso ni registra (evita el crash sin Firebase)', async () => {
    simularPlataforma('android')
    await initPushNotifications('u1')
    expect(push.requestPermissions).not.toHaveBeenCalled()
    expect(push.register).not.toHaveBeenCalled()
  })

  it('iOS sin la variable: no pide permiso de notificaciones', async () => {
    simularPlataforma('ios')
    await initPushNotifications('u1')
    expect(push.requestPermissions).not.toHaveBeenCalled()
  })

  it('con la variable en nativo: pide permiso y registra el dispositivo', async () => {
    vi.stubEnv('VITE_PUSH_ENABLED', 'true')
    simularPlataforma('android')
    await initPushNotifications('u1')
    expect(push.requestPermissions).toHaveBeenCalledOnce()
    expect(push.register).toHaveBeenCalledOnce()
  })

  it('con la variable pero permiso denegado: no registra', async () => {
    vi.stubEnv('VITE_PUSH_ENABLED', 'true')
    simularPlataforma('ios')
    push.requestPermissions.mockResolvedValue({ receive: 'denied' })
    await initPushNotifications('u1')
    expect(push.register).not.toHaveBeenCalled()
  })

  it('en web nunca toca el plugin, aunque la variable esté puesta', async () => {
    vi.stubEnv('VITE_PUSH_ENABLED', 'true')
    simularPlataforma('web')
    await initPushNotifications('u1')
    expect(push.requestPermissions).not.toHaveBeenCalled()
  })
})
