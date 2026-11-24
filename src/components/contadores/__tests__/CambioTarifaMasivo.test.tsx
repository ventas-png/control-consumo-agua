// Cambio masivo de tarifa: desde Contadores se reasigna la tarifa de todos los
// que cumplen el criterio con una sola acción, sin abrirlos uno por uno.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Contador, Tarifa, Unidad } from '../../../types'

const h = vi.hoisted(() => ({ asignarTarifaMasiva: vi.fn(), notify: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1', role: 'admin', company_id: 'co1', name: 'Admin', email: 'admin@x.com' }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../../domain/contadores/mutations', () => ({
  updateContador: vi.fn(), setContadorActivo: vi.fn(), deleteContador: vi.fn(),
  asignarTarifaMasiva: h.asignarTarifaMasiva,
}))
vi.mock('../../../lib/validatedInsert', () => ({ validatedInsert: vi.fn(), validatedInsertMany: vi.fn() }))

const { ContadoresSection } = await import('../ContadoresSection')

const tarifa = (id: string, nombre: string, extra: Partial<Tarifa> = {}) =>
  ({ id, nombre, tipo_agua: 'potable', precio_m3: 9.5, canon_fijo: 0, activa: true, ...extra }) as unknown as Tarifa
const contador = (id: string, tarifa_id: string | null, tipo_agua = 'potable') =>
  ({ id, numero_serie: `MED-${id}`, tipo_agua, lectura_inicial: 0, activo: true, project_id: 'p1', tarifa_id }) as unknown as Contador

const tarifas = [tarifa('t-old', 'Residencial 2026'), tarifa('t-new', 'Residencial 2027'), tarifa('t-off', 'Vieja', { activa: false })]
const contadores = [contador('1', 't-old'), contador('2', 't-old'), contador('3', null), contador('4', 't-new'), contador('5', 't-old', 'rehuso')]

function abrir(onContadorUpdated = vi.fn()) {
  render(
    <ContadoresSection
      contadores={contadores} tarifas={tarifas} unidades={[] as Unidad[]}
      onContadorAdded={() => {}} onContadorUpdated={onContadorUpdated} onContadorDeleted={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar tarifa' }))
  return onContadorUpdated
}

beforeEach(() => { Object.values(h).forEach(m => m.mockReset()) })
afterEach(cleanup)

describe('Cambio masivo de tarifa', () => {
  it('cambia solo los contadores de la tarifa elegida y refleja el resultado en la lista', async () => {
    h.asignarTarifaMasiva.mockResolvedValue({ actualizados: ['1', '2'], error: null })
    const onContadorUpdated = abrir()
    const dialog = await screen.findByRole('dialog', { name: 'Cambiar tarifa a varios contadores' })

    // Las tarifas inactivas no se ofrecen como destino.
    const nueva = within(dialog).getByLabelText('Nueva tarifa *') as HTMLSelectElement
    expect(Array.from(nueva.options).map(o => o.value)).toEqual(['', 't-old', 't-new'])

    fireEvent.change(within(dialog).getByLabelText('Tarifa actual'), { target: { value: 't-old' } })
    fireEvent.change(nueva, { target: { value: 't-new' } })
    expect(within(dialog).getByRole('status').textContent).toContain('2 contadores')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar tarifa a 2' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(h.asignarTarifaMasiva).toHaveBeenCalledWith(['1', '2'], 't-new', { updated_by: 'u1', updated_by_name: 'Admin' })
    expect(onContadorUpdated.mock.calls).toEqual([['1', { tarifa_id: 't-new' }], ['2', { tarifa_id: 't-new' }]])
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }))
  })

  it('"Cualquiera" incluye los que no tienen tarifa y omite los que ya tienen la nueva', async () => {
    h.asignarTarifaMasiva.mockResolvedValue({ actualizados: ['1', '2', '3'], error: null })
    abrir()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nueva tarifa *'), { target: { value: 't-new' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar tarifa a 3' }))
    await waitFor(() => expect(h.asignarTarifaMasiva).toHaveBeenCalled())
    expect(h.asignarTarifaMasiva.mock.calls[0][0]).toEqual(['1', '2', '3'])
  })

  it('si la base falla a medias, avisa cuántos quedaron y deja la ventana abierta', async () => {
    h.asignarTarifaMasiva.mockResolvedValue({ actualizados: ['1'], error: 'timeout' })
    const onContadorUpdated = abrir()
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nueva tarifa *'), { target: { value: 't-new' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cambiar tarifa a 3' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(h.notify.mock.calls[0][0].text).toContain('1 de 3')
    expect(onContadorUpdated).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
