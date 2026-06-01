import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { FinancialAuditModal } from '../FinancialAuditModal'

// Mock state que cada test puede mutar antes de render(). El mock siempre
// lee mockState al momento de la llamada, no al setup.
const mockState: { auditRows: unknown[]; appUsers: unknown[] } = {
  auditRows: [],
  appUsers: [],
}

vi.mock('../../../lib/supabase', () => {
  function auditChain() {
    const c: Record<string, unknown> = {}
    const passthrough = () => c
    c.select = passthrough
    c.order = passthrough
    c.eq = passthrough
    c.gte = passthrough
    c.lte = passthrough
    c.range = () => Promise.resolve({ data: mockState.auditRows, error: null })
    return c
  }
  function usersChain() {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.in = () => Promise.resolve({ data: mockState.appUsers, error: null })
    return c
  }
  return {
    supabase: {
      from: (tableName: string) => tableName === 'audit_log' ? auditChain() : usersChain(),
    },
  }
})

beforeEach(() => {
  cleanup()
  mockState.auditRows = []
  mockState.appUsers = []
})

describe('FinancialAuditModal', () => {
  it('renderiza el header y los 4 filtros (tabla, accion, desde, hasta)', async () => {
    render(<FinancialAuditModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Trazabilidad financiera y de mantenimiento')).toBeTruthy())
    expect(screen.getByText('Tabla')).toBeTruthy()
    expect(screen.getByText('Acción')).toBeTruthy()
    expect(screen.getByText('Desde')).toBeTruthy()
    expect(screen.getByText('Hasta')).toBeTruthy()
  })

  it('muestra estado vacio cuando no hay rows', async () => {
    render(<FinancialAuditModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Sin eventos en el log.')).toBeTruthy())
  })

  it('renderiza fila con table_name, action y fecha', async () => {
    mockState.auditRows = [{
      id: 1,
      table_name: 'pagos',
      record_id: '11111111-1111-1111-1111-111111111111',
      action: 'INSERT',
      actor_id: null,
      before: null,
      after: { monto: 100, estado: 'pagado' },
      project_id: null,
      occurred_at: '2026-06-01T12:00:00Z',
    }]
    render(<FinancialAuditModal onClose={() => {}} />)
    // "Pagos" aparece tanto en el filtro como en la row → buscamos por el record_id
    // (unico) para asegurar que la row se rendereo.
    await waitFor(() => expect(screen.getByText(/11111111/)).toBeTruthy())
    expect(screen.getByText('Sistema')).toBeTruthy() // actor_id null -> Sistema
    // El badge "Creó" debe existir (puede haber 2: en filtro select + en row badge)
    expect(screen.getAllByText('Creó').length).toBeGreaterThanOrEqual(1)
  })

  it('al click "Ver diff" expande la fila y muestra JSON antes/despues', async () => {
    mockState.auditRows = [{
      id: 42,
      table_name: 'cuotas_condominio',
      record_id: null,
      action: 'UPDATE',
      actor_id: null,
      before: { estado: 'pendiente' },
      after:  { estado: 'pagado' },
      project_id: null,
      occurred_at: '2026-06-01T12:00:00Z',
    }]
    render(<FinancialAuditModal onClose={() => {}} />)
    const verDiff = await screen.findByRole('button', { name: 'Ver diff' })
    fireEvent.click(verDiff)
    expect(screen.getByText('Antes')).toBeTruthy()
    expect(screen.getByText('Después')).toBeTruthy()
    // El JSON.stringify renderiza con quotes — usamos textContent check via custom matcher
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeTruthy()
    // Verificar contenido JSON via búsqueda en el DOM
    const detailRow = document.getElementById('audit-detail-42')
    expect(detailRow?.textContent).toContain('pendiente')
    expect(detailRow?.textContent).toContain('pagado')
  })

  it('llama onClose al hacer click en el boton X', async () => {
    const onClose = vi.fn()
    render(<FinancialAuditModal onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Trazabilidad financiera y de mantenimiento')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('boton "Limpiar" aparece solo cuando hay filtros activos', async () => {
    render(<FinancialAuditModal onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Tabla')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Limpiar' })).toBeNull()
    const tableSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(tableSelect, { target: { value: 'pagos' } })
    expect(screen.getByRole('button', { name: 'Limpiar' })).toBeTruthy()
  })
})
