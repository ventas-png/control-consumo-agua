// T7/PR3 — Contrato de las mutaciones de agua (registros): fila + mapeo de error.
import { describe, it, expect, vi } from 'vitest'

const rpc = vi.fn()
const updateEq = vi.fn()
const updateIn = vi.fn()
// E2: deleteRegistro es soft delete — va por softDelete() (update + match + is).
const softDeleteIs = vi.fn()
const storageUpload = vi.fn()
vi.mock('../../../lib/supabase', () => {
  // `db` es la MISMA instancia que `supabase` (cast tipado) — el mock replica eso.
  const client = {
    from: () => ({
      update: () => ({ eq: updateEq, in: updateIn, match: () => ({ is: softDeleteIs }) }),
    }),
    // Envuelto en una flecha (y no `rpc,` a secas) porque vi.mock se iza por
    // encima de la declaración del spy: la referencia tiene que resolverse al
    // LLAMAR, no al construir el objeto.
    rpc: (nombre: string, args: unknown) => rpc(nombre, args),
    storage: { from: () => ({ upload: storageUpload }) },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  }
  return { supabase: client, db: client }
})

import { registrarLectura, updateRegistro, deleteRegistro, marcarRegistrosMora, uploadRegistroFoto } from '../mutations'
import type { LecturaCaptura } from '../mutations'

const captura: LecturaCaptura = {
  contadorId: 'c1',
  lecturaActual: 130,
  fecha: '2026-09-10',
  idempotencyKey: 'op-1234567890',
}

describe('registrarLectura', () => {
  it('éxito → devuelve la fila que construyó el servidor', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'reg1', consumo: 30 }, error: null })
    expect(await registrarLectura(captura)).toEqual({
      data: { id: 'reg1', consumo: 30 }, error: null, duplicado: false,
    })
  })

  it('manda SÓLO lo que capturó el operador: nada que decida el cobro', async () => {
    // Es el contrato entero de este PR. Si alguien vuelve a colar `consumo`,
    // `monto_calculado`, `tarifa_aplicada`, `project_id` o `estado` en la
    // llamada, la RPC los ignoraría, pero esta prueba lo dice antes.
    rpc.mockResolvedValueOnce({ data: { id: 'reg1' }, error: null })
    await registrarLectura({ ...captura, notas: 'nota', gps: { lat: 1, lng: 2 } })
    const [nombre, args] = rpc.mock.calls.at(-1)!
    expect(nombre).toBe('registrar_lectura')
    expect(Object.keys(args as object).sort()).toEqual([
      'p_contador_id', 'p_fecha', 'p_fecha_inicio_servicio', 'p_foto', 'p_gps',
      'p_idempotency_key', 'p_lectura_actual', 'p_lectura_final_retirada',
      'p_notas', 'p_reset_medidor',
    ])
  })

  it('error → { data: null, error: mensaje }', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'lectura retroactiva' } })
    expect(await registrarLectura(captura)).toEqual({
      data: null, error: 'lectura retroactiva', duplicado: false,
    })
  })

  it('23505 (llave natural) → duplicado true con mensaje amigable', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_registros_llave_natural"' },
    })
    const r = await registrarLectura(captura)
    expect(r.duplicado).toBe(true)
    expect(r.data).toBeNull()
    expect(r.error).toContain('ya está registrada')
  })
})

describe('updateRegistro', () => {
  it('éxito → { error: null }', async () => {
    updateEq.mockResolvedValueOnce({ error: null })
    expect(await updateRegistro('reg1', { estado: 'pagado' })).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    updateEq.mockResolvedValueOnce({ error: { message: 'denied' } })
    expect(await updateRegistro('reg1', {})).toEqual({ error: 'denied' })
  })
})

describe('deleteRegistro (soft delete, E2)', () => {
  it('éxito → { error: null, count } vía softDelete (update, no DELETE físico)', async () => {
    softDeleteIs.mockResolvedValueOnce({ error: null, count: 1 })
    expect(await deleteRegistro('reg1')).toEqual({ error: null, count: 1 })
    expect(softDeleteIs).toHaveBeenCalledWith('deleted_at', null)
  })

  it('sin permisos o ya borrado (count 0, sin error) → distingue del borrado', async () => {
    softDeleteIs.mockResolvedValueOnce({ error: null, count: 0 })
    expect(await deleteRegistro('reg1')).toEqual({ error: null, count: 0 })
  })

  it('error → mensaje legible y count null', async () => {
    softDeleteIs.mockResolvedValueOnce({ error: { message: 'denied' }, count: null })
    expect(await deleteRegistro('reg1')).toEqual({ error: 'denied', count: null })
  })
})

describe('marcarRegistrosMora', () => {
  it('éxito → { error: null }', async () => {
    updateIn.mockResolvedValueOnce({ error: null })
    expect(await marcarRegistrosMora(['a', 'b'])).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    updateIn.mockResolvedValueOnce({ error: { message: 'rls' } })
    expect(await marcarRegistrosMora(['a'])).toEqual({ error: 'rls' })
  })
})

describe('uploadRegistroFoto', () => {
  it('éxito → { error: null }', async () => {
    storageUpload.mockResolvedValueOnce({ error: null })
    expect(await uploadRegistroFoto('c1/123', new Blob(['x']), 'image/png')).toEqual({ error: null })
  })

  it('error → mensaje legible', async () => {
    storageUpload.mockResolvedValueOnce({ error: { message: 'too big' } })
    expect(await uploadRegistroFoto('c1/123', new Blob(['x']))).toEqual({ error: 'too big' })
  })
})
