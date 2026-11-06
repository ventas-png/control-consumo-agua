// Cumpleaños: cada día del calendario es un botón que abre sus cumpleaños en ventana (EditModal real, pantalla
// completa en el teléfono) con Cerrar / Día anterior / Día siguiente en el pie; la lista de próximos 30 días también
// abre el día. Antes los nombres sólo se leían en un tooltip, que en el teléfono no existe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { PersonalCondominio } from '../../../../types'
import { CumpleanosTab } from '../CumpleanosTab'

const persona = (id: string, nombre: string, fecha: string): PersonalCondominio =>
  ({ id, nombre, cargo: 'conserje', fecha_nacimiento: fecha } as unknown as PersonalCondominio)

const personal = [persona('p1', 'Marta Juárez', '1990-08-18'), persona('p2', 'Luis Pérez', '1985-08-19')]
const residentes = [{ id: 'c1', nombre: 'Ana Ruiz', fecha_nacimiento: '1995-08-22', unidad_nombre: 'A-101' }]

const celda = (nombre: RegExp) => screen.getByRole('button', { name: nombre })
const ficha = (titulo: string) => screen.getByRole('dialog', { name: titulo })
const pie = (titulo: string) => ficha(titulo).querySelector('.at-modal-footer') as HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 18, 14, 30, 0))   // martes 18/ago/2026
})
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('CumpleanosTab — ventana del día', () => {
  it('tocar un día abre una ventana con sus cumpleaños (pantalla completa en el teléfono); el pie navega por días y Cerrar la cierra', () => {
    render(<CumpleanosTab personal={personal} clientesBirthday={residentes} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(celda(/^Martes 18 de agosto de 2026, 1 cumpleaños$/)).toBeTruthy()
    expect(celda(/^Jueves 20 de agosto de 2026$/)).toBeTruthy()

    fireEvent.click(celda(/^Martes 18 de agosto de 2026/))
    const v = ficha('🎂 Martes 18 de agosto')
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('2026 · 1 cumpleaños')).toBeTruthy()
    expect(within(v).getByText('Marta Juárez')).toBeTruthy()
    expect(within(v).getByText('👷 Conserje · 36 años')).toBeTruthy()
    expect(within(v).getByText('Personal')).toBeTruthy()
    expect(within(pie('🎂 Martes 18 de agosto')).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '‹ Día anterior', 'Día siguiente ›'])

    fireEvent.click(within(pie('🎂 Martes 18 de agosto')).getByRole('button', { name: 'Día siguiente ›' }))
    const manana = ficha('🎂 Miércoles 19 de agosto')
    expect(within(manana).getByText('Luis Pérez')).toBeTruthy()
    expect(within(manana).getByText('👷 Conserje · 41 años')).toBeTruthy()

    fireEvent.click(within(pie('🎂 Miércoles 19 de agosto')).getByRole('button', { name: 'Día siguiente ›' }))
    expect(within(ficha('🎂 Jueves 20 de agosto')).getByText('Sin cumpleaños')).toBeTruthy()

    fireEvent.click(within(pie('🎂 Jueves 20 de agosto')).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('al cruzar de mes el calendario sigue al día abierto; Escape cierra', () => {
    render(<CumpleanosTab personal={personal} clientesBirthday={residentes} />)
    fireEvent.click(celda(/^Lunes 31 de agosto de 2026$/))
    fireEvent.click(within(pie('🎂 Lunes 31 de agosto')).getByRole('button', { name: 'Día siguiente ›' }))
    expect(ficha('🎂 Martes 1 de septiembre')).toBeTruthy()
    expect(screen.getByText('Septiembre 2026')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('la lista de próximos 30 días abre el día de cada cumpleaños (con la edad que cumple ese día), y el filtro también aplica a la ventana', () => {
    render(<CumpleanosTab personal={personal} clientesBirthday={residentes} />)
    // Nació en 1995 y cumple el 22/08/2026: 31, no 32 (antes se sumaba un año a todo lo que no fuera hoy).
    expect(screen.getByRole('button', { name: 'Ver cumpleaños del 22/08' }).textContent).toContain('31 años')
    fireEvent.click(screen.getByRole('button', { name: 'Ver cumpleaños del 22/08' }))
    const v = ficha('🎂 Sábado 22 de agosto')
    expect(within(v).getByText('Ana Ruiz')).toBeTruthy()
    expect(within(v).getByText('🏠 A-101 · 31 años')).toBeTruthy()
    expect(within(v).getByText('Residente')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '👷 Personal' }))
    expect(celda(/^Sábado 22 de agosto de 2026$/)).toBeTruthy()
    fireEvent.click(celda(/^Sábado 22 de agosto de 2026$/))
    expect(within(ficha('🎂 Sábado 22 de agosto')).getByText('Sin cumpleaños')).toBeTruthy()
  })
})
