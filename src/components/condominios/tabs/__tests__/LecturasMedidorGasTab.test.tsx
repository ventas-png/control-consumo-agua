// Medidores de gas: la nueva lectura se registra en ventana (pantalla completa
// en el teléfono, sin cerrarse a mitad del guardado), la lectura anterior se
// propone con la última de la unidad, y cada lectura abre su detalle en ventana
// —con las observaciones que antes solo eran un tooltip—. La tabla se lee como
// tarjetas en el teléfono.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { LecturaMedidorGas, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: vi.fn(),
  deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))

const { default: LecturasMedidorGasTab } = await import('../LecturasMedidorGasTab')

const unidades = [
  { id: 'u1', nombre: 'Casa 1' },
  { id: 'u2', nombre: 'Casa 2' },
] as unknown as Unidad[]

function lectura(over: Partial<LecturaMedidorGas>): LecturaMedidorGas {
  return {
    id: 'l1', company_id: 'co1', project_id: 'p1', unidad_id: 'u1', area: null,
    fecha: '2026-09-30', lectura_anterior: 100, lectura_actual: 112.5, consumo: 12.5,
    alerta_fuga: false, costo_unitario: 8, costo_total: 100, periodo: '2026-09',
    leido_por: 'Pedro', observaciones: null, created_at: '2026-09-30T10:00:00Z',
    ...over,
  }
}

const lecturas = [
  lectura({ id: 'l1' }),
  lectura({ id: 'l0', fecha: '2026-08-31', lectura_anterior: 90, lectura_actual: 100, consumo: 10, periodo: '2026-08' }),
  lectura({ id: 'l2', unidad_id: 'u2', fecha: '2026-09-29', lectura_actual: 50, lectura_anterior: 40, consumo: 10, alerta_fuga: true, observaciones: 'Olor a gas en la cocina' }),
]

function props(over: Partial<Parameters<typeof LecturasMedidorGasTab>[0]> = {}): Parameters<typeof LecturasMedidorGasTab>[0] {
  return { lecturas, unidades, proyectoId: 'p1', companyId: 'co1', moneda: 'Q', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => { vi.clearAllMocks(); mocks.createCondominioRow.mockResolvedValue({ error: null }) })
afterEach(cleanup)

describe('Medidores de gas — nueva lectura en ventana', () => {
  it('abre a pantalla completa, propone la lectura anterior y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<LecturasMedidorGasTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva lectura' }))
    const ventana = screen.getByRole('dialog', { name: '🔥 Nueva lectura de gas' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    // Al elegir la unidad se propone su última lectura (la del 30/09, no la de agosto).
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'u1' } })
    expect((screen.getByLabelText('Lectura anterior (m³)') as HTMLInputElement).value).toBe('112.5')
    expect(within(ventana).getByText(/Última: 112\.500 m³ \(2026-09-30\)/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Lectura actual (m³) *'), { target: { value: '120.5' } })
    fireEvent.change(screen.getByLabelText('Costo unitario (Q/m³)'), { target: { value: '8' } })
    expect(screen.getByRole('status', { name: 'Consumo calculado' }).textContent).toBe('8.000 m³')

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('lecturas_medidor_gas', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', unidad_id: 'u1',
      lectura_anterior: 112.5, lectura_actual: 120.5, consumo: 8, costo_total: 64,
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🔥 Nueva lectura de gas' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('la lectura anterior escrita a mano no se pisa al cambiar de unidad', () => {
    render(<LecturasMedidorGasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva lectura' }))
    fireEvent.change(screen.getByLabelText('Lectura anterior (m³)'), { target: { value: '99' } })
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'u2' } })
    expect((screen.getByLabelText('Lectura anterior (m³)') as HTMLInputElement).value).toBe('99')
  })

  it('avisa si la lectura actual es menor que la anterior', () => {
    render(<LecturasMedidorGasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva lectura' }))
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Lectura actual (m³) *'), { target: { value: '100' } })
    expect(screen.getByRole('alert').textContent).toMatch(/menor que la anterior/)
  })

  it('sin lectura actual avisa y la ventana sigue abierta', async () => {
    render(<LecturasMedidorGasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva lectura' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('si falla el guardado, avisa y la ventana sigue abierta con lo escrito', async () => {
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    render(<LecturasMedidorGasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva lectura' }))
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: 'u2' } })
    fireEvent.change(screen.getByLabelText('Lectura actual (m³) *'), { target: { value: '55' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Lectura actual (m³) *') as HTMLInputElement).value).toBe('55')
  })

  it('sin permiso de crear no hay botón', () => {
    render(<LecturasMedidorGasTab {...props({ canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva lectura' })).toBeNull()
  })
})

describe('Medidores de gas — lista y detalle', () => {
  it('la tabla se lee como tarjetas con rótulos; «Ver» al pie', () => {
    const { container } = render(<LecturasMedidorGasTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Unidad/Área', 'Período', 'Fecha', 'Lect. ant.', 'Lect. act.', 'Consumo', 'Costo', null])
  })

  it('«Ver» abre el detalle con las observaciones y la alerta de fuga', () => {
    render(<LecturasMedidorGasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver lectura de Casa 2 del 2026-09-29' }))
    const detalle = screen.getByRole('dialog', { name: '🔥 Casa 2' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Olor a gas en la cocina')).toBeTruthy()
    expect(within(detalle).getByText('🚨 Esta lectura se registró con alerta de fuga.')).toBeTruthy()
    expect(within(detalle).getByText('Pedro')).toBeTruthy()
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tocar la fila también abre el detalle', () => {
    const { container } = render(<LecturasMedidorGasTab {...props()} />)
    fireEvent.click(within(container.querySelector('tbody')!).getAllByText('Casa 1')[0])
    expect(screen.getByRole('dialog', { name: '🔥 Casa 1' })).toBeTruthy()
  })
})
