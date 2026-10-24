import { describe, it, expect } from 'vitest'
import { situacionPoliza, vencidaSinMarcar, plazoPoliza, DIAS_AVISO_POLIZA } from '../polizas'

const HOY = new Date(2026, 9, 24, 20, 0) // 24 oct, 8 de la noche (local)
const p = (estado: 'vigente' | 'vencida' | 'cancelada', fecha_vencimiento: string) => ({ estado, fecha_vencimiento })

describe('situacionPoliza', () => {
  it('la fecha manda sobre el estado guardado: vigente con fecha pasada es vencida', () => {
    expect(situacionPoliza(p('vigente', '2026-10-23'), HOY)).toBe('vencida')
    expect(vencidaSinMarcar(p('vigente', '2026-10-23'), HOY)).toBe(true)
  })

  it('el día del vencimiento todavía cubre: por vencer, no vencida', () => {
    expect(situacionPoliza(p('vigente', '2026-10-24'), HOY)).toBe('por_vencer')
  })

  it(`por vencer con menos de ${DIAS_AVISO_POLIZA} días; vigente desde ahí`, () => {
    expect(situacionPoliza(p('vigente', '2026-12-22'), HOY)).toBe('por_vencer') // 59 días
    expect(situacionPoliza(p('vigente', '2026-12-23'), HOY)).toBe('vigente') // 60 días
  })

  it('cancelada siempre es cancelada; vencida guardada es vencida aunque la fecha no haya llegado', () => {
    expect(situacionPoliza(p('cancelada', '2020-01-01'), HOY)).toBe('cancelada')
    expect(situacionPoliza(p('vencida', '2030-01-01'), HOY)).toBe('vencida')
    expect(vencidaSinMarcar(p('vencida', '2020-01-01'), HOY)).toBe(false)
    expect(vencidaSinMarcar(p('cancelada', '2020-01-01'), HOY)).toBe(false)
  })

  it('sin fecha válida no inventa un vencimiento', () => {
    expect(situacionPoliza(p('vigente', ''), HOY)).toBe('vigente')
  })
})

describe('plazoPoliza', () => {
  it('dice en palabras cuánto falta o cuánto pasó', () => {
    expect(plazoPoliza(5)).toBe('vence en 5 días')
    expect(plazoPoliza(1)).toBe('vence en 1 día')
    expect(plazoPoliza(0)).toBe('vence hoy')
    expect(plazoPoliza(-1)).toBe('venció hace 1 día')
    expect(plazoPoliza(-3)).toBe('venció hace 3 días')
  })
})
