// Generador: el nuevo registro se hace en ventana (pantalla completa en el
// teléfono, sin cerrarse a mitad del guardado) con la última lectura del
// horómetro a la vista y aviso si la nueva es menor; cada registro —desde el
// historial o la tarjeta de su generador— abre su detalle en ventana; y la
// tarjeta muestra el próximo mantenimiento aunque el último registro no lo
// traiga.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ControlGenerador } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  legado: [] as unknown[],
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: vi.fn(),
  deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
// La empresa de servicio sale del catálogo compartido (consultas de react-query, aquí fijas).
vi.mock('../../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [
      { id: 'prov1', company_id: 'co1', nombre: 'Aguas GT', nit: '1234567-8', rfc: null, pais: 'GT', codigo: 'PRV-00001', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
      { id: 'prov2', company_id: 'co1', nombre: 'Jardines El Roble', nit: '7654321-0', rfc: null, pais: 'GT', codigo: 'PRV-00002', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../../../domain/proveedores/queries', () => ({
  useAsignacionesQuery: () => ({ data: [], isLoading: false }),
  useOperacionesLegadoQuery: () => ({ data: mocks.legado, isLoading: false }),
}))
vi.mock('../../../../domain/proveedores/mutations', () => ({
  useVincularOperacionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const { default: ControlGeneradorTab } = await import('../ControlGeneradorTab')

function registro(over: Partial<ControlGenerador>): ControlGenerador {
  return {
    id: 'g1', company_id: 'co1', project_id: 'p1', generador: 'Generador principal', fecha: '2026-10-20', tipo: 'lectura',
    nivel_combustible_pct: 80, horas_operacion: 1.5, horas_acumuladas: 1250.5, estado: 'standby', voltaje: 220, frecuencia: 60,
    operador: 'Mario Gómez', empresa_servicio: null, costo: null, proximo_mantenimiento: null, observaciones: null,
    created_at: '2026-10-20T14:00:00Z',
    ...over,
  }
}

const registros = [
  // El mismo día, capturado antes: no es el «último» aunque llegue primero.
  registro({ id: 'g0', horas_acumuladas: 1249, nivel_combustible_pct: 82, created_at: '2026-10-20T08:00:00Z' }),
  registro({ id: 'g1' }),
  // Un mantenimiento anterior dejó programado el próximo; la lectura posterior no trae fecha.
  registro({ id: 'm1', tipo: 'mantenimiento', fecha: '2026-09-15', horas_acumuladas: null, empresa_servicio: 'Energía GT', costo: 3500,
    proximo_mantenimiento: '2099-03-15', created_at: '2026-09-15T10:00:00Z' }),
  registro({ id: 'f1', generador: 'Generador torre B', tipo: 'falla', estado: 'falla', fecha: '2026-10-18', nivel_combustible_pct: 12,
    horas_acumuladas: 300, observaciones: 'No arrancó en la prueba semanal.', created_at: '2026-10-18T09:00:00Z' }),
]

function props(over: Partial<Parameters<typeof ControlGeneradorTab>[0]> = {}): Parameters<typeof ControlGeneradorTab>[0] {
  return { registros, proyectoId: 'p1', companyId: 'co1', moneda: 'Q', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Generador — nuevo registro en ventana', () => {
  it('abre a pantalla completa, muestra la última lectura del horómetro y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<ControlGeneradorTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog', { name: '⚡ Nuevo registro de generador' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    // La del último registro (14:00), no la de la mañana.
    expect(within(ventana).getByText('Última: 1250.5 h (2026-10-20)')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Horas acumuladas'), { target: { value: '1260.25' } })
    fireEvent.change(screen.getByLabelText('Nivel de combustible (%)'), { target: { value: '75.5' } })

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_generador', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', generador: 'Generador principal', horas_acumuladas: 1260.25, nivel_combustible_pct: 75.5,
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '⚡ Nuevo registro de generador' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()

    // Las horas acumuladas no se arrastran al siguiente registro.
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    expect((screen.getByLabelText('Horas acumuladas') as HTMLInputElement).value).toBe('')
  })

  it('avisa si el horómetro retrocede y si el combustible está bajo', () => {
    render(<ControlGeneradorTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('Horas acumuladas'), { target: { value: '1200' } })
    expect(screen.getByRole('alert').textContent).toMatch(/menor que la última lectura del horómetro/)
    fireEvent.change(screen.getByLabelText('Nivel de combustible (%)'), { target: { value: '20' } })
    expect(within(screen.getByRole('dialog')).getByText('Combustible bajo (menos de 25%)')).toBeTruthy()
  })

  it('sin nombre avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<ControlGeneradorTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('Generador'), { target: { value: ' ' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Generador'), { target: { value: 'Generador principal' } })
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'Ruido en el escape' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Observaciones') as HTMLTextAreaElement).value).toBe('Ruido en el escape')
  })

  it('sin permiso de crear no hay botón', () => {
    render(<ControlGeneradorTab {...props({ canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo registro' })).toBeNull()
  })
})

describe('Generador — historial y detalle', () => {
  it('el historial se lee como tarjetas con rótulos', () => {
    const { container } = render(<ControlGeneradorTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Generador', 'Tipo', 'Fecha', 'Combustible', 'Horas', 'Voltaje', 'Estado', null])
  })

  it('la tarjeta abre el último registro y muestra el próximo mantenimiento aunque el último no lo traiga', () => {
    render(<ControlGeneradorTab {...props()} />)
    const tarjeta = screen.getByRole('button', { name: 'Ver último registro de Generador principal: Standby' })
    expect(within(tarjeta).getByText('🔧 Manto: 2099-03-15')).toBeTruthy()
    fireEvent.click(tarjeta)
    const detalle = screen.getByRole('dialog', { name: '⚡ Generador principal' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('1250.5 h')).toBeTruthy()
  })

  it('«Ver» abre el detalle con observaciones y combustible bajo en palabras', () => {
    render(<ControlGeneradorTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Generador torre B del 2026-10-18' }))
    const detalle = screen.getByRole('dialog', { name: '⚡ Generador torre B' })
    expect(within(detalle).getByText('No arrancó en la prueba semanal.')).toBeTruthy()
    expect(within(detalle).getByText('Combustible bajo')).toBeTruthy()
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tocar la fila abre el detalle con el costo en formato regional', () => {
    const { container } = render(<ControlGeneradorTab {...props()} />)
    fireEvent.click(within(container.querySelector('tbody')!).getByText('🔧 Mantenimiento'))
    const detalle = screen.getByRole('dialog', { name: '⚡ Generador principal' })
    expect(within(detalle).getByText('Q 3,500.00')).toBeTruthy()
    expect(within(detalle).getByText('Energía GT')).toBeTruthy()
  })
})
