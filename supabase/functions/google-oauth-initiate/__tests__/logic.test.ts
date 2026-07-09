// Tests de la lógica pura de google-oauth-initiate (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Cubre los invariantes de seguridad del arranque del
// flujo OAuth: quién puede conectar el Gmail de cada scope (anti secuestro de
// la config de otro tenant / de plataforma), la forma del state anti-CSRF y la
// URL de consentimiento de Google con scopes de mínimo privilegio.

import { describe, it, expect } from 'vitest'
import {
  GMAIL_OAUTH_SCOPES,
  buildGoogleAuthUrl,
  buildOAuthState,
  canConnectEmailScope,
} from '../logic.ts'

describe('google-oauth-initiate/canConnectEmailScope', () => {
  it('is_superadmin exige rol super (ambas variantes)', () => {
    expect(canConnectEmailScope({ isSuperadmin: true }, { role: 'super_admin', companyId: null })).toBe(true)
    expect(canConnectEmailScope({ isSuperadmin: true }, { role: 'superadmin', companyId: null })).toBe(true)
  })

  it('NUNCA deja a un no-super conectar el correo de plataforma (escalada)', () => {
    for (const role of ['admin', 'company_owner', 'operator', 'viewer', '']) {
      expect(canConnectEmailScope({ isSuperadmin: true }, { role, companyId: 'emp-1' })).toBe(false)
    }
  })

  it('admin/company_owner solo pueden conectar SU propia empresa', () => {
    for (const role of ['admin', 'company_owner']) {
      expect(canConnectEmailScope({ companyId: 'emp-1' }, { role, companyId: 'emp-1' })).toBe(true)
      // company_id ajeno en el body → rechazado (anti secuestro de otro tenant).
      expect(canConnectEmailScope({ companyId: 'emp-ajena' }, { role, companyId: 'emp-1' })).toBe(false)
    }
  })

  it('roles operativos no conectan correo ni de su propia empresa', () => {
    for (const role of ['operator', 'operador', 'viewer', 'visor', 'collector', '']) {
      expect(canConnectEmailScope({ companyId: 'emp-1' }, { role, companyId: 'emp-1' })).toBe(false)
    }
  })

  it('super_admin puede conectar cualquier empresa', () => {
    expect(canConnectEmailScope({ companyId: 'emp-2' }, { role: 'super_admin', companyId: null })).toBe(true)
  })

  it('caller sin empresa no matchea un company_id ausente (null !== undefined)', () => {
    expect(canConnectEmailScope({ companyId: undefined }, { role: 'admin', companyId: null })).toBe(false)
  })
})

describe('google-oauth-initiate/buildOAuthState', () => {
  it('genera base64 de JSON con type tag, scope y timestamp inyectado', () => {
    const ts = Date.parse('2026-07-01T12:00:00.000Z')
    const decoded = JSON.parse(atob(buildOAuthState({ companyId: 'emp-1', isSuperadmin: false }, ts)))
    expect(decoded).toEqual({ t: 'gmail_connect', company_id: 'emp-1', is_superadmin: false, ts })
  })

  it('defaults: sin companyId → null, sin isSuperadmin → false', () => {
    const decoded = JSON.parse(atob(buildOAuthState({}, 123)))
    expect(decoded).toEqual({ t: 'gmail_connect', company_id: null, is_superadmin: false, ts: 123 })
  })
})

describe('google-oauth-initiate/buildGoogleAuthUrl', () => {
  const url = new URL(buildGoogleAuthUrl('client-123', 'https://app.example.com/', 'STATE-XYZ'))

  it('apunta al endpoint de consentimiento de Google', () => {
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  })

  it('lleva los parámetros del code flow offline con consent explícito', () => {
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent select_account')
    expect(url.searchParams.get('state')).toBe('STATE-XYZ')
  })

  it('scopes de MÍNIMO privilegio: gmail.send + userinfo, nada más', () => {
    expect(url.searchParams.get('scope')!.split(' ')).toEqual([
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ])
    // La constante exportada es la fuente de verdad (sin gmail full/readonly).
    expect(GMAIL_OAUTH_SCOPES).toHaveLength(3)
    expect(GMAIL_OAUTH_SCOPES.some((s) => /gmail\.(readonly|modify|full)|mail\.google\.com/.test(s))).toBe(false)
  })
})
