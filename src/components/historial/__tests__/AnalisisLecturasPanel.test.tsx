// Historial → «Análisis gráfico»: filtros (proyecto / unidades / contadores y
// período) y lo que se grafica. Chart.js se reemplaza: aquí se prueba qué datos
// salen, no el dibujo del canvas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, Cliente, Contador, Unidad, Proyecto } from '../../../types'

const h = vi.hoisted(() => ({
  charts: [] as Array<{ data: { datasets: Array<{ label: string; data: number[] }> } }>,
  historial: vi.fn(async () => ({ filas: [] as unknown[], error: false })),
}))

vi.mock('../../../lib/chartjs', () => ({
  Chart: class {
    constructor(_canvas: unknown, config: (typeof h.charts)[number]) { h.charts.push(config) }
    destroy() {}
  },
}))
vi.mock('../../../domain/agua/historialLecturas', () => ({
  fetchHistorialLecturasProyectoResultado: h.historial,
}))
vi.mock('../../../domain/agua/mutations', () => ({
  cambiarEstadoRegistro: vi.fn(async () => ({ error: null })),
  deleteRegistro: vi.fn(async () => ({ error: null, count: 1 })),
}))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: true })) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))

import { AnalisisLecturasPanel } from '../AnalisisLecturasPanel'
import { HistorialSection } from '../HistorialSection'

const proyectos = [{ id: 'p1', nombre: 'Edificio 21B' } as Proyecto]
const unidades = [
  { id: 'u1', project_id: 'p1', nombre: 'Ap-101', cliente_id: 'c1' },
  { id: 'u2', project_id: 'p1', nombre: 'Ap-102', cliente_id: 'c2' },
] as Unidad[]
const clientes = [{ id: 'c1', nombre: 'Ana' }, { id: 'c2', nombre: 'Beto' }] as Cliente[]
const contadores = [
  { id: 'k1', project_id: 'p1', numero_serie: 'MED-001', unidad_id: 'u1', tipo_agua: 'potable', activo: true },
  { id: 'k2', project_id: 'p1', numero_serie: 'MED-002', unidad_id: 'u2', tipo_agua: 'potable', activo: true },
] as Contador[]

const reg = (id: string, contador: string, fecha: string, consumo: number, lectura: number): Registro => ({
  id, cliente_id: 'c1', cliente_nombre: 'Ana', contador_id: contador, project_id: 'p1', fecha,
  lectura_anterior: lectura - consumo, lectura_actual: lectura, consumo,
  tarifa_aplicada: 1, canon_aplicado: 0, monto_calculado: consumo, tipo_cobro: '', estado: 'pendiente',
} as Registro)

const registros = [
  reg('r1', 'k1', '2026-11-20', 10, 110),
  reg('r2', 'k2', '2026-11-21', 4, 54),
  reg('r3', 'k1', '2026-09-20', 7, 93),
  reg('r4', 'k1', '2026-03-20', 50, 50), // fuera de 3 meses, dentro de 12
]

function panel() {
  return render(
    <AnalisisLecturasPanel
      registros={registros} contadores={contadores} unidades={unidades}
      clientes={clientes} proyectos={proyectos} tiposAgua={{ potable: 'Agua Potable' }}
    />,
  )
}

const indicador = (titulo: string) => screen.getByText(titulo).parentElement as HTMLElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 26, 11, 0))
  h.charts.length = 0
  h.historial.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('AnalisisLecturasPanel', () => {
  it('suma el consumo de la ventana elegida', () => {
    panel()
    // 12 meses por defecto: dic 2025 – nov 2026.
    expect(within(indicador('Consumo del período')).getByText('71.00 m³')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '3 meses' }))
    expect(within(indicador('Consumo del período')).getByText('21.00 m³')).toBeTruthy()
    expect(within(indicador('Lecturas realizadas')).getByText('3')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '1 mes' }))
    expect(within(indicador('Consumo del período')).getByText('14.00 m³')).toBeTruthy()
    // La ventana se dice en palabras, no sólo en la gráfica.
    expect(screen.getByText('Período:').parentElement?.textContent).toBe('Período: nov 2026')
  })

  it('con un solo proyecto pide su historial importado', () => {
    panel()
    expect(h.historial).toHaveBeenCalledWith('p1')
  })

  it('por contadores: con uno marcado grafica las lecturas de su medidor', () => {
    panel()
    fireEvent.click(screen.getByRole('radio', { name: 'Contadores' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /MED-002/ }))
    expect(within(indicador('Consumo del período')).getByText('4.00 m³')).toBeTruthy()
    expect(screen.getByText('📈 Lecturas del medidor MED-002')).toBeTruthy()
  })

  it('compara unidades con una línea por unidad', () => {
    panel()
    fireEvent.click(screen.getByRole('radio', { name: 'Unidades' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Ap-101/ }))
    expect((screen.getByRole('radio', { name: 'Comparar' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Ap-102/ }))
    h.charts.length = 0
    fireEvent.click(screen.getByRole('radio', { name: 'Comparar' }))
    const consumo = h.charts.find(c => c.data.datasets.some(d => d.label === 'Ap-101'))
    expect(consumo?.data.datasets.map(d => d.label)).toEqual(['Ap-101', 'Ap-102'])
    expect(consumo?.data.datasets[0].data.at(-1)).toBe(10)
    expect(consumo?.data.datasets[1].data.at(-1)).toBe(4)
  })

  it('sin lecturas en la ventana lo dice en vez de graficar vacío', () => {
    render(
      <AnalisisLecturasPanel
        registros={[reg('r9', 'k1', '2024-01-10', 5, 5)]} contadores={contadores} unidades={unidades}
        clientes={clientes} proyectos={proyectos} tiposAgua={{}}
      />,
    )
    expect(screen.getByText(/No hay lecturas entre/)).toBeTruthy()
  })
})

describe('HistorialSection → pestaña Análisis gráfico', () => {
  it('cambia la tabla por el análisis y oculta las acciones de la tabla', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <HistorialSection
          registros={registros} clientes={clientes} contadores={contadores} unidades={unidades}
          proyectos={proyectos} userRole="admin" moneda="Q" onEstadoUpdated={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Excel/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Análisis gráfico/ }))
    expect(await screen.findByText('Consumo del período')).toBeTruthy()
    expect(screen.queryByText(/Excel/)).toBeNull()
    // Elegir 3 meses, ir a la tabla y volver: el análisis conserva el filtro.
    fireEvent.click(screen.getByRole('radio', { name: '3 meses' }))
    fireEvent.click(screen.getByRole('tab', { name: /Lecturas/ }))
    expect(screen.getByText(/Excel/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Análisis gráfico/ }))
    expect((screen.getByRole('radio', { name: '3 meses' })).getAttribute('aria-checked')).toBe('true')
  })
})
