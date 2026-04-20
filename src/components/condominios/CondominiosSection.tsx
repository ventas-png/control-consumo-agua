import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { UserSession, Proyecto, Unidad, CuotaCondominio, Visitante, Amenidad, ReservaAmenidad, TicketMantenimiento, AnuncioComunidad } from '../../types'
import { PanelGeneralTab } from './tabs/PanelGeneralTab'
import { CuotasTab } from './tabs/CuotasTab'
import { VisitantesTab } from './tabs/VisitantesTab'
import { AmenidadesTab } from './tabs/AmenidadesTab'
import { MantenimientoTab } from './tabs/MantenimientoTab'
import { ComunidadTab } from './tabs/ComunidadTab'

type CondominioTab = 'panel' | 'cuotas' | 'visitantes' | 'amenidades' | 'mantenimiento' | 'comunidad'

const TABS: { id: CondominioTab; label: string; icon: string }[] = [
  { id: 'panel',        label: 'Panel General', icon: '📊' },
  { id: 'cuotas',       label: 'Cuotas',        icon: '💳' },
  { id: 'visitantes',   label: 'Visitantes',    icon: '🚪' },
  { id: 'amenidades',   label: 'Amenidades',    icon: '🏊' },
  { id: 'mantenimiento',label: 'Mantenimiento', icon: '🔧' },
  { id: 'comunidad',    label: 'Comunidad',     icon: '📢' },
]

interface Props {
  proyectos: Proyecto[]
  unidades: Unidad[]
  currentUser: UserSession
  canCreate: (section: string) => boolean
  canEdit: (section: string) => boolean
}

