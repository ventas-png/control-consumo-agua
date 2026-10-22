import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { EventoCalendario, Asamblea } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { CalendarioTab } = await import('../CalendarioTab')

// Fechas en el mes actual: el calendario abre en el mes de hoy.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const hoy = new Date()
const anio = hoy.getFullYear()
const mes = hoy.getMonth()
const fecha = (d: number) => `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const titulo = (d: number) => `${DIAS[new Date(anio, mes, d).getDay()]} ${d} de ${MESES[mes]}`
const celda = (d: number) => screen.getByRole('button', { name: new RegExp(`^${titulo(d)} de ${anio}`) })

const eventos = [
  { id: 'ev1', company_id: 'co1', project_id: 'p1', titulo: 'Limpieza de cisterna', descripcion: null, tipo: 'mantenimiento',
    fecha_inicio: fecha(15), hora_inicio: '08:00', fecha_fin: null, hora_fin: null, recurrente: false, frecuencia: null,
    color: 'var(--at-warning)', todo_el_dia: false, created_by: null, created_at: '2026-10-01T10:00:00Z' },
] as unknown as EventoCalendario[]

const asambleas = [
  { id: 'as1', company_id: 'co1', project_id: 'p1', titulo: 'Asamblea ordinaria', tipo: 'ordinaria', fecha: fecha(15),
    hora_inicio: '18:00', estado: 'convocada', quorum_requerido: 51, created_at: '2026-10-01T10:00:00Z' },
] as unknown as Asamblea[]

function renderTab(props: Partial<Parameters<typeof CalendarioTab>[0]> = {}) {
  return render(
    <CalendarioTab eventos={eventos} asambleas={asambleas} agenda={[]} proyectoId="p1" companyId="co1"
      canCreate canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('CalendarioTab — ventana del día', () => {
  it('tocar un día abre una ventana con su fecha y sus eventos (pantalla completa en el teléfono)', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    // El día es un botón con la fecha completa y cuántos eventos tiene.
    expect(celda(15).getAttribute('aria-label')).toBe(`${titulo(15)} de ${anio}, 2 eventos`)
    fireEvent.click(celda(15))

    const dialog = screen.getByRole('dialog', { name: titulo(15) })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Limpieza de cisterna')).toBeTruthy()
    expect(within(dialog).getByText('🕐 08:00')).toBeTruthy()
    expect(within(dialog).getByText('Asamblea ordinaria')).toBeTruthy()
    // Solo los eventos propios del calendario se pueden borrar (no la asamblea).
    expect(within(dialog).getAllByRole('button', { name: /^Eliminar/ })).toHaveLength(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('eliminar un evento desde la ventana del día', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(celda(15))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar Limpieza de cisterna' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('eventos_calendario', 'ev1'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('un día sin eventos lo dice en la ventana', () => {
    renderTab()
    fireEvent.click(celda(3))
    expect(within(screen.getByRole('dialog', { name: titulo(3) })).getByText('Sin eventos este día.')).toBeTruthy()
  })

  it('el formulario de nuevo evento es una ventana y guarda', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Evento' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo evento' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Fumigación' } })
    fireEvent.change(within(dialog).getByLabelText('Fecha inicio *'), { target: { value: fecha(20) } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('eventos_calendario', expect.objectContaining({
      titulo: 'Fumigación', fecha_inicio: fecha(20), tipo: 'evento', todo_el_dia: true, hora_inicio: null, company_id: 'co1', project_id: 'p1',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permisos no se crea ni se borra, pero el día se puede consultar', () => {
    renderTab({ canCreate: false, canDelete: false })
    expect(screen.queryByRole('button', { name: '+ Evento' })).toBeNull()
    fireEvent.click(celda(15))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Limpieza de cisterna')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /^Eliminar/ })).toBeNull()
  })
})
