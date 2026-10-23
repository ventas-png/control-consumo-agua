// Dashboard de sostenibilidad (gastos): los montos usan el formato regional
// (es-GT), y cada mes —desde la tabla, «Ver» o la barra de la gráfica— abre en
// ventana su desglose por categoría y los gastos que lo forman; en el teléfono
// la tabla sólo muestra el total.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { GastoCondominio, Unidad } from '../../../../types'

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))

const { default: DashboardSostenibilidadTab } = await import('../DashboardSostenibilidadTab')

function gasto(over: Partial<GastoCondominio>): GastoCondominio {
  return {
    id: 'g', company_id: 'co1', project_id: 'p1', concepto: 'Gasto', categoria: 'servicios',
    monto: 100, fecha: '2026-09-05', proveedor_nombre: null, estado: 'pagado', created_at: '2026-09-05T10:00:00Z',
    ...over,
  } as GastoCondominio
}

const gastos = [
  gasto({ id: 'g1', concepto: 'Factura EEGSA', monto: 12345.67, fecha: '2026-09-05', proveedor_nombre: 'EEGSA' }),
  gasto({ id: 'g2', concepto: 'Limpieza de cisterna', categoria: 'limpieza', monto: 654.33, fecha: '2026-09-20', estado: 'pendiente' }),
  // No cuentan: otra categoría y un gasto anulado.
  gasto({ id: 'g3', concepto: 'Papelería', categoria: 'administrativo', monto: 999, fecha: '2026-09-21' }),
  gasto({ id: 'g4', concepto: 'Factura duplicada', monto: 5000, fecha: '2026-09-22', estado: 'anulado' }),
  gasto({ id: 'g5', concepto: 'Agua municipal', monto: 300, fecha: '2026-10-03' }),
]
const unidades = [{ id: 'u1', activo: true }, { id: 'u2', activo: true }] as unknown as Unidad[]

const montar = () => render(<DashboardSostenibilidadTab gastos={gastos} unidades={unidades} moneda="Q" />)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)) // 15 oct 2026
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Dashboard de sostenibilidad', () => {
  it('los montos van en formato es-GT (12,345.67), no el de España (12.345,67)', () => {
    montar()
    // getByText normaliza el espacio duro a uno normal; textContent lo conserva.
    expect(screen.getAllByText('Q 13,300.00')[0].textContent).toBe('Q\u00a013,300.00') // total 12m
    expect(screen.queryByText(/12\.345,67/)).toBeNull()
  })

  it('«Ver» abre el desglose del mes con sus gastos (sin anulados ni otras categorías)', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ver gastos de Sep 2026' }))
    const ventana = screen.getByRole('dialog', { name: '🌿 Gastos de Sep 2026' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(ventana).getByText('Q 13,000.00')).toBeTruthy()
    expect(within(ventana).getByText('Gastos del mes (2)')).toBeTruthy()
    expect(within(ventana).getAllByRole('listitem').map(li => li.querySelector('div > div')?.textContent))
      .toEqual(['Limpieza de cisterna', 'Factura EEGSA'])
    expect(within(ventana).getByText('2026-09-20 · Limpieza · Pendiente de pago')).toBeTruthy()
    expect(within(ventana).getByText('2026-09-05 · Agua y Energía · EEGSA')).toBeTruthy()
    // Por unidad activa: 13,000 / 2.
    expect(within(ventana).getByText('Q 6,500.00')).toBeTruthy()
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tocar la fila o la barra de la gráfica abre el mismo desglose; el mes actual se marca en curso', () => {
    const { container } = montar()
    fireEvent.click(within(container.querySelector('tbody')!).getByText('Oct 2026'))
    expect(screen.getByRole('dialog', { name: '🌿 Gastos de Oct 2026' })).toBeTruthy()
    expect(screen.getByText('Mes en curso · servicios, limpieza y obras')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Ver gastos de Sep 2026: Q\u00a013,000.00' }))
    expect(screen.getByRole('dialog', { name: '🌿 Gastos de Sep 2026' })).toBeTruthy()
  })

  it('un mes sin gastos lo dice', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Ver gastos de Ago 2026' }))
    expect(within(screen.getByRole('dialog')).getByText('Sin gastos de servicios, limpieza u obras este mes.')).toBeTruthy()
  })
})

// El mes en curso se compara con el mismo tramo del mes anterior (del 1 al
// mismo día). Antes se comparaba contra el promedio de doce meses completos y a
// mitad de mes siempre salía muy por debajo.
describe('Dashboard de sostenibilidad — variación del mes', () => {
  const kpi = () => screen.getByText('Mes en curso vs. mes anterior').parentElement!

  it('compara del 1 al 15 de octubre contra del 1 al 15 de septiembre', () => {
    montar()
    expect(screen.getByText('Sostenibilidad · gastos')).toBeTruthy()
    // Sep 1–15: 12,345.67 (el de limpieza del 20 queda fuera); Oct 1–15: 300.
    expect(within(kpi()).getByText('-97.6%')).toBeTruthy()
    expect(within(kpi()).getByText('1–15 Oct vs. 1–15 Sep')).toBeTruthy()
  })

  it('un alza de 10 % o más se marca; sin gastos el mes anterior no hay porcentaje', () => {
    render(<DashboardSostenibilidadTab gastos={[
      gasto({ id: 'a', monto: 100, fecha: '2026-09-10' }),
      gasto({ id: 'b', monto: 150, fecha: '2026-10-10' }),
      // No cuentan: otra categoría y un anulado.
      gasto({ id: 'c', categoria: 'administrativo', monto: 1000, fecha: '2026-10-05' }),
      gasto({ id: 'd', monto: 1000, fecha: '2026-09-05', estado: 'anulado' }),
    ]} unidades={unidades} moneda="Q" />)
    expect(within(kpi()).getByText('+50.0%').style.color).toBe('var(--at-danger)')
    cleanup()

    render(<DashboardSostenibilidadTab gastos={[gasto({ id: 'b', monto: 150, fecha: '2026-10-10' })]} unidades={unidades} moneda="Q" />)
    expect(within(kpi()).getByText('—')).toBeTruthy()
    expect(within(kpi()).getByText('Sin gastos del 1–15 Sep para comparar')).toBeTruthy()
  })
})
