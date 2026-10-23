// Control de plagas: deja la vista dividida (lista de 300px + panel) por una
// tabla que en el teléfono se lee como tarjetas; la nueva visita y el detalle
// van en ventana (pantalla completa en el teléfono). La próxima visita es la
// que dejó programada la visita más reciente (antes se avisaba la de cada
// registro: una ya hecha seguía «próxima» y una atrasada desaparecía), en días
// de calendario locales, y las áreas propias se pueden quitar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, createEvent } from '@testing-library/react'
import type { ControlPlagas } from '../../../../types'

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

const { default: ControlPlagasTab } = await import('../ControlPlagasTab')

function visita(over: Partial<ControlPlagas>): ControlPlagas {
  return {
    id: 'x', company_id: 'co1', project_id: 'p1', tipo: 'fumigacion', empresa: 'Fumigadora Maya', tecnico: null,
    areas: ['Lobby'], productos: null, fecha: '2026-08-20', hora_inicio: null, hora_fin: null, resultado: 'satisfactorio',
    proxima_visita: null, costo: null, observaciones: null, created_at: '2026-08-20T10:00:00Z',
    ...over,
  }
}

const registros = [
  // Ya superada: su próxima visita (20 sep) se hizo.
  visita({ id: 'v1', proxima_visita: '2026-09-20', costo: 450 }),
  // Mismo día que v2 pero capturada antes: no es la vigente.
  visita({ id: 'v3', tipo: 'inspeccion', fecha: '2026-09-20', proxima_visita: '2026-10-25', created_at: '2026-09-20T09:00:00Z' }),
  // La más reciente: su próxima visita (20 oct) está atrasada.
  visita({ id: 'v2', tipo: 'preventivo', fecha: '2026-09-20', proxima_visita: '2026-10-20', resultado: 'requiere_seguimiento',
    hora_inicio: '08:00:00', hora_fin: '10:30:00', areas: ['Lobby', 'Sótano', 'Parqueo', 'Jardines', 'Azotea'],
    observaciones: 'Rastros de roedores en sótano.', costo: 1250.5, created_at: '2026-09-20T15:00:00Z' }),
]

