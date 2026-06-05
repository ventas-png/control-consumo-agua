import { describe, it, expect } from 'vitest'
import {
  normalizeDomain,
  parseSsoAdminRequest,
  sanitizeIdpMetadata,
  buildGoTrueProviderBody,
  isSsoDisabledResponse,
  classifyGoTrueResult,
  extractMessage,
} from '../sso.ts'

describe('normalizeDomain', () => {
  it('normaliza trim + lowercase', () => {
    expect(normalizeDomain('  Acme.COM ')).toBe('acme.com')
    expect(normalizeDomain('sub.acme.co.uk')).toBe('sub.acme.co.uk')
  })
  it('rechaza inválidos → null', () => {
    for (const bad of ['', 'acme', '@acme.com', 'http://a.com', '-a.com', 'a-.com', 42, null, undefined]) {
      expect(normalizeDomain(bad as unknown)).toBeNull()
    }
  })
})

describe('parseSsoAdminRequest', () => {
  it('rechaza body no-objeto / acción desconocida', () => {
    expect('error' in parseSsoAdminRequest(null)).toBe(true)
    expect('error' in parseSsoAdminRequest({ action: 'nope' })).toBe(true)
  })
  it('upsert_domain valida y normaliza el dominio', () => {
    expect(parseSsoAdminRequest({ action: 'upsert_domain', domain: 'ACME.com' })).toEqual({
      action: 'upsert_domain', domain: 'acme.com',
    })
    expect('error' in parseSsoAdminRequest({ action: 'upsert_domain', domain: 'bad' })).toBe(true)
  })
  it('delete_domain exige id', () => {
    expect(parseSsoAdminRequest({ action: 'delete_domain', id: 'x' })).toEqual({ action: 'delete_domain', id: 'x' })
    expect('error' in parseSsoAdminRequest({ action: 'delete_domain' })).toBe(true)
  })
  it('set_enforced exige id + booleano', () => {
    expect(parseSsoAdminRequest({ action: 'set_enforced', id: 'x', enforced: true })).toEqual({
      action: 'set_enforced', id: 'x', enforced: true,
    })
    expect('error' in parseSsoAdminRequest({ action: 'set_enforced', id: 'x', enforced: 'yes' })).toBe(true)
  })
  it('save_metadata exige metadata_url o metadata_xml', () => {
    expect('error' in parseSsoAdminRequest({ action: 'save_metadata', id: 'x', metadata: {} })).toBe(true)
    const ok = parseSsoAdminRequest({ action: 'save_metadata', id: 'x', metadata: { metadata_url: 'https://idp/meta' } })
    expect('error' in ok).toBe(false)
  })
  it('nunca filtra company_id aunque venga en el body', () => {
    const out = parseSsoAdminRequest({ action: 'upsert_domain', domain: 'acme.com', company_id: 'attacker' })
    expect(out).toEqual({ action: 'upsert_domain', domain: 'acme.com' })
    expect('company_id' in (out as object)).toBe(false)
  })
})

describe('sanitizeIdpMetadata', () => {
  it('conserva solo campos conocidos y normaliza attribute_mapping', () => {
    const out = sanitizeIdpMetadata({
      metadata_url: ' https://idp/meta ',
      entity_id: 'urn:idp',
      junk: 'nope',
      attribute_mapping: { email: 'mail', bad: 1 },
    })
    expect(out).toEqual({
      metadata_url: 'https://idp/meta',
      entity_id: 'urn:idp',
      attribute_mapping: { email: 'mail' },
    })
  })
})

describe('buildGoTrueProviderBody', () => {
  it('prefiere metadata_url y mapea dominios + attribute_mapping', () => {
    const body = buildGoTrueProviderBody(
      { metadata_url: 'https://idp/meta', metadata_xml: '<xml/>', attribute_mapping: { email: 'mail' } },
      ['ACME.com', '  ', 'beta.com'],
    )
    expect(body).toEqual({
      type: 'saml',
      metadata_url: 'https://idp/meta',
      domains: ['acme.com', 'beta.com'],
      attribute_mapping: { keys: { email: { name: 'mail' } } },
    })
  })
  it('usa metadata_xml si no hay url', () => {
    const body = buildGoTrueProviderBody({ metadata_xml: '<xml/>' }, ['acme.com'])
    expect(body.metadata_xml).toBe('<xml/>')
    expect(body.metadata_url).toBeUndefined()
  })
})

describe('isSsoDisabledResponse', () => {
  it('404/501 = SSO deshabilitado', () => {
    expect(isSsoDisabledResponse(404, null)).toBe(true)
    expect(isSsoDisabledResponse(501, null)).toBe(true)
  })
  it('mensajes que mencionan SAML/SSO + off', () => {
    expect(isSsoDisabledResponse(400, { msg: 'SAML 2.0 is not enabled' })).toBe(true)
    expect(isSsoDisabledResponse(422, { error_code: 'sso_provider_disabled' })).toBe(true)
  })
  it('errores no relacionados no se confunden con disabled', () => {
    expect(isSsoDisabledResponse(400, { msg: 'invalid metadata xml' })).toBe(false)
    expect(isSsoDisabledResponse(409, { msg: 'duplicate domain' })).toBe(false)
  })
})

describe('classifyGoTrueResult', () => {
  it('2xx con id → ok', () => {
    expect(classifyGoTrueResult(201, { id: 'prov-123' })).toMatchObject({ status: 'ok', providerId: 'prov-123' })
  })
  it('SSO deshabilitado → sso_disabled (parqueado)', () => {
    expect(classifyGoTrueResult(404, null).status).toBe('sso_disabled')
    expect(classifyGoTrueResult(400, { msg: 'SAML not enabled' }).status).toBe('sso_disabled')
  })
  it('error genuino → error', () => {
    const r = classifyGoTrueResult(400, { msg: 'invalid metadata' })
    expect(r.status).toBe('error')
    expect(r.message).toContain('invalid metadata')
  })
})

describe('extractMessage', () => {
  it('lee distintos campos de error', () => {
    expect(extractMessage('plain')).toBe('plain')
    expect(extractMessage({ msg: 'a' })).toBe('a')
    expect(extractMessage({ error_description: 'b' })).toBe('b')
    expect(extractMessage({ nope: 1 })).toBe('')
  })
})
