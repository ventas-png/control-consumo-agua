// Tests de la lógica pura de google-oauth-callback (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre: validación del state anti-CSRF (parseo, type
// tag, ventana de 15 min — incluye el round-trip con el state que genera
// google-oauth-initiate), la autorización del scope contra el rol REAL del
// caller (el state va sin firmar) y la forma de la fila company_email_configs.

import { describe, it, expect } from 'vitest'
import {
  OAUTH_STATE_TTL_MS,
  buildEmailConfigRecord,
  canConnectEmailScope,
  validateOAuthState,
} from '../logic.ts'
import { buildOAuthState } from '../../google-oauth-initiate/logic.ts'

const NOW = Date.parse('2026-07-01T12:00:00.000Z')

describe('google-oauth-callback/validateOAuthState', () => {
  it('acepta un state fresco y devuelve su payload', () => {
    const raw = btoa(JSON.stringify({ t: 'gmail_connect', company_id: 'emp-1', is_superadmin: false, ts: NOW - 1000 }))
    const r = validateOAuthState(raw, NOW)
    expect(r).toEqual({
      ok: true,
      state: { t: 'gmail_connect', company_id: 'emp-1', is_superadmin: false, ts: NOW - 1000 },
    })
  })

  it('round-trip: el state que genera google-oauth-initiate valida aquí (contrato entre las dos fns)', () => {
    const raw = buildOAuthState({ companyId: 'emp-1', isSuperadmin: false }, NOW - 60 * 1000)
    const r = validateOAuthState(raw, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.state.company_id).toBe('emp-1')
  })

  it('basura no parseable (base64/JSON) → "Invalid state parameter"', () => {
    expect(validateOAuthState('%%%no-base64%%%', NOW)).toEqual({ ok: false, error: 'Invalid state parameter' })
    expect(validateOAuthState(btoa('no es json'), NOW)).toEqual({ ok: false, error: 'Invalid state parameter' })
  })

  it('type tag distinto de gmail_connect → "Invalid OAuth flow type" (no se reusa un state de otro flujo)', () => {
    const raw = btoa(JSON.stringify({ t: 'sso_login', company_id: null, is_superadmin: false, ts: NOW }))
    expect(validateOAuthState(raw, NOW)).toEqual({ ok: false, error: 'Invalid OAuth flow type' })
  })

  it('state más viejo que 15 min → expirado; exactamente 15 min aún vale (comparación estricta >)', () => {
    const viejo = btoa(JSON.stringify({ t: 'gmail_connect', company_id: null, is_superadmin: false, ts: NOW - OAUTH_STATE_TTL_MS - 1 }))
    expect(validateOAuthState(viejo, NOW)).toEqual({ ok: false, error: 'OAuth state expired. Please try again.' })

    const justo = btoa(JSON.stringify({ t: 'gmail_connect', company_id: null, is_superadmin: false, ts: NOW - OAUTH_STATE_TTL_MS }))
    expect(validateOAuthState(justo, NOW).ok).toBe(true)
  })
})

describe('google-oauth-callback/canConnectEmailScope (el state va sin firmar)', () => {
  it('state fabricado con is_superadmin:true NO pasa si el caller no es super', () => {
    for (const role of ['admin', 'company_owner', 'operator', 'viewer', '']) {
      expect(canConnectEmailScope({ companyId: null, isSuperadmin: true }, { role, companyId: 'emp-1' })).toBe(false)
    }
    expect(canConnectEmailScope({ companyId: null, isSuperadmin: true }, { role: 'super_admin', companyId: null })).toBe(true)
  })

  it('state fabricado con el company_id de OTRO tenant NO pasa para admin/owner ajenos', () => {
    for (const role of ['admin', 'company_owner']) {
      expect(canConnectEmailScope({ companyId: 'emp-victima', isSuperadmin: false }, { role, companyId: 'emp-atacante' })).toBe(false)
      expect(canConnectEmailScope({ companyId: 'emp-propia', isSuperadmin: false }, { role, companyId: 'emp-propia' })).toBe(true)
    }
  })

  it('super_admin puede completar el flujo de cualquier empresa', () => {
    expect(canConnectEmailScope({ companyId: 'emp-2', isSuperadmin: false }, { role: 'superadmin', companyId: null })).toBe(true)
  })
})

describe('google-oauth-callback/buildEmailConfigRecord', () => {
  // Guarda del P0 #7: este helper es un transportador, NO cifra. Persiste tal
  // cual lo que recibe; el cifrado lo hace el handler con encryptSecret(). Si
  // alguien le pasara los tokens en claro, quedarían sin cifrar en la tabla y
  // nada lo delataría — por eso los parámetros se llaman *Cifrado.
  it('persiste EXACTAMENTE los tokens que recibe, sin tocarlos', () => {
    const rec = buildEmailConfigRecord(
      { access_token: 'PLANO', refresh_token: 'PLANO-R', expires_in: 3600 },
      'a@b.com', { company_id: 'emp-1', is_superadmin: false }, NOW,
      'v1.aead.cifrado', 'v1.aead.cifrado-r',
    )
    expect(rec.access_token).toBe('v1.aead.cifrado')
    expect(rec.refresh_token).toBe('v1.aead.cifrado-r')
    expect(JSON.stringify(rec)).not.toContain('PLANO')
  })

  const tokens = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }

  it('scope de tenant: company_id del state e is_superadmin false (nunca se mezclan)', () => {
    const rec = buildEmailConfigRecord(tokens, 'gerencia@mayan.com', { company_id: 'emp-1', is_superadmin: false }, NOW, 'cif(at-1)', 'cif(rt-1)')
    expect(rec).toEqual({
      provider: 'google',
      email: 'gerencia@mayan.com',
      access_token: 'cif(at-1)',
      refresh_token: 'cif(rt-1)',
      token_expiry: new Date(NOW + 3600 * 1000).toISOString(),
      is_active: true,
      updated_at: new Date(NOW).toISOString(),
      company_id: 'emp-1',
      is_superadmin: false,
    })
  })

  it('scope superadmin: company_id null + is_superadmin true (aunque el state traiga empresa)', () => {
    const rec = buildEmailConfigRecord(tokens, 'plataforma@admin.com', { company_id: 'emp-colada', is_superadmin: true }, NOW, 'cif(at)', 'cif(rt)')
    expect(rec.company_id).toBeNull()
    expect(rec.is_superadmin).toBe(true)
  })

  it('sin refresh_token (re-consent de Google) → null explícito, no undefined', () => {
    const rec = buildEmailConfigRecord({ access_token: 'at-2', expires_in: 60 }, 'a@b.com', { company_id: 'emp-1', is_superadmin: false }, NOW, 'cif(at-2)', null)
    expect(rec.refresh_token).toBeNull()
    expect(rec.token_expiry).toBe(new Date(NOW + 60 * 1000).toISOString())
  })
})