export function CondominiosSection({ proyectos, unidades, currentUser, canCreate, canEdit }: Props) {
  const [activeTab, setActiveTab] = useState<CondominioTab>('panel')
  const [selectedProyectoId, setSelectedProyectoId] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const [cuotas, setCuotas] = useState<CuotaCondominio[]>([])
  const [visitantes, setVisitantes] = useState<Visitante[]>([])
  const [amenidades, setAmenidades] = useState<Amenidad[]>([])
  const [reservas, setReservas] = useState<ReservaAmenidad[]>([])
  const [tickets, setTickets] = useState<TicketMantenimiento[]>([])
  const [anuncios, setAnuncios] = useState<AnuncioComunidad[]>([])

  const proyectosActivos = proyectos.filter(p => p.estado === 'activo')

  useEffect(() => {
    if (proyectosActivos.length > 0 && !selectedProyectoId) {
      setSelectedProyectoId(proyectosActivos[0].id)
    }
  }, [proyectosActivos.length])

  const cargarDatos = useCallback(async () => {
    if (!selectedProyectoId || !currentUser.company_id) return
    setLoading(true)

    const pid = selectedProyectoId
    const cid = currentUser.company_id ?? ''

    const [cuotasRes, visitantesRes, amenidadesRes, reservasRes, ticketsRes, anunciosRes] = await Promise.all([
      supabase
        .from('cuotas_condominio')
        .select('*, unidades(nombre)')
        .eq('project_id', pid)
        .eq('company_id', cid)
        .order('created_at', { ascending: false }),
      supabase
        .from('visitantes')
        .select('*, unidades(nombre)')
        .eq('project_id', pid)
        .eq('company_id', cid)
        .order('hora_entrada', { ascending: false })
        .limit(200),
      supabase
        .from('amenidades')
        .select('*')
        .eq('project_id', pid)
        .eq('company_id', cid)
        .order('nombre'),
      supabase
        .from('reservas_amenidades')
        .select('*, amenidades(nombre), unidades(nombre)')
        .eq('company_id', cid)
        .order('fecha', { ascending: false })
        .limit(200),
      supabase
        .from('tickets_mantenimiento')
        .select('*, unidades(nombre)')
        .eq('project_id', pid)
        .eq('company_id', cid)
        .order('created_at', { ascending: false }),
      supabase
        .from('anuncios_comunidad')
        .select('*, app_users(nombre_completo)')
        .eq('project_id', pid)
        .eq('company_id', cid)
        .order('created_at', { ascending: false }),
    ])

    setCuotas((cuotasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as CuotaCondominio)))

    setVisitantes((visitantesRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as Visitante)))

    setAmenidades((amenidadesRes.data ?? []) as Amenidad[])

    setReservas((reservasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      amenidad_nombre: (r.amenidades as { nombre: string } | null)?.nombre,
      unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as ReservaAmenidad)))

    setTickets((ticketsRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as TicketMantenimiento)))

    setAnuncios((anunciosRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      publicado_por_nombre: (r.app_users as { nombre_completo: string } | null)?.nombre_completo,
    } as AnuncioComunidad)))

    setLoading(false)
  }, [selectedProyectoId, currentUser.company_id])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  const unidadesProyecto = unidades.filter(u => u.project_id === selectedProyectoId)
  const proyectoActual = proyectos.find(p => p.id === selectedProyectoId)
  const moneda = proyectoActual?.moneda ?? 'Q'

  if (proyectosActivos.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
        <p style={{ fontSize: '16px', fontWeight: 600, color: '#64748b' }}>No hay proyectos activos</p>
        <p style={{ fontSize: '13px' }}>Crea un proyecto en "Mis Proyectos" para comenzar a usar el módulo Condominios.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header con selector de proyecto */}
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid #e2e8f0', background: 'white', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🏢</span>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Condominios</h1>
          </div>
          {proyectosActivos.length > 1 && (
            <select
              value={selectedProyectoId}
              onChange={e => setSelectedProyectoId(e.target.value)}
              style={{ padding: '6px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', color: '#374151', fontWeight: 500 }}
            >
              {proyectosActivos.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
          {proyectosActivos.length === 1 && (
            <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>{proyectoActual?.nombre}</span>
          )}
          {loading && <span style={{ fontSize: '12px', color: '#94a3b8' }}>Cargando...</span>}
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: '2px', overflowX: 'auto' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px 8px 0 0',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13.5px',
                fontWeight: activeTab === tab.id ? 700 : 500,
                background: activeTab === tab.id ? '#f8fafc' : 'transparent',
                color: activeTab === tab.id ? '#0ea5e9' : '#64748b',
                borderBottom: activeTab === tab.id ? '2px solid #0ea5e9' : '2px solid transparent',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'panel' && (
          <PanelGeneralTab
            cuotas={cuotas}
            tickets={tickets}
            visitantes={visitantes}
            amenidades={amenidades}
            moneda={moneda}
          />
        )}
        {activeTab === 'cuotas' && (
          <CuotasTab
            cuotas={cuotas}
            unidades={unidadesProyecto}
            proyectos={proyectosActivos}
            proyectoId={selectedProyectoId}
            companyId={currentUser.company_id ?? ''}
            moneda={moneda}
            canCreate={canCreate('condominios')}
            canEdit={canEdit('condominios')}
            onRefresh={cargarDatos}
          />
        )}
        {activeTab === 'visitantes' && (
          <VisitantesTab
            visitantes={visitantes}
            unidades={unidadesProyecto}
            proyectoId={selectedProyectoId}
            companyId={currentUser.company_id ?? ''}
            userId={currentUser.user_id}
            canCreate={canCreate('condominios')}
            onRefresh={cargarDatos}
          />
        )}
        {activeTab === 'amenidades' && (
          <AmenidadesTab
            amenidades={amenidades}
            reservas={reservas}
            unidades={unidadesProyecto}
            proyectoId={selectedProyectoId}
            companyId={currentUser.company_id ?? ''}
            userId={currentUser.user_id}
            moneda={moneda}
            canCreate={canCreate('condominios')}
            canEdit={canEdit('condominios')}
            onRefresh={cargarDatos}
          />
        )}
        {activeTab === 'mantenimiento' && (
          <MantenimientoTab
            tickets={tickets}
            unidades={unidadesProyecto}
            proyectoId={selectedProyectoId}
            companyId={currentUser.company_id ?? ''}
            userId={currentUser.user_id}
            canCreate={canCreate('condominios')}
            canEdit={canEdit('condominios')}
            onRefresh={cargarDatos}
          />
        )}
        {activeTab === 'comunidad' && (
          <ComunidadTab
            anuncios={anuncios}
            proyectoId={selectedProyectoId}
            companyId={currentUser.company_id ?? ''}
            userId={currentUser.user_id}
            canCreate={canCreate('condominios')}
            onRefresh={cargarDatos}
          />
        )}
      </div>
    </div>
  )
}
