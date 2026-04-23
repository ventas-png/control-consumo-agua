import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import type { UserSession, Registro } from '../../types'
import { Chart, registerables } from 'chart.js'
import { CustomerPaymentsTab } from './CustomerPaymentsTab'
import { CustomerComunicacion } from './CustomerComunicacion'

Chart.register(...registerables)

interface Props {
  currentUser: UserSession
  onLogout: () => void
}

interface CompanyInfo {
  id: string
  nombre: string
}

interface ProjectInfo {
  id: string
  nombre: string
  company_id: string
  moneda: string
}

interface UnidadInfo {
  id: string
  nombre: string
  tipo: string
  piso: number | null
  area_m2: number | null
  project_id: string
  company_id: string
  activo: boolean
}

interface ContadorInfo {
  id: string
  numero_serie: string
  tipo_agua: string
  descripcion: string | null
  activo: boolean
  unidad_id: string | null
  project_id: string
  company_id: string
}

interface LecturaInfo {
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
}

interface ClienteContacto {
  email: string | null
  telefono: string | null
  whatsapp: string | null
  telefono_alterno: string | null
}

const TIPO_AGUA_LABELS: Record<string, string> = {
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

const ESTADO_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pendiente: { bg: '#fef3c7', color: '#92400e', label: 'Pendiente' },
  pagado: { bg: '#d1fae5', color: '#065f46', label: 'Pagado' },
  mora: { bg: '#fee2e2', color: '#991b1b', label: 'Mora' },
}

// Handles both 'YYYY-MM-DD' and full ISO timestamps ('YYYY-MM-DDTHH:mm:ssZ')
function parseFecha(fecha: string | null | undefined): Date {
  if (!fecha) return new Date(NaN)
  return new Date(fecha.includes('T') ? fecha : fecha + 'T12:00:00')
}

type PortalTab = 'dashboard' | 'servicios' | 'pagos' | 'perfil' | 'comunicacion'

