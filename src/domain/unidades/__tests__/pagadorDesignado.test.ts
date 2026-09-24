// El cambio de pagador es UNA llamada a la RPC transaccional, nunca dos
// escrituras sueltas sobre `unidad_residentes`.
//
// Con dos peticiones, si la segunda fallaba la unidad quedaba sin pagador y,
// entre una y otra, los cargos emitidos veían ese estado. La atomicidad, las
// validaciones y la serialización viven en la base (supabase/tests/
// conta_pagador_designado); aquí se fija que el cliente no vuelva a partirlo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ db: { rpc, from } }))

import { setResponsablePago } from '../residentes'

beforeEach(() => {
  rpc.mockReset()
  from.mockReset()
})

describe('setResponsablePago', () => {
  it('designa con una sola llamada a la RPC y sin escribir la tabla', async () => {
    rpc.mockResolvedValueOnce({ data: 'r2', error: null })
    expect(await setResponsablePago('u1', 'r2')).toEqual({ error: null })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('unidad_designar_pagador', { p_unidad_id: 'u1', p_residente_id: 'r2' })
    expect(from).not.toHaveBeenCalled()
  })

  it('retirar el pagador también es una sola llamada, con residente NULL', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await setResponsablePago('u1', null)).toEqual({ error: null })
    expect(rpc).toHaveBeenCalledWith('unidad_designar_pagador', { p_unidad_id: 'u1', p_residente_id: null })
    expect(from).not.toHaveBeenCalled()
  })

  it('un rechazo del servidor se muestra sin el código técnico', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PAGADOR_RESIDENTE_DE_OTRA_UNIDAD: el residente pertenece a otra unidad.' },
    })
    expect(await setResponsablePago('u1', 'r9')).toEqual({ error: 'el residente pertenece a otra unidad.' })
  })

  it('una escritura filtrada por RLS llega como error, no como éxito', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PAGADOR_SIN_PERMISO: no tienes permiso para cambiar los residentes de esta unidad.' },
    })
    const { error } = await setResponsablePago('u1', 'r2')
    expect(error).toMatch(/no tienes permiso/)
  })
})
