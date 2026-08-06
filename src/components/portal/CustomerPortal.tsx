import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  fetchPortalBootstrap,
  fetchPortalContadores,
  fetchPortalProjectsByCompanies,
  fetchPortalFotoIds,
  fetchRegistrosByContadores,
  fetchRegistrosByProjects,
  fetchConsumoComunidad,
} from '../../domain/portal/queries'
import { updateCliente } from '../../domain/clientes/mutations'
import { confirmarPago } from '../../domain/portal/mutations'
import { notify } from '../shared/Dialog'
import { validateEmail, validatePhoneNumber, sanitizeInput } from '../../lib/validation'
import type { UserSession, Registro } from '../../types'
import { Chart } from '../../lib/chartjs'
import { resolveChartColor } from '../../lib/chartColors'
import { PhotoLightbox } from '../shared/PhotoLightbox'
import { construirDashboardData, type ComunidadMensual, type ContadorInfo, type LecturaInfo, type UnidadInfo } from '../../lib/portalDashboard'
import type { PortalCtx } from './customer/ctx'
import type { CompanyInfo, ProjectInfo, ClienteContacto } from './customer/ctx'
import { DashboardTab } from './customer/DashboardTab'
import { ServiciosTab } from './customer/ServiciosTab'
import { PerfilTab } from './customer/PerfilTab'
import { CustomerPaymentsTab } from './CustomerPaymentsTab'
import { CustomerComunicacion } from './CustomerComunicacion'
import { BrandLogo } from '../shared/BrandLogo'

