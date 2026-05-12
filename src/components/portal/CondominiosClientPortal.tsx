import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  UserSession, Unidad, CuotaCondominio, Amenidad,
  ReservaAmenidad, BloqueoAmenidad, TicketMantenimiento,
  AnuncioComunidad, Visitante, MensajePortal,
} from '../../types'
import { PortalReservasTab }   from '../condominios/tabs/PortalReservasTab'
import { PortalMiCuentaTab }   from '../condominios/tabs/PortalMiCuentaTab'
import { PortalMisTicketsTab } from '../condominios/tabs/PortalMisTicketsTab'
import { PortalMiUnidadTab }   from '../condominios/tabs/PortalMiUnidadTab'
import { PortalVisitantesTab } from '../condominios/tabs/PortalVisitantesTab'
import { PortalAnunciosTab }   from '../condominios/tabs/PortalAnunciosTab'

interface Props {
  currentUser: UserSession
  onLogout: () => void
}

type PortalTab = 'mi_unidad' | 'reservas' | 'cuenta' | 'tickets' | 'visitantes' | 'anuncios'

const PORTAL_TABS: { id: PortalTab; label: string; icon: string }[] = [
  { id: 'mi_unidad',  label: 'Mi Unidad',    icon: '🏠' },
  { id: 'reservas',   label: 'Reservas',      icon: '🏊' },
  { id: 'cuenta',     label: 'Mi Cuenta',     icon: '💳' },
  { id: 'tickets',    label: 'Mantenimiento', icon: '🔧' },
  { id: 'visitantes', label: 'Visitantes',    icon: '🚪' },
  { id: 'anuncios',   label: 'Anuncios',      icon: '📢' },
]

const PORTAL_CSS = `
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.condo-skeleton {
  background: linear-gradient(90deg,
    rgba(255,255,255,0.18) 25%,
    rgba(255,255,255,0.38) 50%,
    rgba(255,255,255,0.18) 75%
  );
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
  border-radius: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.condo-tab:hover { background: rgba(99,102,241,0.08) !important; }
.condo-tab.active { background: white !important; color: #4f46e5 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
`

