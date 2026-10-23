// Control de plagas: deja la vista dividida (lista de 300px + panel) por una
// tabla que en el teléfono se lee como tarjetas; la nueva visita y el detalle
// van en ventana (pantalla completa en el teléfono), y las áreas propias se
// pueden quitar.
//
// Cada tipo lleva su calendario: la próxima visita es la que dejó programada la
// última visita de ese tipo o, si no dejó, la probable según su frecuencia;
// con ella se proyectan los próximos 90 días. Al registrar, la próxima visita
// se propone sola. Los plazos van en días de calendario locales.
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
  // Fumigaciones cada 46 días; la última (5 oct) no dejó fecha: la probable
  // es el 5 oct + 46 días = 20 nov.
  visita({ id: 'v0', fecha: '2026-07-05', created_at: '2026-07-05T10:00:00Z' }),
  visita({ id: 'v1', proxima_visita: '2026-09-20', costo: 450 }),
  visita({ id: 'v5', fecha: '2026-10-05', costo: 500, created_at: '2026-10-05T10:00:00Z' }),
  // Inspección programada para el 25 oct.
  visita({ id: 'v3', tipo: 'inspeccion', fecha: '2026-09-20', proxima_visita: '2026-10-25', created_at: '2026-09-20T09:00:00Z' }),
  // Preventivo: su próxima visita (20 oct) está atrasada.
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
      proxima_visita: '2026-12-08', // propuesta sola: 23 oct + 46 días
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

describe('Plagas — próxima visita al registrar', () => {
  const valorProxima = () => (screen.getByLabelText('Próxima visita') as HTMLInputElement).value

  it('se propone con la frecuencia del tipo y sigue al tipo, la fecha y el resultado', () => {
    render(<ControlPlagasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva visita' }))
    expect(valorProxima()).toBe('2026-12-08') // fumigación: 23 oct + 46
    expect(screen.getByText('Sugerida: cada ~46 días, según el historial de Fumigación.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'inspeccion' } })
    expect(valorProxima()).toBe('2026-11-27') // 23 oct + 35 (lo programado en la única inspección)
    fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '2026-10-20' } })
    expect(valorProxima()).toBe('2026-11-24')

    // Una visita no realizada no se da por hecha: hay que reponerla.
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'no_realizado' } })
    expect(valorProxima()).toBe('')
    expect(screen.getByText('No se realizó: programa cuándo se repone.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Resultado'), { target: { value: 'satisfactorio' } })
    expect(valorProxima()).toBe('2026-11-24')

    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'tratamiento' } })
    expect(valorProxima()).toBe('')
    expect(screen.getByText('Sin historial de Tratamiento para sugerir: elige un plazo.')).toBeTruthy()
  })

  it('un plazo rápido o una fecha a mano se respetan; «Usar la sugerida» vuelve a la propuesta', async () => {
    render(<ControlPlagasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva visita' }))
    const mas30 = screen.getByRole('button', { name: 'Próxima visita en 30 días' })
    fireEvent.click(mas30)
    expect(valorProxima()).toBe('2026-11-22')
    expect(mas30.getAttribute('aria-pressed')).toBe('true')

    // Ya no se recalcula al cambiar el tipo.
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'inspeccion' } })
    expect(valorProxima()).toBe('2026-11-22')
    fireEvent.click(screen.getByRole('button', { name: 'Usar la sugerida (2026-11-27)' }))
    expect(valorProxima()).toBe('2026-11-27')
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'fumigacion' } })
    expect(valorProxima()).toBe('2026-12-08')

    fireEvent.change(screen.getByLabelText('Próxima visita'), { target: { value: '2027-01-15' } })
    fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '2026-10-22' } })
    expect(valorProxima()).toBe('2027-01-15')

    // Tras registrar, la siguiente visita vuelve a proponerse sola.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Piscina' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_plagas', expect.objectContaining({ proxima_visita: '2027-01-15' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva visita' }))
    expect(valorProxima()).toBe('2026-12-08')
  })
})

