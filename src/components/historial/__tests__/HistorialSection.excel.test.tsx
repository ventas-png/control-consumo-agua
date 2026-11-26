// «📊 Excel» descarga lo que la tabla muestra con los filtros activos (todas
// las páginas), no todo el historial.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, Contador, Proyecto, Unidad, Cliente } from '../../../types'

const h = vi.hoisted(() => ({ writeXlsx: vi.fn(async () => {}) }))

vi.mock('../../../domain/agua/mutations', () => ({
  cambiarEstadoRegistro: vi.fn(async () => ({ error: null })),
  deleteRegistro: vi.fn(async () => ({ error: null, count: 1 })),
}))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: true })) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../../../domain/agua/historialLecturas', () => ({
  fetchHistorialLecturasProyectoResultado: vi.fn(async () => ({ filas: [], error: false })),
}))
vi.mock('../../../lib/xlsx', () => ({ writeXlsx: h.writeXlsx }))

import { HistorialSection } from '../HistorialSection'

const proyectos = [
  { id: 'p1', nombre: 'Viñas', company_id: 'co1' },
  { id: 'p2', nombre: 'Otro', company_id: 'co1' },
] as unknown as Proyecto[]
const contadores = [
  { id: 'c1', numero_serie: 'A-1', unidad_id: 'u1', project_id: 'p1' },
  { id: 'c2', numero_serie: 'B-1', unidad_id: 'u2', project_id: 'p2' },
] as unknown as Contador[]
const unidades = [
  { id: 'u1', nombre: 'Casa 1', project_id: 'p1' },
  { id: 'u2', nombre: 'Casa 2', project_id: 'p2' },
] as unknown as Unidad[]

function reg(id: string, contador: string, proyecto: string, estado: Registro['estado'], cliente: string): Registro {
  return {
    id, cliente_id: id, cliente_nombre: cliente, contador_id: contador, project_id: proyecto,
    fecha: '2026-11-10T15:00:00', lectura_anterior: 10, lectura_actual: 20, consumo: 10,
    tarifa_aplicada: 5, canon_aplicado: 20, monto_calculado: 70, tipo_cobro: 'Consumo', estado,
  }
}
// 25 lecturas del proyecto Viñas (más de una página de 20) y 3 del otro.
const registros = [
  ...Array.from({ length: 25 }, (_, i) => reg(`v${i}`, 'c1', 'p1', i % 2 ? 'pagado' : 'pendiente', `Vecino ${i}`)),
  ...Array.from({ length: 3 }, (_, i) => reg(`o${i}`, 'c2', 'p2', 'pendiente', `Otro ${i}`)),
]

function renderSection(regs: Registro[] = registros) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <HistorialSection
        registros={regs} clientes={[] as Cliente[]} unidades={unidades} proyectos={proyectos} contadores={contadores}
        userRole="admin" moneda="Q" onEstadoUpdated={vi.fn()} onRegistroDeleted={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

const botonExcel = () => screen.getByRole('button', { name: /Excel/ }) as HTMLButtonElement
type Llamada = [string, { name: string; rows: unknown[][] }[]]
const ultimaLlamada = () => h.writeXlsx.mock.calls.at(-1) as unknown as Llamada

beforeEach(() => h.writeXlsx.mockClear())
afterEach(cleanup)

describe('HistorialSection — descarga a Excel', () => {
  it('sin filtros descarga todas las lecturas, no sólo la página visible', async () => {
    renderSection()
    fireEvent.click(botonExcel())
    await waitFor(() => expect(h.writeXlsx).toHaveBeenCalledTimes(1))
    const [nombre, hojas] = ultimaLlamada()
    expect(nombre).toMatch(/^historial-lecturas-\d{4}-\d{2}-\d{2}$/)
    expect(hojas.map(s => s.name)).toEqual(['Lecturas', 'Resumen'])
    expect(hojas[0].rows).toHaveLength(1 + 28)
  })

  it('respeta los filtros: proyecto y estado', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    fireEvent.change(screen.getByDisplayValue('Todos los Proyectos'), { target: { value: 'p1' } })
    fireEvent.change(screen.getByDisplayValue('Todos los Estados'), { target: { value: 'pagado' } })
    fireEvent.click(botonExcel())
    await waitFor(() => expect(h.writeXlsx).toHaveBeenCalledTimes(1))
    const [nombre, hojas] = ultimaLlamada()
    expect(nombre).toMatch(/^historial-lecturas-vinas-/)
    const filas = hojas[0].rows.slice(1)
    expect(filas).toHaveLength(12)
    expect(filas.every(f => f[1] === 'Viñas' && f[10] === 'Pagado')).toBe(true)
    const resumen = hojas[1].rows
    expect(resumen.find(r => r[0] === 'Proyecto')?.[1]).toBe('Viñas')
    expect(resumen.find(r => r[0] === 'Estado')?.[1]).toBe('Pagado')
  })

  it('sin lecturas que mostrar, el botón queda deshabilitado', () => {
    renderSection([])
    expect(botonExcel().disabled).toBe(true)
  })
})
