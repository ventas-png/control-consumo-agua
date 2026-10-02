// Bloque B (#911) — La recepción se crea por UNA función transaccional del
// servidor: cabecera y líneas juntas, idempotente por clave + contenido.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../../lib/supabase', () => {
  const client = {
    // Flecha para que la referencia se resuelva al LLAMAR (vi.mock se iza).
    rpc: (nombre: string, args: unknown) => ({
      abortSignal: () => rpc(nombre, args),
    }),
  }
  return { supabase: client, db: client }
})

import { crearRecepcionTransaccional } from '../mutations'
import type { RecepcionFormInput } from '../schemas'

const input: RecepcionFormInput = {
  orden_compra_id: '0d100000-0000-0000-0000-0000000000b1',
  tipo: 'bienes',
  fecha: '2026-10-01',
  documento_referencia: 'REM-77',
  destino_fisico: 'Bodega',
  recibido_por: null,
  respaldo_path: null,
  clave_idempotencia: 'rpc-001',
  notas: null,
  lineas: [
    { orden_compra_linea_id: '0d110000-0000-0000-0000-0000000000b1', cantidad: 10, cantidad_rechazada: 2, motivo_rechazo: 'Envases dañados', costo_unitario: 10, observacion: null },
    { orden_compra_linea_id: '0d110000-0000-0000-0000-0000000000b2', cantidad: 20, cantidad_rechazada: 0, motivo_rechazo: null, costo_unitario: 5, observacion: null },
  ],
}

const doc = (reutilizada: boolean) => ({
  data: { recepcion: { id: 'r1', estado: 'borrador' }, lineas: [{ id: 'l1' }, { id: 'l2' }], reutilizada },
  error: null,
})

beforeEach(() => rpc.mockReset())

describe('crearRecepcionTransaccional', () => {
  it('manda cabecera y líneas en UNA sola llamada (una transacción), no dos peticiones', async () => {
    rpc.mockResolvedValueOnce(doc(false))
    const r = await crearRecepcionTransaccional('c1', 'p1', input)
    expect(rpc).toHaveBeenCalledTimes(1)
    const [nombre, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(nombre).toBe('compras_recepcion_crear')
    expect(args.p_company_id).toBe('c1')
    expect(args.p_project_id).toBe('p1')
    expect((args.p_cabecera as Record<string, unknown>).clave_idempotencia).toBe('rpc-001')
    expect((args.p_cabecera as Record<string, unknown>).lineas).toBeUndefined()
    expect(args.p_lineas).toHaveLength(2)
    expect(r.recepcion.id).toBe('r1')
    expect(r.lineas).toHaveLength(2)
    expect(r.reutilizada).toBe(false)
  })

  it('respuesta perdida: el reintento con la misma clave recupera el MISMO documento completo', async () => {
    rpc.mockResolvedValueOnce(doc(false)).mockResolvedValueOnce(doc(true))
    const a = await crearRecepcionTransaccional('c1', 'p1', input)
    const b = await crearRecepcionTransaccional('c1', 'p1', input)
    expect(b.recepcion.id).toBe(a.recepcion.id)
    expect(b.reutilizada).toBe(true)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  })

  it('la misma clave con otro contenido: el error del servidor llega tal cual (mensaje claro)', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'COMPRAS_RECEPCION_CLAVE_CONFLICTO: la clave de idempotencia ya se usó para una recepción con OTRO contenido.', code: '23505', details: '', hint: '', name: 'PostgrestError' },
    })
    await expect(crearRecepcionTransaccional('c1', 'p1', { ...input, notas: 'otra' }))
      .rejects.toThrow(/COMPRAS_RECEPCION_CLAVE_CONFLICTO/)
  })

  it('si falla una línea, falla TODA la creación: no hay segunda llamada que complete a medias', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'COMPRAS_RECEPCION_LINEA_AJENA: la línea no es de la orden de esta recepción.', code: '23514', details: '', hint: '', name: 'PostgrestError' },
    })
    await expect(crearRecepcionTransaccional('c1', 'p1', input)).rejects.toThrow(/LINEA_AJENA/)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('sin clave de idempotencia no se llama al servidor', async () => {
    await expect(crearRecepcionTransaccional('c1', 'p1', { ...input, clave_idempotencia: null }))
      .rejects.toThrow(/clave de idempotencia/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('una respuesta sin documento se trata como error, no como éxito', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    await expect(crearRecepcionTransaccional('c1', 'p1', input)).rejects.toThrow(/No se pudo crear/)
  })
})
