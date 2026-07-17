import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DialogProvider } from '../../shared/Dialog'
import { PromptDialogRoot } from '../../shared/PromptDialog'
import { SavedReportsModal } from '../SavedReportsModal'

const mockState: { templates: unknown[]; rows: unknown[] } = { templates: [], rows: [] }
const insertCalls: Array<{ table: string; payload: unknown }> = []
const deleteCalls: Array<{ table: string; id: string }> = []

vi.mock('../../../lib/supabase', () => {
  // Chain proxy: cada metodo retorna el mismo objeto + es await-able (then).
  // Asi cualquier combinacion .select().eq().is().order().eq()... resuelve al mismo data.
  function makeChain(table: string) {
    const result = { data: table === 'report_templates' ? mockState.templates : mockState.rows, error: null }
    const obj: Record<string, unknown> = {}
    const pass = () => obj
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'gte', 'lte', 'not', 'neq', 'range']) obj[m] = pass
    obj.then = (resolve: (v: typeof result) => unknown) => resolve(result)
    obj.maybeSingle = () => Promise.resolve(result)
    obj.single = () => Promise.resolve(result)
    return obj
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: () => makeChain(table),
        insert: (payload: unknown) => {
          insertCalls.push({ table, payload })
          return Promise.resolve({ error: null })
        },
        delete: () => ({
          eq: (_col: string, id: string) => {
            deleteCalls.push({ table, id })
            return Promise.resolve({ error: null })
          },
        }),
      }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-test' } } }) },
    },
  }
})

vi.mock('../../../lib/exportData', () => ({
  exportData: vi.fn().mockResolvedValue(undefined),
}))

beforeEach(() => {
  cleanup()
  mockState.templates = []
  mockState.rows = []
  insertCalls.length = 0
  deleteCalls.length = 0
})

function renderModal(props?: { companyId?: string }) {
  return render(
    <DialogProvider>
      <PromptDialogRoot />
      <SavedReportsModal onClose={() => {}} companyId={props?.companyId ?? 'c1'} />
    </DialogProvider>
  )
}

describe('SavedReportsModal', () => {
  it('renderiza header y botón "Nuevo reporte"', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByText(/Reportes guardados/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Nuevo reporte/ })).toBeTruthy()
  })

  it('estado vacio cuando no hay templates', async () => {
    renderModal()
    await waitFor(() => expect(screen.getByText('Sin reportes guardados')).toBeTruthy())
  })

  it('renderiza lista de templates con badges', async () => {
    mockState.templates = [{
      id: 't1', company_id: 'c1', project_id: null,
      name: 'Cuotas pendientes', description: 'Filtro mensual',
      source_table: 'cuotas_condominio',
      columns: [{ header: 'Periodo', accessor: 'periodo' }],
      filters: { estado: 'pendiente' },
      schedule_kind: 'manual', recipients: [], default_format: 'xlsx',
      created_by: null, created_at: '2026-06-02T12:00:00Z',
    }]
    renderModal()
    await waitFor(() => expect(screen.getByText('Cuotas pendientes')).toBeTruthy())
    expect(screen.getByText('Filtro mensual')).toBeTruthy()
    expect(screen.getByText('Cuotas de condominio')).toBeTruthy()
    expect(screen.getByText('XLSX')).toBeTruthy()
  })

  it('badge de schedule cuando schedule_kind != manual', async () => {
    mockState.templates = [{
      id: 't1', company_id: 'c1', project_id: null,
      name: 'Reporte mensual', description: null,
      source_table: 'pagos',
      columns: [{ header: 'Monto', accessor: 'monto' }],
      filters: {},
      schedule_kind: 'monthly_day1', recipients: ['a@b.com'], default_format: 'pdf',
      created_by: null, created_at: '2026-06-02T12:00:00Z',
    }]
    renderModal()
    await waitFor(() => expect(screen.getByText(/Mensual \(día 1\)/)).toBeTruthy())
  })

  it('botón Ejecutar dispara INSERT en report_runs', async () => {
    mockState.templates = [{
      id: 't1', company_id: 'c1', project_id: null,
      name: 'X', description: null,
      source_table: 'pagos',
      columns: [{ header: 'Monto', accessor: 'monto' }],
      filters: {},
      schedule_kind: 'manual', recipients: [], default_format: 'csv',
      created_by: null, created_at: '2026-06-02T12:00:00Z',
    }]
    mockState.rows = [{ id: 'r1', monto: 100 }, { id: 'r2', monto: 200 }]
    renderModal()
    const runBtn = await screen.findByRole('button', { name: /Ejecutar/ })
    fireEvent.click(runBtn)
    await waitFor(() => {
      const runInsert = insertCalls.find(c => c.table === 'report_runs')
      expect(runInsert).toBeTruthy()
      const payload = runInsert!.payload as { template_id: string; status: string; rows_count: number; format: string }
      expect(payload.template_id).toBe('t1')
      expect(payload.status).toBe('success')
      expect(payload.rows_count).toBe(2)
      expect(payload.format).toBe('csv')
    })
  })

  it('llama onClose al hacer click en X', async () => {
    const onClose = vi.fn()
    render(
      <DialogProvider>
        <SavedReportsModal onClose={onClose} companyId="c1" />
      </DialogProvider>
    )
    await waitFor(() => expect(screen.getByLabelText('Cerrar')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalled()
  })
})
