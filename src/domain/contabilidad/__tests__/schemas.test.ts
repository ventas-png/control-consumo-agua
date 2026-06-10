import { describe, it, expect } from 'vitest'
import {
  asientoFormSchema,
  asientoLineaFormSchema,
  convertirMontoBase,
  cuentaFormSchema,
  round2,
  tipoCambioFormSchema,
  totalesLineas,
} from '../schemas'

const lineaDebe = { cuenta_id: '11111111-1111-1111-1111-111111111111', debe: 100, haber: 0 }
const lineaHaber = { cuenta_id: '22222222-2222-2222-2222-222222222222', debe: 0, haber: 100 }

describe('asientoLineaFormSchema', () => {
  it('acepta una línea con monto en un solo lado', () => {
    expect(asientoLineaFormSchema.safeParse(lineaDebe).success).toBe(true)
    expect(asientoLineaFormSchema.safeParse(lineaHaber).success).toBe(true)
  })

  it('rechaza una línea con debe Y haber simultáneos', () => {
    const r = asientoLineaFormSchema.safeParse({ ...lineaDebe, haber: 50 })
    expect(r.success).toBe(false)
  })

  it('rechaza una línea sin monto', () => {
    const r = asientoLineaFormSchema.safeParse({ ...lineaDebe, debe: 0 })
    expect(r.success).toBe(false)
  })
})

describe('asientoFormSchema', () => {
  const base = {
    fecha: '2026-06-10',
    tipo: 'diario' as const,
    concepto: 'Póliza de prueba',
    project_id: null,
  }

  it('acepta una póliza cuadrada', () => {
    const r = asientoFormSchema.safeParse({ ...base, lineas: [lineaDebe, lineaHaber] })
    expect(r.success).toBe(true)
  })

  it('rechaza una póliza descuadrada', () => {
    const r = asientoFormSchema.safeParse({
      ...base,
      lineas: [lineaDebe, { ...lineaHaber, haber: 90 }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza una póliza con una sola línea', () => {
    const r = asientoFormSchema.safeParse({ ...base, lineas: [lineaDebe] })
    expect(r.success).toBe(false)
  })

  it('cuadra con centavos (redondeo a 2 decimales)', () => {
    const r = asientoFormSchema.safeParse({
      ...base,
      lineas: [
        { ...lineaDebe, debe: 33.33 },
        { ...lineaDebe, cuenta_id: lineaHaber.cuenta_id, debe: 66.67 },
        { ...lineaHaber, cuenta_id: lineaDebe.cuenta_id, haber: 100 },
      ],
    })
    expect(r.success).toBe(true)
  })
})

describe('multimoneda', () => {
  it('convertirMontoBase aplica round half-up a 2 decimales', () => {
    expect(convertirMontoBase(100, 7.85)).toBe(785)
    expect(convertirMontoBase(13.33, 7.7777)).toBe(103.68)
    expect(convertirMontoBase(0.005, 1)).toBe(0.01)
  })

  it('round2 es estable con flotantes problemáticos', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
  })

  it('tipoCambioFormSchema exige ISO-3 y tasa positiva', () => {
    expect(tipoCambioFormSchema.safeParse({ moneda: 'usd', fecha: '2026-06-10', tasa: 7.8 }).success).toBe(true)
    expect(tipoCambioFormSchema.safeParse({ moneda: 'US', fecha: '2026-06-10', tasa: 7.8 }).success).toBe(false)
    expect(tipoCambioFormSchema.safeParse({ moneda: 'USD', fecha: '2026-06-10', tasa: 0 }).success).toBe(false)
  })
})

describe('totalesLineas', () => {
  it('reporta el descuadre vivo del editor', () => {
    const t = totalesLineas([
      { debe: 100.1, haber: 0 },
      { debe: 0, haber: 50 },
    ])
    expect(t.debe).toBe(100.1)
    expect(t.haber).toBe(50)
    expect(t.diferencia).toBe(50.1)
  })
})

describe('cuentaFormSchema', () => {
  it('normaliza la moneda a mayúsculas', () => {
    const r = cuentaFormSchema.parse({
      codigo: '1102-02',
      nombre: 'Banco USD',
      tipo: 'activo',
      naturaleza: 'deudora',
      padre_id: null,
      nivel: 4,
      es_detalle: true,
      moneda: 'usd',
      descripcion: null,
    })
    expect(r.moneda).toBe('USD')
  })

  it('rechaza monedas que no son ISO-3', () => {
    const r = cuentaFormSchema.safeParse({
      codigo: '1102-02',
      nombre: 'Banco USD',
      tipo: 'activo',
      naturaleza: 'deudora',
      padre_id: null,
      nivel: 4,
      es_detalle: true,
      moneda: 'dólares',
      descripcion: null,
    })
    expect(r.success).toBe(false)
  })
})
