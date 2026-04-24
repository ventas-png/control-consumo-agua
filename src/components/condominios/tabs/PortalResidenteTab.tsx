import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import type {
  Unidad, CuotaCondominio, TicketMantenimiento,
  Amenidad, ReservaAmenidad, Visitante, AnuncioComunidad, MensajePortal,
} from '../../../types'
import { PortalMiCuentaTab }   from './PortalMiCuentaTab'
import { PortalMisTicketsTab } from './PortalMisTicketsTab'
import { PortalReservasTab }   from './PortalReservasTab'
import { PortalVisitantesTab } from './PortalVisitantesTab'
import { PortalAnunciosTab }   from './PortalAnunciosTab'
import { PortalMiUnidadTab }   from './PortalMiUnidadTab'

interface Props {
  unidades:   Unidad[]
  cuotas:     CuotaCondominio[]
  tickets:    TicketMantenimiento[]
  amenidades: Amenidad[]
  reservas:   ReservaAmenidad[]
  visitantes: Visitante[]
  anuncios:   AnuncioComunidad[]
  proyectoId: string
  companyId:  string
  moneda:     string
  canEdit:    boolean
  onRefresh:  () => void
}

type PortalTab = 'cuenta' | 'tickets' | 'reservas' | 'visitantes' | 'anuncios' | 'mi_unidad'

const SUB_TABS: { id: PortalTab; label: string; icon: string }[] = [
  { id: 'cuenta',     label: 'Mi cuenta',    icon: '💳' },
  { id: 'tickets',    label: 'Mantenimiento', icon: '🔧' },
  { id: 'reservas',   label: 'Amenidades',   icon: '🏊' },
  { id: 'visitantes', label: 'Visitantes',   icon: '🚪' },
  { id: 'anuncios',   label: 'Anuncios',     icon: '📢' },
  { id: 'mi_unidad',  label: 'Mi unidad',    icon: '🏠' },
]

export function PortalResidenteTab({
  unidades, cuotas, tickets, amenidades, reservas, visitantes, anuncios,
  proyectoId, companyId, moneda, canEdit, onRefresh,
}: Props) {
  const [selectedUnidadId, setSelectedUnidadId] = useState('')
  const [subTab, setSubTab]                     = useState<PortalTab>('cuenta')
  const [mensajes, setMensajes]                 = useState<MensajePortal[]>([])

  const unidad = unidades.find(u => u.id === selectedUnidadId) ?? null

  useEffect(() => {
    if (!selectedUnidadId) { setMensajes([]); return }
    supabase.from('mensajes_portal')
      .select('*').eq('unidad_id', selectedUnidadId).order('created_at', { ascending: false })
      .then(({ data }) => setMensajes(data ?? []))
  }, [selectedUnidadId])

  async function generarToken() {
    if (!unidad) return
    const token = crypto.randomUUID().replace(/-/g, '')
    await supabase.from('unidades').update({ token_portal: token, portal_activo: true }).eq('id', unidad.id)
    onRefresh()
  }

  const cuotasU     = cuotas.filter(c => c.unidad_id === selectedUnidadId)
  const ticketsU    = tickets.filter(t => t.unidad_id === selectedUnidadId)
  const visitantesU = visitantes.filter(v => v.unidad_id === selectedUnidadId)

  const pendientes = cuotasU.filter(c => c.estado !== 'pagado').length
  const abiertos   = ticketsU.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length
  const nuevosMsgs = mensajes.filter(m => m.estado === 'nuevo' || m.estado === 'respondido').length

  function badge(n: number) {
    if (n === 0) return null
    return (
      <span style={{ marginLeft: '5px', background: '#ef4444', color: 'white', borderRadius: '10px',
        fontSize: '10px', fontWeight: 800, padding: '1px 6px', verticalAlign: 'middle' }}>
        {n}
      </span>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#1e40af,#1d4ed8)', borderRadius: '16px', padding: '20px 24px', marginBottom: '20px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>Portal del Residente</div>
          <div style={{ fontSize: '13px', opacity: 0.8 }}>Vista del propietario — selecciona una unidad para gestionar</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: '12px', padding: '8px 16px', backdropFilter: 'blur(4px)' }}>
          <div style={{ fontSize: '11px', opacity: 0.75, marginBottom: '4px', fontWeight: 600 }}>Unidad activa</div>
          <select
            value={selectedUnidadId}
            onChange={e => { setSelectedUnidadId(e.target.value); setSubTab('cuenta') }}
            style={{ background: 'transparent', border: 'none', color: 'white', fontWeight: 700, fontSize: '14px', cursor: 'pointer', outline: 'none' }}>
            <option value="" style={{ color: '#0f172a' }}>— Seleccionar —</option>
            {unidades.map(u => (
              <option key={u.id} value={u.id} style={{ color: '#0f172a' }}>{u.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedUnidadId || !unidad ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#94a3b8' }}>
          <div style={{ fontSize: '48px', marginBottom: '14px' }}>🏠</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#64748b', marginBottom: '6px' }}>Selecciona una unidad</div>
          <div style={{ fontSize: '13px' }}>Elige una unidad del desplegable superior para ver su portal completo</div>
        </div>
      ) : (
        <>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px' }}>
            {SUB_TABS.map(t => (
              <button key={t.id} onClick={() => setSubTab(t.id)}
                style={{
                  padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700,
                  background: subTab === t.id ? '#2563eb' : '#f1f5f9',
                  color:      subTab === t.id ? 'white'    : '#64748b',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {t.id === 'cuenta'    && badge(pendientes)}
                {t.id === 'tickets'   && badge(abiertos)}
                {t.id === 'mi_unidad' && badge(nuevosMsgs)}
              </button>
            ))}
          </div>

          {/* Sub-tab content */}
          <div style={{ background: '#f8fafc', borderRadius: '14px', padding: '20px' }}>
            {subTab === 'cuenta' && (
              <PortalMiCuentaTab
                cuotas={cuotasU}
                moneda={moneda}
                unidadNombre={unidad.nombre}
              />
            )}
            {subTab === 'tickets' && (
              <PortalMisTicketsTab
                tickets={ticketsU}
                unidadId={selectedUnidadId}
                proyectoId={proyectoId}
                companyId={companyId}
                onRefresh={onRefresh}
              />
            )}
            {subTab === 'reservas' && (
              <PortalReservasTab
                amenidades={amenidades}
                reservas={reservas}
                unidadId={selectedUnidadId}
                companyId={companyId}
                moneda={moneda}
                onRefresh={onRefresh}
              />
            )}
            {subTab === 'visitantes' && (
              <PortalVisitantesTab
                visitantes={visitantesU}
                unidadId={selectedUnidadId}
                proyectoId={proyectoId}
                companyId={companyId}
                onRefresh={onRefresh}
              />
            )}
            {subTab === 'anuncios' && (
              <PortalAnunciosTab anuncios={anuncios} />
            )}
            {subTab === 'mi_unidad' && (
              <PortalMiUnidadTab
                unidad={unidad}
                mensajes={mensajes}
                proyectoId={proyectoId}
                companyId={companyId}
                isAdmin={canEdit}
                onRefresh={() => {
                  supabase.from('mensajes_portal')
                    .select('*').eq('unidad_id', selectedUnidadId).order('created_at', { ascending: false })
                    .then(({ data }) => setMensajes(data ?? []))
                  onRefresh()
                }}
                onGenerarToken={generarToken}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