describe('Plagas — próximas visitas por tipo, lista y detalle', () => {
  it('cada tipo tiene su próxima visita (programada o probable), la más urgente primero', () => {
    render(<ControlPlagasTab {...props()} />)
    const seccion = screen.getByRole('region', { name: '⏰ Próximas visitas por tipo' })
    expect(within(seccion).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Preventivo: próxima visita 2026-10-20, programada, atrasada 3 días',
      'Inspección: próxima visita 2026-10-25, programada, en 2 días',
      'Fumigación: próxima visita 2026-11-20, probable, en 28 días',
    ])
    const preventivo = within(seccion).getAllByRole('button')[0]
    expect(preventivo.textContent).toContain('Requiere seguimiento')
    const fumigacion = within(seccion).getAllByRole('button')[2]
    expect(fumigacion.textContent).toContain('Última 2026-10-05 · cada ~46 días')
    expect(fumigacion.textContent).toContain('Luego: 2027-01-05')

    // Proyección a 90 días: preventivo 4 (la atrasada y tres más, a Q 1,250.50),
    // inspección 3 (sin costo) y fumigación 2 (a Q 475 de promedio).
    expect(within(seccion).getByText('Próximos 90 días: 9 visitas · ≈ Q 5,952.00 (3 sin costo de referencia)')).toBeTruthy()

    fireEvent.click(fumigacion)
    const detalle = screen.getByRole('dialog', { name: '💨 Fumigación' })
    expect(within(detalle).getByText('Probable 2026-11-20 · en 28 días')).toBeTruthy()
    expect(within(detalle).getByText('No se programó; cada ~46 días según el historial')).toBeTruthy()
  })

  it('cuenta días de calendario locales, y un tipo sin fecha lo dice', () => {
    vi.setSystemTime(new Date(2026, 9, 23, 20, 0, 0)) // 8 de la noche
    render(<ControlPlagasTab {...props({ registros: [...registros,
      visita({ id: 'v4', tipo: 'inspeccion', fecha: '2026-10-01', proxima_visita: '2026-10-24', created_at: '2026-10-01T10:00:00Z' }),
      visita({ id: 'v6', tipo: 'tratamiento', fecha: '2026-10-01', created_at: '2026-10-01T11:00:00Z' }),
    ] })} />)
    expect(screen.getByRole('button', { name: 'Inspección: próxima visita 2026-10-24, programada, en 1 día' })).toBeTruthy()
    const tratamiento = screen.getByRole('button', { name: 'Tratamiento: sin próxima visita' })
    expect(tratamiento.textContent).toContain('Sin fecha: programa la próxima al registrar')
  })

  it('la lista se lee como tarjetas; sólo la próxima vigente de cada tipo se marca atrasada', () => {
    const { container } = render(<ControlPlagasTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Fecha', 'Tipo', 'Áreas', 'Empresa', 'Próx. visita', 'Costo', 'Resultado', null])
    // La fumigación del 20 sep ya pasó, pero hubo otra fumigación después.
    expect(within(tabla).getAllByText(/· atrasada$/).map(e => e.textContent)).toEqual(['2026-10-20 · atrasada'])
    expect(within(tabla).getByText('≈ 2026-11-20')).toBeTruthy() // la probable de la última fumigación
    expect(within(tabla).getByText('Lobby, Sótano, Parqueo +2')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filtrar por tipo'), { target: { value: 'inspeccion' } })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
  })

  it('«Ver» abre el detalle; una visita superada por otra de su tipo lo dice y no cuenta plazo', () => {
    render(<ControlPlagasTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Fumigación del 2026-08-20' }))
    const vieja = screen.getByRole('dialog', { name: '💨 Fumigación' })
    expect(vieja.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(vieja).getByText('Hay una visita más reciente de tipo «Fumigación»: la próxima vigente es la que dejó programada esa.')).toBeTruthy()
    expect(within(vieja).getByText('2026-09-20')).toBeTruthy()
    expect(within(vieja).getByText('Q 450.00')).toBeTruthy()
    fireEvent.click(within(vieja).getByRole('button', { name: 'Cerrar' }))

    // La probable sólo se muestra en la última de su tipo.
    fireEvent.click(screen.getByRole('button', { name: 'Ver Fumigación del 2026-07-05' }))
    const masVieja = screen.getByRole('dialog', { name: '💨 Fumigación' })
    expect(within(masVieja).getByText('Próxima visita').nextElementSibling!.textContent).toBe('—')
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
