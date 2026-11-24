// Lista de rutas filtrada por proyecto: el selector aparece cuando hay más de
// un proyecto (o rutas sueltas), filtra las tarjetas, recuerda la elección en
// la pestaña y la ruta nueva nace en el proyecto filtrado.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { Cliente, Contador, Proyecto, Ruta, Unidad } from '../../../types'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../domain/usuarios/queries', () => ({ fetchOperadoresAsignablesRuta: vi.fn(async () => []) }))
vi.mock('../../../domain/rutas/mutations', () => ({ createRuta: vi.fn(), updateRuta: vi.fn(), deleteRuta: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: vi.fn() }))

const { RutasSection } = await import('../RutasSection')

const PROYECTOS = [
  { id: 'p1', nombre: '21B+' },
  { id: 'p2', nombre: 'La Arboleda CVH' },
  { id: 'p3', nombre: 'Parajes Vermont' },
] as Proyecto[]

function r(id: string, nombre: string, project_id: string | null): Ruta {
  return { id, nombre, project_id, tipo_ruta: 'clientes', cliente_ids: [] } as unknown as Ruta
}

const RUTAS = [
  r('r1', 'Lectura Mensual 21B+ N7', 'p1'),
  r('r2', 'Lectura Mensual 21B+ N6', 'p1'),
  r('r3', 'La Arboleda', 'p2'),
  r('r4', 'Ruta vieja', null),
]

function renderRutas(opts: { proyectos?: Proyecto[]; rutas?: Ruta[]; companyId?: string } = {}) {
  return render(
    <RutasSection
      clientes={[] as Cliente[]}
      contadores={[] as Contador[]}
      unidades={[] as Unidad[]}
      proyectos={opts.proyectos ?? PROYECTOS}
      rutas={opts.rutas ?? RUTAS}
      userRole="admin"
      companyId={opts.companyId ?? 'emp-1'}
      onRutaAdded={() => {}}
      onRutaUpdated={() => {}}
      onRutaDeleted={() => {}}
      onEjecutarRuta={() => {}}
    />,
  )
}

const selector = () => screen.getByRole('combobox', { name: 'Filtrar rutas por proyecto' }) as HTMLSelectElement
const tarjetas = () => ['Lectura Mensual 21B+ N7', 'Lectura Mensual 21B+ N6', 'La Arboleda', 'Ruta vieja'].filter(n => screen.queryByText(n))

beforeEach(() => sessionStorage.clear())
afterEach(cleanup)

describe('RutasSection — filtro por proyecto', () => {
  it('ofrece todos los proyectos con su cantidad de rutas y «Sin proyecto» cuando hay', () => {
    renderRutas()
    const opciones = within(selector()).getAllByRole('option').map(o => o.textContent)
    expect(opciones).toEqual([
      'Todos los proyectos (4)',
      '21B+ (2)',
      'La Arboleda CVH (1)',
      'Parajes Vermont (0)',
      'Sin proyecto (1)',
    ])
    expect(tarjetas()).toHaveLength(4)
  })

  it('al elegir un proyecto sólo quedan sus rutas', () => {
    renderRutas()
    fireEvent.change(selector(), { target: { value: 'p1' } })
    expect(tarjetas()).toEqual(['Lectura Mensual 21B+ N7', 'Lectura Mensual 21B+ N6'])
    fireEvent.change(selector(), { target: { value: '__sin_proyecto__' } })
    expect(tarjetas()).toEqual(['Ruta vieja'])
    fireEvent.change(selector(), { target: { value: '' } })
    expect(tarjetas()).toHaveLength(4)
  })

  it('un proyecto sin rutas lo dice y permite volver a ver todas', () => {
    renderRutas()
    fireEvent.change(selector(), { target: { value: 'p3' } })
    expect(tarjetas()).toEqual([])
    expect(screen.getByText('Este proyecto no tiene rutas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas las rutas' }))
    expect(selector().value).toBe('')
    expect(tarjetas()).toHaveLength(4)
  })

  it('recuerda el proyecto elegido al volver a la pantalla en la misma pestaña', () => {
    renderRutas()
    fireEvent.change(selector(), { target: { value: 'p2' } })
    cleanup()
    renderRutas()
    expect(selector().value).toBe('p2')
    expect(tarjetas()).toEqual(['La Arboleda'])
  })

  it('la elección guardada es por empresa', () => {
    renderRutas({ companyId: 'emp-1' })
    fireEvent.change(selector(), { target: { value: 'p2' } })
    cleanup()
    renderRutas({ companyId: 'emp-2' })
    expect(selector().value).toBe('')
  })

  it('un filtro guardado que ya no existe se ignora y se ven todas', () => {
    sessionStorage.setItem('rutas:filtro-proyecto:emp-1', 'p-borrado')
    renderRutas()
    expect(selector().value).toBe('')
    expect(tarjetas()).toHaveLength(4)
  })

  it('con un solo proyecto y sin rutas sueltas no hay selector', () => {
    renderRutas({ proyectos: [PROYECTOS[0]], rutas: RUTAS.slice(0, 2) })
    expect(screen.queryByRole('combobox', { name: 'Filtrar rutas por proyecto' })).toBeNull()
    expect(tarjetas()).toHaveLength(2)
  })

  it('la ruta nueva nace en el proyecto filtrado', () => {
    renderRutas()
    fireEvent.change(selector(), { target: { value: 'p2' } })
    fireEvent.click(screen.getByText('+ Nueva Ruta'))
    const proyectoEditor = screen.getAllByRole('combobox').find(s => (s as HTMLSelectElement).value === 'p2')
    expect(proyectoEditor).toBeTruthy()
  })
})
