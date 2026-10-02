import { describe, it, expect } from 'vitest'
import {
  facturaProveedorFormSchema,
  facturaRenglonSchema,
  ordenPagoFormSchema,
  proveedorFormSchema,
  saldoFactura,
  textoErrorServidor,
  totalesFactura,
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

  it('código y país vacíos (formulario sin llenar) se guardan como null, no como cadena vacía', () => {
    const r = proveedorFormSchema.parse({
      nombre: 'Ferretería El Tornillo',
      nit: null, rfc: null, email: null, telefono: null, direccion: null,
      contacto_nombre: null, dias_credito: 0, categoria_default: null, notas: null,
      codigo: '', pais: '',
    })
    expect(r.codigo).toBeNull()
    expect(r.pais).toBeNull()
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

// Bloque B — factura contra una orden: captura por renglón.
describe('factura con orden', () => {
  const orden = '22222222-2222-4222-8222-222222222222'
  const linea = '33333333-3333-4333-8333-333333333333'
  const renglon = { orden_compra_linea_id: linea, descripcion: 'Bombas', cantidad: 2, precio_unitario: 500, iva_monto: 120 }

  it('la factura acepta la orden de origen (uuid) o ninguna', () => {
    expect(facturaProveedorFormSchema.safeParse({ ...facturaBase, orden_compra_id: orden }).success).toBe(true)
    expect(facturaProveedorFormSchema.safeParse({ ...facturaBase, orden_compra_id: null }).success).toBe(true)
    expect(facturaProveedorFormSchema.safeParse({ ...facturaBase, orden_compra_id: 'no-es-uuid' }).success).toBe(false)
  })

  it('el renglón exige cantidad > 0 y no admite precio ni IVA negativos', () => {
    expect(facturaRenglonSchema.safeParse(renglon).success).toBe(true)
    expect(facturaRenglonSchema.safeParse({ ...renglon, cantidad: 0 }).success).toBe(false)
    expect(facturaRenglonSchema.safeParse({ ...renglon, precio_unitario: -1 }).success).toBe(false)
    expect(facturaRenglonSchema.safeParse({ ...renglon, iva_monto: -1 }).success).toBe(false)
    expect(facturaRenglonSchema.safeParse({ ...renglon, orden_compra_linea_id: 'x' }).success).toBe(false)
  })

  it('totalesFactura suma subtotal, IVA y total con el redondeo por renglón del servidor', () => {
    expect(totalesFactura([renglon, { ...renglon, cantidad: 1, precio_unitario: 300, iva_monto: 36 }]))
      .toEqual({ subtotal: 1300, iva: 156, total: 1456 })
    // 3 × 0.335 = 1.005 → 1.01 por renglón (no se redondea solo al final)
    expect(totalesFactura([
      { cantidad: 3, precio_unitario: 0.335, iva_monto: 0 },
      { cantidad: 3, precio_unitario: 0.335, iva_monto: 0 },
    ]).subtotal).toBe(2.02)
    expect(totalesFactura([])).toEqual({ subtotal: 0, iva: 0, total: 0 })
  })
})

describe('textoErrorServidor', () => {
  it('quita el código técnico y deja el texto, que está escrito para leerse tal cual', () => {
    expect(textoErrorServidor('COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con el número "F-1".'))
      .toBe('ya hay una factura de este proveedor con el número "F-1".')
    expect(textoErrorServidor('COMPRAS_MATCH_NO_FORZABLE: 1 renglón(es) no se pueden aprobar.')).toBe('1 renglón(es) no se pueden aprobar.')
  })
  it('no toca los mensajes que no traen código ni los deja vacíos', () => {
    expect(textoErrorServidor('Sin conexión con el servidor.')).toBe('Sin conexión con el servidor.')
    expect(textoErrorServidor('COMPRAS_FACTURA_X:')).toBe('COMPRAS_FACTURA_X:')
  })
})
