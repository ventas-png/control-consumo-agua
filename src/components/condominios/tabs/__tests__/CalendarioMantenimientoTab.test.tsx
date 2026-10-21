import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { TicketMantenimiento, ReservaAmenidad, PlanMantenimiento } from '../../../../types'
import CalendarioMantenimientoTab from '../CalendarioMantenimientoTab'

// Fechas en el mes actual: el calendario abre en el mes de hoy.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const hoy = new Date()
const anio = hoy.getFullYear()
const mes = hoy.getMonth()
const fecha = (d: number) => `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const titulo = (d: number) => `${DIAS[new Date(anio, mes, d).getDay()]} ${d} de ${MESES[mes]}`
const celda = (d: number) => screen.getByRole('button', { name: new RegExp(`^${titulo(d)} de ${anio}`) })

const tickets = [
  { id: 't1', titulo: 'Fuga en bomba 2', fecha_limite: fecha(15), created_at: `${fecha(2)}T09:00:00Z`, estado: 'abierto' },
] as unknown as TicketMantenimiento[]

const reservas = [
  { id: 'r1', fecha: fecha(15), hora_inicio: '10:00', hora_fin: '12:00', amenidad_nombre: 'Piscina', estado: 'confirmada' },
] as unknown as ReservaAmenidad[]

const planes = [
  { id: 'pl1', equipo: 'Elevador torre A', proxima_ejecucion: fecha(20), created_at: '2026-01-10T09:00:00Z', activo: true },
] as unknown as PlanMantenimiento[]

function renderTab() {
  return render(
    <CalendarioMantenimientoTab tickets={tickets} reservas={reservas} planesMantenimiento={planes} inspecciones={[]} vencimientosExtra={[]} />,
  )
}

afterEach(cleanup)

describe('CalendarioMantenimientoTab — ventana del día', () => {
  it('tocar un día abre una ventana con su fecha y lo programado (pantalla completa en el teléfono)', () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(celda(15).getAttribute('aria-label')).toBe(`${titulo(15)} de ${anio}, 2 eventos`)
    fireEvent.click(celda(15))

    const dialog = screen.getByRole('dialog', { name: titulo(15) })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(`${anio} · 2 eventos`)).toBeTruthy()
    expect(within(dialog).getByText('Fuga en bomba 2')).toBeTruthy()
    expect(within(dialog).getByText('Ticket')).toBeTruthy()
    expect(within(dialog).getByText('Piscina — 10:00')).toBeTruthy()
    expect(within(dialog).queryByText('Elevador torre A')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('los filtros también se aplican a la ventana del día', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '🔧 Ticket' }))
    expect(celda(15).getAttribute('aria-label')).toBe(`${titulo(15)} de ${anio}, 1 evento`)
    fireEvent.click(celda(15))
    const dialog = screen.getByRole('dialog', { name: titulo(15) })
    expect(within(dialog).queryByText('Fuga en bomba 2')).toBeNull()
    expect(within(dialog).getByText('Piscina — 10:00')).toBeTruthy()
  })

  it('un día sin eventos lo dice en la ventana', () => {
    renderTab()
    fireEvent.click(celda(3))
    const dialog = screen.getByRole('dialog', { name: titulo(3) })
    expect(within(dialog).getByText('Sin eventos')).toBeTruthy()
  })
})
