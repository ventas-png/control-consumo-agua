import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Cliente, Registro, Proyecto, Contador, FuenteAgua, RegistroCalidad, UserSession, Ruta, Tarifa, Unidad, AppSection } from '../../types'
import { supabase } from '../../lib/supabase'
import { AdminDashboardStats } from './AdminDashboardStats'
import { AdminDashboardCharts } from './AdminDashboardCharts'
import { AdminClientsList } from './AdminClientsList'
import { LecturasSection } from '../lecturas/LecturasSection'
import { AdminHistoryTab } from './AdminHistoryTab'
import { AdminQuickActions } from './AdminQuickActions'
import { AdminConsumoTipologia } from './AdminConsumoTipologia'
import { AdminResumenProyectos } from './AdminResumenProyectos'

interface AdminDashboardData {
  clientes: Cliente[]
  registros: Registro[]
  proyectos: Proyecto[]
  contadores: Contador[]
  fuentesAgua: FuenteAgua[]
  registrosCalidad: RegistroCalidad[]
  rutas: Ruta[]
  tarifas?: Tarifa[]
  unidades?: Unidad[]
}

interface Props {
  currentUser: UserSession
  data: AdminDashboardData
  moneda: string
  isLoading?: boolean
  onDataRefresh: () => Promise<void>
  onNavigateSection?: (section: AppSection) => void
}

type TabType = 'dashboard' | 'clientes' | 'nueva_lectura' | 'historial'

interface ConvStats {
  sinAsignar: number
  cerradasHoy: number
  criticas: number
  urgentes: number
  enProceso: number
}

