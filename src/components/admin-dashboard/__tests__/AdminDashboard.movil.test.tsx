// Panel del administrador de agua en el teléfono: las filas de columnas fijas
// pasan a filas flexibles y las tablas anchas a tarjetas, sin cambiar los datos.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { Cliente, Contador, Proyecto, Registro, Unidad, UserSession } from '../../../types'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../domain/admin-dashboard/queries', () => ({
  fetchConvCountsForProject: vi.fn().mockResolvedValue({ sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0 }),
  // Una conversación abierta y sin asignar en p1: alimenta el desglose por proyecto.
  fetchConvRowsAllProjects: vi.fn().mockResolvedValue([
    { project_id: 'p1', status: 'abierta', assigned_to: null, created_at: new Date().toISOString(), closed_at: null },
  ]),
}))
vi.mock('../../lecturas/LecturasSection', () => ({ LecturasSection: () => null }))
vi.mock('../../../lib/chartjs', () => ({ Chart: class { destroy() {} } }))

import { AdminClientsList } from '../AdminClientsList'
import { AdminHistoryTab } from '../AdminHistoryTab'
import { AdminResumenProyectos } from '../AdminResumenProyectos'
import { AdminClientDashboard } from '../AdminClientDashboard'

const hoy = new Date().toISOString().slice(0, 10)

const clientes = [
  { id: 'c1', nombre: 'SERGIO ESTRADA', codigo: 'CLI-066' },
  { id: 'c2', nombre: 'ANA LÓPEZ', codigo: 'CLI-067' },
] as Cliente[]

function registro(over: Partial<Registro>): Registro {
  return {
    id: 'r1', cliente_id: 'c1', project_id: 'p1', fecha: `${hoy}T12:00:00Z`,
    lectura_anterior: 0, lectura_actual: 45, consumo: 45, tarifa_aplicada: 25, canon_aplicado: 0,
    monto_calculado: 1125, tipo_cobro: 'lectura', estado: 'pagado', ...over,
  } as Registro
}

const proyectos = [
  { id: 'p1', nombre: 'Cascadas', estado: 'activo' },
  { id: 'p2', nombre: 'Viñas del Sur', estado: 'activo' },
] as Proyecto[]

afterEach(cleanup)

describe('AdminClientsList', () => {
  it('cada cliente es una fila flexible (sin `1fr 1fr 1fr 1fr auto`) con los mismos datos', () => {
    render(<AdminClientsList clientes={clientes} registros={[registro({})]} moneda="Q" proyectoId="" />)
    const nombre = screen.getByText('SERGIO ESTRADA')
    const fila = nombre.parentElement!.parentElement!
    expect(fila.style.display).toBe('flex')
    expect(fila.style.flexWrap).toBe('wrap')
    expect(fila.style.gridTemplateColumns).toBe('')
    expect(within(fila).getByText('45.00 m³')).toBeTruthy()
    expect(within(fila).getByText('1125.00 Q')).toBeTruthy()
    expect(within(fila).getByText('✓ Pagado')).toBeTruthy()
  })
})

describe('AdminHistoryTab', () => {
  it('los filtros se acomodan en filas y la tabla pasa a tarjetas en el teléfono', () => {
    const { container } = render(<AdminHistoryTab registros={[registro({})]} clientes={clientes} moneda="Q" />)
    const buscador = screen.getByPlaceholderText('Buscar por cliente, código o ID...')
    const filaFiltros = buscador.parentElement!
    expect(filaFiltros.style.display).toBe('flex')
    expect(filaFiltros.style.flexWrap).toBe('wrap')
    expect(filaFiltros.style.gridTemplateColumns).toBe('')

    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    expect(within(tabla).getByText('SERGIO ESTRADA').closest('td')!.getAttribute('data-label')).toBe('Cliente')
  })

  it('el filtro por estado sigue filtrando', () => {
    render(<AdminHistoryTab registros={[registro({}), registro({ id: 'r2', cliente_id: 'c2', estado: 'mora' })]} clientes={clientes} moneda="Q" />)
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'mora' } })
    expect(screen.queryByText('SERGIO ESTRADA')).toBeNull()
    expect(screen.getByText('ANA LÓPEZ')).toBeTruthy()
  })
})

describe('AdminResumenProyectos', () => {
  it('el pie esconde las mismas columnas de tipología que el encabezado en el teléfono', () => {
    const contadores = [
      { id: 'k1', project_id: 'p1', tipo_agua: 'potable' },
      { id: 'k2', project_id: 'p2', tipo_agua: 'riego' },
    ] as Contador[]
    const { container } = render(
      <AdminResumenProyectos
        registros={[registro({ contador_id: 'k1' }), registro({ id: 'r2', project_id: 'p2', contador_id: 'k2' })]}
        contadores={contadores}
        proyectos={proyectos}
        unidades={[] as Unidad[]}
        moneda="Q"
        fechaDesde={hoy}
        fechaHasta={hoy}
      />,
    )
    const visibles = (celdas: NodeListOf<Element>) =>
      Array.from(celdas).filter(c => !c.classList.contains('table-col-secondary')).length
    const encabezado = container.querySelectorAll('thead th')
    const pie = container.querySelectorAll('tfoot td')
    expect(pie.length).toBe(encabezado.length)
    // Proyecto, Total m³ y Recaudo: lo único que queda en el teléfono, arriba y abajo.
    expect(visibles(encabezado)).toBe(3)
    expect(visibles(pie)).toBe(3)
  })
})

describe('AdminClientDashboard — desglose de comunicaciones por proyecto', () => {
  it('pasa a tarjetas en el teléfono y tocar un proyecto sigue filtrando el panel', async () => {
    const currentUser = { user_id: 'u1', role: 'admin', company_id: 'co1' } as UserSession
    render(
      <AdminClientDashboard
        currentUser={currentUser}
        data={{
          clientes, registros: [], proyectos, contadores: [],
          fuentesAgua: [], registrosCalidad: [], rutas: [], tarifas: [], unidades: [],
        }}
        moneda="Q"
        onDataRefresh={async () => {}}
      />,
    )
    const celdaProyecto = (await screen.findByText('Viñas del Sur', { selector: 'td' })).closest('td')!
    expect(celdaProyecto.getAttribute('data-label')).toBe('Proyecto')
    const tabla = celdaProyecto.closest('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)

    const filaCascadas = within(tabla).getByText('Cascadas').closest('tr')!
    const etiquetas = Array.from(filaCascadas.querySelectorAll('td')).map(td => [td.getAttribute('data-label'), td.textContent])
    expect(etiquetas).toEqual([
      ['Proyecto', 'Cascadas'], ['Sin asignar', '1'], ['Cerradas hoy', '0'],
      ['Críticas', '0'], ['Urgentes', '0'], ['En proceso', '1'],
    ])

    fireEvent.click(filaCascadas)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('p1')
  })
})
