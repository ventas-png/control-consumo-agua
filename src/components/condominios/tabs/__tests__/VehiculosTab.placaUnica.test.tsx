// idx_vehiculos_placa_unica (20261031000500) también se aplica al staff: si la
// base rechaza el alta por placa duplicada, el panel lo dice con palabras y no
// con el texto crudo de Postgres. Cualquier otro error se muestra tal cual.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import type { Unidad } from '../../../../types'

const h = vi.hoisted(() => ({
  createCondominioRow: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn() }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../../domain/condominios/padronAutorizacion', () => ({ asignarTagVehiculo: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: h.createCondominioRow,
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
}))

const { VehiculosTab } = await import('../VehiculosTab')
const { I18nProvider } = await import('../../../../lib/i18n')

const unidades = [{ id: 'u1', nombre: 'Apto 1D', activo: true }] as unknown as Unidad[]

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

async function altaConError(error: { message: string; code?: string }) {
  h.createCondominioRow.mockResolvedValueOnce({ error })
  render(
    <I18nProvider>
      <VehiculosTab vehiculos={[]} unidades={unidades} proyectoId="p1" companyId="c1" canCreate canEdit onRefresh={() => {}} />
    </I18nProvider>,
  )
  fireEvent.click(screen.getAllByRole('button').find(b => /\+/.test(b.textContent ?? ''))!)
  // El formulario abre en ventana: se busca dentro de ella, no entre los filtros de la tabla.
  const ventana = within(screen.getByRole('dialog'))
  const [unidad] = ventana.getAllByRole('combobox')
  fireEvent.change(unidad, { target: { value: 'u1' } })
  fireEvent.change(ventana.getByPlaceholderText(/ABC|placa/i), { target: { value: 'p-777aaa' } })
  const guardar = ventana.getAllByRole('button').find(b => b.textContent === 'Guardar' || /guardar|save/i.test(b.textContent ?? ''))!
  await act(async () => { fireEvent.click(guardar) })
}

describe('VehiculosTab — placa duplicada', () => {
  it('traduce la violación del índice de placa a un mensaje legible', async () => {
    await altaConError({ code: '23505', message: 'duplicate key value violates unique constraint "idx_vehiculos_placa_unica"' })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error',
      text: 'La placa P-777AAA ya está registrada o en revisión en el condominio.',
    }))
  })

  it('cualquier otro error se muestra sin traducir', async () => {
    await altaConError({ code: '42501', message: 'new row violates row-level security policy' })
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'new row violates row-level security policy' }))
  })
})
