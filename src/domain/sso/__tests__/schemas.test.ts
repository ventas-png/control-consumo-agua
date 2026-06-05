// T3 · plat:P10 — Tests de los schemas/helpers PUROS del dominio SSO.
import { describe, it, expect } from 'vitest'
import {
  domainSchema,
  parseSsoLookup,
  ssoLookupRowSchema,
  SSO_LOOKUP_NONE,
} from '../schemas'

describe('domainSchema', () => {
  it('acepta dominios válidos y los normaliza a minúsculas', () => {
    expect(domainSchema.parse('acme.com')).toBe('acme.com')
    expect(domainSchema.parse('  Acme.COM  ')).toBe('acme.com')
    expect(domainSchema.parse('sub.acme.co.uk')).toBe('sub.acme.co.uk')
  })

  it('rechaza valores inválidos', () => {
    for (const bad of ['', '   ', 'acme', 'acme.', '@acme.com', 'http://acme.com', 'a b.com', '-acme.com', 'acme-.com']) {
      expect(domainSchema.safeParse(bad).success, `debería rechazar: ${JSON.stringify(bad)}`).toBe(false)
    }
  })
})

describe('ssoLookupRowSchema', () => {
  it('valida una fila bien formada', () => {
    expect(ssoLookupRowSchema.safeParse({ sso_available: true, enforced: false, provider_id: null }).success).toBe(true)
    expect(ssoLookupRowSchema.safeParse({ sso_available: true, enforced: true, provider_id: 'prov-1' }).success).toBe(true)
  })
  it('rechaza filas con tipos incorrectos', () => {
    expect(ssoLookupRowSchema.safeParse({ sso_available: 'yes', enforced: false, provider_id: null }).success).toBe(false)
  })
})

describe('parseSsoLookup', () => {
  it('array vacío / null → SSO_LOOKUP_NONE (fallback graceful)', () => {
    expect(parseSsoLookup([])).toEqual(SSO_LOOKUP_NONE)
    expect(parseSsoLookup(null)).toEqual(SSO_LOOKUP_NONE)
    expect(parseSsoLookup(undefined)).toEqual(SSO_LOOKUP_NONE)
  })

  it('dominio con SSO disponible (no forzado)', () => {
    expect(parseSsoLookup([{ sso_available: true, enforced: false, provider_id: 'prov-1' }])).toEqual({
      available: true,
      enforced: false,
      providerId: 'prov-1',
    })
  })

  it('dominio con SSO forzado', () => {
    expect(parseSsoLookup([{ sso_available: true, enforced: true, provider_id: 'prov-2' }])).toEqual({
      available: true,
      enforced: true,
      providerId: 'prov-2',
    })
  })

  it('acepta también una fila suelta (no array)', () => {
    expect(parseSsoLookup({ sso_available: true, enforced: false, provider_id: null })).toEqual({
      available: true,
      enforced: false,
      providerId: null,
    })
  })

  it('sso_available falso o ausente → NONE', () => {
    expect(parseSsoLookup([{ sso_available: false, enforced: false, provider_id: null }])).toEqual(SSO_LOOKUP_NONE)
    expect(parseSsoLookup([{ enforced: true, provider_id: 'x' }])).toEqual(SSO_LOOKUP_NONE)
  })

  it('fila malformada → NONE (no lanza)', () => {
    expect(parseSsoLookup([{ garbage: 1 }])).toEqual(SSO_LOOKUP_NONE)
    expect(parseSsoLookup(['nonsense'])).toEqual(SSO_LOOKUP_NONE)
  })
})
