// Tests de la lógica pura de create-billing-portal-session (infra:I22 · Track
// T8/T5, issue #321). Corre bajo vitest (no Deno). El módulo es una copia local
// de las funciones CORS/rol de create-checkout-session (el código original ya
// las duplicaba por función); se testea por separado porque un drift entre
// copias es exactamente el bug que estos tests cazarían. Cubre: whitelist de
// orígenes (nunca reflejar un Origin arbitrario) y gate de rol del portal.

import { describe, it, expect } from 'vitest'
import {
  BILLING_MANAGER_ROLES,
  canManageBilling,
} from '../logic.ts'

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
