// Bloque B (#911) · validación de interfaz — La factura contra una orden se captura
// por RENGLÓN: sin renglones el cuadre de 3 vías no tiene qué comparar y la
// factura aprobaría sin revisar. Antes de este cambio la interfaz no permitía
// ligar una factura a una orden.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Resp = { data: unknown; error: { message: string } | null }
const llamadas: Array<{ tabla: string; op: string; payload?: unknown; id?: string }> = []
let respuestas: Record<string, Resp[]> = {}

vi.mock('../../../lib/supabase', () => {
  const siguiente = (clave: string): Resp => (respuestas[clave] ?? []).shift() ?? { data: null, error: null }
  const client = {
    from: (tabla: string) => ({
      insert: (payload: unknown) => {
        llamadas.push({ tabla, op: 'insert', payload })
        const r = { abortSignal: () => Promise.resolve(siguiente(`${tabla}.insert`)), select: () => r }
        return r
      },
      delete: () => ({
        eq: (_c: string, id: string) => ({
          abortSignal: () => { llamadas.push({ tabla, op: 'delete', id }); return Promise.resolve(siguiente(`${tabla}.delete`)) },
        }),
      }),
      update: (payload: unknown) => ({
        eq: (_c: string, id: string) => ({
          abortSignal: () => { llamadas.push({ tabla, op: 'update', payload, id }); return Promise.resolve(siguiente(`${tabla}.update`)) },
        }),
      }),
    }),
  }
  return { supabase: client, db: client }
})

import { crearFacturaProveedor } from '../mutations'
import { facturaProveedorFormSchema, facturaRenglonSchema, totalesFactura } from '../schemas'

const ORDEN = '0d100000-0000-0000-0000-0000000000c1'
const LINEA_A = '0d110000-0000-0000-0000-0000000000c1'
const LINEA_B = '0d110000-0000-0000-0000-0000000000c2'
const cabecera = facturaProveedorFormSchema.parse({
  proveedor_id: '0d120000-0000-0000-0000-0000000000c1',
  project_id: null,
  numero_factura: 'F-1',
  fecha_emision: '2026-10-02',
  fecha_vencimiento: null,
  concepto: 'Factura de la orden OC-1',
  categoria: 'otros',
  moneda: null,
  monto_total: 1456,
  iva_monto: 156,
  notas: null,
  orden_compra_id: ORDEN,
})
const renglones = [
  { orden_compra_linea_id: LINEA_A, descripcion: 'Mantenimiento', cantidad: 1, precio_unitario: 300, iva_monto: 36 },
  { orden_compra_linea_id: LINEA_B, descripcion: 'Bombas', cantidad: 2, precio_unitario: 500, iva_monto: 120 },
]

beforeEach(() => { llamadas.length = 0; respuestas = {} })

describe('totalesFactura', () => {
  it('suma subtotal, IVA y total de los renglones con el redondeo del servidor', () => {
    expect(totalesFactura(renglones)).toEqual({ subtotal: 1300, iva: 156, total: 1456 })
  })
  it('redondea cada renglón a centavos antes de sumar (igual que la columna total del servidor)', () => {
    const t = totalesFactura([{ cantidad: 3, precio_unitario: 0.335, iva_monto: 0 }, { cantidad: 3, precio_unitario: 0.335, iva_monto: 0 }])
    expect(t.subtotal).toBe(2.02) // cada renglón: 3 × 0.335 = 1.005 → 1.01; no 2.01 de redondear solo al final
  })
})

describe('facturaRenglonSchema', () => {
  it('exige cantidad > 0 y no admite precio ni IVA negativos', () => {
    expect(facturaRenglonSchema.safeParse(renglones[0]).success).toBe(true)
    expect(facturaRenglonSchema.safeParse({ ...renglones[0], cantidad: 0 }).success).toBe(false)
    expect(facturaRenglonSchema.safeParse({ ...renglones[0], precio_unitario: -1 }).success).toBe(false)
    expect(facturaRenglonSchema.safeParse({ ...renglones[0], iva_monto: -1 }).success).toBe(false)
  })
})

