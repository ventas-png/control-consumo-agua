// Tests de la lógica pura de create-checkout-session (infra:I22 · Track T8/T5,
// issue #321). Como el resto de tests de edge fns, corre bajo vitest (no Deno)
// tratando el módulo como TS normal. Cubre: whitelist de orígenes CORS (nunca
// reflejar un Origin arbitrario), gate de rol para billing (escalada), line
// items iniciales del checkout (dinero — mínimos de Stripe y líneas con 0
// omitidas), preservación del trial (ceil, nunca acortar) y sanitización del
// return_path (solo paths relativos).

import { describe, it, expect } from 'vitest'
import {
  BILLING_MANAGER_ROLES,
  buildCheckoutLineItems,
  buildCustomerAddress,
  canManageBilling,
  computeTrialPeriodDays,
  resolveReturnPath,
  type CheckoutPriceIds,
} from '../logic.ts'

const PRICES: CheckoutPriceIds = {
  activation: 'price_act',
  unit_primary: 'price_up',
  extra_project: 'price_xp',
  unit_extra: 'price_ux',
}

describe('create-checkout-session/canManageBilling (gate de rol)', () => {
  it('company_owner y admin pueden gestionar la suscripción', () => {
    expect(canManageBilling('company_owner')).toBe(true)
    expect(canManageBilling('admin')).toBe(true)
    expect(BILLING_MANAGER_ROLES).toEqual(['company_owner', 'admin'])
  })

  it('operadores/viewers/super_admin NO pueden iniciar checkout (escalada)', () => {
    for (const r of ['operator', 'operador', 'viewer', 'visor', 'collector', 'super_admin', '']) {
      expect(canManageBilling(r)).toBe(false)
    }
  })
})

describe('create-checkout-session/buildCheckoutLineItems (dinero)', () => {
  it('company nueva sin uso (RPC sin filas) → solo activation=1 y unit_primary=1', () => {
    expect(buildCheckoutLineItems(undefined, PRICES)).toEqual([
      { price: 'price_act', quantity: 1 },
      { price: 'price_up', quantity: 1 },
    ])
  })

  it('unit_primary tiene mínimo 1 aunque el conteo sea 0 (Stripe exige quantity >= 1)', () => {
    const items = buildCheckoutLineItems(
      { extra_projects_count: 0, primary_units_count: 0, extra_units_count: 0 },
      PRICES,
    )
    expect(items).toEqual([
      { price: 'price_act', quantity: 1 },
      { price: 'price_up', quantity: 1 },
    ])
  })

  it('uso completo → 4 líneas con las cantidades reales', () => {
    const items = buildCheckoutLineItems(
      { extra_projects_count: 2, primary_units_count: 150, extra_units_count: 40 },
      PRICES,
    )
    expect(items).toEqual([
      { price: 'price_act', quantity: 1 },
      { price: 'price_up', quantity: 150 },
      { price: 'price_xp', quantity: 2 },
      { price: 'price_ux', quantity: 40 },
    ])
  })

  it('componentes en 0 se OMITEN (una línea con quantity 0 rompe el checkout)', () => {
    const items = buildCheckoutLineItems(
      { extra_projects_count: 0, primary_units_count: 80, extra_units_count: 0 },
      PRICES,
    )
    expect(items.map(i => i.price)).toEqual(['price_act', 'price_up'])
    expect(items.every(i => i.quantity >= 1)).toBe(true)
  })

  it('activation siempre es exactamente 1 (cargo fijo, no escala con uso)', () => {
    const items = buildCheckoutLineItems(
      { extra_projects_count: 9, primary_units_count: 999, extra_units_count: 999 },
      PRICES,
    )
    expect(items.find(i => i.price === 'price_act')?.quantity).toBe(1)
  })
})

describe('create-checkout-session/computeTrialPeriodDays', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z')

  it('trial vigente → días restantes redondeados HACIA ARRIBA (nunca acortar el trial)', () => {
    // 5 días y 1 hora restantes → 6 días.
    expect(computeTrialPeriodDays('2026-07-14T13:00:00.000Z', now)).toBe(6)
    // Exactamente 5 días → 5.
    expect(computeTrialPeriodDays('2026-07-14T12:00:00.000Z', now)).toBe(5)
    // Menos de un día restante → 1 (no 0: Stripe cobraría de inmediato).
    expect(computeTrialPeriodDays('2026-07-09T18:00:00.000Z', now)).toBe(1)
  })

  it('trial vencido o justo en el límite → undefined (checkout sin trial)', () => {
    expect(computeTrialPeriodDays('2026-07-01T00:00:00.000Z', now)).toBeUndefined()
    expect(computeTrialPeriodDays('2026-07-09T12:00:00.000Z', now)).toBeUndefined() // trialMs = 0
  })

  it('sin trial_end → undefined', () => {
    expect(computeTrialPeriodDays(null, now)).toBeUndefined()
    expect(computeTrialPeriodDays(undefined, now)).toBeUndefined()
  })
})

describe('create-checkout-session/resolveReturnPath (sanitización)', () => {
  it('acepta paths relativos que empiezan con /', () => {
    expect(resolveReturnPath('/facturacion')).toBe('/facturacion')
    expect(resolveReturnPath('/perfil?tab=plan')).toBe('/perfil?tab=plan')
  })

  it('URL absoluta a dominio externo NUNCA pasa → default /perfil', () => {
    expect(resolveReturnPath('https://evil.example.com/phish')).toBe('/perfil')
    expect(resolveReturnPath('http://localhost:5173/x')).toBe('/perfil')
  })

  it('ausente o sin prefijo / → default /perfil', () => {
    expect(resolveReturnPath(undefined)).toBe('/perfil')
    expect(resolveReturnPath('')).toBe('/perfil')
    expect(resolveReturnPath('perfil')).toBe('/perfil')
  })
})

describe('create-checkout-session/buildCustomerAddress (Stripe Tax)', () => {
  it('sin country NO se manda address (Stripe Tax lo requiere como mínimo)', () => {
    expect(buildCustomerAddress(null)).toBeUndefined()
    expect(buildCustomerAddress(undefined)).toBeUndefined()
    expect(buildCustomerAddress({
      country: null, address_line1: 'Calle 60', address_city: 'Mérida', address_state: null, address_postal_code: '97000',
    })).toBeUndefined()
  })

  it('con country solamente → address mínima', () => {
    expect(buildCustomerAddress({
      country: 'MX', address_line1: null, address_city: null, address_state: null, address_postal_code: null,
    })).toEqual({ country: 'MX' })
  })

  it('campos presentes entran; vacíos/null se omiten', () => {
    expect(buildCustomerAddress({
      country: 'MX', address_line1: 'Calle 60 #491', address_city: '', address_state: 'Yucatán', address_postal_code: '97000',
    })).toEqual({ country: 'MX', line1: 'Calle 60 #491', state: 'Yucatán', postal_code: '97000' })
  })
})
