// Guardar y quitar configuración por tipo de cargo, y asignar o renombrar un
// auxiliar, exigen que la escritura haya afectado EXACTAMENTE una fila.
//
// PostgREST no devuelve error cuando la RLS filtra un UPDATE o un DELETE:
// devuelve «éxito» con cero filas. Sin esta comprobación la pantalla decía
// «guardado» y no había cambiado nada. Aquí se simula esa respuesta —y la de
// más de una fila— y se exige que la mutación falle.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const estado = vi.hoisted(() => ({
  filas: [{ id: 'x' }] as Array<{ id: string }>,
  llamadas: [] as string[],
}))

vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.eq = () => chain
  chain.select = (cols: string) => { estado.llamadas.push(`select:${cols}`); return chain }
  chain.abortSignal = () => Promise.resolve({ data: estado.filas, error: null })
  const escribir = (op: string) => () => { estado.llamadas.push(op); return chain }
  return {
    supabase: {
      from: () => ({ update: escribir('update'), insert: escribir('insert'), delete: escribir('delete') }),
    },
  }
})

import {
  SinFilasAfectadasError,
  exigirUnaFila,
  useEliminarConfigTipoCargoMutation,
  useGuardarAuxiliarMutation,
  useGuardarConfigTipoCargoMutation,
} from '../mutations'

function envoltura({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const CONFIG = {
  tipo_cargo: 'mantenimiento', cuenta_cxc_id: 'cxc', cuenta_ingreso_id: 'ing',
  cuenta_impuesto_id: null, activa: true,
}

beforeEach(() => {
  estado.filas = [{ id: 'x' }]
  estado.llamadas.length = 0
})

describe('exigirUnaFila', () => {
  it('acepta exactamente una fila', () => {
    expect(() => exigirUnaFila([{ id: 'a' }])).not.toThrow()
  })
  it('rechaza cero filas, null y más de una', () => {
    expect(() => exigirUnaFila([])).toThrow(SinFilasAfectadasError)
    expect(() => exigirUnaFila(null)).toThrow(SinFilasAfectadasError)
    expect(() => exigirUnaFila([{ id: 'a' }, { id: 'b' }])).toThrow(SinFilasAfectadasError)
  })
})

describe.each([
  ['editar configuración', () => {
    const { result } = renderHook(() => useGuardarConfigTipoCargoMutation('c1', 'p1'), { wrapper: envoltura })
    return () => result.current.mutateAsync({ ...CONFIG, id: 'cfg-1' })
  }, 'update'],
  ['crear configuración', () => {
    const { result } = renderHook(() => useGuardarConfigTipoCargoMutation('c1', 'p1'), { wrapper: envoltura })
    return () => result.current.mutateAsync({ ...CONFIG, id: null })
  }, 'insert'],
  ['quitar configuración', () => {
    const { result } = renderHook(() => useEliminarConfigTipoCargoMutation('c1'), { wrapper: envoltura })
    return () => result.current.mutateAsync('cfg-1')
  }, 'delete'],
  ['renombrar auxiliar', () => {
    const { result } = renderHook(() => useGuardarAuxiliarMutation('c1'), { wrapper: envoltura })
    return () => result.current.mutateAsync({ auxiliar_id: 'aux-1', cliente_id: 'cli-1', codigo: 'T-1' })
  }, 'update'],
  ['asignar auxiliar', () => {
    const { result } = renderHook(() => useGuardarAuxiliarMutation('c1'), { wrapper: envoltura })
    return () => result.current.mutateAsync({ auxiliar_id: null, cliente_id: 'cli-1', codigo: null })
  }, 'insert'],
])('%s', (_nombre, preparar, operacion) => {
  it('con una fila afectada termina bien y pide de vuelta el id', async () => {
    const ejecutar = preparar()
    await expect(ejecutar()).resolves.toBeUndefined()
    expect(estado.llamadas).toEqual([operacion, 'select:id'])
  })

  it('con cero filas (RLS filtró la escritura) falla en vez de «guardar»', async () => {
    estado.filas = []
    const ejecutar = preparar()
    await expect(ejecutar()).rejects.toBeInstanceOf(SinFilasAfectadasError)
  })
})
