// Cierre técnico — La orden de compra se crea por UNA función transaccional del servidor
// (`compras_orden_crear`): cabecera y renglones juntos, idempotente por clave + contenido, desde
// Contabilidad y desde Operaciones. La garantía real vive en el servidor
// (supabase/tests/compras_cierre_tecnico/assert_orden_crear.sql y su concurrencia); aquí se fija lo que el cliente
// manda y cómo trata las respuestas.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../../lib/supabase', () => {
  const client = {
    rpc: (nombre: string, args: unknown) => ({
      abortSignal: () => rpc(nombre, args),
    }),
  }
  return { supabase: client, db: client }
})

import { crearOrdenTransaccional, type OrdenCompraCaptura } from '../mutations'
import { mensajeCrearOrden, nuevaClaveIdempotencia } from '../ordenCrear'

const captura: OrdenCompraCaptura = {
  proveedor_id: '0d100000-0000-4000-8000-0000000000b1',
  contrato_id: null,
  concepto: 'Mantenimiento de bombas',
  descripcion: null,
  fecha_requerida: null,
  clave_idempotencia: 'oc-clave-0001',
  lineas: [
    { descripcion: 'Material', destino_tipo: 'gasto', suministro_id: null, cuenta_id: null, categoria: 'mantenimiento', cantidad: 10, unidad: 'u', precio_unitario: 10, iva_monto: 12 },
    { descripcion: 'Servicio', destino_tipo: 'servicio', suministro_id: null, cuenta_id: null, categoria: 'mantenimiento', cantidad: 1, unidad: 'u', precio_unitario: 300, iva_monto: 36 },
  ],
}

const creada = (reutilizada: boolean) => ({
  data: { orden: { id: 'o1', estado: 'borrador', total: 448 }, lineas: [{ id: 'l1' }, { id: 'l2' }], reutilizada },
  error: null,
})

beforeEach(() => rpc.mockReset())

describe('crearOrdenTransaccional', () => {
  it('manda cabecera y renglones en UNA sola llamada (una transacción), no dos peticiones', async () => {
    rpc.mockResolvedValueOnce(creada(false))
    const r = await crearOrdenTransaccional('c1', 'p1', captura)
    expect(rpc).toHaveBeenCalledTimes(1)
    const [nombre, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(nombre).toBe('compras_orden_crear')
    expect(args.p_company_id).toBe('c1')
    expect(args.p_project_id).toBe('p1')
    expect((args.p_cabecera as Record<string, unknown>).clave_idempotencia).toBe('oc-clave-0001')
    expect((args.p_cabecera as Record<string, unknown>).concepto).toBe('Mantenimiento de bombas')
    expect((args.p_cabecera as Record<string, unknown>).lineas).toBeUndefined()
    expect(args.p_lineas).toHaveLength(2)
    expect(r.orden.id).toBe('o1')
    expect(r.lineas).toHaveLength(2)
    expect(r.reutilizada).toBe(false)
  })

  it('la contabilidad de la EMPRESA (sin proyecto) viaja como NULL', async () => {
    rpc.mockResolvedValueOnce(creada(false))
    await crearOrdenTransaccional('c1', null, captura)
    expect((rpc.mock.calls[0][1] as Record<string, unknown>).p_project_id).toBeNull()
  })

  it('Operaciones: solo cabecera (sin renglones) también es una sola llamada, con la lista vacía', async () => {
    rpc.mockResolvedValueOnce(creada(false))
    const { lineas, ...soloCabecera } = captura
    void lineas
    await crearOrdenTransaccional('c1', 'p1', { ...soloCabecera, monto_estimado: 500 })
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(args.p_lineas).toEqual([])
    expect((args.p_cabecera as Record<string, unknown>).monto_estimado).toBe(500)
  })

  it('respuesta perdida o doble clic: el reintento con la misma clave recupera la MISMA orden', async () => {
    rpc.mockResolvedValueOnce(creada(false)).mockResolvedValueOnce(creada(true))
    const a = await crearOrdenTransaccional('c1', 'p1', captura)
    const b = await crearOrdenTransaccional('c1', 'p1', captura)
    expect(b.orden.id).toBe(a.orden.id)
    expect(b.reutilizada).toBe(true)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])   // exactamente lo mismo, con la misma clave
  })

  it('la misma clave con otro contenido: el error del servidor llega tal cual', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'COMPRAS_ORDEN_CLAVE_CONFLICTO: la clave de idempotencia ya se usó para una orden con OTRO contenido.', code: '23505', details: '', hint: '', name: 'PostgrestError' },
    })
    await expect(crearOrdenTransaccional('c1', 'p1', { ...captura, concepto: 'Otro' })).rejects.toThrow(/COMPRAS_ORDEN_CLAVE_CONFLICTO/)
  })

  it('si falla un renglón, falla TODA la creación: no hay segunda llamada que complete a medias', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'COMPRAS_LINEA_INSUMO_ALCANCE: el insumo no es de la empresa y el proyecto de la orden.', code: '23514', details: '', hint: '', name: 'PostgrestError' },
    })
    await expect(crearOrdenTransaccional('c1', 'p1', captura)).rejects.toThrow(/INSUMO_ALCANCE/)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('sin clave de idempotencia no se llama al servidor', async () => {
    await expect(crearOrdenTransaccional('c1', 'p1', { ...captura, clave_idempotencia: '' })).rejects.toThrow(/clave de idempotencia/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una respuesta sin orden se trata como error, no como éxito', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(crearOrdenTransaccional('c1', 'p1', captura)).rejects.toThrow(/No se pudo crear/)
  })
})

describe('clave de idempotencia y mensajes', () => {
  it('cada apertura del formulario genera una clave distinta y suficientemente larga para el servidor (8 a 200)', () => {
    const a = nuevaClaveIdempotencia('oc')
    const b = nuevaClaveIdempotencia('oc')
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(8)
    expect(a.length).toBeLessThanOrEqual(200)
  })

  it('la clave repetida con otro contenido se explica (la captura anterior probablemente SÍ se guardó)', () => {
    const m = mensajeCrearOrden(new Error('COMPRAS_ORDEN_CLAVE_CONFLICTO: la clave de idempotencia ya se usó…'))
    expect(m).toMatch(/ya se guardó/)
    expect(m).toMatch(/lista de órdenes/)
  })

  it('el resto de los códigos COMPRAS_* se muestran tal cual (están escritos para leerse)', () => {
    expect(mensajeCrearOrden(new Error('COMPRAS_LINEA_INSUMO_UNIDAD: la unidad no es la del insumo')))
      .toBe('COMPRAS_LINEA_INSUMO_UNIDAD: la unidad no es la del insumo')
    expect(mensajeCrearOrden({ message: 'COMPRAS_ORDEN_PROYECTO: no tienes acceso a ese proyecto.' })).toMatch(/no tienes acceso/)
    expect(mensajeCrearOrden(undefined)).toBe('No se pudo crear la orden.')
  })
})
