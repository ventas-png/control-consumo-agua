// Piscina: el nuevo registro se hace en ventana (pantalla completa en el
// teléfono, sin cerrarse a mitad del guardado), el pH y el cloro dicen en
// palabras si están fuera de rango, y cada registro —desde el historial o
// desde la tarjeta de su piscina— abre su detalle en ventana. Abrir/cerrar
// avisa si falla (antes no hacía nada).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ControlPiscina } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))

const { default: ControlPiscinaTab } = await import('../ControlPiscinaTab')

function registro(over: Partial<ControlPiscina>): ControlPiscina {
  return {
    id: 'p1', company_id: 'co1', project_id: 'pr1', fecha: '2026-10-20', hora: '08:30:00', piscina: 'Principal',
    ph: 7.4, cloro: 1.5, temperatura: 27, turbiedad: 'cristalina', estado: 'abierta',
    num_usuarios: 4, registrado_por: 'Pedro', observaciones: null, created_at: '2026-10-20T14:30:00Z',
    ...over,
  }
}

const registros = [
  registro({ id: 'p1' }),
  registro({ id: 'p0', fecha: '2026-10-19', ph: 8.6, cloro: 0.3, estado: 'cerrada_quimica', observaciones: 'Se agregó ácido muriático.' }),
  registro({ id: 'i1', piscina: 'Infantil', fecha: '2026-10-20', hora: '09:00:00', ph: 7.9, estado: 'cerrada_mantenimiento' }),
]

function props(over: Partial<Parameters<typeof ControlPiscinaTab>[0]> = {}): Parameters<typeof ControlPiscinaTab>[0] {
  return { registros, proyectoId: 'pr1', companyId: 'co1', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Piscina — nuevo registro en ventana', () => {
  it('abre a pantalla completa y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<ControlPiscinaTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog', { name: '🏊 Nuevo registro de piscina' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Piscina'), { target: { value: 'Infantil' } })
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '7.5' } })
    fireEvent.change(screen.getByLabelText('Cloro (ppm)'), { target: { value: '1.2' } })
    fireEvent.change(screen.getByLabelText('N° usuarios en piscina'), { target: { value: '6' } })

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({
      company_id: 'co1', project_id: 'pr1', piscina: 'Infantil', ph: 7.5, cloro: 1.2, num_usuarios: 6,
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🏊 Nuevo registro de piscina' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el pH y el cloro dicen en palabras si están fuera de rango', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog')
    expect(within(ventana).getByText('Ideal 7.2–7.8')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '8.5' } })
    expect(within(ventana).getByText('Fuera de rango (ideal 7.2–7.8)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cloro (ppm)'), { target: { value: '3.5' } })
    expect(within(ventana).getByText('Revisar: cerca del límite (ideal 0.5–3)')).toBeTruthy()
  })

  it('un pH imposible (72 por 7.2) no se envía', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '72' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await new Promise(r => setTimeout(r, 0))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('sin nombre de piscina avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('Piscina'), { target: { value: '  ' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Piscina'), { target: { value: 'Sur' } })
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'Hojas en el skimmer' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Observaciones') as HTMLTextAreaElement).value).toBe('Hojas en el skimmer')
  })

  it('sin permiso de crear no hay botón; sin editar no hay Abrir/Cerrar', () => {
    render(<ControlPiscinaTab {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo registro' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Abrir|Cerrar) .* registro del/ })).toBeNull()
  })
})

describe('Piscina — historial y detalle', () => {
  it('el historial se lee como tarjetas con rótulos; acciones al pie', () => {
    const { container } = render(<ControlPiscinaTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Piscina', 'Fecha', 'pH', 'Cloro', '°C', 'Turbiedad', 'Estado', null])
  })

  it('«Ver» abre el detalle con el rango en palabras y las observaciones', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-19 08:30' }))
    const detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Se agregó ácido muriático.')).toBeTruthy()
    expect(within(detalle).getByText('Fuera de rango · ideal 7.2–7.8')).toBeTruthy() // pH 8.6
    expect(within(detalle).getByText('Revisar: cerca del límite · ideal 0.5–3')).toBeTruthy() // cloro 0.3
    expect(within(detalle).getByText('Pedro')).toBeTruthy()
  })

  it('la tarjeta de una piscina abre su último registro', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver último registro de Principal: Abierta' }))
    const detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(within(detalle).getByText('2026-10-20 · 08:30')).toBeTruthy()
  })

  it('cerrar por mantenimiento desde el detalle; si falla, avisa', async () => {
    const onRefresh = vi.fn()
    render(<ControlPiscinaTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-20 08:30' }))
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '🔧 Cerrar por mantenimiento' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_piscina', 'p1', { estado: 'cerrada_mantenimiento' })
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '🔧 Cerrar por mantenimiento' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('«Abrir» en la fila no abre el detalle', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Infantil (registro del 2026-10-20)' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_piscina', 'i1', { estado: 'abierta' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
