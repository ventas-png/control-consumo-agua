// Login social en la app nativa: Google y Apple comparten el mismo camino
// (URL de autorización de Supabase con skipBrowserRedirect → navegador del
// sistema → deep link). Sin plugin nativo de Apple: ver el comentario del módulo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  browserOpen: vi.fn(async (_o: { url: string }) => undefined),
}))
vi.mock('../supabase', () => ({
  supabase: { auth: { signInWithOAuth: mocks.signInWithOAuth, exchangeCodeForSession: vi.fn() } },
}))
vi.mock('@capacitor/browser', () => ({
  Browser: { open: mocks.browserOpen, close: vi.fn(async () => undefined) },
}))
vi.mock('../platform', () => ({ isNative: () => true, getPlatform: () => 'ios' }))

import {
  NATIVE_OAUTH_REDIRECT,
  errorLoginSocial,
  nativeAppleLogin,
  nativeGoogleLogin,
  nativeSocialLogin,
} from '../nativeAuth'

beforeEach(() => {
  mocks.signInWithOAuth.mockReset().mockResolvedValue({ data: { url: 'https://auth.example/authorize' }, error: null })
  mocks.browserOpen.mockClear()
})

describe('nativeSocialLogin', () => {
  it('Apple: pide la URL a Supabase sin navegar el WebView y la abre en el navegador del sistema', async () => {
    await expect(nativeAppleLogin()).resolves.toBeNull()
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'apple',
      options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true },
    })
    expect(mocks.browserOpen).toHaveBeenCalledWith({ url: 'https://auth.example/authorize' })
  })

  it('Google: mismo camino con provider google', async () => {
    await expect(nativeGoogleLogin()).resolves.toBeNull()
    expect(mocks.signInWithOAuth.mock.calls[0][0].provider).toBe('google')
    expect(mocks.browserOpen).toHaveBeenCalledTimes(1)
  })

  it('si Supabase devuelve error o no da URL, no abre el navegador y el mensaje nombra al proveedor', async () => {
    mocks.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: null })
    await expect(nativeSocialLogin('apple')).resolves.toBe('Error al iniciar sesión con Apple')
    mocks.signInWithOAuth.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(nativeSocialLogin('google')).resolves.toBe('Error al iniciar sesión con Google')
    expect(mocks.browserOpen).not.toHaveBeenCalled()
  })

  it('si el navegador del sistema falla al abrir, devuelve el mismo mensaje en vez de lanzar', async () => {
    mocks.browserOpen.mockRejectedValueOnce(new Error('sin plugin'))
    await expect(nativeSocialLogin('apple')).resolves.toBe(errorLoginSocial('apple'))
  })

  it('el deep link es el scheme registrado en Info.plist / AndroidManifest', () => {
    expect(NATIVE_OAUTH_REDIRECT).toBe('com.administratodo.app://auth-callback')
  })
})
