// Elevadores: deja la vista dividida (lista de 300px + panel) por una tabla
// que en el teléfono se lee como tarjetas; la nueva incidencia y el detalle
// van en ventana (pantalla completa en el teléfono). «Requiere seguimiento»
// se puede resolver (antes su botón no hacía nada), avanzar el estado avisa si
// falla, y las próximas inspecciones son las de cada elevador, no las fechas
// más viejas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { IncidenciaElevador } from '../../../../types'

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

const { default: IncidenciasElevadorTab } = await import('../IncidenciasElevadorTab')

function incidencia(over: Partial<IncidenciaElevador>): IncidenciaElevador {
  return {
    id: 'e1', company_id: 'co1', project_id: 'p1', elevador: 'Elevador 1', tipo: 'falla',
    descripcion: 'Se detiene entre el piso 3 y el 4 con pasajeros dentro', fecha: '2026-10-20',
    hora_inicio: '08:15:00', hora_fin: '10:00:00', empresa_servicio: 'Elevadores GT', tecnico: 'Luis Pérez',
    estado: 'reportado', costo: 1500, proxima_inspeccion: null, observaciones: null, created_at: '2026-10-20T14:15:00Z',
    ...over,
  }
}

const registros = [
  incidencia({ id: 'e1' }),
  incidencia({ id: 'e2', elevador: 'Elevador 2', tipo: 'mantenimiento_correctivo', estado: 'requiere_seguimiento', fecha: '2026-10-18',
    descripcion: 'Cambio de cable de tracción', observaciones: 'Volver a revisar en 2 semanas.' }),
  // Inspecciones: una vieja ya superada y una futura del mismo elevador; otra vencida del Elevador 2.
  incidencia({ id: 'i1', tipo: 'inspeccion_legal', estado: 'resuelto', fecha: '2025-01-10', proxima_inspeccion: '2025-07-10' }),
  incidencia({ id: 'i2', tipo: 'inspeccion_legal', estado: 'resuelto', fecha: '2026-07-10', proxima_inspeccion: '2099-01-10' }),
  incidencia({ id: 'i3', elevador: 'Elevador 2', tipo: 'inspeccion_legal', estado: 'resuelto', fecha: '2025-03-01', proxima_inspeccion: '2025-09-01' }),
]

function props(over: Partial<Parameters<typeof IncidenciasElevadorTab>[0]> = {}): Parameters<typeof IncidenciasElevadorTab>[0] {
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

describe('Elevadores — nueva incidencia en ventana', () => {
  it('abre a pantalla completa y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<IncidenciasElevadorTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva incidencia' }))
    const ventana = screen.getByRole('dialog', { name: '🛗 Nueva incidencia de elevador' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Elevador *'), { target: { value: 'Elevador 2' } })
    fireEvent.change(screen.getByLabelText('Descripción *'), { target: { value: 'Puerta no cierra' } })
    fireEvent.change(screen.getByLabelText('Hora inicio'), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText('Hora fin'), { target: { value: '10:30' } })
    expect(within(ventana).getByText('Duración: 1h 30min')).toBeTruthy()

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('incidencias_elevador', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', elevador: 'Elevador 2', descripcion: 'Puerta no cierra', hora_inicio: '09:00', hora_fin: '10:30',
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🛗 Nueva incidencia de elevador' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('avisa si la hora fin es anterior a la de inicio', () => {
    render(<IncidenciasElevadorTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva incidencia' }))
    fireEvent.change(screen.getByLabelText('Hora inicio'), { target: { value: '11:00' } })
    fireEvent.change(screen.getByLabelText('Hora fin'), { target: { value: '10:00' } })
    expect(screen.getByRole('alert').textContent).toMatch(/anterior a la de inicio/)
  })

  it('sin descripción avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<IncidenciasElevadorTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva incidencia' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Descripción *'), { target: { value: 'Ruido en la cabina' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Descripción *') as HTMLTextAreaElement).value).toBe('Ruido en la cabina')
  })

  it('sin permiso de crear no hay botón', () => {
    render(<IncidenciasElevadorTab {...props({ canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva incidencia' })).toBeNull()
  })
})

describe('Elevadores — lista, detalle e inspecciones', () => {
  it('la lista se lee como tarjetas con rótulos', () => {
    const { container } = render(<IncidenciasElevadorTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Elevador', 'Tipo', 'Descripción', 'Fecha', 'Empresa', 'Estado', null])
    expect(screen.getByText('1 falla sin resolver')).toBeTruthy()
  })

  it('«Ver» abre el detalle con descripción completa, duración y costo; «Atender» avanza', async () => {
    const onRefresh = vi.fn()
    render(<IncidenciasElevadorTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver incidencia de Elevador 1 del 2026-10-20' }))
    const detalle = screen.getByRole('dialog', { name: '🛗 Elevador 1' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Se detiene entre el piso 3 y el 4 con pasajeros dentro')).toBeTruthy()
    expect(within(detalle).getByText(/2026-10-20 · 08:15–10:00 · 1h 45min/)).toBeTruthy()
    expect(within(detalle).getByText('Q 1,500.00')).toBeTruthy()

    fireEvent.click(within(detalle).getByRole('button', { name: '▶ Atender' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidencias_elevador', 'e1', { estado: 'en_atencion' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('«Requiere seguimiento» se resuelve (antes el botón no hacía nada); si falla, avisa', async () => {
    const onRefresh = vi.fn()
    const { container } = render(<IncidenciasElevadorTab {...props({ onRefresh })} />)
    fireEvent.click(within(container.querySelector('tbody')!).getByText('Cambio de cable de tracción'))
    const detalle = screen.getByRole('dialog', { name: '🛗 Elevador 2' })
    expect(within(detalle).getByText('Volver a revisar en 2 semanas.')).toBeTruthy()

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(detalle).getByRole('button', { name: '▶ Resolver' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidencias_elevador', 'e2', { estado: 'resuelto' })
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('las próximas inspecciones son la última de cada elevador; la vencida se marca y abre su registro', () => {
    render(<IncidenciasElevadorTab {...props()} />)
    const botones = screen.getAllByRole('button', { name: /^🛗 Elevador \d · \d{4}-/ })
    expect(botones.map(b => b.textContent)).toEqual([
      '🛗 Elevador 2 · 2025-09-01 · vencida',
      '🛗 Elevador 1 · 2099-01-10',
    ])
    fireEvent.click(botones[1])
    expect(within(screen.getByRole('dialog', { name: '🛗 Elevador 1' })).getByText('2099-01-10')).toBeTruthy()
  })

  it('sin permiso de editar no se ofrece avanzar el estado', () => {
    render(<IncidenciasElevadorTab {...props({ canEdit: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver incidencia de Elevador 1 del 2026-10-20' }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /^▶/ })).toBeNull()
  })
})
