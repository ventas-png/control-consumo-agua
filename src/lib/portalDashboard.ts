// Cómputo puro del dashboard del portal del residente (P1 #3, refactor de
// CustomerPortal): KPIs, comparativos 24m, series por contador con línea de
// tendencia (regresión lineal) y desgloses por tipo de agua y unidad. Antes
// vivía en un useMemo de ~185 líneas dentro del componente, sin tests.
import { parseFecha } from './format'
import { proyectarProximoRecibo, type ProyeccionRecibo } from './portalProyeccion'

export interface UnidadInfo {
  id: string
  nombre: string
  tipo: string
  piso: number | null
  area_m2: number | null
  project_id: string
  company_id: string
  activo: boolean
}

export interface ContadorInfo {
  id: string
  numero_serie: string
  tipo_agua: string
  descripcion: string | null
  activo: boolean
  unidad_id: string | null
  project_id: string
  company_id: string
}

export interface LecturaInfo {
  id: string
  fecha: string
  lectura_anterior: number
  lectura_actual: number
  consumo: number
  monto_calculado: number
  estado: string
  mes: string | null
  fecha_lectura_anterior: string | null
  dias_servicio: number | null
  tipo_cobro: string
  contador_id: string | null
  cliente_id?: string | null
  project_id?: string | null
  foto?: string | null
  // Snapshot de la tarifa aplicada en la lectura (para proyectar el próximo
  // recibo sin bajar la config de tarifas). Opcionales: no todas las lecturas
  // los traen y las proyecciones degradan a 0 si faltan.
  tarifa_aplicada?: number | null
  tarifa_exceso_aplicada?: number | null
  canon_aplicado?: number | null
}

/** Fila de la referencia anónima de la comunidad (RPC agua_consumo_comunidad). */
export interface ComunidadMensual {
  /** Primer día del mes (YYYY-MM-DD). */
  mes: string
  n_residentes: number
  mediana_m3: number
  p25_m3: number
  p75_m3: number
  promedio_m3: number
}

/** Comparación del consumo del residente vs la mediana de su comunidad. */
export interface ComparativoComunidad {
  /** Mes comparado (el más reciente con dato del residente y de la comunidad). */
  mesLabel: string
  tuConsumo: number
  mediana: number
  n_residentes: number
  /** % del residente respecto a la mediana (100 = igual a la mediana). */
  pctDeMediana: number
  /** Posición cualitativa respecto a la banda p25–p75 de la comunidad. */
  posicion: 'bajo' | 'tipico' | 'alto'
}

export const TIPO_AGUA_LABELS: Record<string, string> = {
  potable: 'Agua Potable',
  rehuso: 'Agua de Rehúso',
  piscina: 'Piscina',
  desalinada: 'Agua Desalinada',
  riego: 'Riego',
  jacuzzi: 'Jacuzzi',
  consumo_humano: 'Consumo Humano',
  desmineralizada: 'Desmineralizada',
  residuales_tratadas: 'Residuales Tratadas',
}

export const MESES_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export interface PortalDashboardInputs {
  lecturas: LecturaInfo[]
  contadores: ContadorInfo[]
  unidades: UnidadInfo[]
  /** IDs de registros que tienen foto (la foto se baja aparte, bajo demanda). */
  fotoRegistroIds?: Set<string>
  selectedProjectId: string | null
  selectedUnidadId: string | null
  selectedTipoAgua: string | null
  chartMonthsBack: number
  chartCustomStart: string
  chartCustomEnd: string
  chartRangeMode: 'preset' | 'custom'
  chartMetric: 'm3' | 'moneda'
  /** Referencia anónima de la comunidad (mediana mensual por residente). */
  comunidad?: ComunidadMensual[]
  /** Inyectable en tests; default: ahora. */
  ahora?: Date
}

