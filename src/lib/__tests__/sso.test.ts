// T3 · plat:P10 — Tests de la detección PURA de SSO del login.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// El módulo lib/sso importa lib/supabase (que lee env vars y crearía un cliente).
// Lo stubeamos: estos tests ejercitan la detección pura + detectSsoForEmail con
// el lookup mockeado, sin red. Mismo patrón que cobros/mutations.test.ts.
vi.mock('../supabase', () => ({
  supabase: {
    auth: { signInWithSSO: vi.fn() },
  },
}))

const lookupSsoDomain = vi.fn()
vi.mock('../../domain/sso/queries', () => ({
  lookupSsoDomain: (d: string) => lookupSsoDomain(d),
}))

import { extractEmailDomain, detectSsoForEmail } from '../sso'

describe('extractEmailDomain', () => {
  it('extrae y normaliza el dominio', () => {
    expect(extractEmailDomain('alice@Acme.COM')).toBe('acme.com')
    expect(extractEmailDomain('  bob@sub.acme.co.uk ')).toBe('sub.acme.co.uk')
  })

  it('devuelve null para entradas inválidas', () => {
    for (const bad of ['', 'alice', 'alice@', '@acme.com', 'a@@b.com', 'a@b', 'a@b..com', 'a@.com', 'a@com.', 'a b@acme.com', 'a@ac me.com']) {
      expect(extractEmailDomain(bad), `debería ser null: ${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('email parcial mientras se tipea → null (no dispara SSO antes de tiempo)', () => {
    expect(extractEmailDomain('alice@acme')).toBeNull()
    expect(extractEmailDomain('alice@')).toBeNull()
  })
})

describe('detectSsoForEmail', () => {
  beforeEach(() => {
    lookupSsoDomain.mockReset()
  })

  it('email sin dominio válido → no consulta y devuelve sin SSO', async () => {
    const res = await detectSsoForEmail('alice@acme')
    expect(res).toEqual({ available: false, enforced: false, providerId: null, domain: null })
    expect(lookupSsoDomain).not.toHaveBeenCalled()
  })

  it('dominio con SSO disponible', async () => {
    lookupSsoDomain.mockResolvedValue({ available: true, enforced: false, providerId: 'prov-1' })
    const res = await detectSsoForEmail('alice@acme.com')
    expect(lookupSsoDomain).toHaveBeenCalledWith('acme.com')
    expect(res).toEqual({ available: true, enforced: false, providerId: 'prov-1', domain: 'acme.com' })
  })

  it('dominio con SSO forzado', async () => {
    lookupSsoDomain.mockResolvedValue({ available: true, enforced: true, providerId: 'prov-2' })
    const res = await detectSsoForEmail('bob@acme.com')
    expect(res.enforced).toBe(true)
    expect(res.domain).toBe('acme.com')
  })

  it('dominio sin SSO → fallback graceful (password)', async () => {
    lookupSsoDomain.mockResolvedValue({ available: false, enforced: false, providerId: null })
    const res = await detectSsoForEmail('eve@nosso.com')
    expect(res.available).toBe(false)
  })
})
