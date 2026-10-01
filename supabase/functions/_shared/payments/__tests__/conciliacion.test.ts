// leerConciliacion: la respuesta de pasarela_registrar_estado se lee por el
// ESTADO PERSISTIDO (20261016000000), nunca por `accion`.
import { describe, it, expect } from 'vitest'
import { leerConciliacion } from '../conciliacion.ts'

describe('leerConciliacion', () => {
  it('cobro retenido, nuevo o duplicado: en revisión', () => {
    for (const accion of ['cobro_sobre_documento_anulado', 'cobro_retenido_ya_registrado', 'duplicado']) {
      expect(leerConciliacion({ accion, estado: 'pending_verification', conciliado: false, en_revision: true }))
        .toEqual({ tipo: 'en_revision', estadoSolicitud: 'pending_verification', incidenciaId: null })
    }
  })

  it('reembolsada (antes o después de aprobar): reembolsado, nunca conciliado', () => {
    expect(leerConciliacion({ accion: 'ignorado_reembolsado', estado: 'refunded', conciliado: false, reembolsado: true }).tipo)
      .toBe('reembolsado')
    expect(leerConciliacion({ accion: 'duplicado', estado: 'refunded' }).tipo).toBe('reembolsado')
  })

  it('«duplicado» sin conciliación persistida: sin acreditar', () => {
    expect(leerConciliacion({ accion: 'duplicado', estado: 'failed', conciliado: false }))
      .toEqual({ tipo: 'sin_acreditar', estadoSolicitud: 'failed', incidenciaId: null })
  })

  it('conciliado: con lo que informa; sin saldo informado no hay saldo 0', () => {
    expect(leerConciliacion({ conciliado: true, pago_id: 'p', liquidado: true, saldo_restante: 0, ya_conciliado: true }))
      .toEqual({ tipo: 'conciliado', yaConciliado: true, pagoId: 'p', liquidado: true, saldoRestante: 0 })
    expect(leerConciliacion({ conciliado: true, pago_id: 'p' })).toMatchObject({ saldoRestante: null, liquidado: false })
  })

  it('respuesta vacía o sin estado persistido: sólo cuenta como conciliado si trae el pago', () => {
    expect(leerConciliacion(null).tipo).toBe('sin_acreditar')
    expect(leerConciliacion({ accion: 'cobro_retenido_ya_registrado' }).tipo).toBe('sin_acreditar')
    expect(leerConciliacion({ pago_id: 'p', liquidado: false, saldo_restante: 5 }).tipo).toBe('conciliado')
  })
})
