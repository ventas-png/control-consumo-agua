// Contabilidad › Solicitudes de ajuste (20261011000000): la pantalla ofrece
// aprobar sólo lo que el servidor aceptaría (E1) y la autoaprobación del dueño
// va con confirmación explícita.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  sesion: { user_id: 'u-yo', role: 'admin' } as Record<string, unknown>,
  puedeAutorizar: true,
  solicitudes: [] as Array<Record<string, unknown>>,
  aprobar: vi.fn(async (_i: Record<string, unknown>) => ({ solicitud_id: 's', estado: 'ejecutada', repetida: false, autoaprobada: false, resultado: {} as Record<string, unknown> | null, error_ejecucion: null as string | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/SessionContext', () => ({ useSession: () => h.sesion }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: h.confirm }))
vi.mock('../../shared/PromptDialog', () => ({ openTextPrompt: vi.fn(async () => 'motivo del rechazo') }))
vi.mock('../ui', async (orig) => ({
  ...(await orig<typeof import('../ui')>()),
  usePermisosContabilidad: () => ({ puedeCrear: true, puedeEditar: true, puedeCambiarEstado: true, puedeAutorizar: h.puedeAutorizar, puedeEliminar: false }),
}))
vi.mock('../../../domain/contabilidad/ajustes', async (orig) => {
  const real = await orig<typeof import('../../../domain/contabilidad/ajustes')>()
  const mut = (fn = vi.fn()) => () => ({ mutateAsync: fn, isPending: false })
  return {
    ...real,
    useSolicitudesAjusteQuery: () => ({ data: h.solicitudes, isLoading: false, error: null }),
    useIncidenciasConciliacionQuery: () => ({ data: [], isLoading: false, error: null }),
    useAprobarAjusteMutation: mut(h.aprobar),
    useRechazarAjusteMutation: mut(),
    useReintentarAjusteMutation: mut(),
    useCancelarAjusteMutation: mut(),
    useResolverIncidenciaMutation: mut(),
  }
})

import { AjustesTab } from '../AjustesTab'

function solicitud(id: string, por: string, extra: Record<string, unknown> = {}) {
  return {
    id, company_id: 'c', project_id: 'p', tipo: 'anular_cargo', documento_tabla: 'cargos_adicionales_unidad',
    documento_id: 'ca', saldo_origen_id: null, importe: 40, moneda: null, motivo: 'se cobró por error',
    canal: 'backoffice', estado: 'pendiente', solicitado_por: por, solicitado_cliente_id: null,
    solicitado_at: '2026-09-27T00:00:00Z', foto_documento: { concepto: 'Vidrio' }, revisado_por: null,
    revisado_at: null, motivo_revision: null, autoaprobada: false, ejecutado_at: null, resultado: null,
    error_ejecucion: null, intentos_ejecucion: 0, ...extra,
  }
}

beforeEach(() => {
  h.sesion = { user_id: 'u-yo', role: 'admin' }
  h.puedeAutorizar = true
  h.aprobar.mockClear(); h.confirm.mockClear(); h.notify.mockClear()
})
afterEach(cleanup)

describe('AjustesTab', () => {
  it('la solicitud de otra persona se aprueba (sin confirmación de autoaprobación)', async () => {
    h.solicitudes = [solicitud('s-otro', 'u-otro')]
    render(<AjustesTab companyId="c" projectId="p" />)
    const fila = screen.getByTestId('ajuste-s-otro')
    await act(async () => { fireEvent.click(within(fila).getByRole('button', { name: 'Aprobar' })) })
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.aprobar).toHaveBeenCalledWith({ id: 's-otro', confirmarAutoaprobacion: false })
  })

  it('la propia, como admin: ni Aprobar ni Autoaprobar; sí Cancelar', () => {
    h.solicitudes = [solicitud('s-mia', 'u-yo')]
    render(<AjustesTab companyId="c" projectId="p" />)
    const fila = screen.getByTestId('ajuste-s-mia')
    expect(within(fila).queryByRole('button', { name: 'Aprobar' })).toBeNull()
    expect(within(fila).queryByRole('button', { name: 'Autoaprobar…' })).toBeNull()
    expect(within(fila).getByRole('button', { name: 'Cancelar' })).toBeTruthy()
  })

  it('la propia, como dueño: Autoaprobar pide confirmación explícita y la envía', async () => {
    h.sesion = { user_id: 'u-yo', role: 'company_owner' }
    h.solicitudes = [solicitud('s-mia', 'u-yo')]
    render(<AjustesTab companyId="c" projectId="p" />)
    const fila = screen.getByTestId('ajuste-s-mia')
    await act(async () => { fireEvent.click(within(fila).getByRole('button', { name: 'Autoaprobar…' })) })
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.aprobar).toHaveBeenCalledWith({ id: 's-mia', confirmarAutoaprobacion: true })
  })

  it('si el dueño no confirma, no se envía nada', async () => {
    h.sesion = { user_id: 'u-yo', role: 'company_owner' }
    h.confirm.mockResolvedValueOnce({ isConfirmed: false })
    h.solicitudes = [solicitud('s-mia', 'u-yo')]
    render(<AjustesTab companyId="c" projectId="p" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Autoaprobar…' })) })
    expect(h.aprobar).not.toHaveBeenCalled()
  })

  it('una ejecución fallida se informa como tal (nada a medias) y ofrece reintentar', async () => {
    h.aprobar.mockResolvedValueOnce({ solicitud_id: 's', estado: 'fallida', repetida: false, autoaprobada: false, resultado: null, error_ejecucion: 'CARGO_CON_COBROS: …' })
    h.solicitudes = [solicitud('s-otro', 'u-otro')]
    render(<AjustesTab companyId="c" projectId="p" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Aprobar' })) })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', title: 'Aprobada, pero la ejecución falló' }))
    cleanup()
    h.solicitudes = [solicitud('s-f', 'u-otro', { estado: 'fallida', error_ejecucion: 'CARGO_CON_COBROS: …' })]
    render(<AjustesTab companyId="c" projectId="p" />)
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
    expect(screen.getByText('CARGO_CON_COBROS: …')).toBeTruthy()
  })

  it('sin permiso de autorizar no hay botones de aprobación', () => {
    h.puedeAutorizar = false
    h.solicitudes = [solicitud('s-otro', 'u-otro')]
    render(<AjustesTab companyId="c" projectId="p" />)
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull()
  })
})
