import { useState, useEffect } from 'react'
import { fetchMensajesPortal, activarPortalUnidad } from '../../../domain/condominios/tabQueries'
import type {
  Unidad, CuotaCondominio, TicketMantenimiento,
  Amenidad, ReservaAmenidad, BloqueoAmenidad, Visitante, AnuncioComunidad, MensajePortal,
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
  bloqueosAmenidades: BloqueoAmenidad[]
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
  unidades, cuotas, tickets, amenidades, reservas, bloqueosAmenidades, visitantes, anuncios,
  proyectoId, companyId, moneda, canEdit, onRefresh,
}: Props) {
  const [selectedUnidadId, setSelectedUnidadId] = useState('')
  const [subTab, setSubTab]                     = useState<PortalTab>('cuenta')
  const [mensajes, setMensajes]                 = useState<MensajePortal[]>([])

  const unidad = unidades.find(u => u.id === selectedUnidadId) ?? null

  useEffect(() => {
    if (!selectedUnidadId) { setMensajes([]); return }
    void fetchMensajesPortal<MensajePortal>(selectedUnidadId).then(setMensajes)
  }, [selectedUnidadId])

  async function generarToken() {
    if (!unidad) return
    const token = crypto.randomUUID().replace(/-/g, '')
    await activarPortalUnidad(unidad.id, token)
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
      <span style={{ marginLeft: '5px', background: 'var(--at-danger)', color: 'var(--at-on-status)', borderRadius: '10px',
        fontSize: '10px', fontWeight: 800, padding: '1px 6px', verticalAlign: 'middle' }}>
        {n}
      </span>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,var(--at-ink-deep),var(--at-primary-hover))', borderRadius: '16px', padding: '20px 24px', marginBottom: '20px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
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
            <option value="" style={{ color: 'var(--at-ink)' }}>— Seleccionar —</option>
            {unidades.map(u => (
              <option key={u.id} value={u.id} style={{ color: 'var(--at-ink)' }}>{u.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedUnidadId || !unidad ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '14px' }}>🏠</div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>Selecciona una unidad</div>
          <div style={{ fontSize: '13px' }}>Elige una unidad del desplegable superior para ver su portal completo</div>
        </div>
      ) : (
        <>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px', borderBottom: '2px solid var(--at-line)', paddingBottom: '10px' }}>
            {SUB_TABS.map(t => (
              <button key={t.id} onClick={() => setSubTab(t.id)}
                style={{
                  padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700,
                  background: subTab === t.id ? 'var(--at-primary)' : 'var(--at-chip)',
                  color:      subTab === t.id ? 'white'    : 'var(--at-ink-3)',
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
          <div style={{ background: 'var(--at-surface-2)', borderRadius: '14px', padding: '20px' }}>
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
                bloqueos={bloqueosAmenidades}
                unidadId={selectedUnidadId}
                proyectoId={proyectoId}
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
                  void fetchMensajesPortal<MensajePortal>(selectedUnidadId).then(setMensajes)
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
