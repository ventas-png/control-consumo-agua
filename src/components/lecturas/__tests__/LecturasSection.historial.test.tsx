// Nueva Lectura compara la lectura que se captura con la tendencia del
// contador, incluido el historial importado (lecturas que la empresa llevaba a
// mano): promedio de los últimos periodos, mismo mes del año anterior y el
// aviso de consumo anómalo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Cliente, Contador, Registro, Tarifa, Unidad } from '../../../types'

const h = vi.hoisted(() => ({ fetchHistorialLecturas: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/PermissionsContext', () => ({
  usePermissionsContext: () => ({ canEdit: () => true, canDelete: () => true, canCreate: () => true }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../domain/agua/mutations', () => ({ registrarLectura: vi.fn(), uploadRegistroFoto: vi.fn() }))
vi.mock('../../../domain/rutas/mutations', () => ({ completeRelevantOcurrencia: vi.fn(), markRutaCompletada: vi.fn() }))
vi.mock('../../../lib/nativeGeo', () => ({ watchLocation: () => () => {} }))
vi.mock('../../../lib/platform', () => ({ isNative: () => false }))
vi.mock('../../../domain/agua/historialLecturas', () => ({ fetchHistorialLecturas: h.fetchHistorialLecturas }))

const { LecturasSection } = await import('../LecturasSection')

const unidad = { id: 'un-1', nombre: 'Apto 21B', project_id: 'p1', activo: true, cliente_id: null } as unknown as Unidad
const tarifa = { id: 't-1', nombre: 'Residencial', precio_m3: 5, canon_fijo: 0, consumo_minimo: 0, activa: true } as unknown as Tarifa
// La lectura inicial ya es la última del historial (490): así la dejó la importación.
const contador = {
  id: 'c-1', numero_serie: '21B-001', unidad_id: 'un-1', tarifa_id: 't-1', project_id: 'p1',
  lectura_inicial: 490, activo: true, tipo_agua: 'potable', fecha_instalacion: '2024-01-14',
} as unknown as Contador

const historial = [
  { fecha: '2025-11-30', lectura: 400, consumo: 9 },
  { fecha: '2026-05-31', lectura: 440, consumo: 10 },
  { fecha: '2026-06-30', lectura: 452, consumo: null },
  { fecha: '2026-07-31', lectura: 460, consumo: null },
  { fecha: '2026-08-31', lectura: 470, consumo: null },
  { fecha: '2026-09-30', lectura: 480, consumo: null },
  { fecha: '2026-10-31', lectura: 490, consumo: null },
].map((r, i) => ({ id: `h${i}`, contador_id: 'c-1', project_id: 'p1', notas: null, ...r }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T15:00:00'))
  h.fetchHistorialLecturas.mockReset()
  h.fetchHistorialLecturas.mockResolvedValue(historial)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

function elegirContador() {
  render(
    <LecturasSection
      clientes={[] as Cliente[]} unidades={[unidad]} contadores={[contador]} registros={[] as Registro[]}
      tarifas={[tarifa]} onRegistroAdded={() => {}}
    />,
  )
  fireEvent.change(screen.getByLabelText('Seleccionar Unidad'), { target: { value: 'un-1' } })
  fireEvent.change(screen.getByLabelText('Seleccionar Contador'), { target: { value: 'c-1' } })
}

describe('Nueva Lectura — tendencia con el historial importado', () => {
  it('muestra el promedio de los últimos 6 periodos y el mismo mes del año anterior', async () => {
    elegirContador()
    await waitFor(() => expect(h.fetchHistorialLecturas).toHaveBeenCalledWith(['c-1']))
    const caja = await screen.findByTestId('tendencia-consumo')
    // 10, 12, 8, 10, 10, 10 → 10.00 (los consumos que faltaban salen de restar lecturas).
    expect(caja.textContent).toContain('Promedio de los últimos 6 periodos: 10.00 m³')
    expect(caja.textContent).toContain('Mismo mes del año anterior (nov 2025): 9.00 m³')
    expect(caja.textContent).toContain('Incluye 7 lecturas del historial importado.')
  })

  it('una lectura muy por encima del promedio dice cuántas veces y avisa', async () => {
    elegirContador()
    await screen.findByTestId('tendencia-consumo')
    fireEvent.change(screen.getByLabelText('Lectura Actual'), { target: { value: '525' } })
    expect(screen.getByTestId('tendencia-consumo').textContent).toContain('esta lectura: 3.5×')
    expect(screen.getByText(/El consumo \(35\) es 3× mayor que el promedio histórico \(10\.0\)/)).toBeTruthy()
  })

  it('sin historial ni lecturas no muestra comparación', async () => {
    h.fetchHistorialLecturas.mockResolvedValue([])
    elegirContador()
    await waitFor(() => expect(h.fetchHistorialLecturas).toHaveBeenCalled())
    expect(screen.queryByTestId('tendencia-consumo')).toBeNull()
  })

  it('la fecha de la lectura anterior es la de la última lectura del historial, no la de instalación', async () => {
    elegirContador()
    await screen.findByTestId('tendencia-consumo')
    const fecha = screen.getByLabelText('Fecha Lectura Anterior') as HTMLInputElement
    await waitFor(() => expect(fecha.value).toBe('2026-10-31'))
    // Del 31 de octubre al 17 de noviembre: 17 días, no los ~1 000 desde la instalación.
    expect((screen.getByDisplayValue('17 días') as HTMLInputElement).id).toBe('lectura-dias-servicio')
  })

  it('sin historial, la primera lectura sigue partiendo de la fecha de instalación', async () => {
    h.fetchHistorialLecturas.mockResolvedValue([])
    elegirContador()
    await waitFor(() => expect(h.fetchHistorialLecturas).toHaveBeenCalled())
    expect((screen.getByLabelText('Fecha Lectura Anterior') as HTMLInputElement).value).toBe('2024-01-14')
  })
})
