// Tests de la lógica pura de create-charge (infra:I22). Corre bajo vitest
// tratando el módulo como TS normal, sin Deno.
//
// Alcance pequeño a propósito: el resto de lo que #545 extraía aquí ya no
// aplica (ver el comentario de ../logic.ts). El flujo completo del handler
// —roles de cuota, saldos, ambientes, credenciales— lo cubren handler.test.ts
// y validate.test.ts, y la aritmética de dinero los tests de _shared/payments/.
import { describe, it, expect } from 'vitest'
import { estadoPaymentRequest } from '../logic.ts'

describe('create-charge/estadoPaymentRequest', () => {
  it('aprobado → succeeded', () => {
    expect(estadoPaymentRequest('aprobado')).toBe('succeeded')
  })

  it('rechazado y error → failed (ambos cierran el request)', () => {
    expect(estadoPaymentRequest('rechazado')).toBe('failed')
    expect(estadoPaymentRequest('error')).toBe('failed')
  })

  it('pendiente y requiere_accion → pending (esperando confirmación/retorno)', () => {
    expect(estadoPaymentRequest('pendiente')).toBe('pending')
    expect(estadoPaymentRequest('requiere_accion')).toBe('pending')
  })
})