interface Props {
  currentUser: UserSession
  onLogout: () => void
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
  const [fotoRegistroIds, setFotoRegistroIds] = useState<Set<string>>(new Set())
  const [contactoEdit, setContactoEdit] = useState<ClienteContacto>({
    email: null, telefono: null, whatsapp: null, telefono_alterno: null,
  })
  const [savingContacto, setSavingContacto] = useState(false)
  const [contactoMsg, setContactoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedContador, setExpandedContador] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [photoModal, setPhotoModal] = useState<{ registroId: string; label: string } | null>(null)
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)
  const [chartMonthsBack, setChartMonthsBack] = useState(12)
  const [chartCustomStart, setChartCustomStart] = useState('')
  const [chartCustomEnd, setChartCustomEnd] = useState('')
  const [chartRangeMode, setChartRangeMode] = useState<'preset' | 'custom'>('preset')
  const [chartMetric, setChartMetric] = useState<'m3' | 'moneda'>('m3')
  const [selectedUnidadId, setSelectedUnidadId] = useState<string | null>(null)
  const [selectedTipoAgua, setSelectedTipoAgua] = useState<string | null>(null)
  const [comunidad, setComunidad] = useState<ComunidadMensual[]>([])

  const clienteId = currentUser.cliente_id

  const cargarDatos = useCallback(async () => {
    if (!clienteId) { setLoading(false); return }
    setLoading(true)
    try {
      const { ccData, uData, rData, clData } = await fetchPortalBootstrap(clienteId)

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

      const unidadesList = (uData as UnidadInfo[]) ?? []
      const unidadIds = unidadesList.map(u => u.id)
      const companyIds = companiesList.map(c => c.id)
      const unidadProjectIds = [...new Set(unidadesList.map(u => u.project_id).filter(Boolean))] as string[]

      // Contadores y proyectos no dependen entre sí (ambos salen del bootstrap):
      // se piden en paralelo en vez de en cascada — quita un round-trip del arranque.
      const [contData, pData] = await Promise.all([
        unidadIds.length > 0 ? fetchPortalContadores(unidadIds) : Promise.resolve(null),
        companyIds.length > 0 ? fetchPortalProjectsByCompanies(companyIds) : Promise.resolve(null),
      ])
      const cData = (contData as ContadorInfo[]) ?? []

      setCompanies(companiesList)
      setProjects((pData as ProjectInfo[]) ?? [])
      setUnidades(unidadesList)
      setContadores(cData)

      // Fallbacks de lecturas + índice de fotos, todo en paralelo (ahorra round-trips):
      // Fallback 1: by contador_id — catches registros where cliente_id is wrong/null
      // Fallback 2: by project_id — catches registros where contador_id is also null
      //   (safe because RLS, migration 20260420000023, restricts clients to their own data)
      // fotoIds: ids de lecturas con foto (sin bajar el base64; los bytes van bajo demanda)
      const contadorIds = cData.map(c => c.id)
      const [byContadorData, byProjectData, fotoIds] = await Promise.all([
        contadorIds.length > 0 ? fetchRegistrosByContadores(contadorIds) : Promise.resolve(null),
        unidadProjectIds.length > 0 && clienteId ? fetchRegistrosByProjects(unidadProjectIds) : Promise.resolve(null),
        clienteId ? fetchPortalFotoIds(clienteId, contadorIds, unidadProjectIds) : Promise.resolve([] as string[]),
      ])
      setFotoRegistroIds(new Set(fotoIds))

      const merged = new Map<string, LecturaInfo>()
      for (const row of (rData as LecturaInfo[] | null) ?? []) merged.set(row.id, row)
      for (const row of (byContadorData as LecturaInfo[] | null) ?? []) {
        if (!merged.has(row.id)) merged.set(row.id, row)
      }
      const knownCounterIds = new Set(contadorIds)
      for (const row of (byProjectData as LecturaInfo[] | null) ?? []) {
        if (merged.has(row.id)) continue
        const safe = row.cliente_id === clienteId || (row.contador_id != null && knownCounterIds.has(row.contador_id))
        if (safe) merged.set(row.id, row)
      }
      const mergedLecturas = Array.from(merged.values())

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

  // F2 pago en línea: retorno del checkout hospedado (?pago=ok|cancelado). En 'ok'
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
      const conf = await confirmarPago(prId)
      if (conf.error) { notify({ variant: 'error', title: 'Pago no confirmado', text: conf.error }); return }
      if (conf.estado === 'aprobado') {
        notify({
          variant: 'success',
          title: conf.liquidado ? 'Recibo pagado' : 'Abono registrado',
          text: conf.liquidado ? 'Tu recibo quedó al día.' : `Saldo restante: Q ${(conf.saldoRestante ?? 0).toFixed(2)}`,
        })
        cargarDatos()
      } else {
        notify({ variant: 'info', title: 'Pago en proceso', text: 'Tu pago aún se está procesando; se reflejará en unos momentos.' })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Referencia anónima de la comunidad para el proyecto activo (O5/V6). Con un
  // solo proyecto propio se usa ese; con varios, solo cuando el residente elige
  // uno en el filtro (evita mezclar comunidades). 24 meses cubre la ventana máx.
  const comunidadProjectId = useMemo(() => {
    if (selectedProjectId) return selectedProjectId
    const propios = projects.filter(p =>
      unidades.some(u => u.project_id === p.id) || contadores.some(c => c.project_id === p.id)
    )
    return propios.length === 1 ? propios[0].id : null
  }, [selectedProjectId, projects, unidades, contadores])

  useEffect(() => {
    if (!comunidadProjectId) { setComunidad([]); return }
    let cancelled = false
    fetchConsumoComunidad(comunidadProjectId, 24)
      .then(rows => { if (!cancelled) setComunidad(rows) })
      .catch(() => { if (!cancelled) setComunidad([]) })
    return () => { cancelled = true }
  }, [comunidadProjectId])

  // ── Dashboard analytics (useMemo) ────────────────────────
  const dashboardData = useMemo(() => construirDashboardData({
    lecturas, contadores, unidades, fotoRegistroIds,
    selectedProjectId, selectedUnidadId, selectedTipoAgua,
    chartMonthsBack, chartCustomStart, chartCustomEnd, chartRangeMode, chartMetric,
    comunidad,
  }), [lecturas, contadores, unidades, fotoRegistroIds, selectedProjectId, selectedUnidadId, selectedTipoAgua, chartMonthsBack, chartCustomStart, chartCustomEnd, chartRangeMode, chartMetric, comunidad])

  // ── Chart.js bar chart (per-counter, configurable range & metric) ──
  useEffect(() => {
    if (tab !== 'dashboard') return
    const timeout = setTimeout(() => {
      if (!chartRef.current) return
      if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null }
      const { chartLabels, chartDatasets, chartCurrentMonthIdx, trendData, medianaComunidadData } = dashboardData
      const moneda = selectedProjectId
        ? (projects.find(p => p.id === selectedProjectId)?.moneda ?? projects[0]?.moneda ?? 'Q')
        : (projects[0]?.moneda ?? 'Q')
      const metricLabel = chartMetric === 'm3' ? 'm³' : moneda
      const hasTrend = trendData.some(v => v > 0)
      // Mediana de la comunidad: solo en m³ (el RPC no expone importes ajenos) y
      // solo si hay algún mes con dato dentro de la ventana visible.
      const hasComunidad = chartMetric === 'm3' && medianaComunidadData.some(v => v != null)
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
                // V1: colorSet.full es un token var(--at-*); el canvas no lo
                // resuelve, así que las barras del mes actual salían en negro.
                i === chartCurrentMonthIdx ? resolveChartColor(colorSet.full) : colorSet.soft
              ),
              borderRadius: 6,
              borderSkipped: false,
            })),
            ...(hasTrend ? [{
              type: 'line' as const,
              label: 'Tendencia',
              data: trendData,
              borderColor: resolveChartColor('var(--at-warning)'),
              borderWidth: 2,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
              tension: 0.4,
              backgroundColor: 'transparent',
              order: -1,
            }] : []),
            ...(hasComunidad ? [{
              type: 'line' as const,
              label: 'Mediana de la comunidad',
              data: medianaComunidadData,
              borderColor: resolveChartColor('var(--at-accent-2)'),
              borderWidth: 2,
              borderDash: [3, 3],
              pointRadius: 0,
              fill: false,
              tension: 0.3,
              backgroundColor: 'transparent',
              spanGaps: true,
              order: -2,
            }] : []),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 400 },
          plugins: {
            legend: {
              display: chartDatasets.length > 1 || hasTrend || hasComunidad,
              labels: {
                font: { size: 11 }, color: 'var(--at-ink-2)', boxWidth: 12, padding: 14,
                filter: item => item.text !== 'Tendencia' || hasTrend,
              },
            },
            tooltip: {
              backgroundColor: 'var(--at-ink)',
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
              ticks: { font: { size: 10 }, maxRotation: 45, color: 'var(--at-ink-3)' },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'var(--at-chip)' },
              ticks: { font: { size: 11 }, color: 'var(--at-ink-3)', callback: v => `${v} ${metricLabel}` },
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

    const email = contactoEdit.email?.trim() || null
    const telefono = contactoEdit.telefono?.trim() || null
    const whatsapp = contactoEdit.whatsapp?.trim() || null
    const telefonoAlt = contactoEdit.telefono_alterno?.trim() || null

    if (email && !validateEmail(email)) {
      setContactoMsg({ type: 'error', text: 'El correo electrónico no tiene un formato válido.' })
      return
    }
    if (telefono && !validatePhoneNumber(telefono)) {
      setContactoMsg({ type: 'error', text: 'El teléfono no tiene un formato válido.' })
      return
    }
    if (whatsapp && !validatePhoneNumber(whatsapp)) {
      setContactoMsg({ type: 'error', text: 'El WhatsApp no tiene un formato válido.' })
      return
    }
    if (telefonoAlt && !validatePhoneNumber(telefonoAlt)) {
      setContactoMsg({ type: 'error', text: 'El teléfono alterno no tiene un formato válido.' })
      return
    }

    setSavingContacto(true)
    setContactoMsg(null)
    const { error } = await updateCliente(clienteId, {
      email: email ? sanitizeInput(email) : null,
      telefono: telefono ? sanitizeInput(telefono) : null,
      whatsapp: whatsapp ? sanitizeInput(whatsapp) : null,
      telefono_alterno: telefonoAlt ? sanitizeInput(telefonoAlt) : null,
    })

    setSavingContacto(false)
    if (error) {
      setContactoMsg({ type: 'error', text: 'No se pudo guardar. Intente nuevamente.' })
    } else {
      setContactoMsg({ type: 'success', text: 'Información de contacto actualizada correctamente.' })
    }
  }

  const hasServices = contadores.length > 0 || unidades.length > 0

  // ── Dashboard render ─────────────────────────────────────

  // ── No services screen ───────────────────────────────────
  if (!loading && !hasServices) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 50%, var(--at-accent-2) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{
          background: 'var(--at-surface)', borderRadius: '24px', padding: '48px 40px',
          maxWidth: '480px', width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.16)',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>💧</div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Sin servicios asociados
          </h2>
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: 'var(--at-ink-2)', lineHeight: 1.6 }}>
            Por el momento no cuenta con contadores ni unidades activas vinculadas a su cuenta.
          </p>
          <p style={{ margin: '0 0 32px', fontSize: '13.5px', color: 'var(--at-ink-3)' }}>
            Si cree que esto es un error, comuníquese con su empresa de servicios de agua.
          </p>
          <div style={{
            background: 'var(--at-chip)', borderRadius: '12px', padding: '16px',
            fontSize: '13px', color: 'var(--at-ink-3)', marginBottom: '28px',
          }}>
            <strong style={{ color: 'var(--at-ink-2)' }}>Sesión activa:</strong> {currentUser.name}
            <br />{currentUser.email}
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '12px 32px', background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
              color: 'white', border: 'none', borderRadius: '12px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(27, 59, 54,0.35)',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  const ctx: PortalCtx = {
    currentUser, loading, companies, companyActivoMap, projects, unidades, contadores, lecturas, registros,
    contactoEdit, setContactoEdit, savingContacto, contactoMsg, setContactoMsg, expandedContador, setExpandedContador, selectedProjectId, setSelectedProjectId,
    setPhotoModal, chartMonthsBack, setChartMonthsBack, chartCustomStart, setChartCustomStart, chartCustomEnd, setChartCustomEnd, chartRangeMode, setChartRangeMode,
    chartMetric, setChartMetric, selectedUnidadId, setSelectedUnidadId, selectedTipoAgua, setSelectedTipoAgua, chartRef, dashboardData, hasServices,
    guardarContacto,
  }

  // ── Full portal ──────────────────────────────────────────
  return (
    <div data-context="resident" style={{ minHeight: '100vh', background: 'var(--at-primary-tint)' }}>
      {/* Estilos .kpi-skeleton/.portal-* (y keyframes) en src/styles/runtime.css (I24). */}

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
        padding: '0',
        boxShadow: '0 2px 12px rgba(27, 59, 54,0.3)',
      }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', lineHeight: 0, flexShrink: 0 }}>
              <BrandLogo size={38} />
            </div>
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

        {/* Tabs — misma tira que el portal de Condominios: una sola línea con
            scroll horizontal. Sin `overflow-x: auto` + `white-space: nowrap`
            las 5 pestañas no caben en un teléfono: las etiquetas se partían en
            dos líneas ("Mis / Servicios") y, aun así, la fila ensanchaba el
            documento y TODO el portal se podía arrastrar de lado. Aquí no hay
            red de seguridad de `.app-main`, que solo cubre el panel de admin. */}
        <div className="tab-strip-scrollable" style={{
          maxWidth: '900px', margin: '0 auto',
          padding: '0 24px',
          display: 'flex', gap: '4px', overflowX: 'auto',
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
                padding: '10px 16px',
                background: tab === t.key ? 'var(--at-surface)' : 'transparent',
                color: tab === t.key ? 'var(--at-primary)' : 'rgba(255,255,255,0.85)',
                border: 'none',
                borderRadius: '10px 10px 0 0',
                fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.18s',
                display: 'flex', alignItems: 'center', gap: '6px',
                whiteSpace: 'nowrap', flexShrink: 0,
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
        {tab === 'dashboard' && <DashboardTab ctx={ctx} />}

        {/* ── TAB: SERVICIOS ── */}
        {tab === 'servicios' && <ServiciosTab ctx={ctx} />}

        {/* ── TAB: PAGOS ── */}
        {tab === 'pagos' && (
          <CustomerPaymentsTab
            registros={registros}
            clientes={[]}
            currentUser={currentUser}
            companyId={companies[0]?.id}
            moneda={projects[0]?.moneda ?? 'Q'}
            onDataChange={cargarDatos}
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
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--at-ink-3)', fontSize: '14px' }}>
            No estás asociado a ninguna empresa todavía.
          </div>
        )}

        {/* ── TAB: PERFIL ── */}
        {tab === 'perfil' && <PerfilTab ctx={ctx} />}
      </div>

      {/* ── Lightbox de fotos ── */}
      {photoModal && (
        <PhotoLightbox registroId={photoModal.registroId} label={photoModal.label} onClose={() => setPhotoModal(null)} />
      )}
    </div>
  )
}