function props(over: Partial<Parameters<typeof ControlPlagasTab>[0]> = {}): Parameters<typeof ControlPlagasTab>[0] {
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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0)) // 23 oct 2026
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Plagas — nueva visita en ventana', () => {
  it('abre a pantalla completa, agrega y quita áreas propias y registra sin cerrarse mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<ControlPlagasTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva visita' }))
    const ventana = screen.getByRole('dialog', { name: '🧪 Nueva visita de control de plagas' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Empresas ya usadas como sugerencia.
    expect(Array.from(ventana.querySelectorAll('#plagas-empresas option')).map(o => o.getAttribute('value'))).toEqual(['Fumigadora Maya'])

    fireEvent.click(within(ventana).getByRole('button', { name: 'Lobby' }))
    expect(within(ventana).getByRole('button', { name: '✓ Lobby' }).getAttribute('aria-pressed')).toBe('true')

    // Enter agrega el área sin enviar el formulario.
    const otra = screen.getByLabelText('Agregar otra área')
    fireEvent.change(otra, { target: { value: 'Bodega' } })
    const enter = createEvent.keyDown(otra, { key: 'Enter' })
    fireEvent(otra, enter)
    expect(enter.defaultPrevented).toBe(true)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    // El área propia se ve como las demás y se puede quitar.
    fireEvent.click(within(ventana).getByRole('button', { name: '✓ Bodega' }))
    expect(within(ventana).queryByRole('button', { name: /Bodega/ })).toBeNull()
    fireEvent.change(otra, { target: { value: 'Cuarto eléctrico' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Agregar' }))
    expect(within(ventana).getByRole('button', { name: '✓ Cuarto eléctrico' })).toBeTruthy()

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_plagas', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', tipo: 'fumigacion', fecha: '2026-10-23', areas: ['Lobby', 'Cuarto eléctrico'],
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🧪 Nueva visita de control de plagas' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin áreas avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<ControlPlagasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva visita' }))
    const ventana = screen.getByRole('dialog')
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Técnico'), { target: { value: 'Luis Pérez' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Piscina' }))
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Técnico') as HTMLInputElement).value).toBe('Luis Pérez')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '✓ Piscina' })).toBeTruthy()
  })

  it('sin permiso de crear no hay botón', () => {
    render(<ControlPlagasTab {...props({ canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva visita' })).toBeNull()
  })
})

describe('Plagas — próxima visita, lista y detalle', () => {
  it('la próxima visita es la que dejó la visita más reciente, y avisa si está atrasada', () => {
    render(<ControlPlagasTab {...props()} />)
    const ultima = screen.getByRole('button', { name: /^Ver última visita/ })
    expect(ultima.textContent).toContain('2026-09-20')
    expect(ultima.textContent).toContain('Requiere seguimiento')
    const proxima = screen.getByRole('button', { name: /^Próxima visita/ })
    expect(proxima.textContent).toBe('⏰ Próxima visita2026-10-20atrasada 3 días')

    fireEvent.click(proxima)
    expect(screen.getByRole('dialog', { name: '🛡️ Preventivo' })).toBeTruthy()
  })

  it('cuenta días de calendario locales, y sin fecha en la última visita lo dice', () => {
    vi.setSystemTime(new Date(2026, 9, 23, 20, 0, 0)) // 8 de la noche
    const { rerender } = render(<ControlPlagasTab {...props({ registros: [...registros, visita({ id: 'v4', fecha: '2026-10-01', proxima_visita: '2026-10-24', created_at: '2026-10-01T10:00:00Z' })] })} />)
    expect(screen.getByRole('button', { name: /^Próxima visita/ }).textContent).toContain('en 1 día')

    rerender(<ControlPlagasTab {...props({ registros: [...registros, visita({ id: 'v4', fecha: '2026-10-01', created_at: '2026-10-01T10:00:00Z' })] })} />)
    expect(screen.queryByRole('button', { name: /^Próxima visita/ })).toBeNull()
    expect(screen.getByText('Sin programar en la última visita')).toBeTruthy()
  })

  it('la lista se lee como tarjetas; sólo la próxima visita vigente se marca atrasada', () => {
    const { container } = render(<ControlPlagasTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Fecha', 'Tipo', 'Áreas', 'Empresa', 'Próx. visita', 'Costo', 'Resultado', null])
    expect(within(tabla).getAllByText(/· atrasada$/).map(e => e.textContent)).toEqual(['2026-10-20 · atrasada'])
    expect(within(tabla).getByText('Lobby, Sótano, Parqueo +2')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filtrar por tipo'), { target: { value: 'inspeccion' } })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('«Ver» abre el detalle; una visita superada lo dice y no cuenta plazo', () => {
    render(<ControlPlagasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Fumigación del 2026-08-20' }))
    const vieja = screen.getByRole('dialog', { name: '💨 Fumigación' })
    expect(vieja.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(vieja).getByText(/Hay una visita más reciente/)).toBeTruthy()
    expect(within(vieja).getByText('2026-09-20')).toBeTruthy()
    expect(within(vieja).getByText('Q 450.00')).toBeTruthy()
  })

  it('tocar la fila abre el detalle con horario, plazo, áreas y observaciones', () => {
    const { container } = render(<ControlPlagasTab {...props({ canCreate: false })} />)
    const fila = within(container.querySelector('tbody')!).getByText('🛡️ Preventivo').closest('tr')!
    fireEvent.click(fila)
    const detalle = screen.getByRole('dialog', { name: '🛡️ Preventivo' })
    expect(within(detalle).queryByText(/Hay una visita más reciente/)).toBeNull()
    expect(within(detalle).getByText('08:00 – 10:30')).toBeTruthy()
    expect(within(detalle).getByText('2026-10-20 · atrasada 3 días')).toBeTruthy()
    expect(within(detalle).getByText('Q 1,250.50')).toBeTruthy()
    expect(within(detalle).getByText('Azotea')).toBeTruthy()
    expect(within(detalle).getByText('Rastros de roedores en sótano.')).toBeTruthy()
  })
})
