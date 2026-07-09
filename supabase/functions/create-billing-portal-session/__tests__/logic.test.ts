// Tests de la lógica pura de create-billing-portal-session (infra:I22 · Track
// T8/T5, issue #321). Corre bajo vitest (no Deno). El módulo es una copia local
// de las funciones CORS/rol de create-checkout-session (el código original ya
// las duplicaba por función); se testea por separado porque un drift entre
// copias es exactamente el bug que estos tests cazarían. Cubre: whitelist de
// orígenes (nunca reflejar un Origin arbitrario) y gate de rol del portal.

import { describe, it, expect } from 'vitest'
import {
  BILLING_MANAGER_ROLES,
  DEFAULT_ALLOWED_ORIGINS,
  buildAllowedOrigins,
  canManageBilling,
  corsHeadersFor,
} from '../logic.ts'

describe('create-billing-portal-session/buildAllowedOrigins', () => {
  it('siempre incluye los dominios de producción', () => {
    const origins = buildAllowedOrigins(undefined, undefined)
    for (const o of DEFAULT_ALLOWED_ORIGINS) expect(origins).toContain(o)
  })

  it('sin ALLOWED_ORIGINS agrega localhost de dev; con ALLOWED_ORIGINS los omite', () => {
    expect(buildAllowedOrigins(undefined, undefined)).toContain('http://localhost:5173')
    const conEnv = buildAllowedOrigins('https://staging.administratodo.com', undefined)
    expect(conEnv).toContain('https://staging.administratodo.com')
    expect(conEnv).not.toContain('http://localhost:5173')
  })

  it('agrega solo el origin de APP_URL e ignora APP_URL inválido', () => {
    expect(buildAllowedOrigins(undefined, 'https://app.administratodo.com/perfil')).toContain('https://app.administratodo.com')
    expect(() => buildAllowedOrigins(undefined, 'no-es-url')).not.toThrow()
  })
})

describe('create-billing-portal-session/corsHeadersFor', () => {
  const allowed = ['https://administratodo.com', 'https://staging.administratodo.com']

  it('refleja el Origin solo si está en la whitelist', () => {
    expect(corsHeadersFor('https://staging.administratodo.com', allowed)['Access-Control-Allow-Origin'])
      .toBe('https://staging.administratodo.com')
  })

  it('origen fuera de la whitelist o ausente → primer origen permitido', () => {
    expect(corsHeadersFor('https://evil.example.com', allowed)['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
    expect(corsHeadersFor(null, allowed)['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })
})

describe('create-billing-portal-session/canManageBilling (gate de rol)', () => {
  it('solo company_owner y admin pueden abrir el portal (cancelar/cambiar plan es dinero)', () => {
    expect(canManageBilling('company_owner')).toBe(true)
    expect(canManageBilling('admin')).toBe(true)
    expect(BILLING_MANAGER_ROLES).toEqual(['company_owner', 'admin'])
  })

  it('el resto de roles NO puede (escalada de privilegios)', () => {
    for (const r of ['operator', 'operador', 'viewer', 'visor', 'collector', 'super_admin', '']) {
      expect(canManageBilling(r)).toBe(false)
    }
  })
})
