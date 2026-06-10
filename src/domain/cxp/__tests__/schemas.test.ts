import { describe, it, expect } from 'vitest'
import {
  facturaProveedorFormSchema,
  ordenPagoFormSchema,
  proveedorFormSchema,
  saldoFactura,
} from '../schemas'

const facturaBase = {
  proveedor_id: '11111111-1111-1111-1111-111111111111',
  project_id: null,
  numero_factura: 'F-001',
  fecha_emision: '2026-06-10',
  fecha_vencimiento: '2026-07-10',
  concepto: 'Materiales de mantenimiento',
  categoria: 'mantenimiento',
  moneda: null,
  monto_total: 500,
  iva_monto: 60,
  notas: null,
}

describe('facturaProveedorFormSchema', () => {
  it('acepta una factura válida', () => {
    expect(facturaProveedorFormSchema.safeParse(facturaBase).success).toBe(true)
  })

  it('rechaza monto cero o negativo', () => {
    expect(facturaProveedorFormSchema.safeParse({ ...facturaBase, monto_total: 0 }).success).toBe(false)
  })

  it('rechaza IVA mayor que el total', () => {
    expect(facturaProveedorFormSchema.safeParse({ ...facturaBase, iva_monto: 600 }).success).toBe(false)
  })

  it('normaliza moneda a mayúsculas y exige ISO-3', () => {
    const ok = facturaProveedorFormSchema.parse({ ...facturaBase, moneda: 'usd' })
    expect(ok.moneda).toBe('USD')
    expect(facturaProveedorFormSchema.safeParse({ ...facturaBase, moneda: 'dolar' }).success).toBe(false)
  })
})

describe('ordenPagoFormSchema', () => {
  const ordenBase = {
    factura_id: '22222222-2222-2222-2222-222222222222',
    monto: 200,
    metodo_pago: 'transferencia' as const,
    fecha_pago: null,
    referencia: null,
    notas: null,
  }

  it('acepta una orden válida', () => {
    expect(ordenPagoFormSchema.safeParse(ordenBase).success).toBe(true)
  })

  it('rechaza monto no positivo y método desconocido', () => {
    expect(ordenPagoFormSchema.safeParse({ ...ordenBase, monto: 0 }).success).toBe(false)
    expect(ordenPagoFormSchema.safeParse({ ...ordenBase, metodo_pago: 'bitcoin' }).success).toBe(false)
  })
})

describe('proveedorFormSchema', () => {
  it('convierte email vacío a null', () => {
    const r = proveedorFormSchema.parse({
      nombre: 'Ferretería El Tornillo',
      nit: null, rfc: null, email: '', telefono: null, direccion: null,
      contacto_nombre: null, dias_credito: 30, categoria_default: null, notas: null,
    })
    expect(r.email).toBeNull()
  })

  it('rechaza días de crédito negativos', () => {
    const r = proveedorFormSchema.safeParse({
      nombre: 'X Y', nit: null, rfc: null, email: null, telefono: null,
      direccion: null, contacto_nombre: null, dias_credito: -1,
      categoria_default: null, notas: null,
    })
    expect(r.success).toBe(false)
  })
})

describe('saldoFactura', () => {
  it('calcula el pendiente con redondeo a 2 decimales', () => {
    expect(saldoFactura({ monto_total: 500, monto_pagado: 200 })).toBe(300)
    expect(saldoFactura({ monto_total: 0.3, monto_pagado: 0.1 })).toBe(0.2)
  })
})
