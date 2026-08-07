// Tests de la lógica pura de save-payment-config (infra:I22 · Track T8/T5).
// Como el resto de tests de edge fns, corre bajo vitest (no Deno) tratando el
// módulo como TS normal. Esta función guarda SECRETOS de pago por tenant, así
// que aquí se blindan los invariantes que importan: gate de rol (solo
// company_owner/admin), whitelist de proveedores, campos obligatorios, y —el
// crítico— que la llave SECRETA vaya solo a company_payment_secrets y JAMÁS a la
// fila pública de companies. También el rollback que desmarca configured/activo.

import { describe, it, expect } from 'vitest'
import {
  buildConfigUpdates,
  buildRollbackUpdate,
  esProveedorValido,
  faltanCampos,
  puedeConfigurarPagos,
} from '../logic.ts'

describe('save-payment-config/puedeConfigurarPagos', () => {
  it('permite company_owner y admin', () => {
    expect(puedeConfigurarPagos('company_owner')).toBe(true)
    expect(puedeConfigurarPagos('admin')).toBe(true)
  })

  it('NUNCA permite roles operativos ni desconocidos (escalada de privilegios)', () => {
    for (const r of ['operator', 'operador', 'viewer', 'visor', 'collector', 'root', '', 'Admin']) {
      expect(puedeConfigurarPagos(r)).toBe(false)
    }
  })

  it('super_admin tampoco pasa: la config de pagos es del tenant, no de la plataforma', () => {
    expect(puedeConfigurarPagos('super_admin')).toBe(false)
  })
})

describe('save-payment-config/faltanCampos', () => {
  const completo = { companyId: 'co-1', provider: 'stripe', publicKey: 'pk_x', secretKey: 'sk_x' }

  it('un body completo no reporta faltantes', () => {
    expect(faltanCampos(completo)).toBe(false)
  })

  it('cualquier campo ausente o vacío se reporta como faltante', () => {
    expect(faltanCampos({ ...completo, companyId: '' })).toBe(true)
    expect(faltanCampos({ ...completo, provider: undefined })).toBe(true)
    expect(faltanCampos({ ...completo, publicKey: '' })).toBe(true)
    expect(faltanCampos({ ...completo, secretKey: '' })).toBe(true)
    expect(faltanCampos({})).toBe(true)
  })
})

describe('save-payment-config/esProveedorValido', () => {
  it('acepta solo stripe y paypal', () => {
    expect(esProveedorValido('stripe')).toBe(true)
    expect(esProveedorValido('paypal')).toBe(true)
  })

  it('rechaza cualquier otro valor (whitelist estricto, case-sensitive)', () => {
    expect(esProveedorValido('qpaypro')).toBe(false)
    expect(esProveedorValido('Stripe')).toBe(false)
    expect(esProveedorValido('')).toBe(false)
    expect(esProveedorValido('stripe; drop table')).toBe(false)
  })
})

describe('save-payment-config/buildConfigUpdates', () => {
  // Guarda del P0 #7: este helper es un transportador, NO cifra. Lo que reciba
  // es lo que se persiste. El handler le pasa el resultado de encryptSecret();
  // si alguien le pasara el texto plano, la credencial quedaría sin cifrar en
  // la tabla aislada y ningún tipo ni test lo delataría. Estos dos tests fijan
  // que el valor viaja intacto, para que el contrato quede escrito.
  it('persiste EXACTAMENTE el secreto que recibe (el handler ya lo cifró)', () => {
    const cifrado = 'v1.aead.QUJDRA==.RUZHSA=='
    const stripe = buildConfigUpdates('stripe', 'co-1', 'pk_live_x', cifrado)
    expect(stripe.secretsUpdate.stripe_secret_key).toBe(cifrado)
    const paypal = buildConfigUpdates('paypal', 'co-1', 'client-id', cifrado)
    expect(paypal.secretsUpdate.paypal_client_secret).toBe(cifrado)
  })

  it('el secreto no se filtra nunca al update público de companies', () => {
    const cifrado = 'v1.aead.QUJDRA==.RUZHSA=='
    for (const prov of ['stripe', 'paypal'] as const) {
      const { companyUpdate } = buildConfigUpdates(prov, 'co-1', 'pub', cifrado)
      expect(JSON.stringify(companyUpdate)).not.toContain(cifrado)
    }
  })
  it('stripe: llave pública + flags a companies; llave secreta SOLO a secrets', () => {
    const { companyUpdate, secretsUpdate } = buildConfigUpdates(
      'stripe', 'co-1', 'pk_live_123', 'sk_live_999', '2026-07-09T12:00:00.000Z',
    )
    expect(companyUpdate).toEqual({
      stripe_public_key: 'pk_live_123',
      stripe_configured: true,
      stripe_activo: true,
    })
    expect(secretsUpdate).toEqual({
      company_id: 'co-1',
      stripe_secret_key: 'sk_live_999',
      updated_at: '2026-07-09T12:00:00.000Z',
    })
  })

  it('paypal: client_id público + client_secret aislado', () => {
    const { companyUpdate, secretsUpdate } = buildConfigUpdates(
      'paypal', 'co-2', 'client-abc', 'secret-xyz', '2026-07-09T12:00:00.000Z',
    )
    expect(companyUpdate).toEqual({
      paypal_client_id: 'client-abc',
      paypal_configured: true,
      paypal_activo: true,
    })
    expect(secretsUpdate).toEqual({
      company_id: 'co-2',
      paypal_client_secret: 'secret-xyz',
      updated_at: '2026-07-09T12:00:00.000Z',
    })
  })

  it('INVARIANTE de sanitización: el secretKey jamás se filtra al update público', () => {
    for (const provider of ['stripe', 'paypal'] as const) {
      const { companyUpdate } = buildConfigUpdates(provider, 'co-1', 'pk_x', 'sk_SECRETO', '2026-07-09T12:00:00.000Z')
      expect(JSON.stringify(companyUpdate)).not.toContain('sk_SECRETO')
    }
  })

  it('la llave pública tampoco se cuela en la tabla de secretos', () => {
    const { secretsUpdate } = buildConfigUpdates('stripe', 'co-1', 'pk_PUBLICA', 'sk_x', '2026-07-09T12:00:00.000Z')
    expect(JSON.stringify(secretsUpdate)).not.toContain('pk_PUBLICA')
  })

  it('updated_at por default es un ISO parseable (now inyectable solo en tests)', () => {
    const antes = Date.now()
    const { secretsUpdate } = buildConfigUpdates('stripe', 'co-1', 'pk', 'sk')
    expect(Date.parse(secretsUpdate.updated_at as string)).toBeGreaterThanOrEqual(antes - 1000)
  })
})

describe('save-payment-config/buildRollbackUpdate', () => {
  it('stripe: desmarca configured y activo (no dejar "configurado" sin secreto)', () => {
    expect(buildRollbackUpdate('stripe')).toEqual({ stripe_configured: false, stripe_activo: false })
  })

  it('paypal: desmarca sus propios flags, sin tocar los de stripe', () => {
    const rollback = buildRollbackUpdate('paypal')
    expect(rollback).toEqual({ paypal_configured: false, paypal_activo: false })
    expect('stripe_configured' in rollback).toBe(false)
  })
})
