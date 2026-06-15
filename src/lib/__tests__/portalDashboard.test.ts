import { describe, it, expect } from 'vitest'
import {
  construirDashboardData,
  type ContadorInfo,
  type LecturaInfo,
  type PortalDashboardInputs,
  type UnidadInfo,
} from '../portalDashboard'

const AHORA = new Date('2026-06-15T12:00:00')

function contador(partial: Partial<ContadorInfo>): ContadorInfo {
  return {
    id: 'c1', numero_serie: 'SN-1', tipo_agua: 'potable', descripcion: null,
    activo: true, unidad_id: 'u1', project_id: 'p1', company_id: 'co1',
    ...partial,
  }
}

function unidad(partial: Partial<UnidadInfo>): UnidadInfo {
  return {
    id: 'u1', nombre: 'Apto 101', tipo: 'apartamento', piso: 1, area_m2: 80,
    project_id: 'p1', company_id: 'co1', activo: true,
    ...partial,
  }
}

function lectura(partial: Partial<LecturaInfo>): LecturaInfo {
  return {
    id: 'l1', fecha: '2026-06-10', lectura_anterior: 0, lectura_actual: 10,
    consumo: 10, monto_calculado: 50, estado: 'pendiente', mes: null,
    fecha_lectura_anterior: null, dias_servicio: null, tipo_cobro: 'normal',
    contador_id: 'c1',
    ...partial,
  }
}

function inputs(partial: Partial<PortalDashboardInputs>): PortalDashboardInputs {
  return {
    lecturas: [], contadores: [], unidades: [],
    selectedProjectId: null, selectedUnidadId: null, selectedTipoAgua: null,
    chartMonthsBack: 12, chartCustomStart: '', chartCustomEnd: '',
    chartRangeMode: 'preset', chartMetric: 'm3', ahora: AHORA,
    ...partial,
  }
}

describe('construirDashboardData', () => {
  it('sin datos: KPIs en cero y estructuras vacías', () => {
    const d = construirDashboardData(inputs({}))
    expect(d.consumoMesActual).toBe(0)
    expect(d.montoPendiente).toBe(0)
    expect(d.contadoresActivos).toBe(0)
    expect(d.chartDatasets).toEqual([])
    expect(d.chartLabels).toHaveLength(12)
    expect(d.unidadBreakdown).toEqual([])
  })

  it('KPIs: consumo del mes, pendiente (pendiente+mora) y contadores activos', () => {
    const d = construirDashboardData(inputs({
      contadores: [contador({}), contador({ id: 'c2', activo: false, unidad_id: 'u1' })],
      unidades: [unidad({})],
      lecturas: [
        lectura({ id: 'a', fecha: '2026-06-05', consumo: 7, monto_calculado: 35, estado: 'pendiente' }),
        lectura({ id: 'b', fecha: '2026-06-08', consumo: 3, monto_calculado: 15, estado: 'mora' }),
        lectura({ id: 'c', fecha: '2026-05-08', consumo: 99, monto_calculado: 99, estado: 'pagado' }),
      ],
    }))
    expect(d.consumoMesActual).toBe(10)
    expect(d.montoPendiente).toBe(50)
    expect(d.contadoresActivos).toBe(1)
    expect(d.consumoPrevMes).toBe(99)
    expect(d.vsAnterior).toBeCloseTo(((10 - 99) / 99) * 100)
  })

  it('filtro por tipo de agua: las pills muestran los tipos disponibles antes de filtrar', () => {
    const base = inputs({
      contadores: [contador({}), contador({ id: 'c2', tipo_agua: 'riego' })],
      unidades: [unidad({})],
      lecturas: [lectura({}), lectura({ id: 'l2', contador_id: 'c2', consumo: 5 })],
    })
    const todos = construirDashboardData(base)
    expect(todos.availableTiposAgua.sort()).toEqual(['potable', 'riego'])
    const soloRiego = construirDashboardData({ ...base, selectedTipoAgua: 'riego' })
    expect(soloRiego.availableTiposAgua.sort()).toEqual(['potable', 'riego'])
    expect(soloRiego.consumoMesActual).toBe(5)
    expect(soloRiego.chartDatasets).toHaveLength(1)
  })

  it('rango custom genera los meses del intervalo y la métrica moneda usa montos', () => {
    const d = construirDashboardData(inputs({
      contadores: [contador({})],
      unidades: [unidad({})],
      lecturas: [lectura({ fecha: '2026-03-10', consumo: 4, monto_calculado: 20 })],
      chartRangeMode: 'custom', chartCustomStart: '2026-02', chartCustomEnd: '2026-04',
      chartMetric: 'moneda',
    }))
    expect(d.chartLabels).toEqual(['Feb 2026', 'Mar 2026', 'Abr 2026'])
    expect(d.chartDatasets[0].data).toEqual([0, 20, 0])
  })

  it('la unidad muestra el último mes con datos cuando el mes actual va en cero', () => {
    const d = construirDashboardData(inputs({
      contadores: [contador({})],
      unidades: [unidad({})],
      lecturas: [lectura({ fecha: '2026-04-20', consumo: 8 })],
    }))
    const meter = d.unidadBreakdown[0].meters[0]
    expect(meter.consumoMes).toBe(0)
    expect(meter.consumoMesDisplay).toBe(8)
    expect(meter.consumoMesLabel).toBe('Abr 2026')
  })

  it('fotoActual/fotoAnterior se toman de fotoRegistroIds (más recientes con foto)', () => {
    const d = construirDashboardData(inputs({
      contadores: [contador({})],
      unidades: [unidad({})],
      lecturas: [
        lectura({ id: 'mas-nueva', fecha: '2026-06-12' }),       // sin foto
        lectura({ id: 'con-foto-1', fecha: '2026-06-10' }),       // con foto (más reciente con foto)
        lectura({ id: 'con-foto-2', fecha: '2026-05-10' }),       // con foto (anterior)
        lectura({ id: 'vieja', fecha: '2026-04-10' }),            // sin foto
      ],
      fotoRegistroIds: new Set(['con-foto-1', 'con-foto-2']),
    }))
    const meter = d.unidadBreakdown[0].meters[0]
    expect(meter.fotoActual?.id).toBe('con-foto-1')
    expect(meter.fotoAnterior?.id).toBe('con-foto-2')
  })

  it('sin fotoRegistroIds: no hay fotoActual/fotoAnterior aunque la lectura traiga `foto`', () => {
    const d = construirDashboardData(inputs({
      contadores: [contador({})],
      unidades: [unidad({})],
      lecturas: [lectura({ id: 'x', foto: 'data:image/jpeg;base64,AAAA' })],
    }))
    const meter = d.unidadBreakdown[0].meters[0]
    expect(meter.fotoActual).toBeNull()
    expect(meter.fotoAnterior).toBeNull()
  })

  it('resuelve el proyecto vía unidad cuando el project_id del contador está desfasado', () => {
    const d = construirDashboardData(inputs({
      contadores: [contador({ project_id: 'p-viejo' })],
      unidades: [unidad({ project_id: 'p1' })],
      lecturas: [lectura({})],
      selectedProjectId: 'p1',
    }))
    expect(d.consumoMesActual).toBe(10)
  })
})
