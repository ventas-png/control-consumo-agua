// Helpers puros del flujo OAuth: con qué proveedor entró la persona (GoTrue lo
// deja en app_metadata.provider) y qué nombre trajo la metadata. Apple solo
// entrega el nombre en la primera autorización: sin nombre, el onboarding lo pide.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), getUser: vi.fn(), signOut: vi.fn() } },
  getOAuthCallbackError: () => null,
}))
vi.mock('../../../lib/security', () => ({ logSecurityEvent: vi.fn(async () => undefined) }))
vi.mock('../../../lib/authSession', () => ({ getStoredSession: () => null, storeSession: vi.fn() }))
vi.mock('../../../domain/auth/session', () => ({
  buildSessionFromSupabase: vi.fn(),
  refreshSessionFromSupabase: vi.fn(),
  appUserProfileExists: vi.fn(),
}))
vi.mock('../../../domain/auth/oauthCallbackError', () => ({ describeOAuthCallbackError: (e: unknown) => String(e) }))

import { oauthFullNameOf, oauthProviderOf } from '../useOAuthSession'

describe('oauthProviderOf', () => {
  it('reconoce google y apple; cualquier otra cosa es "oauth"', () => {
    expect(oauthProviderOf({ app_metadata: { provider: 'google' } })).toBe('google')
    expect(oauthProviderOf({ app_metadata: { provider: 'apple' } })).toBe('apple')
    expect(oauthProviderOf({ app_metadata: { provider: 'email' } })).toBe('oauth')
    expect(oauthProviderOf({ app_metadata: undefined })).toBe('oauth')
  })
})

describe('oauthFullNameOf', () => {
  it('full_name gana sobre name; ambos recortados', () => {
    expect(oauthFullNameOf({ user_metadata: { full_name: ' Ana García ', name: 'Ana' } })).toBe('Ana García')
    expect(oauthFullNameOf({ user_metadata: { name: 'Ana' } })).toBe('Ana')
  })

  it('sin nombre devuelve cadena vacía (no el email): así el onboarding sabe que debe pedirlo', () => {
    expect(oauthFullNameOf({ user_metadata: {} })).toBe('')
    expect(oauthFullNameOf({ user_metadata: undefined })).toBe('')
    expect(oauthFullNameOf({ user_metadata: { full_name: 42 } })).toBe('')
  })
})