describe('crearFacturaProveedor', () => {
  it('sin orden: una sola inserción (gasto directo) y ningún renglón', async () => {
    respuestas['facturas_proveedor.insert'] = [{ data: [{ id: 'f1' }], error: null }]
    const f = await crearFacturaProveedor('c1', { ...cabecera, orden_compra_id: null })
    expect(f?.id).toBe('f1')
    expect(llamadas.map((l) => l.tabla)).toEqual(['facturas_proveedor'])
  })

  it('con orden: inserta cabecera ligada a la orden y los renglones numerados contra los de la orden', async () => {
    respuestas['facturas_proveedor.insert'] = [{ data: [{ id: 'f1' }], error: null }]
    respuestas['factura_proveedor_lineas.insert'] = [{ data: null, error: null }]
    await crearFacturaProveedor('c1', { ...cabecera, renglones })
    const [cab, lin] = llamadas
    expect(cab.tabla).toBe('facturas_proveedor')
    expect(cab.payload).toMatchObject({ company_id: 'c1', estado: 'registrada', orden_compra_id: ORDEN })
    expect((cab.payload as Record<string, unknown>).renglones).toBeUndefined()
    expect(lin.tabla).toBe('factura_proveedor_lineas')
    expect(lin.payload).toEqual([
      { ...renglones[0], company_id: 'c1', factura_id: 'f1', linea: 1 },
      { ...renglones[1], company_id: 'c1', factura_id: 'f1', linea: 2 },
    ])
  })

  it('con orden y SIN renglones: no escribe nada (no se deja una factura que aprobaría sin cuadre)', async () => {
    await expect(crearFacturaProveedor('c1', { ...cabecera })).rejects.toThrow(/por renglón/)
    await expect(crearFacturaProveedor('c1', { ...cabecera, renglones: [] })).rejects.toThrow(/por renglón/)
    expect(llamadas).toHaveLength(0)
  })

  it('si fallan los renglones, borra la cabecera y propaga el error original', async () => {
    respuestas['facturas_proveedor.insert'] = [{ data: [{ id: 'f1' }], error: null }]
    respuestas['factura_proveedor_lineas.insert'] = [{ data: null, error: { message: 'COMPRAS_FACTURA_LINEA_AJENA: la línea no es de la orden' } }]
    respuestas['facturas_proveedor.delete'] = [{ data: null, error: null }]
    await expect(crearFacturaProveedor('c1', { ...cabecera, renglones })).rejects.toThrow(/COMPRAS_FACTURA_LINEA_AJENA/)
    expect(llamadas.map((l) => `${l.tabla}:${l.op}`)).toEqual([
      'facturas_proveedor:insert', 'factura_proveedor_lineas:insert', 'facturas_proveedor:delete',
    ])
    expect(llamadas[2].id).toBe('f1')
  })

  it('si tampoco se puede borrar la cabecera, la anula (nunca queda registrada y ligada sin renglones)', async () => {
    respuestas['facturas_proveedor.insert'] = [{ data: [{ id: 'f1' }], error: null }]
    respuestas['factura_proveedor_lineas.insert'] = [{ data: null, error: { message: 'falló' } }]
    respuestas['facturas_proveedor.delete'] = [{ data: null, error: { message: 'RLS: no se puede borrar' } }]
    respuestas['facturas_proveedor.update'] = [{ data: null, error: null }]
    await expect(crearFacturaProveedor('c1', { ...cabecera, renglones })).rejects.toThrow(/falló/)
    const ult = llamadas[llamadas.length - 1]
    expect(ult).toMatchObject({ tabla: 'facturas_proveedor', op: 'update', id: 'f1', payload: { estado: 'anulada' } })
  })
})
