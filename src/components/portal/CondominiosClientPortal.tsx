import { useState, useEffect, useCallback } from 'react'
import { fetchCondominiosPortalData, fetchPortalUnidadesByCliente, fetchPortalPaymentConfig, fetchPortalRecargoTarjeta, marcarAnunciosLeidos } from '../../domain/portal/queries'
import type { RecargoTarjetaRow } from '../../lib/businessPagos'
import { confirmarPagoCuota } from '../../domain/portal/mutations'
import { notify } from '../shared/Dialog'
import { BrandLogo } from '../shared/BrandLogo'
import { EditModal } from '../shared/EditModal'
import { NotificationBell } from '../layout/NotificationBell'
import type {
  UserSession, Unidad, CuotaCondominio, Amenidad,
  ReservaAmenidad, BloqueoAmenidad, TicketMantenimiento,
  AnuncioComunidad, Visitante, MensajePortal, SolicitudRentaUnidad, PaqueteRecibido,
  ComunicadoCondominio,
} from '../../types'
import { PortalReservasTab }   from '../condominios/tabs/PortalReservasTab'
import { PortalMiCuentaTab }   from '../condominios/tabs/PortalMiCuentaTab'
import { PortalMisTicketsTab } from '../condominios/tabs/PortalMisTicketsTab'
import { PortalMiUnidadTab }   from '../condominios/tabs/PortalMiUnidadTab'
import { PortalVisitantesTab } from '../condominios/tabs/PortalVisitantesTab'
import { PortalAnunciosTab }   from '../condominios/tabs/PortalAnunciosTab'
import { PortalRentasTab }     from '../condominios/tabs/PortalRentasTab'
import { PortalMudanzaTab }    from '../condominios/tabs/PortalMudanzaTab'
import { PortalPaquetesTab }   from '../condominios/tabs/PortalPaquetesTab'
import { MediaScopeProvider }  from '../shared/MediaScopeContext'
// F3.12: Portal residente ampliado (asambleas + transparencia)
import { PortalAsambleasTab }     from '../condominios/tabs/PortalAsambleasTab'
import { PortalTransparenciaTab } from '../condominios/tabs/PortalTransparenciaTab'
// plat:P36: gating por plan
import { FeatureGate } from '../../lib/featureFlags'
import { UpgradeCTA } from '../shared/UpgradeCTA'

interface Props {
  currentUser: UserSession
  onLogout: () => void
}

type PortalTab = 'mi_unidad' | 'reservas' | 'cuenta' | 'tickets' | 'visitantes' | 'paquetes' | 'anuncios' | 'rentas' | 'mudanza' | 'asambleas' | 'transparencia'

// `user_notifications.seccion` es texto libre: los productores escriben tanto
// secciones de la app de staff ('condominios', 'cobros') como destinos del
// portal ('anuncios', 'paquetes'). Se traduce lo que tiene equivalente aquí y se
// ignora el resto — antes sólo se atendía 'paquetes' y todo lo demás, incluido
// el aviso de anuncio nuevo que 20260801000500 ya emitía, no llevaba a ninguna
// parte.
const SECCION_A_TAB: Record<string, PortalTab> = {
  paquetes: 'paquetes',
  anuncios: 'anuncios',
  condominios: 'mi_unidad',
  condominios_dashboard: 'mi_unidad',
  condominios_cuotas: 'cuenta',
  cobros: 'cuenta',
  condominios_mantenimiento: 'tickets',
  condominios_visitantes: 'visitantes',
}

const PORTAL_TABS: { id: PortalTab; label: string; icon: string }[] = [
  { id: 'mi_unidad',     label: 'Mi Unidad',       icon: '🏠' },
  { id: 'reservas',      label: 'Reservas',        icon: '🏊' },
  { id: 'cuenta',        label: 'Mi Cuenta',       icon: '💳' },
  { id: 'tickets',       label: 'Mantenimiento',   icon: '🔧' },
  { id: 'visitantes',    label: 'Visitantes',      icon: '🚪' },
  { id: 'paquetes',      label: 'Paquetería',      icon: '📦' },
  { id: 'anuncios',      label: 'Anuncios',        icon: '📢' },
  { id: 'asambleas',     label: 'Asambleas',       icon: '🏛️' },
  { id: 'transparencia', label: 'Transparencia',   icon: '📊' },
  { id: 'rentas',        label: 'Rentas',          icon: '🏨' },
  { id: 'mudanza',       label: 'Mudanzas',        icon: '🚛' },
]

