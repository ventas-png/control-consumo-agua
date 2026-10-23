// Sostenibilidad (residuos y agua): las gráficas muestran los seis meses
// completos —también los vacíos y sin perder febrero a fin de mes—, las cifras
// usan el formato regional, y cada mes o tipo de residuo abre en ventana los
// registros que lo forman.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { RegistroResiduo } from '../../../../types'

const mocks = vi.hoisted(() => ({
  agua: { data: [] as { mes: string; m3: number }[], isLoading: false },
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/agua/queries', () => ({ useConsumoMensualPorProyectoQuery: () => mocks.agua }))

const { SostenibilidadTab } = await import('../SostenibilidadTab')

function registro(over: Partial<RegistroResiduo>): RegistroResiduo {
  return {
    id: 'r', company_id: 'co1', project_id: 'p1', fecha: '2026-09-10', tipo_residuo: 'reciclable',
    cantidad_kg: 10, punto_acopio: null, empresa_recolectora: null, estado: 'pendiente',
    incidencia: false, descripcion_incidencia: null, registrado_por: null, notas: null,
    created_at: '2026-09-10T10:00:00Z',
    ...over,
  }
}

const residuos = [
  registro({ id: 'a', fecha: '2026-09-10', cantidad_kg: 1200.5, punto_acopio: 'Sótano 1' }),
  registro({ id: 'b', fecha: '2026-09-20', tipo_residuo: 'peligroso', cantidad_kg: 3, incidencia: true, descripcion_incidencia: 'Baterías sueltas' }),
  registro({ id: 'c', fecha: '2026-07-02', cantidad_kg: 20, estado: 'procesado' }),
  // Fuera de los seis meses: cuenta en «por tipo», no en «por mes».
  registro({ id: 'd', fecha: '2026-01-05', cantidad_kg: 50 }),
]

const montar = (r = residuos) => render(<SostenibilidadTab residuos={r} proyectoId="p1" companyId="co1" />)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)) // 15 oct 2026
  mocks.agua = { data: [{ mes: '2026-09', m3: 12000 }, { mes: '2026-10', m3: 345 }], isLoading: false }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Sostenibilidad — cifras y meses', () => {
  it('las cifras llevan separador de miles y la unidad pegada', () => {
    montar()
    // getByText normaliza el espacio duro a uno normal; textContent lo conserva.
    // (El KPI y el panel de CO₂ la muestran.)
    expect(screen.getAllByText('12,345 m³').map(e => e.textContent)).toEqual(['12,345\u00a0m³', '12,345\u00a0m³'])
    expect(screen.getByText('1,274 kg')).toBeTruthy() // 1200.5 + 3 + 20 + 50
  })

  it('residuos por mes muestra los seis meses, también los vacíos; sólo los que tienen registros se abren', () => {
    montar()
    for (const mes of ['May 2026', 'Jun 2026', 'Ago 2026', 'Oct 2026']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^Ver residuos de ${mes}`) })).toBeNull()
    }
    expect(screen.getByRole('button', { name: /^Ver residuos de Sep 2026: 2 registros/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Ver residuos de Jul 2026: 1 registro,/ })).toBeTruthy()
    expect(screen.queryByText('Ene 2026')).toBeNull()
    // El agua también lista los seis meses (antes sólo los que tenían lecturas).
    expect(screen.getAllByText('Jun 2026')).toHaveLength(2)
  })

  it('el 31 de julio la ventana empieza en febrero (antes saltaba a marzo)', () => {
    vi.setSystemTime(new Date(2026, 6, 31, 20, 0, 0))
    montar([registro({ id: 'f', fecha: '2026-02-10', cantidad_kg: 7 })])
    expect(screen.getByRole('button', { name: /^Ver residuos de Feb 2026: 1 registro, 7\.0\u00a0kg/ })).toBeTruthy()
  })
})

describe('Sostenibilidad — % de reciclaje', () => {
  it('cuenta lo reciclable y lo electrónico, igual que la pestaña Residuos', () => {
    montar([
      registro({ id: 'a', tipo_residuo: 'reciclable', cantidad_kg: 30 }),
      registro({ id: 'b', tipo_residuo: 'electronico', cantidad_kg: 10 }),
      registro({ id: 'c', tipo_residuo: 'organico', cantidad_kg: 60 }),
    ])
    expect(screen.getByRole('heading', { name: 'Sostenibilidad · residuos' })).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('reciclable + electrónico')).toBeTruthy()
    // El CO₂ ahorrado sale de esos mismos 40 kg (1.5 kg por kg reciclado).
    expect(screen.getByText('40 kg')).toBeTruthy() // reciclado, en el panel de CO₂
    expect(screen.getByText('60 kg')).toBeTruthy() // KPI «CO₂ ahorrado»
  })

  it('sin kg registrados el porcentaje queda en blanco (antes, 0 %)', () => {
    montar([])
    const kpi = screen.getByText('% Reciclaje').parentElement!
    expect(within(kpi).getByText('—')).toBeTruthy()
  })
})

describe('Sostenibilidad — detalle en ventana', () => {
  it('un mes abre sus registros a pantalla completa, con la incidencia', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /^Ver residuos de Sep 2026/ }))
    const ventana = screen.getByRole('dialog', { name: '♻️ Residuos de Sep 2026' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(ventana).getByText(/2 registros · 1,203\.5 kg/)).toBeTruthy()
    const filas = within(ventana).getAllByRole('listitem')
    expect(filas.map(li => li.textContent)).toEqual([
      expect.stringContaining('⚠️ Peligroso'),
      expect.stringContaining('♻️ Reciclable'),
    ])
    expect(within(ventana).getByText('⚠ Incidencia: Baterías sueltas')).toBeTruthy()
    expect(within(ventana).getByText('2026-09-10 · Pendiente · Sótano 1')).toBeTruthy()
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('un tipo abre todo su historial, también lo que queda fuera de los seis meses', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /^Ver residuos de tipo Reciclable/ }))
    const ventana = screen.getByRole('dialog', { name: '♻️ Reciclable' })
    expect(within(ventana).getByText(/3 registros · 1,270\.5 kg · todo el historial/)).toBeTruthy()
    expect(within(ventana).getAllByRole('listitem').map(li => li.textContent?.slice(0, 10)))
      .toEqual(['2026-09-10', '2026-07-02', '2026-01-05'])
  })

  it('sin registros no hay filas que abrir', () => {
    mocks.agua = { data: [], isLoading: false }
    montar([])
    expect(screen.getByText('Sin datos de residuos')).toBeTruthy()
    expect(screen.getByText('Sin datos de consumo de agua')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
