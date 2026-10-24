// Jardinería: deja la vista dividida (lista de 300px + panel) por una tabla
// que en el teléfono se lee como tarjetas; el nuevo servicio y el detalle van
// en ventana (pantalla completa en el teléfono). Las áreas propias se ven y se
// pueden quitar, Enter en ese campo no registra, y marcar completado avisa si
// falla (antes no hacía nada).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, createEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { MantenimientoJardineria } from '../../../../types'

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

const { default: MantenimientoJardineriaTab } = await import('../MantenimientoJardineriaTab')

function servicio(over: Partial<MantenimientoJardineria>): MantenimientoJardineria {
  return {
    id: 'j1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-10', tipo: 'poda',
    areas: ['Jardín principal', 'Perímetro', 'Terraza'], proveedor: 'Jardines El Roble', trabajadores: 3,
    horas_trabajo: 6.5, insumos: 'Fertilizante 15-15-15', costo: 1250.5, estado: 'completado',
    proxima_visita: null, observaciones: null, created_at: '2026-10-10T10:00:00Z',
    ...over,
  }
}

const registros = [
  servicio({ id: 'j1' }),
  servicio({ id: 'j2', fecha: '2026-10-15', tipo: 'fumigacion', estado: 'programado', costo: null, areas: ['Área de juegos'],
    proxima_visita: '2099-01-20', observaciones: 'Avisar a residentes 24 h antes.' }),
]

function props(over: Partial<Parameters<typeof MantenimientoJardineriaTab>[0]> = {}): Parameters<typeof MantenimientoJardineriaTab>[0] {
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
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Jardinería — nuevo servicio en ventana', () => {
  it('abre a pantalla completa y registra con las áreas elegidas; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<MantenimientoJardineriaTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo servicio' }))
    const ventana = screen.getByRole('dialog', { name: '🌿 Nuevo servicio de jardinería' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'riego' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Jardín lateral' }))
    expect(within(ventana).getByRole('button', { name: '✓ Jardín lateral' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByLabelText('Costo (Q)'), { target: { value: '300' } })

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('mantenimiento_jardineria', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', tipo: 'riego', areas: ['Jardín lateral'], costo: 300,
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🌿 Nuevo servicio de jardinería' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el área propia se agrega con Enter sin registrar, se ve y se puede quitar', async () => {
    render(<MantenimientoJardineriaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo servicio' }))
    const ventana = screen.getByRole('dialog')
    const campo = screen.getByLabelText('Agregar área personalizada')
    fireEvent.change(campo, { target: { value: 'Rotonda de ingreso' } })
    // jsdom no simula el envío implícito del formulario: se comprueba que Enter
    // se cancela (en el navegador, sin eso, registraba el servicio).
    const enter = createEvent.keyDown(campo, { key: 'Enter' })
    fireEvent(campo, enter)
    expect(enter.defaultPrevented).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()

    const chip = within(ventana).getByRole('button', { name: '✓ Rotonda de ingreso' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    // Quitarla la saca de la lista (no es un área común).
    fireEvent.click(chip)
    expect(within(ventana).queryByRole('button', { name: /Rotonda de ingreso/ })).toBeNull()

    fireEvent.change(campo, { target: { value: 'Rotonda de ingreso' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Agregar' }))
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('mantenimiento_jardineria', expect.objectContaining({ areas: ['Rotonda de ingreso'] })))
  })

  it('sin áreas avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<MantenimientoJardineriaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo servicio' }))
    const ventana = screen.getByRole('dialog')
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Perímetro' }))
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'Ramas caídas' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Observaciones') as HTMLTextAreaElement).value).toBe('Ramas caídas')
  })

  it('sin permiso de crear no hay botón', () => {
    render(<MantenimientoJardineriaTab {...props({ canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo servicio' })).toBeNull()
  })
})

describe('Jardinería — lista y detalle', () => {
  it('la lista se lee como tarjetas con rótulos; montos en formato regional', () => {
    const { container } = render(<MantenimientoJardineriaTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Tipo', 'Fecha', 'Áreas', 'Proveedor', 'Costo', 'Estado', null])
    // getAllByText normaliza el espacio duro a uno normal.
    expect(screen.getAllByText('Q 1,250.50').length).toBe(2) // KPI y fila
    expect(within(tabla).getByText('Jardín principal, Perímetro +1')).toBeTruthy()
  })

  it('«Ver» abre el detalle con áreas, insumos y observaciones', () => {
    render(<MantenimientoJardineriaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Poda del 2026-10-10' }))
    const detalle = screen.getByRole('dialog', { name: '✂️ Poda' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    for (const a of ['Jardín principal', 'Perímetro', 'Terraza']) expect(within(detalle).getByText(a)).toBeTruthy()
    expect(within(detalle).getByText('Fertilizante 15-15-15')).toBeTruthy()
    expect(within(detalle).getByText('6.5 h')).toBeTruthy()
    // Ya completado: no se ofrece marcarlo otra vez.
    expect(within(detalle).queryByRole('button', { name: '✓ Marcar completado' })).toBeNull()
  })

  it('las próximas visitas abren su registro', () => {
    render(<MantenimientoJardineriaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /2099-01-20 · Fumigación/ }))
    const detalle = screen.getByRole('dialog', { name: '🧪 Fumigación' })
    expect(within(detalle).getByText('Avisar a residentes 24 h antes.')).toBeTruthy()
  })

  it('tocar la fila abre el detalle; marcar completado avisa si falla y luego refresca', async () => {
    const onRefresh = vi.fn()
    const { container } = render(<MantenimientoJardineriaTab {...props({ onRefresh })} />)
    fireEvent.click(within(container.querySelector('tbody')!).getByText('Área de juegos'))
    const detalle = screen.getByRole('dialog', { name: '🧪 Fumigación' })

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(detalle).getByRole('button', { name: '✓ Marcar completado' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('mantenimiento_jardineria', 'j2', { estado: 'completado' })
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(detalle).getByRole('button', { name: '✓ Marcar completado' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('sin permiso de editar no se ofrece marcar completado', () => {
    render(<MantenimientoJardineriaTab {...props({ canEdit: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Fumigación del 2026-10-15' }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '✓ Marcar completado' })).toBeNull()
  })
})
