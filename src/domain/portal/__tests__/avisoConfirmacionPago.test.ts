// El portal nunca presenta como acreditado un cobro retenido o reembolsado, ni
// muestra un saldo que no vino en la respuesta.
import { describe, it, expect } from 'vitest'
import { avisoConfirmacionPago } from '../avisoConfirmacionPago'

const op = { moneda: 'Q', tituloPagado: 'Cuota pagada', textoAlDia: 'Tu cuota quedó al día.' }

describe('avisoConfirmacionPago', () => {
  it('acreditado y liquidado', () => {
    expect(avisoConfirmacionPago({ estado: 'aprobado', liquidado: true, saldoRestante: 0 }, op))
      .toEqual({ variant: 'success', title: 'Cuota pagada', text: 'Tu cuota quedó al día.' })
  })

  it('abono con saldo informado', () => {
    expect(avisoConfirmacionPago({ estado: 'aprobado', liquidado: false, saldoRestante: 12.5 }, op).text)
      .toBe('Abono aplicado. Saldo restante: Q 12.50')
  })

  it('abono sin saldo informado: no muestra 0', () => {
    expect(avisoConfirmacionPago({ estado: 'aprobado', liquidado: false, saldoRestante: null }, op).text).toBe('Abono aplicado.')
  })

  it('cobro retenido: en revisión, nunca «pagada» ni «abono»', () => {
    const a = avisoConfirmacionPago({ estado: 'en_revision', liquidado: false, saldoRestante: null }, op)
    expect(a).toMatchObject({ variant: 'warning', title: 'Pago en revisión' })
    expect(a.text).toContain('No se aplicó a tu saldo')
  })

  it('reembolsado o pendiente: no es un abono', () => {
    expect(avisoConfirmacionPago({ estado: 'reembolsado', liquidado: false, saldoRestante: null }, op).title).toBe('Pago reembolsado')
    expect(avisoConfirmacionPago({ estado: 'pendiente', liquidado: false, saldoRestante: null }, op).title).toBe('Pago en proceso')
  })
})
