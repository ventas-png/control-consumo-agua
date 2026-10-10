// Contabilidad › Proveedores › Papelería: retirar un documento del expediente pide confirmación y «Cancelar» NO lo elimina.
//
// confirm() devuelve Promise<{ isConfirmed }>: un objeto siempre es «verdadero», así que `if (ok) await eliminar(…)` eliminaba el
// documento aunque la persona cancelara. Aquí se prueba con la firma REAL de confirm() (no con un booleano simulado).
//
// Y el borrado tampoco puede quedar mudo: si el servidor rechaza, se avisa (antes el rechazo quedaba sin manejar y sin aviso), y si
// no cambia ninguna fila —PostgREST contesta ÉXITO con cero filas cuando la política de filas no deja tocar— no es un éxito. Esos
// dos casos usan la mutación REAL (solo el cliente de Supabase está simulado).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { VER_Y_EDITAR, montarConSesion } from '../../../test/sesionPermisos'

const h = vi.hoisted(() => ({
  eliminar: vi.fn(), confirm: vi.fn(), notify: vi.fn(),
  /** true = la papelería usa la mutación REAL (con el cliente de Supabase simulado de abajo); false = `h.eliminar`. */
  real: false,
  filas: [] as unknown[],
  error: null as { message: string; code?: string } | null,
  borrados: [] as Array<{ tabla: string; filtro: string }>,
}))

vi.mock('../../../lib/supabase', () => {
  const cadena = (tabla: string) => {
    const c: Record<string, unknown> = {}
    const filtros: string[] = []
    c.delete = () => c
    c.eq = (col: string, val: unknown) => { filtros.push(`${col}=${String(val)}`); return c }
    c.select = () => c
    c.abortSignal = () => {
      h.borrados.push({ tabla, filtro: filtros.join('&') })
      return Promise.resolve({ data: h.filas, error: h.error })
    }
    return c
  }
  return { supabase: { from: (t: string) => cadena(t) }, warmUpSupabase: vi.fn() }
})
const vacio = { data: [], isLoading: false }
const ok = (fn: unknown) => ({ mutateAsync: fn, isPending: false })

vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [{ id: 'p1', nombre: 'Ferretería', estado: 'autorizado', activo: true, dias_credito: 0, autorizacion_vence: null, alcance: 'empresa' }],
    isLoading: false,
  }),
}))
vi.mock('../../../domain/cxp/mutations', () => ({ useGuardarProveedorMutation: () => ok(vi.fn()) }))
vi.mock('../../../domain/proveedores/queries', () => ({
  useDuplicadosFiscalesQuery: () => vacio,
  useEmpresaNombreQuery: () => ({ data: 'Empresa Uno', isLoading: false }),
}))
vi.mock('../../../domain/compras/queries', () => ({
  useDocumentosProveedorQuery: () => ({
    data: [{ id: 'd1', proveedor_id: 'p1', tipo: 'rtu', numero: 'RTU-123', archivo_url: null, vence_el: null }],
    isLoading: false,
  }),
}))
vi.mock('../../../domain/compras/mutations', async (orig) => {
  const real = await orig<typeof import('../../../domain/compras/mutations')>()
  return {
    useCambiarEstadoProveedorMutation: () => ok(vi.fn()),
    useGuardarDocumentoProveedorMutation: () => ok(vi.fn()),
    useEliminarDocumentoProveedorMutation: () => {
      const delServidor = real.useEliminarDocumentoProveedorMutation()
      return h.real ? delServidor : ok(h.eliminar)
    },
  }
})
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

import { ProveedoresTab } from '../ProveedoresTab'

function abrirPapeleria(permisos: readonly string[] = VER_Y_EDITAR, queryClient?: QueryClient) {
  montarConSesion(<ProveedoresTab companyId="c1" />, { permisos, queryClient })
  fireEvent.click(screen.getByText('Papelería'))
  return screen.getByRole('button', { name: /Eliminar/ })
}

const SIN_FILAS = /El servidor no aplicó el cambio/
const DURACION_MINIMA_MS = 10_000
const avisos = (variante: string) =>
  h.notify.mock.calls.map(([o]) => o as { variant: string; text: string; duration?: number }).filter((o) => o.variant === variante)

beforeEach(() => {
  h.eliminar.mockResolvedValue(undefined)
  h.real = false; h.filas = []; h.error = null; h.borrados = []
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Proveedores › Papelería › retirar un documento', () => {
  it('«Cancelar» en la confirmación NO elimina el documento', async () => {
    h.confirm.mockResolvedValue({ isConfirmed: false })
    fireEvent.click(abrirPapeleria())
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
    // un tick más para asegurar que nada se encadenó tras el diálogo
    await Promise.resolve(); await Promise.resolve()
    expect(h.eliminar).not.toHaveBeenCalled()
    expect(screen.getByText('RTU-123')).toBeTruthy()
  })

  it('confirmar sí elimina ese documento (control positivo)', async () => {
    h.confirm.mockResolvedValue({ isConfirmed: true })
    fireEvent.click(abrirPapeleria())
    await waitFor(() => expect(h.eliminar).toHaveBeenCalledWith('d1'))
    expect(h.eliminar).toHaveBeenCalledTimes(1)
  })

  it('sin «Editar» de Contabilidad no se ofrece eliminar', () => {
    montarConSesion(<ProveedoresTab companyId="c1" />, { permisos: ['platform.contabilidad.view'] })
    fireEvent.click(screen.getByText('Papelería'))
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull()
  })
})

describe('Proveedores › Papelería › retirar un documento: el servidor decide y la pantalla lo dice', () => {
  const arrancar = () => {
    h.real = true
    h.confirm.mockResolvedValue({ isConfirmed: true })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidar = vi.spyOn(qc, 'invalidateQueries')
    fireEvent.click(abrirPapeleria(VER_Y_EDITAR, qc))
    return invalidar
  }

  it('el rechazo del servidor se avisa (antes quedaba sin manejar y sin ningún aviso)', async () => {
    h.error = { message: 'COMPRAS_X: el servidor rechazó el borrado del documento.' }
    const invalidar = arrancar()
    await waitFor(() => expect(avisos('error')).toHaveLength(1))
    expect(avisos('error')[0].text).toMatch(/el servidor rechazó el borrado del documento/)
    expect(avisos('error')[0].duration).toBeGreaterThanOrEqual(DURACION_MINIMA_MS)
    expect(avisos('success')).toEqual([])
    expect(invalidar).not.toHaveBeenCalled()
  })

  it('cero filas afectadas NO es éxito: se avisa, el documento no se da por eliminado y no se refrescan las consultas', async () => {
    h.filas = []
    const invalidar = arrancar()
    await waitFor(() => expect(avisos('error')).toHaveLength(1))
    expect(avisos('error')[0].text).toMatch(SIN_FILAS)
    expect(avisos('success')).toEqual([])
    expect(invalidar).not.toHaveBeenCalled()
    // el DELETE sí se intentó, sobre ese documento y solo sobre él
    expect(h.borrados).toEqual([{ tabla: 'proveedor_documentos', filtro: 'id=d1' }])
  })

  it('con una fila afectada se elimina sin avisos de error y se refrescan las consultas (control positivo)', async () => {
    h.filas = [{ id: 'd1' }]
    const invalidar = arrancar()
    await waitFor(() => expect(invalidar).toHaveBeenCalled())
    expect(avisos('error')).toEqual([])
    expect(h.borrados).toEqual([{ tabla: 'proveedor_documentos', filtro: 'id=d1' }])
  })
})
