// Panel turno — el buscador acota las listas de los bloques (visitantes dentro,
// tickets urgentes, tareas de hoy, reservas de hoy y vencimientos próximos) por
// nombre, unidad, título o estado, sin distinguir acentos ni mayúsculas. Los
// contadores (KPI y cabecera de cada bloque) siguen siendo los del turno.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { hoyLocalISO } from '../../../../lib/format'
import type {
  Visitante, TicketMantenimiento, TareaCondominio, ReservaAmenidad, VencimientoExtra,
} from '../../../../types'
import PanelTurnoTab from '../PanelTurnoTab'

const hoy = hoyLocalISO()

const visitante = (id: string, nombre: string, unidad: string, salio = false) => ({
  id, nombre, unidad_nombre: unidad, hora_entrada: `${hoy}T08:15:00`, hora_salida: salio ? `${hoy}T09:00:00` : null,
} as unknown as Visitante)
const ticket = (id: string, titulo: string, prioridad: string, estado = 'abierto') =>
  ({ id, titulo, prioridad, estado } as unknown as TicketMantenimiento)
const tarea = (id: string, titulo: string, estado = 'pendiente') =>
  ({ id, titulo, estado, fecha_limite: hoy } as unknown as TareaCondominio)
const reserva = (id: string, amenidad: string, unidad: string) =>
  ({ id, fecha: hoy, amenidad_nombre: amenidad, unidad_nombre: unidad, hora_inicio: '10:00', hora_fin: '12:00' } as unknown as ReservaAmenidad)
const vencimiento = (id: string, titulo: string) =>
  ({ id, titulo, fecha_vencimiento: hoy, renovado: false } as unknown as VencimientoExtra)

const base = {
  visitantes: [visitante('v1', 'Ana López', 'A-1'), visitante('v2', 'Pedro Ruiz', 'B-2'), visitante('v3', 'Ya Salió', 'C-3', true)],
  tickets: [ticket('t1', 'Fuga en bomba', 'urgente'), ticket('t2', 'Pintar banca', 'baja')],
  tareasCond: [tarea('ta1', 'Revisar piscina')],
  reservas: [reserva('r1', 'Piscina', 'A-1')],
  polizas: [], contratosProveedores: [], inspecciones: [],
  vencimientosExtra: [vencimiento('ve1', 'Extintores')],
  cuotas: [],
}

const buscador = () => screen.getByRole('searchbox', { name: 'Buscar en el panel' })
const kpi = (label: string) => screen.getByText(label).previousElementSibling?.textContent
const visible = (texto: string) => screen.queryByText(texto) !== null

afterEach(() => { cleanup() })

describe('Panel turno · buscador', () => {
  it('acota cada bloque por nombre, unidad, título o estado, sin distinguir acentos; los contadores no cambian', () => {
    render(<PanelTurnoTab {...base} />)
    expect(visible('Ana López') && visible('Pedro Ruiz') && visible('Fuga en bomba') && visible('Revisar piscina') && visible('Extintores')).toBe(true)
    // El de baja prioridad y quien ya salió nunca estuvieron en el panel.
    expect(visible('Pintar banca') || visible('Ya Salió')).toBe(false)
    expect(kpi('Dentro ahora')).toBe('2')

    fireEvent.change(buscador(), { target: { value: 'LOPEZ' } })
    expect(visible('Ana López')).toBe(true)
    expect(visible('Pedro Ruiz')).toBe(false)
    expect(kpi('Dentro ahora')).toBe('2')
    expect(screen.getByText('Ningún ticket urgente coincide con «LOPEZ»')).toBeTruthy()
    expect(screen.getByText('Ninguna tarea de hoy coincide con «LOPEZ»')).toBeTruthy()
    expect(screen.getByText('Ninguna reserva de hoy coincide con «LOPEZ»')).toBeTruthy()
    expect(screen.getByText('Ningún vencimiento próximo coincide con «LOPEZ»')).toBeTruthy()

    // «piscina» cruza bloques: la tarea y la reserva; ningún visitante.
    fireEvent.change(buscador(), { target: { value: 'piscina' } })
    expect(visible('Revisar piscina') && visible('Piscina')).toBe(true)
    expect(screen.getByText('Ningún visitante dentro coincide con «piscina»')).toBeTruthy()

    // Por unidad: la visitante de A-1 y la reserva de A-1.
    fireEvent.change(buscador(), { target: { value: 'a-1' } })
    expect(visible('Ana López')).toBe(true)
    expect(visible('Pedro Ruiz')).toBe(false)
    expect(visible('Piscina')).toBe(true)

    fireEvent.change(buscador(), { target: { value: 'extintores' } })
    expect(visible('Extintores')).toBe(true)
    expect(screen.getByText('Ningún visitante dentro coincide con «extintores»')).toBeTruthy()

    fireEvent.change(buscador(), { target: { value: '' } })
    expect(visible('Pedro Ruiz') && visible('Fuga en bomba')).toBe(true)
    expect(screen.queryByText(/coincide con/)).toBeNull()
  })

  it('sin búsqueda conserva los mensajes vacíos de siempre, y el «+N más» de visitantes cuenta sobre lo que coincide', () => {
    const muchos = Array.from({ length: 10 }, (_, i) => visitante(`m${i + 1}`, `Visita ${i + 1}`, `U-${i + 1}`))
    render(<PanelTurnoTab {...base} visitantes={muchos} tickets={[]} tareasCond={[]} reservas={[]} vencimientosExtra={[]} />)
    expect(screen.getByText('Sin tickets pendientes de alta prioridad ✓')).toBeTruthy()
    expect(screen.getByText('No hay tareas con vencimiento hoy')).toBeTruthy()
    expect(screen.getByText('Sin reservas para hoy')).toBeTruthy()
    expect(screen.queryByText(/Vencimientos en los próximos/)).toBeNull()
    expect(screen.getByText('+2 más')).toBeTruthy()

    // «visita 1» deja a Visita 1 y Visita 10: caben, no hay «más».
    fireEvent.change(buscador(), { target: { value: 'visita 1' } })
    expect(visible('Visita 1') && visible('Visita 10')).toBe(true)
    expect(visible('Visita 2')).toBe(false)
    expect(screen.queryByText(/más$/)).toBeNull()
    // Los bloques vacíos de verdad no cambian de mensaje por buscar.
    expect(screen.getByText('Sin reservas para hoy')).toBeTruthy()
    expect(screen.queryByText(/reserva de hoy coincide/)).toBeNull()
  })
})
