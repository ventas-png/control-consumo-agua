import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { IncidenteSeguridad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowAfectando: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
// jsPDF / xlsx no hacen falta para estas pruebas.
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))

const { IncidentesTab } = await import('../IncidentesTab')

function incidente(over: Partial<IncidenteSeguridad> = {}): IncidenteSeguridad {
  return {
    id: 'i1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-19', hora: '23:40',
    tipo: 'vandalismo', descripcion: 'Grafiti en el muro del parqueo', area: 'Parqueo 3',
    reportado_por: 'Guardia nocturno', estado: 'reportado', involucrados: 'Desconocidos',
    seguimiento: 'Se revisan las cámaras.', created_at: '2026-10-20T00:00:00Z',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof IncidentesTab>[0]> = {}) {
  return render(
    <IncidentesTab incidentes={[incidente()]} proyectoId="p1" companyId="co1"
      canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('IncidentesTab — ventanas', () => {
  it('la lista ocupa la página y cada incidente se abre en ventana; Escape la cierra', () => {
    renderTab()
    expect(screen.queryByText(/Selecciona un incidente/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro del parqueo/ }))

    const dialog = screen.getByRole('dialog', { name: '🔨 Grafiti en el muro del parqueo' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Guardia nocturno')).toBeTruthy()
    expect(within(dialog).getByText('Se revisan las cámaras.')).toBeTruthy()
    expect(within(dialog).getByText(/a las 23:40 · Parqueo 3/)).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('avanzar de estado desde la ventana, y la ventana muestra la fila refrescada', async () => {
    const onRefresh = vi.fn()
    const { rerender } = renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '→ Iniciar Investigación' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', 'i1', { estado: 'investigando' }))
    expect(onRefresh).toHaveBeenCalled()

    // Llega la lista refrescada: la ventana lee la fila vigente, no una copia.
    rerender(<IncidentesTab incidentes={[incidente({ estado: 'investigando' })]} proyectoId="p1" companyId="co1"
      canCreate canEdit canDelete onRefresh={onRefresh} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '→ Marcar Resuelto' })).toBeTruthy()
    expect(within(dialog).getByRole('listitem', { current: 'step' }).textContent).toBe('Investigando')
  })

  it('registrar un incidente se hace en ventana y guardar llama a la mutación', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '🚨 Registrar incidente' }))
    const dialog = screen.getByRole('dialog', { name: '🚨 Registrar incidente' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Descripción *'), { target: { value: 'Puerta forzada en bodega' } })
    fireEvent.change(within(dialog).getByLabelText('Área'), { target: { value: 'Bodega' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', expect.objectContaining({
      descripcion: 'Puerta forzada en bodega', area: 'Bodega', company_id: 'co1', project_id: 'p1',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('editar desde el detalle abre el formulario con los datos y, al cerrarlo, vuelve el detalle', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))

    const form = screen.getByRole('dialog', { name: '✏️ Editar incidente' })
    expect((within(form).getByLabelText('Área') as HTMLInputElement).value).toBe('Parqueo 3')
    fireEvent.change(within(form).getByLabelText('Seguimiento'), { target: { value: 'Denuncia presentada.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', 'i1', expect.objectContaining({
      seguimiento: 'Denuncia presentada.',
    })))
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Grafiti en el muro/ })).toBeTruthy())
  })

  it('sin permiso de edición no hay editar ni avance de estado; sin crear no hay registrar', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '🚨 Registrar incidente' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Iniciar Investigación/ })).toBeNull()
  })

  it('los filtros siguen filtrando la lista', () => {
    renderTab({ incidentes: [incidente(), incidente({ id: 'i2', descripcion: 'Caída en escaleras', tipo: 'accidente', area: 'Torre B' })] })
    fireEvent.change(screen.getByLabelText('Buscar incidentes'), { target: { value: 'torre' } })
    expect(screen.queryByRole('button', { name: /Grafiti/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Caída en escaleras/ })).toBeTruthy()
  })

  it('eliminar exige su propio permiso: editar no basta', async () => {
    renderTab({ canDelete: false })
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Editar/ })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Eliminar/ })).toBeNull()
    cleanup()

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Eliminar/ }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('incidentes_seguridad', 'i1'))
  })

  it('con permiso de eliminar, aunque no edite, borra el incidente', async () => {
    renderTab({ canEdit: false })
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Eliminar/ }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('incidentes_seguridad', 'i1'))
  })

  it('si la base no borra (la RLS lo rechaza), avisa y no da el incidente por eliminado', async () => {
    mocks.deleteCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'El servidor no aplicó el cambio', code: 'SIN_FILAS' } })
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Eliminar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

