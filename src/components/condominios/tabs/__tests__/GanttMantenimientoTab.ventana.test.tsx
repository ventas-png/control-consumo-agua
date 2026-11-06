// Gantt de tickets: la fila abre la ficha del ticket en ventana emergente (EditModal real, pantalla completa en el
// teléfono), sólo lectura, con el tramo de la barra (inicio, fin, duración). Antes sólo había un tooltip al pasar el
// ratón por la barra, que en el teléfono no existe.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { TicketMantenimiento } from '../../../../types'
import GanttMantenimientoTab from '../GanttMantenimientoTab'

const ticket = (o: Partial<TicketMantenimiento>): TicketMantenimiento => ({
  id: 't?', company_id: 'co1', project_id: 'p1', tipo: 'correctivo', titulo: '?', prioridad: 'media', estado: 'abierto',
  foto_urls: [], archivo_urls: [], created_at: '2026-11-01T14:30:00Z', updated_at: '2026-11-01T14:30:00Z', ...o,
})
const PINTURA = ticket({
  id: 't1', titulo: 'Pintura lobby', prioridad: 'alta', estado: 'cerrado', unidad_nombre: 'Lobby', asignado_a: 'Luis Gómez',
  created_at: '2026-10-01T09:00:00Z', fecha_cierre: '2026-10-11T15:00:00Z', costo_estimado: 2000, costo_real: 1850,
  descripcion: 'Dos manos de esmalte lavable.', notas_cierre: 'Quedó sin marcas.',
})
const FUGA = ticket({ id: 't2', titulo: 'Fuga en bomba 2', prioridad: 'urgente', estado: 'en_proceso', created_at: '2026-11-01T09:00:00Z' })

const montar = (tickets = [PINTURA, FUGA]) => render(<GanttMantenimientoTab tickets={tickets} moneda="Q" />)
const abrir = (titulo: string) => fireEvent.click(screen.getByRole('button', { name: titulo }))
const ficha = (titulo: string) => screen.getByRole('dialog', { name: titulo })
const pie = (titulo: string) => ficha(titulo).querySelector('.at-modal-footer') as HTMLElement

afterEach(cleanup)

describe('GanttMantenimientoTab — la fila abre la ficha en ventana', () => {
  it('sin pulsar nada sólo hay filas; la fila abre la ficha a pantalla completa en el teléfono con el tramo de la barra', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Pintura lobby' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fuga en bomba 2' })).toBeTruthy()
    expect(screen.queryByText('Dos manos de esmalte lavable.')).toBeNull()

    abrir('Pintura lobby')
    const v = ficha('Pintura lobby')
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('📍 Lobby')).toBeTruthy()
    expect(within(v).getByText('👤 Luis Gómez')).toBeTruthy()
    expect(within(v).getAllByText('Alta')).toHaveLength(2)
    expect(within(v).getByText('Q 2000.00')).toBeTruthy()
    expect(within(v).getByText('Q 1850.00')).toBeTruthy()
    expect(within(v).getByText('2026-10-01')).toBeTruthy()
    expect(within(v).getByText('2026-10-11')).toBeTruthy()
    expect(within(v).getByText('10 días')).toBeTruthy()
    expect(within(v).getByText('Dos manos de esmalte lavable.')).toBeTruthy()
    expect(within(v).getByText('Quedó sin marcas.')).toBeTruthy()
    // Sólo lectura: esta pestaña no edita el ticket.
    expect(within(pie('Pintura lobby')).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar'])
  })

  it('un ticket abierto muestra el tramo en curso hasta hoy; Cerrar y Escape cierran la ficha', () => {
    montar()
    abrir('Fuga en bomba 2')
    const v = ficha('Fuga en bomba 2')
    expect(within(v).getByText(/^En curso \(hoy \d{4}-\d{2}-\d{2}\)$/)).toBeTruthy()
    expect(within(v).getByText(/^\d+ días?$/)).toBeTruthy()
    fireEvent.click(within(pie('Fuga en bomba 2')).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    abrir('Fuga en bomba 2')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('los filtros dejan sólo esas filas y la vista de estadísticas no tiene filas', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'cerrado' } })
    expect(screen.getByRole('button', { name: 'Pintura lobby' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fuga en bomba 2' })).toBeNull()
    expect(screen.getByText('1 de 2 tickets')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '📈 Estadísticas' }))
    expect(screen.queryByRole('button', { name: 'Pintura lobby' })).toBeNull()
    expect(screen.getByText('Tiempo promedio de resolución por prioridad')).toBeTruthy()
  })
})
