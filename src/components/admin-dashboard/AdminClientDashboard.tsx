import { useState, useEffect, useCallback } from 'react'
import type { Cliente, Registro, Proyecto, Contador, FuenteAgua, RegistroCalidad, UserSession, Ruta, AppSection } from '../../types'
import { supabase } from '../../lib/supabase'
import { AdminDashboardStats } from './AdminDashboardStats'
import { AdminDashboardCharts } from './AdminDashboardCharts'
import { AdminClientsList } from './AdminClientsList'
import { LecturasSection } from '../lecturas/LecturasSection'
import { AdminHistoryTab } from './AdminHistoryTab'
import { AdminQuickActions } from './AdminQuickActions'

interface AdminDashboardData {
  clientes: Cliente[]
  registros: Registro[]
  proyectos: Proyecto[]
  contadores: Contador[]
  fuentesAgua: FuenteAgua[]
  registrosCalidad: RegistroCalidad[]
  rutas: Ruta[]
  tarifas?: any[]
  unidades?: any[]
}

interface Props {
  currentUser: UserSession
  data: AdminDashboardData
  moneda: string
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

export function AdminClientDashboard({ currentUser, data, moneda, onDataRefresh, onNavigateSection }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [convStats, setConvStats] = useState<ConvStats>({ sinAsignar: 0, cerradasHoy: 0, criticas: 0, urgentes: 0, enProceso: 0 })

  // Cargar datos específicos al montar
  useEffect(() => {
    if (data.proyectos.length > 0 && !selectedProjectId) {
      setSelectedProjectId(data.proyectos[0].id)
    }
  }, [data.proyectos, selectedProjectId])

  const cargarConvStats = useCallback(async () => {
    const companyId = currentUser.company_id
    if (!companyId) return
    const now = new Date()
    const hace24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const hace48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
    const abiertos = ['abierta', 'en_progreso', 'esperando_cliente']
    const mkBase = () => {
      let q = supabase.from('conversations').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('service_type', 'agua')
      if (selectedProjectId) q = q.eq('project_id', selectedProjectId)
      return q
    }
    const [sinAsignarRes, cerradasRes, criticasRes, urgentesRes, enProcesoRes] = await Promise.all([
      mkBase().in('status', abiertos).is('assigned_to', null),
      mkBase().eq('status', 'cerrada').gte('closed_at', hace24h),
      mkBase().in('status', abiertos).lt('created_at', hace48h),
      mkBase().in('status', abiertos).lt('created_at', hace24h).gte('created_at', hace48h),
      mkBase().in('status', abiertos).gte('created_at', hace24h),
    ])
    setConvStats({
      sinAsignar: sinAsignarRes.count ?? 0,
      cerradasHoy: cerradasRes.count ?? 0,
      criticas: criticasRes.count ?? 0,
      urgentes: urgentesRes.count ?? 0,
      enProceso: enProcesoRes.count ?? 0,
    })
  }, [currentUser.company_id, selectedProjectId])

  useEffect(() => { void cargarConvStats() }, [cargarConvStats])

  // Obtener IDs de clientes que pertenecen al proyecto seleccionado (a través de unidades)
  const clienteIdsEnProyecto = selectedProjectId
    ? new Set((data.unidades || [])
        .filter(u => u.project_id === selectedProjectId && u.cliente_id)
        .map(u => u.cliente_id))
    : new Set(data.clientes.map(c => c.id))

  // Filtrar clientes por proyecto
  const clientesEnProyecto = selectedProjectId
    ? data.clientes.filter(c => clienteIdsEnProyecto.has(c.id))
    : data.clientes

  // Filtrar registros por proyecto
  const registrosFiltrados = selectedProjectId
    ? data.registros.filter(r => clienteIdsEnProyecto.has(r.cliente_id))
    : data.registros

  // Filtrar unidades y contadores por proyecto
  const unidadesFiltradas = selectedProjectId
    ? (data.unidades || []).filter((u: any) => u.project_id === selectedProjectId)
    : (data.unidades || [])

  const contadoresFiltrados = selectedProjectId
    ? data.contadores.filter(c => c.project_id === selectedProjectId)
    : data.contadores

  const tarifasFiltradas = selectedProjectId
    ? (data.tarifas || []).filter((t: any) => t.project_id === selectedProjectId)
    : (data.tarifas || [])

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
        <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '16px', color: '#0f172a' }}>
          Dashboard - Administrador de Empresa
        </h1>

        {/* Selector de Proyecto */}
        {data.proyectos.length > 0 && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
            <label style={{ fontSize: '14px', fontWeight: '600', color: '#475569' }}>Proyecto:</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
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

        {/* Tabs de navegación */}
        <div style={{
          display: 'flex',
          gap: '12px',
          borderBottom: '2px solid #e2e8f0',
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
                color: activeTab === tab.id ? '#0ea5e9' : '#64748b',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '3px solid #0ea5e9' : 'none',
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
            />
            {onNavigateSection && (
              <AdminQuickActions
                onNavigate={(section) => onNavigateSection(section as AppSection)}
              />
            )}

            {/* ── Estadísticas de Comunicaciones ─────────────────────── */}
            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                💬 Comunicaciones
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
                {([
                  { label: 'Sin asignar', sub: 'sin agente asignado', value: convStats.sinAsignar, from: '#f59e0b', to: '#d97706', icon: '📥' },
                  { label: 'Cerradas hoy', sub: 'últimas 24 horas', value: convStats.cerradasHoy, from: '#10b981', to: '#059669', icon: '✅' },
                  { label: 'Críticas', sub: 'abiertas > 48h', value: convStats.criticas, from: '#ef4444', to: '#dc2626', icon: '🚨' },
                  { label: 'Urgentes', sub: 'abiertas 24–48h', value: convStats.urgentes, from: '#f97316', to: '#ea580c', icon: '⚠️' },
                  { label: 'En proceso', sub: 'abiertas < 24h', value: convStats.enProceso, from: '#0ea5e9', to: '#0284c7', icon: '🔄' },
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
