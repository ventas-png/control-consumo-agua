// Desempeño — el buscador acota las tarjetas del ranking por nombre, cargo o turno
// sin distinguir acentos ni mayúsculas. El ranking (medallas) y los KPI de arriba
// no cambian: quien va segundo conserva su 🥈 aunque sea la única tarjeta visible.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { hoyLocalISO } from '../../../../lib/format'
import type { BloqueTurno, PersonalCondominio } from '../../../../types'
import { DesempenoPersonalTab } from '../DesempenoPersonalTab'

const hoy = hoyLocalISO()
const persona = (id: string, nombre: string, cargo: string, turno: string) =>
  ({ id, nombre, cargo, turno, estado: 'activo' } as unknown as PersonalCondominio)
const bloque = (id: string, personal_id: string, puntaje: number) =>
  ({ id, personal_id, fecha: hoy, estado: 'completado', puntaje_completitud: puntaje } as unknown as BloqueTurno)

const personal = [
  persona('p1', 'Ana López', 'conserje', 'diurno'),
  persona('p2', 'Pedro Ruiz', 'guardia', 'nocturno'),
  persona('p3', 'Sin Actividad', 'jardinero', 'diurno'),
]
const bloques = [bloque('b1', 'p1', 95), bloque('b2', 'p2', 80)]

const abrir = () => render(
  <DesempenoPersonalTab bloques={bloques} tareas={[]} revisiones={[]} rondas={[]} visitasControl={[]} personal={personal} />,
)
const buscador = () => screen.getByRole('searchbox', { name: 'Buscar colaborador' })
const kpi = (label: string) => screen.getByText(label).previousElementSibling?.textContent
const visibles = () => ['Ana López', 'Pedro Ruiz', 'Sin Actividad'].filter(n => screen.queryByText(n))

afterEach(() => { cleanup() })

describe('Desempeño · buscador', () => {
  it('acota las tarjetas por nombre, cargo o turno sin acentos; el ranking y los KPI no cambian', () => {
    abrir()
    // Quien no tiene actividad en el período nunca entra al ranking.
    expect(visibles()).toEqual(['Ana López', 'Pedro Ruiz'])
    expect(kpi('Personal activo')).toBe('2')
    expect(kpi('Puntaje promedio')).toBe('88%')
    expect(screen.getByText('🥇')).toBeTruthy()
    expect(screen.getByText('🥈')).toBeTruthy()

    fireEvent.change(buscador(), { target: { value: 'PEDRO' } })
    expect(visibles()).toEqual(['Pedro Ruiz'])
    // Sigue siendo el segundo del ranking, y los KPI siguen siendo de los dos.
    expect(screen.getByText('🥈')).toBeTruthy()
    expect(screen.queryByText('🥇')).toBeNull()
    expect(kpi('Personal activo')).toBe('2')
    expect(kpi('Puntaje promedio')).toBe('88%')

    fireEvent.change(buscador(), { target: { value: 'lopez' } })
    expect(visibles()).toEqual(['Ana López'])
    fireEvent.change(buscador(), { target: { value: 'conserje' } })
    expect(visibles()).toEqual(['Ana López'])
    fireEvent.change(buscador(), { target: { value: 'Nocturno' } })
    expect(visibles()).toEqual(['Pedro Ruiz'])

    fireEvent.change(buscador(), { target: { value: 'zzz' } })
    expect(visibles()).toEqual([])
    expect(screen.getByText('Nadie coincide con «zzz» en este período')).toBeTruthy()
    expect(kpi('Personal activo')).toBe('2')

    fireEvent.change(buscador(), { target: { value: '' } })
    expect(visibles()).toEqual(['Ana López', 'Pedro Ruiz'])
    expect(screen.queryByText(/Nadie coincide/)).toBeNull()
  })

  it('se combina con el filtro de cargo', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /^guardia$/i }))
    expect(visibles()).toEqual(['Pedro Ruiz'])
    fireEvent.change(buscador(), { target: { value: 'ana' } })
    expect(visibles()).toEqual([])
    expect(screen.getByText('Nadie coincide con «ana» en este período')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Todos los cargos' }))
    expect(visibles()).toEqual(['Ana López'])
  })
})