export function AdminClientDashboard({ currentUser, data, moneda, isLoading = false, onDataRefresh, onNavigateSection }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [projectInitialized, setProjectInitialized] = useState(false)

  const defaultDesde = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })()
  const defaultHasta = new Date().toISOString().slice(0, 10)
  const [fechaDesde, setFechaDesde] = useState(defaultDesde)
  const [fechaHasta, setFechaHasta] = useState(defaultHasta)
  const [convStats, setConvStats] = useState<ConvStats>({ sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0 })
  const [perProjectStats, setPerProjectStats] = useState<Record<string, ConvStats>>({})

  // Auto-select project only once on mount:
  // - 1 project → select it directly
  // - multiple projects → stay on "Todos los proyectos" (empty string)
  useEffect(() => {
    if (data.proyectos.length > 0 && !projectInitialized) {
      if (data.proyectos.length === 1) {
        setSelectedProjectId(data.proyectos[0].id)
      }
      setProjectInitialized(true)
    }
  }, [data.proyectos, projectInitialized])

  const cargarConvStats = useCallback(async () => {
    const companyId = currentUser.company_id
    if (!companyId) return
    const now = new Date()
    const hace24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const hace48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
    const abiertos = new Set(['abierta', 'en_progreso', 'esperando_cliente'])

    if (selectedProjectId) {
      // Single project: 5 lightweight count queries
      const mkBase = () => {
        return supabase.from('conversations').select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).eq('service_type', 'agua').eq('project_id', selectedProjectId)
      }
      const abArr = [...abiertos]
      const [sinAsignarRes, cerradasRes, criticasRes, urgentesRes, enProcesoRes] = await Promise.all([
        mkBase().in('status', abArr).is('assigned_to', null),
        mkBase().eq('status', 'cerrada').gte('closed_at', hace24h),
        mkBase().in('status', abArr).lt('created_at', hace48h),
        mkBase().in('status', abArr).lt('created_at', hace24h).gte('created_at', hace48h),
        mkBase().in('status', abArr).gte('created_at', hace24h),
      ])
      setConvStats({
        sinAsignar: sinAsignarRes.count ?? 0,
        cerradasHoy: cerradasRes.count ?? 0,
        criticas: criticasRes.count ?? 0,
        urgentes: urgentesRes.count ?? 0,
        enProceso: enProcesoRes.count ?? 0,
      })
      setPerProjectStats({})
    } else {
      // All projects: fetch lightweight rows and compute per-project stats in JS
      const { data: rows } = await supabase
        .from('conversations')
        .select('project_id, status, assigned_to, created_at, closed_at')
        .eq('company_id', companyId)
        .eq('service_type', 'agua')
      if (!rows) return

      const empty = (): ConvStats => ({ sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0 })
      const totals = empty()
      const byProject: Record<string, ConvStats> = {}

      for (const r of rows) {
        const pid = r.project_id ?? '__sin_proyecto__'
        if (!byProject[pid]) byProject[pid] = empty()
        const s = byProject[pid]
        const isOpen = abiertos.has(r.status)
        const createdAt = r.created_at

        if (isOpen && !r.assigned_to) { s.sinAsignar++; totals.sinAsignar++ }
        if (r.status === 'cerrada' && r.closed_at && r.closed_at >= hace24h) { s.cerradasHoy++; totals.cerradasHoy++ }
        if (isOpen && createdAt < hace48h) { s.criticas++; totals.criticas++ }
        if (isOpen && createdAt < hace24h && createdAt >= hace48h) { s.urgentes++; totals.urgentes++ }
        if (isOpen && createdAt >= hace24h) { s.enProceso++; totals.enProceso++ }
      }

      setConvStats(totals)
      setPerProjectStats(byProject)
    }
  }, [currentUser.company_id, selectedProjectId])

  useEffect(() => { void cargarConvStats() }, [cargarConvStats])

  // Memoizar todos los derivados: si las arrays subyacentes (data.*) o
  // selectedProjectId no cambian, las referencias se mantienen estables y
  // los hijos memoizados (AdminDashboardStats, AdminDashboardCharts, etc.)
  // pueden saltar su re-render.

  // IDs de clientes que pertenecen al proyecto seleccionado (vía unidades)
  const clienteIdsEnProyecto = useMemo(() => (
    selectedProjectId
      ? new Set((data.unidades || [])
          .filter(u => u.project_id === selectedProjectId && u.cliente_id)
          .map(u => u.cliente_id))
      : new Set(data.clientes.map(c => c.id))
  ), [selectedProjectId, data.unidades, data.clientes])

  const clientesEnProyecto = useMemo(() => (
    selectedProjectId
      ? data.clientes.filter(c => clienteIdsEnProyecto.has(c.id))
      : data.clientes
  ), [selectedProjectId, data.clientes, clienteIdsEnProyecto])

  // Registros: usa project_id directo cuando está disponible, fallback a la
  // cadena cliente→unidad para registros históricos sin project_id.
  const registrosFiltrados = useMemo(() => (
    selectedProjectId
      ? data.registros.filter(r =>
          r.project_id
            ? r.project_id === selectedProjectId
            : clienteIdsEnProyecto.has(r.cliente_id)
        )
      : data.registros
  ), [selectedProjectId, data.registros, clienteIdsEnProyecto])

  const unidadesFiltradas = useMemo(() => (
    selectedProjectId
      ? (data.unidades || []).filter(u => u.project_id === selectedProjectId)
      : (data.unidades || [])
  ), [selectedProjectId, data.unidades])

  const contadoresFiltrados = useMemo(() => (
    selectedProjectId
      ? data.contadores.filter(c => c.project_id === selectedProjectId)
      : data.contadores
  ), [selectedProjectId, data.contadores])

  const tarifasFiltradas = useMemo(() => (
    selectedProjectId
      ? (data.tarifas || []).filter(t => t.project_id === selectedProjectId)
      : (data.tarifas || [])
  ), [selectedProjectId, data.tarifas])

  const handleReadingAdded = async () => {
    await onDataRefresh()
    setActiveTab('historial')
  }

  // Tabs de navegación
  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'clientes', label: 'Clientes', icon: '👥' },
    { id: 'nueva_lectura', label: 'Nueva Lectura', icon: '📝' },
    { id: 'historial', label: 'Historial', icon: '📋' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '16px', color: '#15291F' }}>
          Dashboard - Administrador de Empresa
        </h1>

        {/* Selector de Proyecto */}
        {data.proyectos.length > 0 && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
            <label style={{ fontSize: '14px', fontWeight: '600', color: '#3E5A4C' }}>Proyecto:</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #E1DDD0',
                fontSize: '14px',
                fontWeight: '500',
                background: 'white',
                cursor: 'pointer',
                minWidth: '200px',
              }}
            >
              <option value="">-- Todos los proyectos --</option>
              {data.proyectos.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Selector de Rango de Fechas */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
          <label style={{ fontSize: '14px', fontWeight: '600', color: '#3E5A4C' }}>Período:</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={e => setFechaDesde(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #E1DDD0', fontSize: '13px', background: 'white' }}
          />
          <span style={{ fontSize: '13px', color: '#7E9389' }}>—</span>
          <input
            type="date"
            value={fechaHasta}
            onChange={e => setFechaHasta(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #E1DDD0', fontSize: '13px', background: 'white' }}
          />
          {/* Quick presets */}
          {[
            { label: 'Últ. 30 días', onClick: () => { const d = new Date(); const d30 = new Date(); d30.setDate(d.getDate() - 30); setFechaDesde(d30.toISOString().slice(0, 10)); setFechaHasta(d.toISOString().slice(0, 10)) } },
            { label: 'Este mes', onClick: () => { const d = new Date(); setFechaDesde(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`); setFechaHasta(d.toISOString().slice(0,10)) } },
            { label: 'Mes anterior', onClick: () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); const y = d.getFullYear(); const m = d.getMonth(); const last = new Date(y, m+1, 0); setFechaDesde(`${y}-${String(m+1).padStart(2,'0')}-01`); setFechaHasta(last.toISOString().slice(0,10)) } },
            { label: 'Últ. 3 meses', onClick: () => { const d = new Date(); const d90 = new Date(); d90.setDate(d.getDate() - 90); setFechaDesde(d90.toISOString().slice(0, 10)); setFechaHasta(d.toISOString().slice(0, 10)) } },
          ].map(p => (
            <button key={p.label} onClick={p.onClick} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #E1DDD0', background: 'white', fontSize: '12px', fontWeight: 500, color: '#3E5A4C', cursor: 'pointer' }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Tabs de navegación */}
        <div style={{
          display: 'flex',
          gap: '12px',
          borderBottom: '2px solid #E1DDD0',
          overflowX: 'auto',
          paddingBottom: '12px',
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 18px',
                fontSize: '14px',
                fontWeight: activeTab === tab.id ? '600' : '500',
                color: activeTab === tab.id ? '#1B3B36' : '#7E9389',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '3px solid #1B3B36' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ marginRight: '6px' }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido de pestañas */}
      <div style={{ minHeight: 'calc(100vh - 300px)' }}>
        {activeTab === 'dashboard' && (
          <div>
            <AdminDashboardStats
              registros={registrosFiltrados}
              moneda={moneda}
              clientes={clientesEnProyecto}
              fechaDesde={fechaDesde}
              fechaHasta={fechaHasta}
              isLoading={isLoading}
            />
            {!selectedProjectId && data.proyectos.length > 1 && (
              <AdminResumenProyectos
                registros={data.registros}
                contadores={data.contadores}
                proyectos={data.proyectos}
                unidades={data.unidades || []}
                moneda={moneda}
                fechaDesde={fechaDesde}
                fechaHasta={fechaHasta}
              />
            )}
            {/* Cards de tipología solo cuando hay un proyecto seleccionado;
                cuando se ven todos, la tabla de AdminResumenProyectos las reemplaza */}
            {selectedProjectId && (
              <AdminConsumoTipologia
                registros={registrosFiltrados}
                contadores={contadoresFiltrados}
                proyectos={data.proyectos}
                moneda={moneda}
                selectedProjectId={selectedProjectId}
                unidades={data.unidades || []}
                fechaDesde={fechaDesde}
                fechaHasta={fechaHasta}
              />
            )}
            {onNavigateSection && (
              <AdminQuickActions
                onNavigate={(section) => onNavigateSection(section as AppSection)}
              />
            )}

            {/* ── Estadísticas de Comunicaciones ─────────────────────── */}
            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#7E9389', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                💬 Comunicaciones
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
                {([
                  { label: 'Sin asignar', sub: 'sin agente asignado', value: convStats.sinAsignar, from: '#f59e0b', to: '#d97706', icon: '📥' },
                  { label: 'Cerradas hoy', sub: 'últimas 24 horas', value: convStats.cerradasHoy, from: '#10b981', to: '#059669', icon: '✅' },
                  { label: 'Críticas', sub: 'abiertas > 48h', value: convStats.criticas, from: '#ef4444', to: '#dc2626', icon: '🚨' },
                  { label: 'Urgentes', sub: 'abiertas 24–48h', value: convStats.urgentes, from: '#f97316', to: '#ea580c', icon: '⚠️' },
                  { label: 'En proceso', sub: 'abiertas < 24h', value: convStats.enProceso, from: '#1B3B36', to: '#102622', icon: '🔄' },
                ] as const).map(card => (
                  <button
                    key={card.label}
                    onClick={() => onNavigateSection?.('comunicacion')}
                    style={{
                      background: `linear-gradient(135deg, ${card.from}, ${card.to})`,
                      borderRadius: '14px',
                      padding: '20px',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 10px 28px rgba(0,0,0,0.18)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ''; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)' }}
                  >
                    <div style={{ fontSize: '20px', marginBottom: '6px' }}>{card.icon}</div>
                    <div style={{ fontSize: '28px', fontWeight: 800, lineHeight: 1 }}>{card.value}</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '6px', opacity: 0.95 }}>{card.label}</div>
                    <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>{card.sub}</div>
                  </button>
                ))}
              </div>

              {/* Desglose por proyecto cuando se ven todos */}
              {!selectedProjectId && data.proyectos.length > 1 && Object.keys(perProjectStats).length > 0 && (
                <div style={{ marginTop: '20px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#FAF7EF' }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#3E5A4C', borderBottom: '2px solid #E1DDD0' }}>Proyecto</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#d97706', borderBottom: '2px solid #E1DDD0' }}>📥 Sin asignar</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#059669', borderBottom: '2px solid #E1DDD0' }}>✅ Cerradas hoy</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#dc2626', borderBottom: '2px solid #E1DDD0' }}>🚨 Críticas</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#ea580c', borderBottom: '2px solid #E1DDD0' }}>⚠️ Urgentes</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#102622', borderBottom: '2px solid #E1DDD0' }}>🔄 En proceso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.proyectos.filter(p => p.estado === 'activo').map((p, i) => {
                        const s = perProjectStats[p.id] ?? { sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0 }
                        const hasCritica = s.criticas > 0
                        return (
                          <tr
                            key={p.id}
                            style={{ background: i % 2 === 0 ? 'white' : '#FAF7EF', cursor: 'pointer', transition: 'background 0.15s' }}
                            onClick={() => setSelectedProjectId(p.id)}
                            onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = '#EEF2EC'}
                            onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'white' : '#FAF7EF'}
                          >
                            <td style={{ padding: '10px 14px', fontWeight: 600, color: '#15291F', borderBottom: '1px solid #EAE6D8' }}>
                              {hasCritica && <span style={{ marginRight: 6, color: '#ef4444' }}>●</span>}
                              {p.nombre}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #EAE6D8', fontWeight: s.sinAsignar > 0 ? 700 : 400, color: s.sinAsignar > 0 ? '#d97706' : '#7E9389' }}>{s.sinAsignar}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #EAE6D8', fontWeight: s.cerradasHoy > 0 ? 700 : 400, color: s.cerradasHoy > 0 ? '#059669' : '#7E9389' }}>{s.cerradasHoy}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #EAE6D8', fontWeight: s.criticas > 0 ? 700 : 400, color: s.criticas > 0 ? '#dc2626' : '#7E9389' }}>{s.criticas}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #EAE6D8', fontWeight: s.urgentes > 0 ? 700 : 400, color: s.urgentes > 0 ? '#ea580c' : '#7E9389' }}>{s.urgentes}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid #EAE6D8', fontWeight: s.enProceso > 0 ? 700 : 400, color: s.enProceso > 0 ? '#102622' : '#7E9389' }}>{s.enProceso}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p style={{ fontSize: '11px', color: '#7E9389', marginTop: 8 }}>Haz clic en un proyecto para filtrar el dashboard</p>
                </div>
              )}
            </div>

            <div style={{ marginTop: '32px' }}>
              <AdminDashboardCharts
                registros={registrosFiltrados}
                clientes={clientesEnProyecto}
              />
            </div>
          </div>
        )}

        {activeTab === 'clientes' && (
          <AdminClientsList
            clientes={clientesEnProyecto}
            registros={registrosFiltrados}
            moneda={moneda}
            proyectoId={selectedProjectId}
          />
        )}

        {activeTab === 'nueva_lectura' && (
          <LecturasSection
            clientes={clientesEnProyecto}
            unidades={unidadesFiltradas}
            contadores={contadoresFiltrados}
            registros={registrosFiltrados}
            tarifas={tarifasFiltradas}
            userRole={currentUser.role}
            moneda={moneda}
            onRegistroAdded={() => { void handleReadingAdded() }}
          />
        )}

        {activeTab === 'historial' && (
          <AdminHistoryTab
            registros={registrosFiltrados}
            clientes={clientesEnProyecto}
            moneda={moneda}
          />
        )}
      </div>
    </div>
  )
}