// Más amigable: resumen con lo abierto y su antigüedad, filtros por estado con
// su cuenta, búsqueda en todo el texto, la línea de avance del incidente y
// notas de seguimiento con fecha y autor sin pasar por «Editar».
describe('IncidentesTab — resumen, filtros y seguimiento', () => {
  const lista = [
    incidente({ id: 'i1', fecha: '2026-10-10', hora: '08:00', estado: 'reportado', descripcion: 'Puerta de bodega forzada', tipo: 'robo', area: 'Bodega', reportado_por: 'Carlos Ruiz', involucrados: null, seguimiento: null }),
    incidente({ id: 'i2', fecha: '2026-10-25', hora: '21:15', estado: 'investigando', descripcion: 'Grafiti en el muro del parqueo' }),
    incidente({ id: 'i3', fecha: '2026-09-30', hora: '10:00', estado: 'cerrado', descripcion: 'Caída en escaleras', tipo: 'accidente', area: 'Torre B', involucrados: 'Apto 4C' }),
  ]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 26, 10, 30, 0)) // 26 oct 2026, 10:30
  })
  afterEach(() => vi.useRealTimers())

  const titulos = () => screen.getAllByRole('button', { name: /Puerta de bodega|Grafiti en el muro|Caída en escaleras/ })
    .map(b => (b.textContent ?? '').match(/Puerta de bodega|Grafiti en el muro|Caída en escaleras/)![0])

  it('el resumen cuenta lo abierto, su antigüedad y lo del mes; «Abiertos» filtra', () => {
    renderTab({ incidentes: lista })
    expect(screen.getByRole('button', { name: 'Abiertos: 2' })).toBeTruthy()
    expect(screen.getByText(/Más antiguo abierto$/).nextElementSibling!.textContent).toBe('16 días')
    expect(screen.getByText(/Este mes$/).nextElementSibling!.textContent).toBe('2')

    // Lo más reciente arriba.
    expect(titulos()).toEqual(['Grafiti en el muro', 'Puerta de bodega', 'Caída en escaleras'])
    fireEvent.click(screen.getByRole('button', { name: 'Abiertos: 2' }))
    expect(titulos()).toEqual(['Grafiti en el muro', 'Puerta de bodega'])
    expect(screen.getByRole('button', { name: 'Abiertos (2)' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('los estados filtran con su cuenta; la búsqueda mira también quién reportó y los involucrados', () => {
    renderTab({ incidentes: lista })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrado (1)' }))
    expect(titulos()).toEqual(['Caída en escaleras'])
    fireEvent.click(screen.getByRole('button', { name: 'Todos (3)' }))

    fireEvent.change(screen.getByLabelText('Buscar incidentes'), { target: { value: 'carlos' } })
    expect(titulos()).toEqual(['Puerta de bodega'])
    fireEvent.change(screen.getByLabelText('Buscar incidentes'), { target: { value: '4c' } })
    expect(titulos()).toEqual(['Caída en escaleras'])
  })

  it('cada incidente abierto dice cuánto lleva; uno cerrado no', () => {
    renderTab({ incidentes: lista })
    const tarjeta = (t: RegExp) => screen.getByRole('button', { name: t }).textContent
    expect(tarjeta(/Puerta de bodega/)).toContain('abierto hace 16 días')
    expect(tarjeta(/Grafiti en el muro/)).toContain('abierto hace 1 día')
    expect(tarjeta(/Caída en escaleras/)).not.toContain('abierto')
  })

  it('el detalle muestra el avance y agrega notas de seguimiento con fecha y autor', async () => {
    const onRefresh = vi.fn()
    renderTab({ incidentes: lista, onRefresh, autorNombre: 'Ana López' })
    fireEvent.click(screen.getByRole('button', { name: /Puerta de bodega/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('listitem', { current: 'step' }).textContent).toBe('Reportado')
    expect(within(dialog).getByText('Sin notas todavía.')).toBeTruthy()

    const agregar = within(dialog).getByRole('button', { name: '+ Agregar nota' }) as HTMLButtonElement
    expect(agregar.disabled).toBe(true) // sin texto no hay nota
    fireEvent.change(within(dialog).getByLabelText('Agregar nota de seguimiento'), { target: { value: 'Se revisaron las cámaras.' } })

    // Si falla, la nota se queda escrita.
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } } as never)
    fireEvent.click(agregar)
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((within(dialog).getByLabelText('Agregar nota de seguimiento') as HTMLTextAreaElement).value).toBe('Se revisaron las cámaras.')
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: '+ Agregar nota' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).toHaveBeenLastCalledWith('incidentes_seguridad', 'i1', {
      seguimiento: '[2026-10-26 10:30 · Ana López] Se revisaron las cámaras.',
    })
    expect((within(dialog).getByLabelText('Agregar nota de seguimiento') as HTMLTextAreaElement).value).toBe('')
  })

  it('una nota nueva va debajo de las anteriores, sin borrarlas', async () => {
    renderTab({ incidentes: lista, autorNombre: 'Ana López' })
    fireEvent.click(screen.getByRole('button', { name: /Grafiti en el muro/ }))
    fireEvent.change(screen.getByLabelText('Agregar nota de seguimiento'), { target: { value: 'Denuncia presentada.' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar nota' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('incidentes_seguridad', 'i2', {
      seguimiento: 'Se revisan las cámaras.\n[2026-10-26 10:30 · Ana López] Denuncia presentada.',
    }))
  })

  it('avanzar de estado no se repite con un segundo toque', async () => {
    renderTab({ incidentes: lista })
    fireEvent.click(screen.getByRole('button', { name: /Puerta de bodega/ }))
    let resolver!: (v: { error: null }) => void
    mocks.updateCondominioRow.mockReturnValueOnce(new Promise(r => { resolver = r }) as never)
    const avanzar = within(screen.getByRole('dialog')).getByRole('button', { name: '→ Iniciar Investigación' })
    fireEvent.click(avanzar)
    fireEvent.click(avanzar)
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)
    resolver({ error: null })
  })

  it('sin permiso de editar no hay notas; el pie ofrece Cerrar', () => {
    renderTab({ incidentes: lista, canEdit: false, canDelete: false })
    fireEvent.click(screen.getByRole('button', { name: /Puerta de bodega/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByLabelText('Agregar nota de seguimiento')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('registrar propone la fecha y la hora de ahora, y sin fecha avisa', async () => {
    renderTab({ incidentes: lista })
    fireEvent.click(screen.getByRole('button', { name: '🚨 Registrar incidente' }))
    const dialog = screen.getByRole('dialog', { name: '🚨 Registrar incidente' })
    expect((within(dialog).getByLabelText('Fecha *') as HTMLInputElement).value).toBe('2026-10-26')
    expect((within(dialog).getByLabelText('Hora') as HTMLInputElement).value).toBe('10:30')

    fireEvent.change(within(dialog).getByLabelText('Descripción *'), { target: { value: 'Alarma activada' } })
    fireEvent.change(within(dialog).getByLabelText('Fecha *'), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Indica la fecha del incidente.' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })
})