// Los estilos .condo-skeleton/.condo-tab (y keyframes) viven ahora en
// src/styles/runtime.css (I24).

export function CondominiosClientPortal({ currentUser, onLogout }: Props) {
  const clienteId = currentUser.cliente_id ?? ''

  const [loading, setLoading]                     = useState(true)
  const [tab, setTab]                             = useState<PortalTab>('mi_unidad')
  const [unidades, setUnidades]                   = useState<Unidad[]>([])
  const [selectedUnidadId, setSelectedUnidadId]   = useState('')
  const [resolvedCompanyId, setResolvedCompanyId] = useState(currentUser.company_id ?? '')
  const [moneda, setMoneda]                       = useState('Q')
  // Recargo por pago con tarjeta + canal efectivo (desglose pre-pago del modal
  // de cuotas; el cobro real lo sella el edge server-side).
  const [recargoRows, setRecargoRows]             = useState<RecargoTarjetaRow[]>([])
  const [canalPago, setCanalPago]                 = useState('sandbox')
  const [cuotas, setCuotas]                       = useState<CuotaCondominio[]>([])
  const [amenidades, setAmenidades]               = useState<Amenidad[]>([])
  const [reservas, setReservas]                   = useState<ReservaAmenidad[]>([])
  const [bloqueos, setBloqueos]                   = useState<BloqueoAmenidad[]>([])
  const [tickets, setTickets]                     = useState<TicketMantenimiento[]>([])
  const [anuncios, setAnuncios]                   = useState<AnuncioComunidad[]>([])
  const [visitantes, setVisitantes]               = useState<Visitante[]>([])
  const [mensajes, setMensajes]                   = useState<MensajePortal[]>([])
  const [solicitudesRenta, setSolicitudesRenta]   = useState<SolicitudRentaUnidad[]>([])
  const [paquetes, setPaquetes]                   = useState<PaqueteRecibido[]>([])
  const [comunicados, setComunicados]             = useState<ComunicadoCondominio[]>([])
  const [popupOpen, setPopupOpen]                 = useState(false)

  const cargarDatos = useCallback(async () => {
    if (!clienteId) { setLoading(false); return }
    setLoading(true)
    try {
      // Batch 1: load client's units
      const uData = await fetchPortalUnidadesByCliente(clienteId)
      const unidadesList = (uData as Unidad[]) ?? []
      setUnidades(unidadesList)

      if (unidadesList.length === 0) return

      setSelectedUnidadId(prev => prev || unidadesList[0].id)

      const unidadIds  = unidadesList.map(u => u.id)
      const projectIds = [...new Set(unidadesList.map(u => u.project_id).filter(Boolean))] as string[]

      // Batch 2: all condominios data in parallel (los caps de tiempo viven en la
      // capa domain; el portal muestra actividad reciente, el admin tiene su loader).
      const {
        projData, amenidadesData, cuotasData, reservasData, bloqueosData,
        ticketsData, anunciosData, visitantesData, mensajesData,
        solicitudesRentaData, paquetesData, comunicadosData,
      } = await fetchCondominiosPortalData(projectIds, unidadIds)

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
      setSolicitudesRenta((solicitudesRentaData as SolicitudRentaUnidad[]) ?? [])
      setPaquetes(((paquetesData as (PaqueteRecibido & { unidades?: { nombre: string } | null })[]) ?? [])
        .map(r => ({ ...r, unidad_nombre: r.unidades?.nombre })))
      setComunicados((comunicadosData as ComunicadoCondominio[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [clienteId, currentUser.company_id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Recargo por pago con tarjeta + canal efectivo del tenant, para el desglose
  // pre-pago del modal de cuotas (el cobro real lo sella create-charge).
  useEffect(() => {
    if (!resolvedCompanyId) return
    let cancelado = false
    void Promise.all([
      fetchPortalPaymentConfig(resolvedCompanyId),
      fetchPortalRecargoTarjeta(resolvedCompanyId),
    ]).then(([cfg, rows]) => {
      if (cancelado) return
      setCanalPago(cfg?.proveedor_pago || 'sandbox')
      setRecargoRows(rows)
    })
    return () => { cancelado = true }
  }, [resolvedCompanyId])

  // F1 pago en línea: retorno del checkout hospedado (?pago=ok|cancelado). En 'ok'
  // confirma+concilia server-side el pago guardado antes de redirigir. Corre una
  // sola vez al montar; limpia el query param para no re-disparar en refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pago = params.get('pago')
    if (!pago) return
    params.delete('pago')
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash)
    if (pago === 'cancelado') {
      notify({ variant: 'warning', title: 'Pago cancelado', text: 'No se completó el pago. Podés intentarlo de nuevo.' })
      return
    }
    if (pago !== 'ok') return
    let prId: string | null = null
    try { prId = sessionStorage.getItem('pago_pr_id'); sessionStorage.removeItem('pago_pr_id') } catch { /* no-op */ }
    if (!prId) return
    void (async () => {
      const conf = await confirmarPagoCuota(prId)
      if (conf.error) { notify({ variant: 'error', title: 'Pago no confirmado', text: conf.error }); return }
      if (conf.estado === 'aprobado') {
        notify({
          variant: 'success',
          title: conf.cuotaLiquidada ? 'Cuota pagada' : 'Abono registrado',
          text: conf.cuotaLiquidada ? 'Tu cuota quedó al día.' : `Saldo restante: ${moneda} ${(conf.saldoRestante ?? 0).toFixed(2)}`,
        })
        cargarDatos()
      } else {
        notify({ variant: 'info', title: 'Pago en proceso', text: 'Tu pago aún se está procesando; se reflejará en unos momentos.' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Acuse de lectura: al abrir Anuncios se sella la lectura de los que se le
  // muestran. Best-effort y idempotente (UNIQUE anuncio_id+cliente_id), así que
  // volver al tab no re-marca ni duplica. No bloquea el render.
  useEffect(() => {
    if (tab !== 'anuncios' || loading) return
    // El proyecto se deriva aquí (y no de `proyectoId`, que se calcula más
    // abajo, después del guard de "sin unidades"): los hooks van todos arriba.
    const pid = unidades.find(u => u.id === selectedUnidadId)?.project_id ?? unidades[0]?.project_id
    if (!pid || !clienteId || !resolvedCompanyId) return
    const visibles = anuncios.filter(a => a.project_id === pid && a.activo).map(a => a.id)
    if (visibles.length === 0) return
    void marcarAnunciosLeidos(visibles, clienteId, resolvedCompanyId)
  }, [tab, loading, anuncios, unidades, selectedUnidadId, clienteId, resolvedCompanyId])

  // Pop-up de aviso: muestra los paquetes pendientes una vez por sesión (set de
  // ids vistos en sessionStorage para no repetir en cada refresco).
  useEffect(() => {
    if (loading) return
    const pend = paquetes.filter(p => p.estado === 'pendiente')
    if (pend.length === 0) return
    let seen: string[] = []
    try { seen = JSON.parse(sessionStorage.getItem('paq_popup_seen') ?? '[]') } catch { seen = [] }
    if (pend.some(p => !seen.includes(p.id))) setPopupOpen(true)
  }, [loading, paquetes])

  // No services guard (only after initial load)
  if (!loading && unidades.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, var(--at-accent-hover) 0%, var(--at-accent) 50%, var(--at-accent-light) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}>
        <div style={{
          background: 'var(--at-surface)', borderRadius: '24px', padding: '48px 40px',
          maxWidth: '480px', width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.16)',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>🏢</div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Sin unidades asociadas
          </h2>
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: 'var(--at-ink-2)', lineHeight: 1.6 }}>
            No tiene unidades activas vinculadas a su cuenta en este condominio.
          </p>
          <p style={{ margin: '0 0 32px', fontSize: '13.5px', color: 'var(--at-ink-3)' }}>
            Si cree que esto es un error, comuníquese con la administración.
          </p>
          <div style={{ background: 'var(--at-chip)', borderRadius: '12px', padding: '16px', fontSize: '13px', color: 'var(--at-ink-3)', marginBottom: '28px' }}>
            <strong style={{ color: 'var(--at-ink-2)' }}>Sesión activa:</strong> {currentUser.name}<br />{currentUser.email}
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '12px 32px', background: 'linear-gradient(135deg, var(--at-accent-hover), var(--at-accent))',
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
  const cuotasU        = cuotas.filter(c => c.unidad_id === selectedUnidadId)
  const ticketsU       = tickets.filter(t => t.unidad_id === selectedUnidadId)
  const visitantesU    = visitantes.filter(v => v.unidad_id === selectedUnidadId)
  const paquetesU      = paquetes.filter(p => p.unidad_id === selectedUnidadId)
  const mensajesU      = mensajes.filter(m => m.unidad_id === selectedUnidadId)
  const comunicadosU   = comunicados.filter(c => c.unidad_id === selectedUnidadId)
  const paquetesPendientes = paquetes.filter(p => p.estado === 'pendiente')

  function cerrarPopup(irA?: boolean) {
    try { sessionStorage.setItem('paq_popup_seen', JSON.stringify(paquetesPendientes.map(p => p.id))) } catch { /* ignore */ }
    setPopupOpen(false)
    if (irA) setTab('paquetes')
  }
  // Most recent rental authorization for the selected unit (null = none submitted)
  const solicitudRentaU = solicitudesRenta.find(s => s.unidad_id === selectedUnidadId) ?? null

  // Data filtered to selected unit's project
  const amenidadesP = amenidades.filter(a => a.project_id === proyectoId)
  const bloqueosP   = bloqueos.filter(b => b.project_id === proyectoId)
  const anunciosP   = anuncios.filter(a => a.project_id === proyectoId)

  // KPI values
  const cuotasPendientes = cuotasU.filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
  const deudaTotal       = cuotasPendientes.reduce((s, c) => s + c.monto, 0)
  const ticketsAbiertos  = ticketsU.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length
  const misReservas      = reservas.filter(r => r.unidad_id === selectedUnidadId)
  const reservasProx     = misReservas.filter(r => r.estado === 'confirmada' || r.estado === 'pendiente').length
  const anunciosNuevos   = anunciosP.filter(a => {
    const hace7 = new Date(); hace7.setDate(hace7.getDate() - 7)
    return new Date(a.created_at) >= hace7
  }).length

  const kpiCards = [
    { label: 'Deuda Pendiente',   value: loading ? '' : `${moneda} ${deudaTotal.toFixed(2)}`, icon: '💳', bg: deudaTotal > 0 ? 'linear-gradient(135deg, var(--at-warning), var(--at-warning))' : 'linear-gradient(135deg, var(--at-success), var(--at-success-strong))' },
    { label: 'Tickets Abiertos',  value: loading ? '' : String(ticketsAbiertos),              icon: '🔧', bg: 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))' },
    { label: 'Reservas Activas',  value: loading ? '' : String(reservasProx),                 icon: '🏊', bg: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))' },
    { label: 'Anuncios (7 días)', value: loading ? '' : String(anunciosNuevos),               icon: '📢', bg: 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))' },
  ]

  return (
    /* infra:I14 — provides the resident's unit project_id to condominios-media uploaders. */
    <MediaScopeProvider projectId={proyectoId}>
    <div style={{ minHeight: '100vh', background: 'var(--at-accent-tint-2)' }}>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--at-accent-hover), var(--at-accent))',
        boxShadow: '0 2px 12px rgba(156, 87, 51,0.3)',
      }}>
        <div className="portal-header" style={{
          maxWidth: '960px', margin: '0 auto', padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', lineHeight: 0, flexShrink: 0 }}>
              <BrandLogo size={38} />
            </div>
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
                  <option key={u.id} value={u.id} style={{ color: 'var(--at-ink)', background: 'var(--at-surface)' }}>
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

            <NotificationBell
              userId={currentUser.user_id}
              onNavigate={s => {
                if (Object.prototype.hasOwnProperty.call(SECCION_A_TAB, s)) setTab(SECCION_A_TAB[s])
              }}
            />

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
        <div className="tab-strip-scrollable" style={{ maxWidth: '960px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '4px', overflowX: 'auto' }}>
          {PORTAL_TABS.map(t => (
            <button
              key={t.id}
              className={`condo-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px', whiteSpace: 'nowrap', flexShrink: 0,
                background: tab === t.id ? 'var(--at-surface)' : 'transparent',
                color: tab === t.id ? 'var(--at-accent-hover)' : 'rgba(255,255,255,0.85)',
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
            background: 'var(--at-surface)', borderRadius: '20px', padding: '48px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}>
            <div style={{
              width: '28px', height: '28px',
              border: '3px solid var(--at-line)', borderTop: '3px solid var(--at-accent-hover)',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ fontSize: '14px', color: 'var(--at-ink-3)', fontWeight: 500 }}>Cargando información…</span>
          </div>
        ) : !unidad ? null : (
          <div style={{ background: 'var(--at-surface)', borderRadius: '20px', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
            {tab === 'mi_unidad' && (
              <PortalMiUnidadTab
                unidad={unidad}
                mensajes={mensajesU}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                isAdmin={false}
                autorNombre={currentUser.name}
                autorUserId={currentUser.user_id}
                onRefresh={cargarDatos}
                onGenerarToken={() => {}}
              />
            )}
            {tab === 'reservas' && (
              amenidadesP.length === 0 ? (
                <EmptyState icon="🏊" title="Sin amenidades disponibles" text="Este condominio no tiene amenidades configuradas para reservar." />
              ) : (
                <PortalReservasTab
                  amenidades={amenidadesP}
                  reservas={misReservas}
                  bloqueos={bloqueosP}
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
                recargoRows={recargoRows}
                canalPago={canalPago}
                onPagado={cargarDatos}
              />
            )}
            {tab === 'tickets' && (
              <PortalMisTicketsTab
                tickets={ticketsU}
                unidadId={selectedUnidadId}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                autorNombre={currentUser.name}
                autorUserId={currentUser.user_id}
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
            {tab === 'paquetes' && (
              <PortalPaquetesTab
                paquetes={paquetesU}
                unidadId={selectedUnidadId}
                nombrePrefill={currentUser.name}
                onRefresh={cargarDatos}
              />
            )}
            {tab === 'anuncios' && (
              anunciosP.length === 0 && comunicadosU.length === 0 ? (
                <EmptyState icon="📢" title="Sin anuncios" text="No hay anuncios publicados en este momento." />
              ) : (
                <PortalAnunciosTab anuncios={anunciosP} comunicados={comunicadosU} unidadNombre={unidad.nombre} />
              )
            )}
            {tab === 'rentas' && (
              <PortalRentasTab
                unidadId={selectedUnidadId}
                unidadNombre={unidad.nombre}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                clienteId={clienteId}
                solicitudRenta={solicitudRentaU}
                onSolicitudChange={cargarDatos}
              />
            )}
            {tab === 'mudanza' && (
              <PortalMudanzaTab
                unidadId={selectedUnidadId}
                unidadNombre={unidad.nombre}
                proyectoId={proyectoId}
                companyId={resolvedCompanyId}
                clienteId={clienteId}
              />
            )}
            {tab === 'asambleas' && (
              <FeatureGate
                feature="asambleas_digitales"
                fallback={
                  <UpgradeCTA
                    feature="Asambleas digitales"
                    description="Vota digitalmente en asambleas del condominio, consulta resultados en tiempo real y accede al histórico de actas."
                    requiredPlan="Solo Condominios o Bundle Completo"
                  />
                }
              >
                <PortalAsambleasTab
                  unidadId={selectedUnidadId}
                  proyectoId={proyectoId}
                />
              </FeatureGate>
            )}
            {tab === 'transparencia' && (
              <FeatureGate
                feature="transparencia_financiera"
                fallback={
                  <UpgradeCTA
                    feature="Transparencia financiera"
                    description="Consulta el presupuesto, gastos por categoría y fondo de reserva del condominio en tiempo real."
                    requiredPlan="Solo Condominios o Bundle Completo"
                  />
                }
              >
                <PortalTransparenciaTab
                  proyectoId={proyectoId}
                  moneda={moneda}
                />
              </FeatureGate>
            )}
          </div>
        )}
      </div>

      {popupOpen && paquetesPendientes.length > 0 && (
        <EditModal title="📦 Tienes paquetes en portería" onClose={() => cerrarPopup()} maxWidth="440px">
          <p style={{ margin: '0 0 14px', fontSize: '14px', color: 'var(--at-ink-2)', lineHeight: 1.5 }}>
            {paquetesPendientes.length === 1 ? 'Hay un envío esperándote' : `Hay ${paquetesPendientes.length} envíos esperándote`} en portería. Al retirarlo podrás firmar la recepción desde tu portal.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px', maxHeight: '240px', overflowY: 'auto' }}>
            {paquetesPendientes.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '10px', padding: '10px 12px' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>📦</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{p.descripcion}</div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                    {p.unidad_nombre ? `📍 ${p.unidad_nombre}` : ''}{p.remitente ? ` · De: ${p.remitente}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => cerrarPopup(true)} style={{ flex: 1, padding: '11px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent))', color: 'white', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              Ver y firmar
            </button>
            <button onClick={() => cerrarPopup()} style={{ padding: '11px 18px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>
              Después
            </button>
          </div>
        </EditModal>
      )}
    </div>
    </MediaScopeProvider>
  )
}

function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--at-ink-3)' }}>
      <div style={{ fontSize: '48px', marginBottom: '14px' }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '13px' }}>{text}</div>
    </div>
  )
}
