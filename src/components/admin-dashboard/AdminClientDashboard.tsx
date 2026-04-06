import { useState, useEffect } from 'react'
import type { Cliente, Registro, Proyecto, Contador, FuenteAgua, RegistroCalidad, UserSession, Ruta, AppSection } from '../../types'
import { supabase } from '../../lib/supabase'
import { AdminDashboardStats } from './AdminDashboardStats'
import { AdminDashboardCharts } from './AdminDashboardCharts'
import { AdminClientsList } from './AdminClientsList'
import { AdminNewReading } from './AdminNewReading'
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

export function AdminClientDashboard({ currentUser, data, moneda, onDataRefresh, onNavigateSection }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Cargar datos específicos al montar
  useEffect(() => {
    if (data.proyectos.length > 0 && !selectedProjectId) {
      setSelectedProjectId(data.proyectos[0].id)
    }
  }, [data.proyectos, selectedProjectId])

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

  const handleReadingAdded = async () => {
    setLoading(true)
    try {
      await onDataRefresh()
      setActiveTab('historial')
    } finally {
      setLoading(false)
    }
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
          <AdminNewReading
            clientes={clientesEnProyecto}
            contadores={data.contadores}
            tarifas={data.tarifas || []}
            onReadingAdded={handleReadingAdded}
            proyectoId={selectedProjectId}
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