export function CondominiosClientPortal({ currentUser, onLogout }: Props) {
  const clienteId = currentUser.cliente_id ?? ''

  const [loading, setLoading]                     = useState(true)
  const [tab, setTab]                             = useState<PortalTab>('mi_unidad')
  const [unidades, setUnidades]                   = useState<Unidad[]>([])
  const [selectedUnidadId, setSelectedUnidadId]   = useState('')
  const [resolvedCompanyId, setResolvedCompanyId] = useState(currentUser.company_id ?? '')
  const [moneda, setMoneda]                       = useState('Q')
  const [cuotas, setCuotas]                       = useState<CuotaCondominio[]>([])
  const [amenidades, setAmenidades]               = useState<Amenidad[]>([])
  const [reservas, setReservas]                   = useState<ReservaAmenidad[]>([])
  const [bloqueos, setBloqueos]                   = useState<BloqueoAmenidad[]>([])
  const [tickets, setTickets]                     = useState<TicketMantenimiento[]>([])
  const [anuncios, setAnuncios]                   = useState<AnuncioComunidad[]>([])
  const [visitantes, setVisitantes]               = useState<Visitante[]>([])
  const [mensajes, setMensajes]                   = useState<MensajePortal[]>([])

  const cargarDatos = useCallback(async () => {
    if (!clienteId) { setLoading(false); return }
    setLoading(true)
    try {
      // Batch 1: load client's units
      const { data: uData } = await supabase
        .from('unidades')
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('activo', true)
      const unidadesList = (uData as Unidad[]) ?? []
      setUnidades(unidadesList)

      if (unidadesList.length === 0) return

      setSelectedUnidadId(prev => prev || unidadesList[0].id)

      const unidadIds  = unidadesList.map(u => u.id)
      const projectIds = [...new Set(unidadesList.map(u => u.project_id).filter(Boolean))]
      const today      = new Date().toISOString().slice(0, 10)

      // Batch 2: all condominios data in parallel
      const [
        { data: projData },
        { data: amenidadesData },
        { data: cuotasData },
        { data: reservasData },
        { data: bloqueosData },
        { data: ticketsData },
        { data: anunciosData },
        { data: visitantesData },
        { data: mensajesData },
      ] = await Promise.all([
        supabase.from('projects').select('id, company_id, moneda_condominios, moneda').in('id', projectIds),
        supabase.from('amenidades').select('*').in('project_id', projectIds).eq('activo', true),
        supabase.from('cuotas_condominio').select('*').in('unidad_id', unidadIds).order('fecha_vencimiento', { ascending: false }),
        supabase.from('reservas_amenidades').select('*').in('unidad_id', unidadIds).gte('fecha', today).order('fecha'),
        supabase.from('amenidades_bloqueos').select('*').in('project_id', projectIds),
        supabase.from('tickets_mantenimiento').select('*').in('unidad_id', unidadIds).order('created_at', { ascending: false }),
        supabase.from('anuncios_comunidad').select('*').in('project_id', projectIds).eq('activo', true).order('created_at', { ascending: false }),
        supabase.from('visitantes').select('*').in('unidad_id', unidadIds).order('hora_entrada', { ascending: false }).limit(200),
        supabase.from('mensajes_portal').select('*').in('unidad_id', unidadIds).order('created_at', { ascending: false }),
      ])

      const proj = (projData as { id: string; company_id: string; moneda_condominios: string | null; moneda: string }[] | null)?.[0]
      if (proj) {
        setMoneda(proj.moneda_condominios ?? proj.moneda ?? 'Q')
        // Resolve company_id from project when client doesn't have one set directly
        if (!currentUser.company_id && proj.company_id) {
          setResolvedCompanyId(proj.company_id)
        }
      }

      setAmenidades((amenidadesData as Amenidad[]) ?? [])
      setCuotas((cuotasData as CuotaCondominio[]) ?? [])
      setReservas((reservasData as ReservaAmenidad[]) ?? [])
      setBloqueos((bloqueosData as BloqueoAmenidad[]) ?? [])
      setTickets((ticketsData as TicketMantenimiento[]) ?? [])
      setAnuncios((anunciosData as AnuncioComunidad[]) ?? [])
      setVisitantes((visitantesData as Visitante[]) ?? [])
      setMensajes((mensajesData as MensajePortal[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [clienteId, currentUser.company_id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // No services guard (only after initial load)
  if (!loading && unidades.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}>
        <div style={{
          background: 'white', borderRadius: '24px', padding: '48px 40px',
          maxWidth: '480px', width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.16)',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>🏢</div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            Sin unidades asociadas
          </h2>
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: '#475569', lineHeight: 1.6 }}>
            No tiene unidades activas vinculadas a su cuenta en este condominio.
          </p>
          <p style={{ margin: '0 0 32px', fontSize: '13.5px', color: '#94a3b8' }}>
            Si cree que esto es un error, comuníquese con la administración.
          </p>
          <div style={{ background: '#f1f5f9', borderRadius: '12px', padding: '16px', fontSize: '13px', color: '#64748b', marginBottom: '28px' }}>
            <strong style={{ color: '#334155' }}>Sesión activa:</strong> {currentUser.name}<br />{currentUser.email}
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '12px 32px', background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
              color: 'white', border: 'none', borderRadius: '12px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}
          >Cerrar sesión</button>
        </div>
      </div>
    )
  }

  const unidad     = unidades.find(u => u.id === selectedUnidadId) ?? unidades[0] ?? null
  const proyectoId = unidad?.project_id ?? ''

  // Data filtered to selected unit
  const cuotasU     = cuotas.filter(c => c.unidad_id === selectedUnidadId)
  const ticketsU    = tickets.filter(t => t.unidad_id === selectedUnidadId)
  const visitantesU = visitantes.filter(v => v.unidad_id === selectedUnidadId)
  const mensajesU   = mensajes.filter(m => m.unidad_id === selectedUnidadId)

  // KPI values
  const cuotasPendientes = cuotasU.filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
  const deudaTotal       = cuotasPendientes.reduce((s, c) => s + c.monto, 0)
  const ticketsAbiertos  = ticketsU.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length
  const misReservas      = reservas.filter(r => r.unidad_id === selectedUnidadId)
  const reservasProx     = misReservas.filter(r => r.estado === 'confirmada' || r.estado === 'pendiente').length
  const anunciosNuevos   = anuncios.filter(a => {
    const hace7 = new Date(); hace7.setDate(hace7.getDate() - 7)
    return new Date(a.created_at) >= hace7
  }).length

  const kpiCards = [
    { label: 'Deuda Pendiente',   value: loading ? '' : `${moneda} ${deudaTotal.toFixed(2)}`, icon: '💳', bg: deudaTotal > 0 ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #10b981, #059669)' },
    { label: 'Tickets Abiertos',  value: loading ? '' : String(ticketsAbiertos),              icon: '🔧', bg: 'linear-gradient(135deg, #6366f1, #4f46e5)' },
    { label: 'Reservas Activas',  value: loading ? '' : String(reservasProx),                 icon: '🏊', bg: 'linear-gradient(135deg, #0ea5e9, #0284c7)' },
    { label: 'Anuncios (7 días)', value: loading ? '' : String(anunciosNuevos),               icon: '📢', bg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ff' }}>
      <style>{PORTAL_CSS}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
        boxShadow: '0 2px 12px rgba(79,70,229,0.3)',
      }}>
        <div style={{
          maxWidth: '960px', margin: '0 auto', padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px',
            }}>🏢</div>
            <div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: '16px' }}>{currentUser.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px' }}>Portal del Residente</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Unit selector (shown when multiple units) */}
            {unidades.length > 1 && (
              <select
                value={selectedUnidadId}
                onChange={e => { setSelectedUnidadId(e.target.value); setTab('mi_unidad') }}
                style={{
                  padding: '7px 12px', borderRadius: '9px', fontSize: '13px', fontWeight: 600,
                  border: '1.5px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.15)',
                  color: 'white', cursor: 'pointer', outline: 'none',
                }}
              >
                {unidades.map(u => (
                  <option key={u.id} value={u.id} style={{ color: '#0f172a', background: 'white' }}>
                    🏠 {u.nombre}
                  </option>
                ))}
              </select>
            )}
            {unidades.length === 1 && unidad && (
              <div style={{
                padding: '7px 14px', borderRadius: '9px', fontSize: '13px', fontWeight: 600,
                background: 'rgba(255,255,255,0.15)', color: 'white',
                border: '1.5px solid rgba(255,255,255,0.3)',
              }}>🏠 {unidad.nombre}</div>
            )}

            <button
              onClick={onLogout}
              style={{
                padding: '8px 18px', background: 'rgba(255,255,255,0.15)',
                color: 'white', border: '1.5px solid rgba(255,255,255,0.3)',
                borderRadius: '10px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
              }}
            >Cerrar sesión</button>
          </div>
        </div>

        {/* Tab navigation */}
        <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '4px', overflowX: 'auto' }}>
          {PORTAL_TABS.map(t => (
            <button
              key={t.id}
              className={`condo-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px', whiteSpace: 'nowrap',
                background: tab === t.id ? 'white' : 'transparent',
                color: tab === t.id ? '#4f46e5' : 'rgba(255,255,255,0.85)',
                border: 'none', borderRadius: '10px 10px 0 0',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 24px' }}>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '14px', marginBottom: '24px' }}>
          {kpiCards.map(card => (
            <div key={card.label} style={{
              background: card.bg, borderRadius: '16px', padding: '20px',
              color: 'white', boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            }}>
              <div style={{ fontSize: '22px', marginBottom: '8px', opacity: loading ? 0.4 : 1 }}>{card.icon}</div>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="condo-skeleton" style={{ height: '22px', width: '65%' }} />
                  <div className="condo-skeleton" style={{ height: '11px', width: '50%' }} />
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, marginBottom: '4px' }}>{card.value}</div>
                  <div style={{ fontSize: '11.5px', opacity: 0.88 }}>{card.label}</div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Tab content */}
        {loading ? (
          <div style={{
            background: 'white', borderRadius: '20px', padding: '48px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              width: '28px', height: '28px',
              border: '3px solid #e2e8f0', borderTop: '3px solid #4f46e5',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>Cargando información…</span>
          </div>
        ) : !unidad ? null : (
          <div style={{ background: 'white', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            {tab === 'mi_unidad' && (
              <PortalMiUnidadTab
                unidad={unidad}
                mensajes={mensajesU}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                isAdmin={false}
                onRefresh={cargarDatos}
                onGenerarToken={() => {}}
              />
            )}
            {tab === 'reservas' && (
              amenidades.length === 0 ? (
                <EmptyState icon="🏊" title="Sin amenidades disponibles" text="Este condominio no tiene amenidades configuradas para reservar." />
              ) : (
                <PortalReservasTab
                  amenidades={amenidades}
                  reservas={reservas}
                  bloqueos={bloqueos}
                  unidadId={selectedUnidadId}
                  proyectoId={proyectoId}
                  companyId={resolvedCompanyId}
                  moneda={moneda}
                  onRefresh={cargarDatos}
                />
              )
            )}
            {tab === 'cuenta' && (
              <PortalMiCuentaTab
                cuotas={cuotasU}
                moneda={moneda}
                unidadNombre={unidad.nombre}
              />
            )}
            {tab === 'tickets' && (
              <PortalMisTicketsTab
                tickets={ticketsU}
                unidadId={selectedUnidadId}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                onRefresh={cargarDatos}
              />
            )}
            {tab === 'visitantes' && (
              <PortalVisitantesTab
                visitantes={visitantesU}
                unidadId={selectedUnidadId}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                onRefresh={cargarDatos}
              />
            )}
            {tab === 'anuncios' && (
              anuncios.length === 0 ? (
                <EmptyState icon="📢" title="Sin anuncios" text="No hay anuncios publicados en este momento." />
              ) : (
                <PortalAnunciosTab anuncios={anuncios} />
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
      <div style={{ fontSize: '48px', marginBottom: '14px' }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: '15px', color: '#64748b', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
  )
}
