// Cisternas: el nuevo registro se hace en ventana (pantalla completa en el
// teléfono, sin cerrarse a mitad del guardado), el cloro y el pH dicen en
// palabras si están fuera de rango, y cada registro —desde el historial, la
// tarjeta de su cisterna o su próxima revisión— abre su detalle en ventana.
// Normalizar avisa si falla (antes no hacía nada) y las próximas revisiones
// son la última de cada cisterna, con las vencidas marcadas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { MantenimientoCisterna } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  legado: [] as unknown[],
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
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

const { default: MantenimientoCisternaTab } = await import('../MantenimientoCisternaTab')

function registro(over: Partial<MantenimientoCisterna>): MantenimientoCisterna {
  return {
    id: 'c1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-20', cisterna: 'Cisterna principal', tipo: 'lectura',
    nivel_agua_pct: 72.5, cloro_residual: 0.5, ph: 7.2, estado: 'normal', empresa_servicio: 'Aguas GT', tecnico: 'Ana López',
    costo: 850, proxima_revision: null, observaciones: null, created_at: '2026-10-20T14:00:00Z',
    ...over,
  }
}

const registros = [
  // El mismo día, capturado antes: no es el «último» aunque llegue primero.
  registro({ id: 'c0', nivel_agua_pct: 40, created_at: '2026-10-20T08:00:00Z' }),
  registro({ id: 'c1' }),
  registro({ id: 'b1', cisterna: 'Cisterna Ala B', fecha: '2026-10-19', nivel_agua_pct: 22, cloro_residual: 1.8, ph: 9.1,
    estado: 'bajo_nivel', observaciones: 'Bomba de llenado intermitente.' }),
  // Revisiones: una vencida (Ala B) y, para la principal, una vieja superada y una futura.
  registro({ id: 'r1', cisterna: 'Cisterna Ala B', tipo: 'limpieza', fecha: '2025-03-01', proxima_revision: '2025-09-01', created_at: '2025-03-01T10:00:00Z' }),
  registro({ id: 'r2', tipo: 'limpieza', fecha: '2025-01-10', proxima_revision: '2025-07-10', created_at: '2025-01-10T10:00:00Z' }),
  registro({ id: 'r3', tipo: 'limpieza', fecha: '2026-07-10', proxima_revision: '2099-01-10', created_at: '2026-07-10T10:00:00Z' }),
]

