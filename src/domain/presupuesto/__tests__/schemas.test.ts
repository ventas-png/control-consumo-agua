import { describe, it, expect } from 'vitest'
import { distribuirAnual, partidaSchema, presupuestoFormSchema, totalFila } from '../schemas'

describe('distribuirAnual', () => {
  it('reparte en 12 mensualidades que suman exacto el anual', () => {
    const meses = distribuirAnual(1000)
    expect(meses).toHaveLength(12)
    const suma = meses.reduce((s, m) => s + m, 0)
    expect(Math.round(suma * 100) / 100).toBe(1000)
  })

  it('la última cuota absorbe el residuo de redondeo', () => {
    const meses = distribuirAnual(100)
    // 100/12 = 8.33 ×11 = 91.63 → última = 8.37
    expect(meses[0]).toBe(8.33)
    expect(meses[11]).toBe(8.37)
  })

  it('montos no válidos o ≤ 0 → todo en cero', () => {
    expect(distribuirAnual(0)).toEqual(Array(12).fill(0))
    expect(distribuirAnual(NaN)).toEqual(Array(12).fill(0))
  })
})

describe('totalFila', () => {
  it('suma con redondeo estable e ignora NaN', () => {
    expect(totalFila([0.1, 0.2, NaN])).toBe(0.3)
  })
})

describe('partidaSchema', () => {
  it('valida formato de periodo YYYY-MM', () => {
    const base = { cuenta_id: '11111111-1111-1111-1111-111111111111', monto: 10 }
    expect(partidaSchema.safeParse({ ...base, periodo: '2026-06' }).success).toBe(true)
    expect(partidaSchema.safeParse({ ...base, periodo: '2026-13' }).success).toBe(false)
    expect(partidaSchema.safeParse({ ...base, periodo: '202606' }).success).toBe(false)
  })

  it('rechaza montos negativos', () => {
    expect(partidaSchema.safeParse({
      cuenta_id: '11111111-1111-1111-1111-111111111111', periodo: '2026-06', monto: -1,
    }).success).toBe(false)
  })
})

describe('presupuestoFormSchema', () => {
  it('valida año y nombre', () => {
    expect(presupuestoFormSchema.safeParse({ anio: 2026, nombre: 'Presupuesto 2026', project_id: null, notas: null }).success).toBe(true)
    expect(presupuestoFormSchema.safeParse({ anio: 1990, nombre: 'X', project_id: null, notas: null }).success).toBe(false)
  })
})