export function CustomerPortal({ currentUser, onLogout }: Props) {
  const [tab, setTab] = useState<PortalTab>('dashboard')
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  const [companyActivoMap, setCompanyActivoMap] = useState<Record<string, boolean>>({})
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [unidades, setUnidades] = useState<UnidadInfo[]>([])
  const [contadores, setContadores] = useState<ContadorInfo[]>([])
  const [lecturas, setLecturas] = useState<LecturaInfo[]>([])
  const [registros, setRegistros] = useState<Registro[]>([])
  const [contactoEdit, setContactoEdit] = useState<ClienteContacto>({
    email: null, telefono: null, whatsapp: null, telefono_alterno: null,
  })
  const [savingContacto, setSavingContacto] = useState(false)
  const [contactoMsg, setContactoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedContador, setExpandedContador] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [photoModal, setPhotoModal] = useState<{ url: string; label: string } | null>(null)
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)
  const [chartMonthsBack, setChartMonthsBack] = useState(12)
  const [chartCustomStart, setChartCustomStart] = useState('')
  const [chartCustomEnd, setChartCustomEnd] = useState('')
  const [chartRangeMode, setChartRangeMode] = useState<'preset' | 'custom'>('preset')
  const [chartMetric, setChartMetric] = useState<'m3' | 'moneda'>('m3')
  const [selectedUnidadId, setSelectedUnidadId] = useState<string | null>(null)
  const [selectedTipoAgua, setSelectedTipoAgua] = useState<string | null>(null)

  const clienteId = currentUser.cliente_id

  const cargarDatos = useCallback(async () => {
    if (!clienteId) { setLoading(false); return }
    setLoading(true)
    try {
      const [
        { data: ccData },
        { data: uData },
        { data: rData },
        { data: clData },
      ] = await Promise.all([
        // Companies the client belongs to (with visibility flag)
        supabase
          .from('company_clientes')
          .select('company_id, activo, companies(id, nombre)')
          .eq('cliente_id', clienteId),
        // Active units
        supabase
          .from('unidades')
          .select('id, nombre, tipo, piso, area_m2, project_id, company_id, activo')
          .eq('cliente_id', clienteId)
          .eq('activo', true),
        // Reading history — all historical records (no date cap)
        supabase
          .from('registros')
          .select('id, cliente_id, cliente_nombre, contador_id, project_id, fecha, lectura_anterior, lectura_actual, consumo, tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado, monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, mes, fecha_lectura_anterior, dias_servicio, notas, foto')
          .eq('cliente_id', clienteId)
          .order('fecha', { ascending: false }),
        // Own contact info
        supabase
          .from('clientes')
          .select('email, telefono, whatsapp, telefono_alterno')
          .eq('id', clienteId)
          .single(),
      ])

      // Build companies list and activo map from junction
      const companyMap: Record<string, CompanyInfo> = {}
      const activoMap: Record<string, boolean> = {}
      if (ccData) {
        type CCRow = { company_id: string; activo: boolean | null; companies: unknown }
        for (const row of ccData as CCRow[]) {
          const co = row.companies as { id: string; nombre: string } | null
          if (co?.id) {
            companyMap[co.id] = co
            activoMap[co.id] = row.activo !== false
          }
        }
      }
      const companiesList = Object.values(companyMap)
      setCompanyActivoMap(activoMap)

      // Load active units first, then fetch contadores by their unidad_id
      const unidadesList = (uData as UnidadInfo[]) ?? []
      const unidadIds = unidadesList.map(u => u.id)
      let cData: ContadorInfo[] = []
      if (unidadIds.length > 0) {
        const { data: contData } = await supabase
          .from('contadores')
          .select('id, numero_serie, tipo_agua, descripcion, activo, unidad_id, project_id, company_id')
          .in('unidad_id', unidadIds)
          .eq('activo', true)
        cData = (contData as ContadorInfo[]) ?? []
      }
      setCompanies(companiesList)

      // Fetch projects for found companies
      if (companiesList.length > 0) {
        const { data: pData } = await supabase
          .from('projects')
          .select('id, nombre, company_id, moneda')
          .in('company_id', companiesList.map(c => c.id))
          .eq('estado', 'activo')
        setProjects((pData as ProjectInfo[]) ?? [])
      } else {
        setProjects([])
      }

      setUnidades(unidadesList)
      setContadores(cData)

      const REGISTROS_SELECT = 'id, cliente_id, cliente_nombre, contador_id, fecha, lectura_anterior, lectura_actual, consumo, tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado, monto_calculado, tipo_cobro, estado, monto_pagado, fecha_pago, mes, fecha_lectura_anterior, dias_servicio, notas, foto'

      let mergedLecturas: LecturaInfo[] = (rData as LecturaInfo[]) ?? []
      const mergeIn = (rows: unknown[] | null) => {
        if (!rows?.length) return
        const seen = new Set(mergedLecturas.map(l => l.id))
        const extra = (rows as LecturaInfo[]).filter(l => !seen.has(l.id))
        if (extra.length > 0) mergedLecturas = [...mergedLecturas, ...extra]
      }

      // Fallback 1: by contador_id — catches registros where cliente_id is wrong/null
      if (cData.length > 0) {
        const { data: byContador } = await supabase
          .from('registros').select(REGISTROS_SELECT)
          .in('contador_id', cData.map(c => c.id))
          .order('fecha', { ascending: false })
        mergeIn(byContador)
      }

      // Fallback 2: by project_id — catches registros where contador_id is also null
      // Only safe because RLS (after migration 20260420000023) restricts clients to their own data
      const unidadProjectIds = [...new Set(unidadesList.map(u => u.project_id).filter(Boolean))]
      if (unidadProjectIds.length > 0 && clienteId) {
        const { data: byProject } = await supabase
          .from('registros').select(REGISTROS_SELECT)
          .in('project_id', unidadProjectIds)
          .order('fecha', { ascending: false })
        // Extra safety: only keep rows for this client or for our counters
        const knownCounterIds = new Set(cData.map(c => c.id))
        const safe = (byProject as LecturaInfo[] | null)?.filter(l =>
          l.cliente_id === clienteId || (l.contador_id != null && knownCounterIds.has(l.contador_id))
        ) ?? []
        mergeIn(safe)
      }

      setLecturas(mergedLecturas)
      setRegistros(mergedLecturas as Registro[])

      if (clData) {
        setContactoEdit(clData as ClienteContacto)
      }
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  // ── Dashboard analytics (useMemo) ────────────────────────
  const MESES_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const dashboardData = useMemo(() => {
    const now = new Date()
    const curY = now.getFullYear()
    const curM = now.getMonth()

    // Three-level drill-down: project → unidad → tipo de agua
    const filteredContadoresByProject = selectedProjectId
      ? contadores.filter(c => c.project_id === selectedProjectId)
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
      { full: '#0ea5e9', soft: 'rgba(14,165,233,0.5)' },
      { full: '#10b981', soft: 'rgba(16,185,129,0.5)' },
      { full: '#f59e0b', soft: 'rgba(245,158,11,0.5)' },
      { full: '#8b5cf6', soft: 'rgba(139,92,246,0.5)' },
      { full: '#ef4444', soft: 'rgba(239,68,68,0.5)' },
      { full: '#ec4899', soft: 'rgba(236,72,153,0.5)' },
      { full: '#14b8a6', soft: 'rgba(20,184,166,0.5)' },
      { full: '#f97316', soft: 'rgba(249,115,22,0.5)' },
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
        // Fotos: última y penúltima lectura con foto
        const withFoto = cLec.filter(l => l.foto)
        return { contador, consumoMes, consumo12m, fotoActual: withFoto[0] ?? null, fotoAnterior: withFoto[1] ?? null }
      })
      return { unidad, meters }
    })

    const lecturasTotal = lecturas.length
    const filteredLecturasCount = filteredLecturas.length

    return {
      consumoMesActual, consumoPromedio, montoPendiente, contadoresActivos,
      consumoPrevMes, consumoSameLastYear, vsAnterior, vsAnioAnterior,
      chartLabels, chartDatasets, chartCurrentMonthIdx, trendData,
      availableTiposAgua, tipoAguaMap, unidadBreakdown,
      lecturasTotal, filteredLecturasCount,
    }
  }, [lecturas, contadores, unidades, selectedProjectId, selectedUnidadId, selectedTipoAgua, chartMonthsBack, chartCustomStart, chartCustomEnd, chartRangeMode, chartMetric])

  // ── Chart.js bar chart (per-counter, configurable range & metric) ──
  useEffect(() => {
    if (tab !== 'dashboard') return
    const timeout = setTimeout(() => {
      if (!chartRef.current) return
      if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null }
      const { chartLabels, chartDatasets, chartCurrentMonthIdx, trendData } = dashboardData
      const moneda = selectedProjectId
        ? (projects.find(p => p.id === selectedProjectId)?.moneda ?? projects[0]?.moneda ?? 'Q')
        : (projects[0]?.moneda ?? 'Q')
      const metricLabel = chartMetric === 'm3' ? 'm³' : moneda
      const hasTrend = trendData.some(v => v > 0)
      chartInstance.current = new Chart(chartRef.current, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: [
            ...chartDatasets.map(({ label, data, colorSet }) => ({
              type: 'bar' as const,
              label,
              data,
              backgroundColor: chartLabels.map((_, i) =>
                i === chartCurrentMonthIdx ? colorSet.full : colorSet.soft
              ),
              borderRadius: 6,
              borderSkipped: false,
            })),
            ...(hasTrend ? [{
              type: 'line' as const,
              label: 'Tendencia',
              data: trendData,
              borderColor: '#f59e0b',
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
              tension: 0.4,
              backgroundColor: 'transparent',
              order: -1,
            }] : []),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 400 },
          plugins: {
            legend: {
              display: chartDatasets.length > 1 || hasTrend,
              labels: {
                font: { size: 11 }, color: '#475569', boxWidth: 12, padding: 14,
                filter: item => item.text !== 'Tendencia' || hasTrend,
              },
            },
            tooltip: {
              backgroundColor: '#0f172a',
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: ctx => `  ${ctx.dataset.label}: ${(ctx.parsed.y ?? 0).toFixed(2)} ${metricLabel}`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 10 }, maxRotation: 45, color: '#94a3b8' },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { font: { size: 11 }, color: '#94a3b8', callback: v => `${v} ${metricLabel}` },
              border: { display: false },
            },
          },
        },
      })
    }, 50)
    return () => { clearTimeout(timeout); chartInstance.current?.destroy(); chartInstance.current = null }
  }, [tab, dashboardData, chartMetric, selectedProjectId, projects])

  async function guardarContacto() {
    if (!clienteId) return
    setSavingContacto(true)
    setContactoMsg(null)
    const { error } = await supabase
      .from('clientes')
      .update({
        email: contactoEdit.email?.trim() || null,
        telefono: contactoEdit.telefono?.trim() || null,
        whatsapp: contactoEdit.whatsapp?.trim() || null,
        telefono_alterno: contactoEdit.telefono_alterno?.trim() || null,
      })
      .eq('id', clienteId)

    setSavingContacto(false)
    if (error) {
      setContactoMsg({ type: 'error', text: 'No se pudo guardar. Intente nuevamente.' })
    } else {
      setContactoMsg({ type: 'success', text: 'Información de contacto actualizada correctamente.' })
    }
  }

  const hasServices = contadores.length > 0 || unidades.length > 0

  // ── Dashboard render ─────────────────────────────────────
  function renderDashboard() {
    const {
      consumoMesActual, consumoPromedio, montoPendiente, contadoresActivos,
      consumoPrevMes, consumoSameLastYear, vsAnterior, vsAnioAnterior,
      chartDatasets, availableTiposAgua, tipoAguaMap, unidadBreakdown,
      lecturasTotal, filteredLecturasCount,
    } = dashboardData

    const moneda = selectedProjectId
      ? (projects.find(p => p.id === selectedProjectId)?.moneda ?? projects[0]?.moneda ?? 'Q')
      : (projects[0]?.moneda ?? 'Q')

    const clienteProjects = projects.filter(p =>
      unidades.some(u => u.project_id === p.id) || contadores.some(c => c.project_id === p.id)
    )

    function PctCard({ label, pct, base, baseLabel }: { label: string; pct: number | null; base: number; baseLabel: string }) {
      const isNull = pct === null
      const positive = !isNull && pct! >= 0
      return (
        <div style={{ background: 'white', borderRadius: '14px', padding: '18px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', marginBottom: '8px' }}>{label}</div>
          {isNull ? (
            <span style={{ fontSize: '14px', color: '#94a3b8' }}>Sin datos</span>
          ) : (
            <span style={{ fontSize: '20px', fontWeight: 700, color: positive ? '#ef4444' : '#10b981' }}>
              {positive ? '▲' : '▼'} {Math.abs(pct!).toFixed(1)}%
            </span>
          )}
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '5px' }}>{baseLabel}: {base.toFixed(2)} m³</div>
        </div>
      )
    }

    return (
      <div>
        {/* Filtro de proyecto */}
        {clienteProjects.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', background: 'white', borderRadius: '12px', padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>🏗️ Proyecto:</span>
            <select
              value={selectedProjectId ?? ''}
              onChange={e => { setSelectedProjectId(e.target.value || null); setSelectedUnidadId(null); setSelectedTipoAgua(null) }}
              style={{ flex: 1, padding: '7px 12px', fontSize: '13.5px', border: '1.5px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', color: '#0f172a', cursor: 'pointer' }}
            >
              <option value="">Todos los proyectos</option>
              {clienteProjects.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        )}

        {/* Filtro de unidad */}
        {(() => {
          const visibleUnidades4Filter = (selectedProjectId
            ? unidades.filter(u => u.project_id === selectedProjectId)
            : unidades
          ).filter(u => contadores.some(c => c.unidad_id === u.id && c.activo))
          if (visibleUnidades4Filter.length < 2) return null
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', background: 'white', borderRadius: '12px', padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>🏠 Unidad:</span>
              <select
                value={selectedUnidadId ?? ''}
                onChange={e => { setSelectedUnidadId(e.target.value || null); setSelectedTipoAgua(null) }}
                style={{ flex: 1, padding: '7px 12px', fontSize: '13.5px', border: '1.5px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', color: '#0f172a', cursor: 'pointer' }}
              >
                <option value="">Todas las unidades</option>
                {visibleUnidades4Filter.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
          )
        })()}

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          {[
            { label: 'Consumo Mes Actual', value: `${consumoMesActual.toFixed(2)} m³`, icon: '💧', bg: 'linear-gradient(135deg, #0ea5e9, #0284c7)' },
            { label: 'Promedio Mensual', value: `${consumoPromedio.toFixed(2)} m³`, icon: '📊', bg: 'linear-gradient(135deg, #0d9488, #0f766e)' },
            { label: 'Monto Pendiente', value: `${moneda} ${montoPendiente.toFixed(2)}`, icon: '💳', bg: montoPendiente > 0 ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #10b981, #059669)' },
            { label: 'Contadores Activos', value: String(contadoresActivos), icon: '🔢', bg: 'linear-gradient(135deg, #6366f1, #4f46e5)' },
          ].map(card => (
            <div key={card.label} style={{ background: card.bg, borderRadius: '16px', padding: '20px', color: 'white', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: '22px', marginBottom: '10px' }}>{card.icon}</div>
              <div style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, marginBottom: '4px' }}>{card.value}</div>
              <div style={{ fontSize: '11.5px', opacity: 0.88 }}>{card.label}</div>
            </div>
          ))}
        </div>

        {/* Comparaciones */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          <PctCard label="vs Mes Anterior" pct={vsAnterior} base={consumoPrevMes} baseLabel="Mes ant." />
          <PctCard label="vs Mismo Mes Año Anterior" pct={vsAnioAnterior} base={consumoSameLastYear} baseLabel="Año ant." />
        </div>

        {/* Historial de Consumo */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '22px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '18px' }}>
          {/* Título + filtro tipo de agua */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>Historial de Consumo</div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
              {chartRangeMode === 'custom' && chartCustomStart && chartCustomEnd
                ? `${chartCustomStart} — ${chartCustomEnd} · ${chartMetric === 'm3' ? 'm³' : moneda}`
                : `Últimos ${chartMonthsBack} meses · ${chartMetric === 'm3' ? 'm³' : moneda}`}
            </div>
            </div>
            {availableTiposAgua.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                <button
                  onClick={() => setSelectedTipoAgua(null)}
                  style={{
                    padding: '4px 12px', fontSize: '11.5px', fontWeight: 600, borderRadius: '20px', cursor: 'pointer',
                    border: '1.5px solid', transition: 'all 0.15s',
                    background: selectedTipoAgua === null ? '#0ea5e9' : 'transparent',
                    borderColor: selectedTipoAgua === null ? '#0ea5e9' : '#cbd5e1',
                    color: selectedTipoAgua === null ? 'white' : '#475569',
                  }}
                >Todos</button>
                {availableTiposAgua.map(tipo => (
                  <button
                    key={tipo}
                    onClick={() => setSelectedTipoAgua(tipo)}
                    style={{
                      padding: '4px 12px', fontSize: '11.5px', fontWeight: 600, borderRadius: '20px', cursor: 'pointer',
                      border: '1.5px solid', transition: 'all 0.15s',
                      background: selectedTipoAgua === tipo ? '#0ea5e9' : 'transparent',
                      borderColor: selectedTipoAgua === tipo ? '#0ea5e9' : '#cbd5e1',
                      color: selectedTipoAgua === tipo ? 'white' : '#475569',
                    }}
                  >{TIPO_AGUA_LABELS[tipo] ?? tipo}</button>
                ))}
              </div>
            )}
          </div>
          {/* Controles: Período y Métrica */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>Período:</span>
            <div style={{ display: 'flex', borderRadius: '8px', border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
              {([6, 12, 24] as const).map(n => (
                <button
                  key={n}
                  onClick={() => { setChartMonthsBack(n); setChartRangeMode('preset') }}
                  style={{
                    padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                    border: 'none', borderRight: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.15s',
                    background: chartRangeMode === 'preset' && chartMonthsBack === n ? '#0ea5e9' : '#f8fafc',
                    color: chartRangeMode === 'preset' && chartMonthsBack === n ? 'white' : '#475569',
                  }}
                >{n}M</button>
              ))}
              <button
                onClick={() => {
                  setChartRangeMode('custom')
                  if (!chartCustomStart || !chartCustomEnd) {
                    const now = new Date()
                    const endStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                    const startYear = lecturas.length > 0
                      ? parseFecha(lecturas[lecturas.length - 1].fecha).getFullYear()
                      : now.getFullYear() - 2
                    const startStr = `${startYear}-01`
                    setChartCustomStart(startStr)
                    setChartCustomEnd(endStr)
                  }
                }}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: chartRangeMode === 'custom' ? '#0ea5e9' : '#f8fafc',
                  color: chartRangeMode === 'custom' ? 'white' : '#475569',
                }}
              >📅 Rango</button>
            </div>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: '6px' }}>Métrica:</span>
            <div style={{ display: 'flex', borderRadius: '8px', border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
              <button
                onClick={() => setChartMetric('m3')}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                  border: 'none', borderRight: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.15s',
                  background: chartMetric === 'm3' ? '#0ea5e9' : '#f8fafc',
                  color: chartMetric === 'm3' ? 'white' : '#475569',
                }}
              >m³</button>
              <button
                onClick={() => setChartMetric('moneda')}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: chartMetric === 'moneda' ? '#0ea5e9' : '#f8fafc',
                  color: chartMetric === 'moneda' ? 'white' : '#475569',
                }}
              >{moneda}</button>
            </div>
            {chartDatasets.length === 1 && (
              <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#64748b', alignItems: 'center', marginLeft: 'auto' }}>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: '#0ea5e9', marginRight: '4px' }} />Mes actual</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'rgba(14,165,233,0.45)', marginRight: '4px' }} />Anteriores</span>
                <span><span style={{ display: 'inline-block', width: '18px', height: '0px', borderTop: '2px dashed #f59e0b', marginRight: '4px', verticalAlign: 'middle' }} />Tendencia</span>
              </div>
            )}
          </div>
          {/* Inputs de rango personalizado — selectores Mes/Año */}
          {chartRangeMode === 'custom' && (() => {
            const now = new Date()
            const curYear = now.getFullYear()
            const years = Array.from({ length: curYear - 2018 + 2 }, (_, i) => 2018 + i)
            const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
            const selStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: '8px', border: '1.5px solid #7dd3fc', fontSize: '12.5px', color: '#0f172a', background: 'white', cursor: 'pointer' }

            function parseParts(val: string) {
              const [y, m] = (val || '').split('-')
              return { y: y || '', m: m || '' }
            }
            function buildVal(y: string, m: string) { return y && m ? `${y}-${m}` : '' }

            const startParts = parseParts(chartCustomStart)
            const endParts = parseParts(chartCustomEnd)

            return (
              <div style={{ display: 'flex', gap: '20px', marginBottom: '14px', alignItems: 'center', flexWrap: 'wrap', background: '#f0f9ff', borderRadius: '10px', padding: '10px 14px', border: '1px solid #bae6fd' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151' }}>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Desde:</span>
                  <select value={startParts.m} onChange={e => setChartCustomStart(buildVal(startParts.y, e.target.value))} style={selStyle}>
                    <option value="">Mes</option>
                    {meses.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                  </select>
                  <select value={startParts.y} onChange={e => setChartCustomStart(buildVal(e.target.value, startParts.m))} style={selStyle}>
                    <option value="">Año</option>
                    {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151' }}>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Hasta:</span>
                  <select value={endParts.m} onChange={e => setChartCustomEnd(buildVal(endParts.y, e.target.value))} style={selStyle}>
                    <option value="">Mes</option>
                    {meses.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                  </select>
                  <select value={endParts.y} onChange={e => setChartCustomEnd(buildVal(e.target.value, endParts.m))} style={selStyle}>
                    <option value="">Año</option>
                    {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
              </div>
            )
          })()}
          {/* Gráfico o estado vacío */}
          {lecturasTotal === 0 ? (
            <div style={{ height: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: '8px', background: '#f8fafc', borderRadius: '10px' }}>
              <span style={{ fontSize: '32px' }}>📊</span>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>Sin lecturas registradas aún</span>
              <span style={{ fontSize: '11.5px', textAlign: 'center', maxWidth: '280px' }}>Los datos aparecerán cuando se ingresen lecturas de consumo</span>
            </div>
          ) : filteredLecturasCount === 0 ? (
            <div style={{ height: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: '8px', background: '#f8fafc', borderRadius: '10px' }}>
              <span style={{ fontSize: '32px' }}>🔍</span>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>Sin lecturas para los contadores activos</span>
              <span style={{ fontSize: '11.5px', textAlign: 'center', maxWidth: '320px' }}>
                Hay {lecturasTotal} lectura{lecturasTotal !== 1 ? 's' : ''} en el sistema pero no coinciden con los contadores vinculados
              </span>
            </div>
          ) : (
            <div style={{ height: chartDatasets.length > 1 ? '300px' : '260px' }}><canvas ref={chartRef} /></div>
          )}
        </div>

        {/* Desglose por tipo de agua */}
        {Object.keys(tipoAguaMap).length > 0 && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '18px' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', marginBottom: '14px' }}>Desglose por Tipo de Agua</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Tipo de Agua', 'Contadores', 'Consumo Mes (m³)', 'Consumo 12 meses (m³)'].map(h => (
                      <th scope="col" key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '11.5px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(Object.entries(tipoAguaMap) as [string, { label: string; count: number; consumoMes: number; consumo12m: number }][]).map(([tipo, info]) => (
                    <tr key={tipo} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '20px', background: '#e0f2fe', color: '#0369a1', fontSize: '12px', fontWeight: 600 }}>
                          💧 {info.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#374151', textAlign: 'center' }}>{info.count}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0ea5e9', textAlign: 'right' }}>{info.consumoMes.toFixed(2)}</td>
                      <td style={{ padding: '10px 14px', color: '#374151', textAlign: 'right' }}>{info.consumo12m.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Desglose por unidad */}
        {unidadBreakdown.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', marginBottom: '12px' }}>Desglose por Unidad</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '14px' }}>
              {(unidadBreakdown as { unidad: UnidadInfo; meters: { contador: ContadorInfo; consumoMes: number; consumo12m: number; fotoActual: LecturaInfo | null; fotoAnterior: LecturaInfo | null }[] }[]).map(({ unidad, meters }) => {
                const project = projects.find(p => p.id === unidad.project_id)
                return (
                  <div key={unidad.id} style={{ background: 'white', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    {/* Header unidad */}
                    <div style={{ background: 'linear-gradient(135deg, #0d9488, #0ea5e9)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>🏠</div>
                      <div>
                        <div style={{ color: 'white', fontWeight: 700, fontSize: '14px' }}>{unidad.nombre}</div>
                        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '11px' }}>{unidad.tipo.replace(/_/g, ' ')}{project && ` · ${project.nombre}`}</div>
                      </div>
                    </div>
                    {/* Contadores */}
                    <div style={{ padding: '14px 16px' }}>
                      {meters.length === 0 ? (
                        <div style={{ color: '#94a3b8', fontSize: '12.5px', textAlign: 'center', padding: '8px 0' }}>Sin contadores asignados</div>
                      ) : meters.map(({ contador, consumoMes, consumo12m, fotoActual, fotoAnterior }) => (
                        <div key={contador.id} style={{ borderRadius: '10px', background: '#f8fafc', padding: '11px', border: '1px solid #e2e8f0', marginBottom: '10px' }}>
                          {/* Info medidor */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'linear-gradient(135deg, #0ea5e9, #0d9488)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>💧</div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a' }}>#{contador.numero_serie}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}</div>
                            </div>
                          </div>
                          {/* Stats */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: fotoActual || fotoAnterior ? '12px' : '0' }}>
                            {[
                              { lbl: 'Este mes', val: consumoMes.toFixed(2), color: '#0ea5e9' },
                              { lbl: 'Últimos 12m', val: consumo12m.toFixed(2), color: '#0d9488' },
                            ].map(s => (
                              <div key={s.lbl} style={{ background: 'white', borderRadius: '7px', padding: '7px 9px', border: '1px solid #e2e8f0' }}>
                                <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px' }}>{s.lbl}</div>
                                <div style={{ fontSize: '15px', fontWeight: 700, color: s.color }}>{s.val}</div>
                                <div style={{ fontSize: '9.5px', color: '#94a3b8' }}>m³</div>
                              </div>
                            ))}
                          </div>
                          {/* Fotos */}
                          {(fotoActual || fotoAnterior) && (
                            <div>
                              <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#64748b', marginBottom: '7px' }}>📷 Fotografías del Medidor</div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                {[
                                  { lectura: fotoAnterior, label: 'Foto Anterior' },
                                  { lectura: fotoActual, label: 'Foto Actual' },
                                ].map(({ lectura, label }) => (
                                  <div key={label} style={{ flex: 1 }}>
                                    <div style={{ fontSize: '9.5px', color: '#94a3b8', marginBottom: '3px', textAlign: 'center' }}>{label}</div>
                                    {lectura?.foto ? (
                                      <img
                                        src={lectura.foto}
                                        alt={label}
                                        onClick={() => setPhotoModal({ url: lectura.foto!, label: `${label} — #${contador.numero_serie} — ${parseFecha(lectura.fecha).toLocaleDateString('es-GT')}` })}
                                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '7px', border: '1.5px solid #e2e8f0', cursor: 'zoom-in' }}
                                      />
                                    ) : (
                                      <div style={{ width: '100%', aspectRatio: '1', background: '#f1f5f9', borderRadius: '7px', border: '1.5px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '3px', color: '#94a3b8', fontSize: '10px' }}>
                                        <span style={{ fontSize: '18px' }}>📷</span>
                                        <span>Sin foto</span>
                                      </div>
                                    )}
                                    {lectura && (
                                      <div style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'center', marginTop: '2px' }}>
                                        {parseFecha(lectura.fecha).toLocaleDateString('es-GT')}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '44px', height: '44px',
            border: '3px solid rgba(255,255,255,0.25)',
            borderTop: '3px solid white',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: 'white', fontSize: '15px', fontWeight: 500 }}>Cargando portal...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── No services screen ───────────────────────────────────
  if (!hasServices) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{
          background: 'white', borderRadius: '24px', padding: '48px 40px',
          maxWidth: '480px', width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.16)',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>💧</div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            Sin servicios asociados
          </h2>
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: '#475569', lineHeight: 1.6 }}>
            Por el momento no cuenta con contadores ni unidades activas vinculadas a su cuenta.
          </p>
          <p style={{ margin: '0 0 32px', fontSize: '13.5px', color: '#94a3b8' }}>
            Si cree que esto es un error, comuníquese con su empresa de servicios de agua.
          </p>
          <div style={{
            background: '#f1f5f9', borderRadius: '12px', padding: '16px',
            fontSize: '13px', color: '#64748b', marginBottom: '28px',
          }}>
            <strong style={{ color: '#334155' }}>Sesión activa:</strong> {currentUser.name}
            <br />{currentUser.email}
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '12px 32px', background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
              color: 'white', border: 'none', borderRadius: '12px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(14,165,233,0.35)',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  // ── Full portal ──────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f0f9ff' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .portal-tab:hover { background: rgba(14,165,233,0.08) !important; }
        .portal-tab.active { background: white !important; color: #0ea5e9 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .portal-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.1) !important; transform: translateY(-1px); }
        .contador-row:hover { background: #f0f9ff !important; cursor: pointer; }
        .lectura-row:nth-child(even) { background: #f8fafc; }
        .portal-input:focus { outline: none; border-color: #0ea5e9 !important; box-shadow: 0 0 0 3px rgba(14,165,233,0.12); }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
        padding: '0',
        boxShadow: '0 2px 12px rgba(14,165,233,0.3)',
      }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px',
            }}>💧</div>
            <div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: '16px' }}>
                {currentUser.name}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px' }}>
                Portal de cliente
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '8px 18px', background: 'rgba(255,255,255,0.15)',
              color: 'white', border: '1.5px solid rgba(255,255,255,0.3)',
              borderRadius: '10px', fontSize: '13px', fontWeight: 500,
              cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            Cerrar sesión
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          padding: '0 24px',
          display: 'flex', gap: '4px',
        }}>
          {([
            { key: 'dashboard', label: 'Dashboard', icon: '📈' },
            { key: 'servicios', label: 'Mis Servicios', icon: '📊' },
            { key: 'pagos', label: 'Mis Pagos', icon: '💳' },
            { key: 'comunicacion', label: 'Contacto', icon: '💬' },
            { key: 'perfil', label: 'Mi Perfil', icon: '👤' },
          ] as const).map(t => (
            <button
              key={t.key}
              className={`portal-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px',
                background: tab === t.key ? 'white' : 'transparent',
                color: tab === t.key ? '#0ea5e9' : 'rgba(255,255,255,0.85)',
                border: 'none',
                borderRadius: '10px 10px 0 0',
                fontSize: '13.5px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.18s',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>

        {/* ── TAB: DASHBOARD ── */}
        {tab === 'dashboard' && renderDashboard()}

        {/* ── TAB: SERVICIOS ── */}
        {tab === 'servicios' && (
          <div>
            {/* Summary cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
              marginBottom: '28px',
            }}>
              {[
                { icon: '🏢', label: 'Empresas', value: companies.length, color: '#6366f1' },
                { icon: '🏠', label: 'Unidades activas', value: unidades.length, color: '#0ea5e9' },
                { icon: '💧', label: 'Contadores activos', value: contadores.length, color: '#0d9488' },
                { icon: '📋', label: 'Registros de lectura', value: lecturas.length, color: '#f59e0b' },
              ].map(s => (
                <div
                  key={s.label}
                  className="portal-card"
                  style={{
                    background: 'white', borderRadius: '14px', padding: '18px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    display: 'flex', alignItems: 'center', gap: '14px',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: `${s.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '18px', flexShrink: 0,
                  }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Companies & meters tree */}
            {companies.map(company => {
              const companyProjects = projects.filter(p => p.company_id === company.id)
              const companyContadores = contadores.filter(c => c.company_id === company.id)
              const companyUnidades = unidades.filter(u => u.company_id === company.id)
              const isActivo = companyActivoMap[company.id] !== false

              // Company header (shared between active and inactive views)
              const companyHeader = (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: isActivo ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '15px', color: 'white',
                  }}>🏢</div>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: isActivo ? '#1e293b' : '#94a3b8' }}>
                    {company.nombre}
                  </h2>
                </div>
              )

              if (!isActivo) {
                return (
                  <div key={company.id} style={{ marginBottom: '24px' }}>
                    {companyHeader}
                    <div style={{
                      padding: '20px 24px',
                      background: '#f8fafc',
                      border: '1.5px dashed #cbd5e1',
                      borderRadius: '12px',
                      color: '#64748b',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}>
                      <span style={{ fontSize: '20px' }}>ℹ️</span>
                      <span>
                        Sin datos disponibles de <strong>{company.nombre}</strong>. Si desea más información, contáctenos directamente con la empresa.
                      </span>
                    </div>
                  </div>
                )
              }

              if (companyContadores.length === 0 && companyUnidades.length === 0) return null
              return (
                <div key={company.id} style={{ marginBottom: '24px' }}>
                  {/* Company header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    marginBottom: '14px',
                  }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '15px', color: 'white',
                    }}>🏢</div>
                    <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#1e293b' }}>
                      {company.nombre}
                    </h2>
                  </div>

                  {/* Contadores for this company */}
                  {companyContadores.map(contador => {
                    const unidad = unidades.find(u => u.id === contador.unidad_id)
                    const project = companyProjects.find(p => p.id === contador.project_id)
                    const moneda = project?.moneda ?? 'Q'
                    const contLecturas = lecturas
                      .filter(l => l.contador_id === contador.id)
                      .slice(0, 12)
                    const isExpanded = expandedContador === contador.id

                    return (
                      <div
                        key={contador.id}
                        className="portal-card"
                        style={{
                          background: 'white', borderRadius: '14px',
                          marginBottom: '12px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          overflow: 'hidden',
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Meter header row */}
                        <div
                          className="contador-row"
                          onClick={() => setExpandedContador(isExpanded ? null : contador.id)}
                          style={{
                            padding: '16px 20px',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: '12px',
                            transition: 'background 0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <div style={{
                              width: '36px', height: '36px', borderRadius: '9px', flexShrink: 0,
                              background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '16px', color: 'white',
                            }}>💧</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14.5px' }}>
                                Contador #{contador.numero_serie}
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                {TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}
                                {unidad && ` · ${unidad.nombre}`}
                                {project && ` · ${project.nombre}`}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: '20px',
                              background: '#dcfce7', color: '#166534',
                              fontSize: '11px', fontWeight: 600,
                            }}>Activo</span>
                            <span style={{ color: '#94a3b8', fontSize: '16px', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                          </div>
                        </div>

                        {/* Reading history */}
                        {isExpanded && (
                          <div style={{ borderTop: '1px solid #f1f5f9' }}>
                            {contLecturas.length === 0 ? (
                              <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13.5px' }}>
                                No hay lecturas registradas para este contador.
                              </div>
                            ) : (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                  <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                      {['Fecha', 'Período', 'Lect. anterior', 'Lect. actual', 'Consumo (m³)', `Monto (${moneda})`, 'Estado'].map(h => (
                                        <th scope="col" key={h} style={{
                                          padding: '10px 14px', textAlign: 'left',
                                          fontSize: '11.5px', fontWeight: 600,
                                          color: '#64748b', whiteSpace: 'nowrap',
                                          borderBottom: '1px solid #e2e8f0',
                                        }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {contLecturas.map(lectura => {
                                      const est = ESTADO_COLORS[lectura.estado] ?? ESTADO_COLORS.pendiente
                                      return (
                                        <tr key={lectura.id} className="lectura-row">
                                          <td style={{ padding: '10px 14px', color: '#374151', whiteSpace: 'nowrap' }}>
                                            {parseFecha(lectura.fecha).toLocaleDateString('es-GT')}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: '#64748b' }}>
                                            {lectura.dias_servicio != null ? `${lectura.dias_servicio} días` : lectura.mes ? `Mes ${lectura.mes}` : '—'}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: '#374151', textAlign: 'right' }}>
                                            {lectura.lectura_anterior.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: '#374151', textAlign: 'right' }}>
                                            {lectura.lectura_actual.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0ea5e9', textAlign: 'right' }}>
                                            {lectura.consumo.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {moneda} {lectura.monto_calculado.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px' }}>
                                            <span style={{
                                              padding: '3px 9px', borderRadius: '20px',
                                              background: est.bg, color: est.color,
                                              fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
                                            }}>{est.label}</span>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Units without meters */}
                  {companyUnidades
                    .filter(u => !companyContadores.some(c => c.unidad_id === u.id))
                    .map(unidad => (
                      <div
                        key={unidad.id}
                        className="portal-card"
                        style={{
                          background: 'white', borderRadius: '14px', padding: '16px 20px',
                          marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          display: 'flex', alignItems: 'center', gap: '12px',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '9px', flexShrink: 0,
                          background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '16px', color: 'white',
                        }}>🏠</div>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14.5px' }}>
                            {unidad.nombre}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                            {unidad.tipo.replace('_', ' ')}
                            {unidad.piso != null && ` · Piso ${unidad.piso}`}
                            {unidad.area_m2 != null && ` · ${unidad.area_m2} m²`}
                            {' · Sin contador asignado'}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
        )}

        {/* ── TAB: PAGOS ── */}
        {tab === 'pagos' && (
          <CustomerPaymentsTab
            registros={registros}
            clientes={[]}
            currentUser={currentUser}
            moneda={projects[0]?.moneda ?? 'Q'}
          />
        )}

        {/* ── TAB: COMUNICACION ── */}
        {tab === 'comunicacion' && companies.length > 0 && (
          <CustomerComunicacion
            currentUser={currentUser}
            companyId={companies[0].id}
          />
        )}
        {tab === 'comunicacion' && companies.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af', fontSize: '14px' }}>
            No estás asociado a ninguna empresa todavía.
          </div>
        )}

        {/* ── TAB: PERFIL ── */}
        {tab === 'perfil' && (
          <div>
            <div style={{
              background: 'white', borderRadius: '16px', padding: '28px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              maxWidth: '520px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px', color: 'white',
                }}>👤</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                    {currentUser.name}
                  </h2>
                  <div style={{ fontSize: '12.5px', color: '#64748b' }}>Actualice su información de contacto</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {([
                  { key: 'email', label: 'Correo electrónico', placeholder: 'correo@ejemplo.com', type: 'email' },
                  { key: 'telefono', label: 'Teléfono', placeholder: 'Ej. 5555-1234', type: 'tel' },
                  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'Ej. 5555-1234', type: 'tel' },
                  { key: 'telefono_alterno', label: 'Teléfono alterno', placeholder: 'Ej. 2255-1234', type: 'tel' },
                ] as const).map(field => (
                  <div key={field.key}>
                    <label style={{
                      display: 'block', fontSize: '12.5px',
                      fontWeight: 600, color: '#374151', marginBottom: '5px',
                    }}>
                      {field.label}
                    </label>
                    <input
                      className="portal-input"
                      type={field.type}
                      value={contactoEdit[field.key] ?? ''}
                      onChange={e => setContactoEdit(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 14px', fontSize: '14px',
                        border: '1.5px solid #e2e8f0', borderRadius: '10px',
                        background: '#f8fafc', color: '#0f172a',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                      }}
                    />
                  </div>
                ))}

                {contactoMsg && (
                  <div style={{
                    padding: '11px 14px', borderRadius: '10px', fontSize: '13px',
                    background: contactoMsg.type === 'success' ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${contactoMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                    color: contactoMsg.type === 'success' ? '#166534' : '#b91c1c',
                    display: 'flex', gap: '8px', alignItems: 'center',
                  }}>
                    <span>{contactoMsg.type === 'success' ? '✅' : '⚠️'}</span>
                    {contactoMsg.text}
                  </div>
                )}

                <button
                  onClick={guardarContacto}
                  disabled={savingContacto}
                  style={{
                    padding: '12px', marginTop: '4px',
                    background: savingContacto
                      ? '#94a3b8'
                      : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                    color: 'white', border: 'none', borderRadius: '12px',
                    fontSize: '14.5px', fontWeight: 600,
                    cursor: savingContacto ? 'not-allowed' : 'pointer',
                    boxShadow: savingContacto ? 'none' : '0 4px 14px rgba(14,165,233,0.3)',
                    transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  }}
                >
                  {savingContacto ? (
                    <>
                      <div style={{
                        width: '14px', height: '14px',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTop: '2px solid white',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                      Guardando...
                    </>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Lightbox de fotos ── */}
      {photoModal && (
        <div
          onClick={() => setPhotoModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, cursor: 'pointer', flexDirection: 'column', gap: '14px', padding: '24px',
          }}
        >
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12.5px', textAlign: 'center', maxWidth: '80vw' }}>
            {photoModal.label}
          </div>
          <img
            src={photoModal.url}
            alt={photoModal.label}
            style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: '12px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', objectFit: 'contain' }}
          />
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '11.5px' }}>Toque o clic para cerrar</div>
        </div>
      )}
    </div>
  )
}