function props(over: Partial<Parameters<typeof MantenimientoCisternaTab>[0]> = {}): Parameters<typeof MantenimientoCisternaTab>[0] {
  return { registros, proyectoId: 'p1', companyId: 'co1', moneda: 'Q', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.legado = []
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Cisternas — nuevo registro en ventana', () => {
  it('abre a pantalla completa y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<MantenimientoCisternaTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog', { name: '🏗️ Nuevo registro de cisterna' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Cisterna'), { target: { value: 'Cisterna Ala B' } })
    fireEvent.change(screen.getByLabelText('Nivel de agua (%)'), { target: { value: '55.25' } })
    fireEvent.change(screen.getByLabelText('Cloro residual (ppm)'), { target: { value: '0.125' } })
    // La empresa de servicio se ELIGE del catálogo de proveedores (no se escribe).
    const empresa = screen.getByLabelText('Empresa de servicio')
    expect(empresa.getAttribute('role')).toBe('combobox')
    fireEvent.focus(empresa)
    fireEvent.change(empresa, { target: { value: 'aguas' } })
    const opciones = within(screen.getByRole('listbox')).getAllByRole('option')   // las del selector, no las de los <select>
    expect(opciones).toHaveLength(1)
    fireEvent.mouseDown(opciones[0])
    expect(within(ventana).getByTestId('proveedor-seleccionado').textContent).toContain('Aguas GT')

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('mantenimiento_cisterna', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', cisterna: 'Cisterna Ala B', nivel_agua_pct: 55.25, cloro_residual: 0.125,
      proveedor_id: 'prov1', empresa_servicio: 'Aguas GT',
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🏗️ Nuevo registro de cisterna' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el cloro, el pH y el nivel dicen en palabras si están fuera de rango; un pH imposible no se envía', async () => {
    render(<MantenimientoCisternaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog')
    expect(within(ventana).getByText('Ideal 0.2–1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cloro residual (ppm)'), { target: { value: '1.5' } })
    expect(within(ventana).getByText('Fuera de rango (ideal 0.2–1)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Nivel de agua (%)'), { target: { value: '20' } })
    expect(within(ventana).getByText('Nivel bajo (menos de 30%)')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '75' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await new Promise(r => setTimeout(r, 0))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('sin nombre avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<MantenimientoCisternaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('Cisterna'), { target: { value: ' ' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Cisterna'), { target: { value: 'Cisterna principal' } })
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'Tapa sin candado' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Observaciones') as HTMLTextAreaElement).value).toBe('Tapa sin candado')
  })

  it('sin empresa elegida el registro va sin vínculo al catálogo', async () => {
    render(<MantenimientoCisternaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog', { name: '🏗️ Nuevo registro de cisterna' })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('mantenimiento_cisterna', expect.objectContaining({ proveedor_id: null, empresa_servicio: null }))
  })

  it('los registros históricos con empresa solo en texto se listan para vincularlos uno a uno', () => {
    mocks.legado = [
      { tabla: 'mantenimiento_cisterna', registro_id: 'c1', project_id: 'p1', texto: 'Aguas GT', clasificacion: 'inequivoca',
        candidatos: [{ id: 'prov1', codigo: 'PRV-00001', nombre: 'Aguas GT', estado: 'autorizado' }] },
      { tabla: 'control_generador', registro_id: 'g1', project_id: 'p1', texto: 'Energía GT', clasificacion: 'sin_coincidencia', candidatos: [] },
    ]
    render(<MantenimientoCisternaTab {...props()} />)
    const panel = screen.getByTestId('operaciones-legado')
    expect(panel.textContent).toContain('Registros con proveedor solo en texto (1)')
    expect(panel.textContent).toContain('«Aguas GT»')
    expect(panel.textContent).not.toContain('Energía GT')   // es del generador, no de cisternas
    expect(within(panel).getByRole('button', { name: 'Vincular' })).toBeTruthy()
    // En el detalle, lo no vinculado se dice.
    fireEvent.click(screen.getAllByRole('button', { name: /^Ver registro/ })[0])
    expect(screen.getByRole('dialog').textContent).toContain('(sin vincular al catálogo)')
  })

  it('sin permiso de crear no hay botón; sin editar no hay Normalizar', () => {
    render(<MantenimientoCisternaTab {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo registro' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Normalizar/ })).toBeNull()
  })
})

describe('Cisternas — historial, detalle y revisiones', () => {
  it('el historial se lee como tarjetas con rótulos; cloro y pH fuera de rango con aviso accesible', () => {
    const { container } = render(<MantenimientoCisternaTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Cisterna', 'Tipo', 'Fecha', 'Nivel', 'Cloro', 'pH', 'Estado', null])
    expect(within(tabla).getAllByRole('img', { name: 'Fuera de rango' }).length).toBe(2) // cloro 1.8 y pH 9.1 de Ala B
  })

  it('la tarjeta de una cisterna abre su último registro (el mismo día, el capturado después)', () => {
    render(<MantenimientoCisternaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver último registro de Cisterna principal: Normal' }))
    const detalle = screen.getByRole('dialog', { name: '🏗️ Cisterna principal' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('72.5%')).toBeTruthy()
    expect(within(detalle).getByText('Q 850.00')).toBeTruthy()
  })

  it('las próximas revisiones son la última de cada cisterna; la vencida se marca y abre su registro', () => {
    render(<MantenimientoCisternaTab {...props()} />)
    const botones = screen.getAllByRole('button', { name: /^🏗️ Cisterna .* · \d{4}-/ })
    expect(botones.map(b => b.textContent)).toEqual([
      '🏗️ Cisterna Ala B · 2025-09-01 · vencida',
      '🏗️ Cisterna principal · 2099-01-10',
    ])
    fireEvent.click(botones[0])
    expect(screen.getByRole('dialog', { name: '🏗️ Cisterna Ala B' })).toBeTruthy()
  })

  it('normalizar desde el detalle; si falla, avisa y luego refresca', async () => {
    const onRefresh = vi.fn()
    render(<MantenimientoCisternaTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Cisterna Ala B del 2026-10-19' }))
    const detalle = screen.getByRole('dialog', { name: '🏗️ Cisterna Ala B' })
    expect(within(detalle).getByText('Bomba de llenado intermitente.')).toBeTruthy()
    expect(within(detalle).getByText('Nivel bajo')).toBeTruthy()

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(detalle).getByRole('button', { name: '✅ Normalizar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('mantenimiento_cisterna', 'b1', { estado: 'normal' })
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(detalle).getByRole('button', { name: '✅ Normalizar' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('«Normalizar» en la fila no abre el detalle', async () => {
    render(<MantenimientoCisternaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Normalizar Cisterna Ala B (registro del 2026-10-19)' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('mantenimiento_cisterna', 'b1', { estado: 'normal' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