export function construirDashboardData(inputs: PortalDashboardInputs) {
  const {
    lecturas, contadores, unidades, selectedProjectId, selectedUnidadId,
    selectedTipoAgua, chartMonthsBack, chartCustomStart, chartCustomEnd,
    chartRangeMode, chartMetric,
  } = inputs
    const comunidad = inputs.comunidad ?? []
    const fotoRegistroIds = inputs.fotoRegistroIds ?? new Set<string>()
    const now = inputs.ahora ?? new Date()
    const curY = now.getFullYear()
    const curM = now.getMonth()

    // Three-level drill-down: project → unidad → tipo de agua
    // Resolve project via unidad when counter's own project_id is stale/incorrect
    const filteredContadoresByProject = selectedProjectId
      ? contadores.filter(c => {
          const u = unidades.find(un => un.id === c.unidad_id)
          return (u?.project_id ?? c.project_id) === selectedProjectId
        })
      : contadores
    const filteredContadoresByUnidad = selectedUnidadId
      ? filteredContadoresByProject.filter(c => c.unidad_id === selectedUnidadId)
      : filteredContadoresByProject
    // Collect available water types before applying tipo_agua filter (for UI pills)
    const availableTiposAgua = [...new Set(filteredContadoresByUnidad.map(c => c.tipo_agua))]
    const filteredContadores = selectedTipoAgua
      ? filteredContadoresByUnidad.filter(c => c.tipo_agua === selectedTipoAgua)
      : filteredContadoresByUnidad
    const filteredContadorIds = new Set(filteredContadores.map(c => c.id))
    const filteredLecturas = lecturas.filter(l =>
      l.contador_id != null && filteredContadorIds.has(l.contador_id)
    )

    const sameYM = (fecha: string, y: number, m: number) => {
      const d = parseFecha(fecha)
      return d.getFullYear() === y && d.getMonth() === m
    }

    // KPI 1: consumo mes actual
    const consumoMesActual = filteredLecturas
      .filter(l => sameYM(l.fecha, curY, curM))
      .reduce((s, l) => s + (l.consumo || 0), 0)

    // KPI 2: promedio mensual últimos 12 meses
    const monthBuckets: Record<string, number> = {}
    for (let i = 1; i <= 12; i++) {
      const d = new Date(curY, curM - i, 1)
      monthBuckets[`${d.getFullYear()}-${d.getMonth()}`] = 0
    }
    filteredLecturas.forEach(l => {
      const d = parseFecha(l.fecha)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (key in monthBuckets) monthBuckets[key] += (l.consumo || 0)
    })
    const bucketVals = Object.values(monthBuckets)
    const consumoPromedio = bucketVals.length > 0
      ? bucketVals.reduce((a, b) => a + b, 0) / bucketVals.length
      : 0

    // KPI 3: monto pendiente
    const montoPendiente = filteredLecturas
      .filter(l => l.estado === 'pendiente' || l.estado === 'mora')
      .reduce((s, l) => s + (l.monto_calculado || 0), 0)

    // KPI 4: contadores activos
    const contadoresActivos = filteredContadores.filter(c => c.activo).length

    // Fixed 24 months for comparison baseline (independent of display range)
    const all24Consumo: number[] = []
    for (let i = 23; i >= 0; i--) {
      const d = new Date(curY, curM - i, 1)
      const y = d.getFullYear(); const m = d.getMonth()
      const sliceLec = filteredLecturas.filter(l => sameYM(l.fecha, y, m))
      all24Consumo.push(parseFloat(sliceLec.reduce((s, l) => s + (l.consumo || 0), 0).toFixed(2)))
    }

    // Compute chart months array — single source of truth for labels + per-counter data
    const chartMonths: { y: number; m: number; label: string }[] = []
    if (chartRangeMode === 'custom' && chartCustomStart && chartCustomEnd) {
      const [sy, sm] = chartCustomStart.split('-').map(Number)
      const [ey, em] = chartCustomEnd.split('-').map(Number)
      const iter = new Date(sy, sm - 1, 1)
      const end = new Date(ey, em - 1, 1)
      while (iter <= end) {
        chartMonths.push({ y: iter.getFullYear(), m: iter.getMonth(), label: `${MESES_LABELS[iter.getMonth()]} ${iter.getFullYear()}` })
        iter.setMonth(iter.getMonth() + 1)
      }
    } else {
      for (let i = chartMonthsBack - 1; i >= 0; i--) {
        const d = new Date(curY, curM - i, 1)
        chartMonths.push({ y: d.getFullYear(), m: d.getMonth(), label: `${MESES_LABELS[d.getMonth()]} ${d.getFullYear()}` })
      }
    }
    const chartLabels = chartMonths.map(cm => cm.label)
    const chartCurrentMonthIdx = chartMonths.findIndex(cm => cm.y === curY && cm.m === curM)

    // Per-counter datasets — one dataset per active counter
    const CHART_COLOR_SETS = [
      { full: 'var(--at-primary)', soft: 'rgba(27, 59, 54,0.5)' },
      { full: 'var(--at-success)', soft: 'rgba(16,185,129,0.5)' },
      { full: 'var(--at-warning)', soft: 'rgba(245,158,11,0.5)' },
      { full: 'var(--at-accent)', soft: 'rgba(185, 106, 63,0.5)' },
      { full: 'var(--at-danger)', soft: 'rgba(239,68,68,0.5)' },
      { full: '#ec4899', soft: 'rgba(236,72,153,0.5)' },
      { full: 'var(--at-accent-2)', soft: 'rgba(87, 123, 105,0.5)' },
      { full: 'var(--at-warning)', soft: 'rgba(249,115,22,0.5)' },
    ]
    const chartDatasets = filteredContadores.map((contador, idx) => {
      const colorSet = CHART_COLOR_SETS[idx % CHART_COLOR_SETS.length]
      const label = contador.descripcion || contador.numero_serie
      const data = chartMonths.map(({ y, m }) => {
        const cLec = filteredLecturas.filter(l => l.contador_id === contador.id && sameYM(l.fecha, y, m))
        const val = cLec.reduce((s, l) => s + (chartMetric === 'm3' ? (l.consumo || 0) : (l.monto_calculado || 0)), 0)
        return parseFloat(val.toFixed(2))
      })
      return { label, data, colorSet }
    })

    // Linear regression trend line across aggregated monthly totals
    const monthTotals = chartMonths.map((_, mi) =>
      chartDatasets.reduce((sum, ds) => sum + (ds.data[mi] ?? 0), 0)
    )
    const n = monthTotals.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    monthTotals.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x })
    const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0
    const intercept = n > 0 ? (sumY - slope * sumX) / n : 0
    const trendData = monthTotals.map((_, x) =>
      parseFloat(Math.max(0, slope * x + intercept).toFixed(2))
    )

    // ── Referencia de la comunidad (O5/V6) ──────────────────────────────────
    // Mediana mensual de la comunidad alineada a los meses del gráfico. Solo
    // tiene sentido en m³ (el RPC no expone importes de otros residentes); la
    // UI la muestra únicamente cuando chartMetric === 'm3'.
    const comunidadPorYM = new Map<string, ComunidadMensual>()
    for (const c of comunidad) {
      const d = parseFecha(c.mes)
      comunidadPorYM.set(`${d.getFullYear()}-${d.getMonth()}`, c)
    }
    const medianaComunidadData: (number | null)[] = chartMonths.map(({ y, m }) => {
      const c = comunidadPorYM.get(`${y}-${m}`)
      return c ? c.mediana_m3 : null
    })

    // Comparación puntual: mes más reciente en el que HAY dato de la comunidad y
    // el residente tuvo consumo (independiente de la ventana visible del gráfico).
    let comparativoComunidad: ComparativoComunidad | null = null
    const comunidadDesc = [...comunidad].sort((a, b) => (a.mes < b.mes ? 1 : a.mes > b.mes ? -1 : 0))
    for (const c of comunidadDesc) {
      const d = parseFecha(c.mes)
      const tu = filteredLecturas
        .filter(l => sameYM(l.fecha, d.getFullYear(), d.getMonth()))
        .reduce((s, l) => s + (l.consumo || 0), 0)
      if (tu > 0) {
        comparativoComunidad = {
          mesLabel: `${MESES_LABELS[d.getMonth()]} ${d.getFullYear()}`,
          tuConsumo: parseFloat(tu.toFixed(2)),
          mediana: c.mediana_m3,
          n_residentes: c.n_residentes,
          pctDeMediana: c.mediana_m3 > 0 ? Math.round((tu / c.mediana_m3) * 100) : 100,
          posicion: tu < c.p25_m3 ? 'bajo' : tu > c.p75_m3 ? 'alto' : 'tipico',
        }
        break
      }
    }

    // ── Proyección del próximo recibo (O5) ──────────────────────────────────
    // Estimación a partir del promedio reciente por medidor valorado con su
    // última tarifa conocida (snapshot en la lectura). Ver lib/portalProyeccion.
    const proyeccion: ProyeccionRecibo = proyectarProximoRecibo(filteredLecturas)

    // Comparaciones (always based on fixed 24m baseline)
    const consumoPrevMes = all24Consumo[22] ?? 0
    const consumoSameLastYear = all24Consumo[11] ?? 0
    const vsAnterior = consumoPrevMes > 0
      ? ((consumoMesActual - consumoPrevMes) / consumoPrevMes) * 100 : null
    const vsAnioAnterior = consumoSameLastYear > 0
      ? ((consumoMesActual - consumoSameLastYear) / consumoSameLastYear) * 100 : null

    // Desglose por tipo de agua
    const tipoAguaMap: Record<string, { label: string; count: number; consumoMes: number; consumo12m: number }> = {}
    const twelveMonthsAgo = new Date(curY, curM - 11, 1)
    filteredContadores.forEach(c => {
      if (!tipoAguaMap[c.tipo_agua])
        tipoAguaMap[c.tipo_agua] = { label: TIPO_AGUA_LABELS[c.tipo_agua] ?? c.tipo_agua, count: 0, consumoMes: 0, consumo12m: 0 }
      tipoAguaMap[c.tipo_agua].count++
      const cLec = filteredLecturas.filter(l => l.contador_id === c.id)
      tipoAguaMap[c.tipo_agua].consumoMes += cLec.filter(l => sameYM(l.fecha, curY, curM)).reduce((s, l) => s + (l.consumo || 0), 0)
      tipoAguaMap[c.tipo_agua].consumo12m += cLec.filter(l => parseFecha(l.fecha) >= twelveMonthsAgo).reduce((s, l) => s + (l.consumo || 0), 0)
    })

    // Desglose por unidad
    const visibleUnidades = selectedProjectId
      ? unidades.filter(u => u.project_id === selectedProjectId)
      : unidades

    const unidadBreakdown = visibleUnidades.map(unidad => {
      const uContadores = filteredContadores.filter(c => c.unidad_id === unidad.id)
      const meters = uContadores.map(contador => {
        const cLec = filteredLecturas
          .filter(l => l.contador_id === contador.id)
          .sort((a, b) => parseFecha(b.fecha).getTime() - parseFecha(a.fecha).getTime())
        const consumoMes = cLec.filter(l => sameYM(l.fecha, curY, curM)).reduce((s, l) => s + (l.consumo || 0), 0)
        const consumo12m = cLec.filter(l => parseFecha(l.fecha) >= twelveMonthsAgo).reduce((s, l) => s + (l.consumo || 0), 0)
        const ultimaLectura = cLec[0] ?? null
        // If current month has no reading yet, show the most recent month with data
        let consumoMesLabel = 'Este mes'
        let consumoMesDisplay = consumoMes
        if (consumoMes === 0 && ultimaLectura) {
          const lastD = parseFecha(ultimaLectura.fecha)
          consumoMesDisplay = cLec
            .filter(l => sameYM(l.fecha, lastD.getFullYear(), lastD.getMonth()))
            .reduce((s, l) => s + (l.consumo || 0), 0)
          consumoMesLabel = `${MESES_LABELS[lastD.getMonth()]} ${lastD.getFullYear()}`
        }
        // Fotos: última y penúltima lectura con foto. La presencia de foto viene
        // del set `fotoRegistroIds` (consultado aparte); los bytes se bajan bajo
        // demanda al renderizar la miniatura, no aquí.
        const withFoto = cLec.filter(l => fotoRegistroIds.has(l.id))
        return { contador, consumoMes, consumo12m, consumoMesDisplay, consumoMesLabel, ultimaLectura, fotoActual: withFoto[0] ?? null, fotoAnterior: withFoto[1] ?? null }
      })
      return { unidad, meters }
    })

    const lecturasTotal = lecturas.length
    const filteredLecturasCount = filteredLecturas.length

    return {
      consumoMesActual, consumoPromedio, montoPendiente, contadoresActivos,
      consumoPrevMes, consumoSameLastYear, vsAnterior, vsAnioAnterior,
      chartLabels, chartDatasets, chartCurrentMonthIdx, trendData,
      medianaComunidadData, comparativoComunidad, proyeccion,
      availableTiposAgua, tipoAguaMap, unidadBreakdown,
      lecturasTotal, filteredLecturasCount,
    }
}

export type PortalDashboardData = ReturnType<typeof construirDashboardData>
