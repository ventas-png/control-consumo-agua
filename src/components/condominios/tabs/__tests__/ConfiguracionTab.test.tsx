import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ConfiguracionCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { ConfiguracionTab } = await import('../ConfiguracionTab')

function renderTab(configuracion: ConfiguracionCondominio[] = [], canEdit = true) {
  return render(<ConfiguracionTab configuracion={configuracion} proyectoId="p1" companyId="co1" canEdit={canEdit} onRefresh={() => {}} />)
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('ConfiguracionTab — base de votación de las asambleas', () => {
  it('sin configurar se lee «por unidad»; elegir alícuota la guarda con el valor que acepta la base', async () => {
    renderTab()
    const base = screen.getByLabelText('Base de votación') as HTMLSelectElement
    expect(base.value).toBe('unidad')
    expect(screen.getByText(/Cada asamblea la fija al abrirse/)).toBeTruthy()

    fireEvent.change(base, { target: { value: 'alicuota' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar$/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('configuracion_condominio', {
      company_id: 'co1', project_id: 'p1', clave: 'asambleas_base_votacion', valor: 'alicuota', tipo: 'texto',
    }))
  })

  it('ya configurada, la cambia sobre su fila', async () => {
    renderTab([{ id: 'c1', clave: 'asambleas_base_votacion', valor: 'alicuota' } as ConfiguracionCondominio])
    const base = screen.getByLabelText('Base de votación') as HTMLSelectElement
    expect(base.value).toBe('alicuota')
    fireEvent.change(base, { target: { value: 'unidad' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar$/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('configuracion_condominio', 'c1',
      expect.objectContaining({ valor: 'unidad' })))
  })

  it('sin permiso de edición no se cambia', () => {
    renderTab([], false)
    expect((screen.getByLabelText('Base de votación') as HTMLSelectElement).disabled).toBe(true)
  })
})
