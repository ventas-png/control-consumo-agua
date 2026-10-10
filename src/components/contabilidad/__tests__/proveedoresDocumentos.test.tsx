// Contabilidad › Proveedores › Papelería: retirar un documento del expediente pide confirmación y «Cancelar» NO lo elimina.
//
// confirm() devuelve Promise<{ isConfirmed }>: un objeto siempre es «verdadero», así que `if (ok) await eliminar(…)` eliminaba el
// documento aunque la persona cancelara. Aquí se prueba con la firma REAL de confirm() (no con un booleano simulado).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { VER_Y_EDITAR, montarConSesion } from '../../../test/sesionPermisos'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const h = vi.hoisted(() => ({ eliminar: vi.fn(), confirm: vi.fn(), notify: vi.fn() }))
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
vi.mock('../../../domain/compras/mutations', () => ({
  useCambiarEstadoProveedorMutation: () => ok(vi.fn()),
  useGuardarDocumentoProveedorMutation: () => ok(vi.fn()),
  useEliminarDocumentoProveedorMutation: () => ok(h.eliminar),
}))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ confirm: h.confirm, notify: h.notify }))

import { ProveedoresTab } from '../ProveedoresTab'

function abrirPapeleria(permisos: readonly string[] = VER_Y_EDITAR) {
  montarConSesion(<ProveedoresTab companyId="c1" />, { permisos })
  fireEvent.click(screen.getByText('Papelería'))
  return screen.getByRole('button', { name: /Eliminar/ })
}

beforeEach(() => { h.eliminar.mockResolvedValue(undefined) })
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
