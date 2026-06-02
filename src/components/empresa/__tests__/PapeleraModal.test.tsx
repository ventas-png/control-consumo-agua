import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DialogProvider } from '../../shared/Dialog'
import { PapeleraModal } from '../PapeleraModal'

const mockState: { rows: unknown[]; users: unknown[]; updateError: { message: string } | null } = {
  rows: [], users: [], updateError: null,
}
const updateCalls: Array<{ table: string; payload: unknown; id?: string; ids?: string[] }> = []

vi.mock('../../../lib/supabase', () => {
  function selectChain(table: string) {
    const c: Record<string, unknown> = { _table: table }
    const pass = () => c
    c.select = pass
    c.not = pass
    c.order = pass
    c.range = () => Promise.resolve({ data: mockState.rows, error: null })
    c.eq = pass
    c.in = () => Promise.resolve({ data: mockState.users, error: null })
    return c
  }
  function updateChain(table: string) {
    return {
      eq: (_col: string, val: string) => {
        updateCalls.push({ table, payload: (updateChain as unknown as { lastPayload?: unknown }).lastPayload, id: val })
        return Promise.resolve({ error: mockState.updateError })
      },
      in: (_col: string, vals: string[]) => {
        updateCalls.push({ table, payload: (updateChain as unknown as { lastPayload?: unknown }).lastPayload, ids: vals })
        return Promise.resolve({ error: mockState.updateError })
      },
    }
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: () => selectChain(table),
        update: (payload: unknown) => {
          ;(updateChain as unknown as { lastPayload?: unknown }).lastPayload = payload
          return updateChain(table)
        },
        in: () => Promise.resolve({ data: mockState.users, error: null }),
      }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u-current' } } }),
      },
    },
  }
})

beforeEach(() => {
  cleanup()
  mockState.rows = []
  mockState.users = []
  mockState.updateError = null
  updateCalls.length = 0
})

describe('PapeleraModal', () => {
  it('renderiza header y selector de tabla', async () => {
    render(<DialogProvider><PapeleraModal onClose={() => {}} /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/Papelera — recuperar borrados/)).toBeTruthy())
    expect(screen.getByLabelText(/Seleccionar tabla/)).toBeTruthy()
  })

  it('muestra estado vacio cuando no hay rows', async () => {
    render(<DialogProvider><PapeleraModal onClose={() => {}} /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/Sin registros borrados/)).toBeTruthy())
  })

  it('renderiza row borrada con boton Restaurar', async () => {
    mockState.rows = [{
      id: '11111111-1111-1111-1111-111111111111',
      deleted_at: '2026-06-01T12:00:00Z',
      deleted_by: null,
      monto: 100,
      estado: 'pagado',
    }]
    render(<DialogProvider><PapeleraModal onClose={() => {}} /></DialogProvider>)
    await waitFor(() => expect(screen.getByText(/11111111/)).toBeTruthy())
    expect(screen.getByText('Sistema')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Restaurar/ })).toBeTruthy()
  })

  it('llama onClose al hacer click en X', async () => {
    const onClose = vi.fn()
    render(<DialogProvider><PapeleraModal onClose={onClose} /></DialogProvider>)
    await waitFor(() => expect(screen.getByLabelText('Cerrar modal')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cerrar modal'))
    expect(onClose).toHaveBeenCalled()
  })

  it('expand "Ver fila" muestra el JSON completo de la fila', async () => {
    mockState.rows = [{
      id: '22222222-2222-2222-2222-222222222222',
      deleted_at: '2026-06-01T12:00:00Z',
      deleted_by: null,
      monto: 150,
      concepto: 'mantenimiento',
    }]
    render(<DialogProvider><PapeleraModal onClose={() => {}} /></DialogProvider>)
    const verFila = await screen.findByRole('button', { name: /Ver fila/ })
    fireEvent.click(verFila)
    expect(screen.getByRole('button', { name: /Ocultar/ })).toBeTruthy()
    const detail = document.getElementById('row-detail-22222222-2222-2222-2222-222222222222')
    expect(detail?.textContent).toContain('mantenimiento')
    expect(detail?.textContent).toContain('150')
  })

  it('restaurar dispara update con deleted_at=null tras confirmar', async () => {
    mockState.rows = [{
      id: '33333333-3333-3333-3333-333333333333',
      deleted_at: '2026-06-01T12:00:00Z',
      deleted_by: null,
    }]
    render(<DialogProvider><PapeleraModal onClose={() => {}} defaultTable="pagos" /></DialogProvider>)
    const restaurarBtn = await screen.findByRole('button', { name: /Restaurar/ })
    fireEvent.click(restaurarBtn)
    await waitFor(() => expect(screen.getByText(/¿Restaurar este registro\?/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }))
    await waitFor(() => expect(updateCalls.length).toBeGreaterThan(0))
    const call = updateCalls[updateCalls.length - 1]
    expect(call.table).toBe('pagos')
    expect(call.id).toBe('33333333-3333-3333-3333-333333333333')
    expect((call.payload as { deleted_at: string | null; deleted_by: string | null }).deleted_at).toBeNull()
    expect((call.payload as { deleted_at: string | null; deleted_by: string | null }).deleted_by).toBeNull()
  })

  it('seleccionar checkbox de fila muestra SelectionToolbar con count', async () => {
    mockState.rows = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', deleted_at: '2026-06-01T12:00:00Z', deleted_by: null },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', deleted_at: '2026-06-01T13:00:00Z', deleted_by: null },
    ]
    render(<DialogProvider><PapeleraModal onClose={() => {}} /></DialogProvider>)
    const checkboxes = await screen.findAllByRole('checkbox')
    // [0] master, [1] fila1, [2] fila2
    fireEvent.click(checkboxes[1])
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy())
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar.getAttribute('aria-label')).toContain('1 registro seleccionado')
  })

  it('bulk restore dispara update.in con todos los ids seleccionados', async () => {
    mockState.rows = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', deleted_at: '2026-06-01T12:00:00Z', deleted_by: null },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', deleted_at: '2026-06-01T13:00:00Z', deleted_by: null },
    ]
    render(<DialogProvider><PapeleraModal onClose={() => {}} defaultTable="pagos" /></DialogProvider>)
    const checkboxes = await screen.findAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // master → select all
    await waitFor(() => expect(screen.getByRole('toolbar').getAttribute('aria-label')).toContain('2 registros'))

    // El toolbar tiene action "Restaurar" con icono ↩
    const toolbarRestoreBtn = screen.getAllByRole('button', { name: 'Restaurar' })[0]
    fireEvent.click(toolbarRestoreBtn)

    await waitFor(() => expect(screen.getByText(/¿Restaurar 2 registros\?/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar todos' }))

    await waitFor(() => expect(updateCalls.some(c => c.ids)).toBe(true))
    const bulkCall = updateCalls.find(c => c.ids)!
    expect(bulkCall.table).toBe('pagos')
    expect(bulkCall.ids).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ])
  })

  it('botón "Limpiar selección" vacía el toolbar', async () => {
    mockState.rows = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', deleted_at: '2026-06-01T12:00:00Z', deleted_by: null },
    ]
    render(<DialogProvider><PapeleraModal onClose={() => {}} /></DialogProvider>)
    const checkboxes = await screen.findAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }))
    await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull())
  })
})
