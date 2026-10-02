// Bloque B (#911) · La factura se crea por UNA operación de servidor
// (`compras_factura_crear`): cabecera y renglones juntos, idempotente por clave +
// huella de contenido. Antes eran dos peticiones y un borrado compensatorio desde
// el cliente, que dejaban facturas a medias o duplicadas.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const desdeTabla = vi.fn()
vi.mock('../../../lib/supabase', () => {
  const client = {
    // Flecha para que la referencia se resuelva al LLAMAR (vi.mock se iza).
    rpc: (nombre: string, args: unknown) => ({ abortSignal: () => rpc(nombre, args) }),
    // Si el código volviera a escribir tablas desde el cliente, esta prueba lo vería.
    from: (tabla: string) => { desdeTabla(tabla); throw new Error('el cliente no debe escribir ' + tabla) },
  }
  return { supabase: client, db: client }
})

import { crearFacturaProveedor } from '../mutations'
import { facturaProveedorFormSchema, facturaRenglonSchema, totalesFactura, type FacturaCrearInput } from '../schemas'

const ORDEN = '0d100000-0000-0000-0000-0000000000c1'
const LINEA_A = '0d110000-0000-0000-0000-0000000000c1'
const LINEA_B = '0d110000-0000-0000-0000-0000000000c2'
const base = facturaProveedorFormSchema.parse({
  proveedor_id: '0d120000-0000-0000-0000-0000000000c1',
  project_id: '0d130000-0000-0000-0000-0000000000c1',
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
const entrada = (extra: Partial<FacturaCrearInput> = {}): FacturaCrearInput => ({ ...base, clave_idempotencia: 'clave-0001-abcd', renglones, ...extra })
const respuesta = (reutilizada: boolean) => ({ data: { factura: { id: 'f1', estado: 'registrada' }, lineas: [{ id: 'l1' }, { id: 'l2' }], reutilizada }, error: null })

beforeEach(() => { rpc.mockReset(); desdeTabla.mockReset() })

describe('totalesFactura', () => {
  it('suma subtotal, IVA y total de los renglones con el redondeo del servidor', () => {
    expect(totalesFactura(renglones)).toEqual({ subtotal: 1300, iva: 156, total: 1456 })
  })
})

describe('facturaRenglonSchema', () => {
  it('exige cantidad > 0 y no admite precio ni IVA negativos', () => {
    expect(facturaRenglonSchema.safeParse(renglones[0]).success).toBe(true)
    expect(facturaRenglonSchema.safeParse({ ...renglones[0], cantidad: 0 }).success).toBe(false)
    expect(facturaRenglonSchema.safeParse({ ...renglones[0], precio_unitario: -1 }).success).toBe(false)
  })
})

describe('crearFacturaProveedor', () => {
  it('manda cabecera y renglones en UNA sola llamada y no escribe tablas desde el cliente', async () => {
    rpc.mockResolvedValueOnce(respuesta(false))
    const r = await crearFacturaProveedor('c1', entrada())
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(desdeTabla).not.toHaveBeenCalled()
    const [nombre, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(nombre).toBe('compras_factura_crear')
    expect(args.p_company_id).toBe('c1')
    expect(args.p_project_id).toBe(base.project_id)
    const cab = args.p_cabecera as Record<string, unknown>
    expect(cab).toMatchObject({ orden_compra_id: ORDEN, clave_idempotencia: 'clave-0001-abcd', numero_factura: 'F-1' })
    expect(cab.renglones).toBeUndefined()      // los renglones viajan aparte
    expect(cab.project_id).toBeUndefined()     // el proyecto viaja aparte
    expect(args.p_lineas).toEqual(renglones)
    expect(r.factura.id).toBe('f1')
    expect(r.reutilizada).toBe(false)
  })

  it('doble clic / respuesta perdida: el reintento con la misma clave devuelve la MISMA factura', async () => {
    rpc.mockResolvedValueOnce(respuesta(false)).mockResolvedValueOnce(respuesta(true))
    const a = await crearFacturaProveedor('c1', entrada())
    const b = await crearFacturaProveedor('c1', entrada())
    expect(b.factura.id).toBe(a.factura.id)
    expect(b.reutilizada).toBe(true)
    const claves = rpc.mock.calls.map((c) => ((c[1] as { p_cabecera: { clave_idempotencia: string } }).p_cabecera.clave_idempotencia))
    expect(new Set(claves).size).toBe(1)
  })

  it('gasto directo (sin orden): sin renglones, p_lineas va nulo', async () => {
    rpc.mockResolvedValueOnce(respuesta(false))
    await crearFacturaProveedor('c1', entrada({ orden_compra_id: null, renglones: undefined }))
    expect((rpc.mock.calls[0][1] as { p_lineas: unknown }).p_lineas).toBeNull()
  })

  it('el rechazo del servidor (renglón ajeno, clave en conflicto…) se propaga y NO hay compensación del cliente', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'COMPRAS_FACTURA_LINEA_AJENA: 1 renglón(es) no son de la orden de esta factura.' } })
    await expect(crearFacturaProveedor('c1', entrada())).rejects.toThrow(/COMPRAS_FACTURA_LINEA_AJENA/)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(desdeTabla).not.toHaveBeenCalled()      // ni borrar ni anular desde el cliente
  })

  it('sin clave de idempotencia o con orden y sin renglones no llama al servidor', async () => {
    await expect(crearFacturaProveedor('c1', entrada({ clave_idempotencia: '' }))).rejects.toThrow(/clave de idempotencia/)
    await expect(crearFacturaProveedor('c1', entrada({ renglones: [] }))).rejects.toThrow(/por renglón/)
    await expect(crearFacturaProveedor('c1', entrada({ renglones: undefined }))).rejects.toThrow(/por renglón/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una respuesta sin factura es un error, no un éxito silencioso', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null })
    await expect(crearFacturaProveedor('c1', entrada())).rejects.toThrow(/No se pudo crear/)
  })
})
