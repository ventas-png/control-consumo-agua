import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { notify } from './components/shared/Dialog'
import { OPEN_BILLING_EVENT } from './components/shared/promptUpgrade'
import { TrialExpirationBanner } from './components/shared/TrialExpirationBanner'
import { PresenceIndicator } from './components/shared/PresenceIndicator'
import { usePresence } from './hooks/usePresence'
import { Toaster } from 'sonner'
import type { AppSection, Cliente, Contador, Empresa, FacturaEnergia, FuenteAgua, FuenteEnergia, ProveedorEnergia, Registro, RegistroCalidad, Ruta, Tarifa, TarifaEnergia, Unidad, UserSession } from './types'
import { sectionToPath, pathToSection } from './lib/routes'
import { lazyWithPreload } from './lib/lazyWithPreload'
import { supabase } from './lib/supabase'
import { useAuth } from './hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { useProyectosQuery, useProyectoAssignmentsQuery, useRutasQuery, useTarifasQuery, useContadoresQuery, useUnidadesQuery, useProveedoresEnergiaQuery, useTarifasEnergiaQuery, useFuentesEnergiaQuery, useFacturasEnergiaQuery, useFuentesAguaQuery, useRegistrosCalidadQuery, useEmpresaQuery, useClientesQuery, useRegistrosQuery } from './domain/agua/queries'
import { aguaKeys } from './domain/agua/keys'
import { filterRutasByProjectAccess } from './lib/rutasAccess'
import { filterProyectosByAssignment, deriveProyectoConfig } from './lib/proyectosAccess'
import { SessionProvider } from './components/shared/SessionContext'
import { PermissionsProvider } from './components/shared/PermissionsContext'
import { identify, registerSuperProperties, resetAnalytics } from './lib/analytics'
import { setMonitoringUser } from './lib/monitoring'
import { BrandLogo } from './components/shared/BrandLogo'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RoleGuard, AccessDenied } from './components/shared/AccessDenied'
import { usePermissions } from './hooks/usePermissions'
import { SinProyectoAsignado } from './components/condominios/SinProyectoAsignado'
import { CommandPalette } from './components/shared/CommandPalette'
import { KeyboardShortcutsHelp } from './components/shared/KeyboardShortcutsHelp'
import { useRegisteredCommands } from './lib/commandRegistry'
import { useRecentItems } from './hooks/useRecentItems'
import { usePinnedItems } from './hooks/usePinnedItems'
import { buildNavCommands, NAV_COMMANDS } from './lib/navigationCommands'
import { useKeyboardShortcuts, type ShortcutBinding } from './hooks/useKeyboardShortcuts'

// Auth + landing flow — lazy para que NO entre al bundle principal de la app
// autenticada (donde el ~99% del tiempo de uso ocurre). En primer load el
// usuario sin sesion paga el coste de descargar Landing/Register/etc, pero
// el usuario autenticado nunca los carga.
const LandingPage = lazy(() => import('./components/landing/LandingPage').then(m => ({ default: m.LandingPage })))
const PasswordResetModal = lazy(() => import('./components/auth/PasswordResetModal').then(m => ({ default: m.PasswordResetModal })))
const PasswordResetPage = lazy(() => import('./components/auth/PasswordResetPage').then(m => ({ default: m.PasswordResetPage })))
const RegisterScreen = lazy(() => import('./components/auth/RegisterScreen').then(m => ({ default: m.RegisterScreen })))
const SignupCompanyScreen = lazy(() => import('./components/auth/SignupCompanyScreen').then(m => ({ default: m.SignupCompanyScreen })))
const OAuthOnboardingScreen = lazy(() => import('./components/auth/OAuthOnboardingScreen'))

// Cliente-role portals — solo se cargan para usuarios con role='cliente'.
// La inmensa mayoria son admins/staff que nunca tocan estos componentes.
const CustomerPortal = lazy(() => import('./components/portal/CustomerPortal').then(m => ({ default: m.CustomerPortal })))
const CondominiosClientPortal = lazy(() => import('./components/portal/CondominiosClientPortal').then(m => ({ default: m.CondominiosClientPortal })))

// agua:A8 — secciones navegables vía sidebar usan lazyWithPreload para poder
// prefetch del chunk al hacer hover/focus sobre su item (ver SECTION_PRELOADERS).
const ClientesSection = lazyWithPreload(() => import('./components/clientes/ClientesSection').then(m => ({ default: m.ClientesSection })))
const LecturasSection = lazyWithPreload(() => import('./components/lecturas/LecturasSection').then(m => ({ default: m.LecturasSection })))
const HistorialSection = lazyWithPreload(() => import('./components/historial/HistorialSection').then(m => ({ default: m.HistorialSection })))
const DashboardSection = lazyWithPreload(() => import('./components/dashboard/DashboardSection').then(m => ({ default: m.DashboardSection })))
const AdminClientDashboard = lazyWithPreload(() => import('./components/admin-dashboard/AdminClientDashboard').then(m => ({ default: m.AdminClientDashboard })))
const MapaSection = lazyWithPreload(() => import('./components/mapa/MapaSection').then(m => ({ default: m.MapaSection })))
const CalidadSection = lazyWithPreload(() => import('./components/calidad/CalidadSection').then(m => ({ default: m.CalidadSection })))
const RutasSection = lazyWithPreload(() => import('./components/rutas/RutasSection').then(m => ({ default: m.RutasSection })))
const ConfiguracionSection = lazyWithPreload(() => import('./components/configuracion/ConfiguracionSection').then(m => ({ default: m.ConfiguracionSection })))
const PerfilSection = lazyWithPreload(() => import('./components/perfil/PerfilSection').then(m => ({ default: m.PerfilSection })))
const EmpresaSection = lazyWithPreload(() => import('./components/empresa/EmpresaSection').then(m => ({ default: m.EmpresaSection })))
const SuperAdminSection = lazyWithPreload(() => import('./components/superadmin/SuperAdminSection').then(m => ({ default: m.SuperAdminSection })))
const TarifasSection = lazyWithPreload(() => import('./components/tarifas/TarifasSection').then(m => ({ default: m.TarifasSection })))
const ContadoresSection = lazyWithPreload(() => import('./components/contadores/ContadoresSection').then(m => ({ default: m.ContadoresSection })))
const UnidadesSection = lazyWithPreload(() => import('./components/unidades/UnidadesSection').then(m => ({ default: m.UnidadesSection })))
const CobrosSection = lazyWithPreload(() => import('./components/cobros/CobrosSection').then(m => ({ default: m.CobrosSection })))
const ComunicacionSection = lazyWithPreload(() => import('./components/comunicacion/ComunicacionSection').then(m => ({ default: m.ComunicacionSection })))
const ServiciosEnergiaSection = lazyWithPreload(() => import('./components/servicios-energia/ServiciosEnergiaSection'))
const CondominiosSection = lazyWithPreload(() => import('./components/condominios/CondominiosSection').then(m => ({ default: m.CondominiosSection })))
const CondominiosDashboard = lazyWithPreload(() => import('./components/condominios/CondominiosDashboard').then(m => ({ default: m.CondominiosDashboard })))

// agua:A8 — mapa AppSection → preload del chunk de su sección. Lo consume el
// Sidebar en hover/focus de cada item para descargar el código por anticipado.
// Las sub-rutas de condominios comparten el chunk de CondominiosSection.
const SECTION_PRELOADERS: Partial<Record<AppSection, () => void>> = {
  clientes: () => { ClientesSection.preload() },
  lecturas: () => { LecturasSection.preload() },
  tabla: () => { HistorialSection.preload() },
  dashboard: () => { DashboardSection.preload() },
  admin_dashboard: () => { AdminClientDashboard.preload() },
  cobros: () => { CobrosSection.preload() },
  mapa: () => { MapaSection.preload() },
  rutas: () => { RutasSection.preload() },
  tarifas: () => { TarifasSection.preload() },
  unidades: () => { UnidadesSection.preload() },
  contadores: () => { ContadoresSection.preload() },
  calidad: () => { CalidadSection.preload() },
  configuracion: () => { ConfiguracionSection.preload() },
  perfil: () => { PerfilSection.preload() },
  empresa_proyectos: () => { EmpresaSection.preload() },
  superadmin_empresas: () => { SuperAdminSection.preload() },
  comunicacion: () => { ComunicacionSection.preload() },
  servicios_energia: () => { ServiciosEnergiaSection.preload() },
  condominios: () => { CondominiosSection.preload() },
  condominios_dashboard: () => { CondominiosDashboard.preload() },
  condominios_visitantes: () => { CondominiosSection.preload() },
  condominios_cuotas: () => { CondominiosSection.preload() },
  condominios_mantenimiento: () => { CondominiosSection.preload() },
}

function prefetchSection(section: AppSection): void {
  SECTION_PRELOADERS[section]?.()
}


// Splash compartido entre el initial-load y los Suspense fallbacks de las
// pantallas de auth lazy. Mismo visual que cuando `loading=true` del useAuth.
function AuthSplash() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-primary) 55%, var(--at-primary-2) 100%)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
        <div style={{ filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.35))' }}>
          <BrandLogo size={64} />
        </div>
        <div style={{
          width: '40px', height: '40px',
          border: '3px solid rgba(255,255,255,0.25)',
          borderTop: '3px solid white',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// F4.4.2: muestra avatares de otros usuarios de la misma company viendo la
// misma seccion. Se monta justo bajo el Topbar. Si no hay nadie mas, se
// auto-oculta. Se inyecta el hook aqui (y no en App directo) para evitar
// re-renders del arbol grande cuando llegan eventos Realtime cada 30s.
function PresenceBar({ currentUser, activeSection }: { currentUser: UserSession; activeSection: AppSection }) {
  const { others } = usePresence({
    companyId: currentUser.company_id ?? null,
    userId: currentUser.user_id,
    section: activeSection,
  })
  if (others.length === 0) return null
  return (
    <div style={{
      padding: '6px 16px',
      borderBottom: '1px solid var(--at-line)',
      background: 'var(--at-surface-2)',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>
        Activos aquí:
      </span>
      <PresenceIndicator others={others} />
    </div>
  )
}

// Shown when a client has both servicio_agua and servicio_condominios active
function DualServicePortal({ currentUser, onLogout }: { currentUser: UserSession; onLogout: () => void }) {
  const [activeService, setActiveService] = useState<'condominios' | 'agua'>('condominios')
  return (
    <div>
      <div style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: 'var(--at-surface)',
        borderBottom: '2px solid var(--at-line)',
        display: 'flex', justifyContent: 'center', gap: '6px',
        padding: '8px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <button
          onClick={() => setActiveService('condominios')}
          style={{
            padding: '7px 22px', borderRadius: '20px', border: 'none',
            background: activeService === 'condominios' ? 'linear-gradient(135deg, var(--at-accent), var(--at-accent))' : 'var(--at-chip)',
            color: activeService === 'condominios' ? 'white' : 'var(--at-ink-3)',
            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.18s',
          }}
        >🏢 Condominios</button>
        <button
          onClick={() => setActiveService('agua')}
          style={{
            padding: '7px 22px', borderRadius: '20px', border: 'none',
            background: activeService === 'agua' ? 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))' : 'var(--at-chip)',
            color: activeService === 'agua' ? 'white' : 'var(--at-ink-3)',
            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.18s',
          }}
        >💧 Agua</button>
      </div>
      {activeService === 'condominios'
        ? <CondominiosClientPortal currentUser={currentUser} onLogout={onLogout} />
        : <CustomerPortal currentUser={currentUser} onLogout={onLogout} />
      }
    </div>
  )
}

// Detect password reset token in URL
function getResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('reset_token')
}

// Detect Gmail OAuth callback.
// supabase.ts intercepts the URL early and saves params to sessionStorage before
// Supabase can try to process the Gmail code as its own PKCE callback.
interface GmailOAuthParams { code: string; state: string; stateData: { t: string; company_id: string | null; is_superadmin: boolean } }
function detectGmailOAuthCallback(): GmailOAuthParams | null {
  // Primary: read from sessionStorage (set by supabase.ts before Supabase init)
  const stored = sessionStorage.getItem('__gmail_callback')
  if (stored) {
    try {
      sessionStorage.removeItem('__gmail_callback')
      const { code, state } = JSON.parse(stored) as { code: string; state: string }
      const stateData = JSON.parse(atob(state)) as { t: string; company_id: string | null; is_superadmin: boolean }
      if (stateData.t === 'gmail_connect') return { code, state, stateData }
    } catch { /* invalid stored data */ }
  }
  // Fallback: URL still has params (shouldn't happen after the fix, kept for safety)
  const p = new URLSearchParams(window.location.search)
  const code = p.get('code')
  const state = p.get('state')
  if (!code || !state) return null
  try {
    const stateData = JSON.parse(atob(state)) as { t: string; company_id: string | null; is_superadmin: boolean }
    if (stateData.t === 'gmail_connect') {
      window.history.replaceState({}, '', window.location.pathname)
      return { code, state, stateData }
    }
  } catch { /* not our callback */ }
  return null
}

const SUPABASE_URL_FOR_FN = import.meta.env.VITE_SUPABASE_URL as string

async function handleGmailOAuthCallback(params: GmailOAuthParams): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  const res = await fetch(`${SUPABASE_URL_FOR_FN}/functions/v1/google-oauth-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: params.code, state: params.state }),
  })
  if (res.ok) {
    const json = await res.json() as { email?: string }
    notify({
      variant: 'success',
      title: '¡Cuenta de Google conectada!',
      text: `Los correos se enviarán desde ${json.email ?? 'tu cuenta de Google'}.`,
    })
  } else {
    const err = await res.json() as { error?: string }
    notify({ variant: 'error', title: 'Error al conectar Google', text: err.error ?? 'Intenta nuevamente.' })
  }
}

export default function App() {
  // F3.13: ComponentShowcase dev route (/dev/components). Solo accesible
  // si el usuario navega manualmente — no aparece en el sidebar.
  if (typeof window !== 'undefined' && window.location.pathname === '/dev/components') {
    const LazyShowcase = lazy(() => import('./components/dev/ComponentShowcase').then(m => ({ default: m.ComponentShowcase })))
    return (
      <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Cargando…</div>}>
        <LazyShowcase />
      </Suspense>
    )
  }

  const { currentUser, loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, login, loginWithGoogle, logout, updateProfile, mfaChallenge, verifyMfaChallenge, cancelMfaChallenge } = useAuth()
  const { canViewModule, canCreate, canEdit, canChangeStatus } = usePermissions(currentUser)

  // ── T7: las rutas (agua) viven en la capa de datos (TanStack Query), ya no en
  // useData. El filtrado por acceso a proyecto (que antes hacía useData) se
  // aplica aquí sobre la lista cruda; `proyectos` ya viene acotado a los
  // proyectos accesibles del usuario. Los nombres (`rutas`, `addRuta`,
  // `updateRuta`, `deleteRuta`) se conservan para no tocar a los consumidores.
  const dataQueryClient = useQueryClient()
  const dataCompanyId = currentUser?.company_id
  // T7 · agua:A4 — `proyectos` (última colección que vivía en useData) migran a la
  // capa de datos. La query devuelve la lista CRUDA que RLS acota por empresa; el
  // filtrado fino por asignación de proyecto (lo que hacía filterDataByAssignment)
  // y la derivación de moneda/maxUnidades se aplican aquí, igual que rutas usa
  // filterRutasByProjectAccess. Va ANTES del useMemo de rutas porque ese filtro usa
  // `proyectos` accesibles para construir su accessibleProjectIds.
  const { data: proyectosRaw = [], isLoading: dataLoading } = useProyectosQuery(dataCompanyId)
  const { data: projectAssignments } = useProyectoAssignmentsQuery(
    currentUser?.user_id, currentUser?.role, currentUser?.assigned_role_ids,
  )
  const { proyectos, moneda, maxUnidadesPorTipo } = useMemo(() => {
    const accesibles = filterProyectosByAssignment({
      proyectos: proyectosRaw,
      userId: currentUser?.user_id,
      role: currentUser?.role,
      assignedRoleIds: currentUser?.assigned_role_ids,
      assignments: projectAssignments,
    })
    return { proyectos: accesibles, ...deriveProyectoConfig(accesibles, proyectosRaw) }
  }, [proyectosRaw, projectAssignments, currentUser?.user_id, currentUser?.role, currentUser?.assigned_role_ids])
  // Refresco manual (reemplaza el `cargarDatos` de useData): invalida todo el
  // dominio agua para que registros/proyectos/etc. se vuelvan a traer. Lo usa
  // AdminClientDashboard tras agregar una lectura (onDataRefresh).
  const refrescarDatos = useCallback(
    () => dataQueryClient.invalidateQueries({ queryKey: aguaKeys.all }),
    [dataQueryClient],
  )
  // T7: `contadores` migran a la capa de datos (scope company). Va ANTES del
  // useMemo de rutas porque ese filtro usa `contadores` como entrada.
  const { data: contadores = [] } = useContadoresQuery(dataCompanyId)
  const addContador = useCallback((contador: Contador) => {
    dataQueryClient.setQueryData<Contador[]>(aguaKeys.contadores(dataCompanyId), (old = []) => [contador, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateContador = useCallback((id: string, partial: Partial<Contador>) => {
    dataQueryClient.setQueryData<Contador[]>(aguaKeys.contadores(dataCompanyId), (old = []) => old.map(c => (c.id === id ? { ...c, ...partial } : c)))
  }, [dataQueryClient, dataCompanyId])
  const deleteContador = useCallback((id: string) => {
    dataQueryClient.setQueryData<Contador[]>(aguaKeys.contadores(dataCompanyId), (old = []) => old.filter(c => c.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `unidades` migran a la capa de datos (scope company, orden por nombre).
  // También va ANTES del useMemo de rutas (es entrada del filtro). addUnidad
  // reordena por nombre al insertar, igual que el setData del antiguo useData.
  const { data: unidades = [] } = useUnidadesQuery(dataCompanyId)
  const addUnidad = useCallback((unidad: Unidad) => {
    dataQueryClient.setQueryData<Unidad[]>(aguaKeys.unidades(dataCompanyId), (old = []) => [...old, unidad].sort((a, b) => a.nombre.localeCompare(b.nombre)))
  }, [dataQueryClient, dataCompanyId])
  const updateUnidad = useCallback((id: string, partial: Partial<Unidad>) => {
    dataQueryClient.setQueryData<Unidad[]>(aguaKeys.unidades(dataCompanyId), (old = []) => old.map(u => (u.id === id ? { ...u, ...partial } : u)))
  }, [dataQueryClient, dataCompanyId])
  const deleteUnidad = useCallback((id: string) => {
    dataQueryClient.setQueryData<Unidad[]>(aguaKeys.unidades(dataCompanyId), (old = []) => old.filter(u => u.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `registros` (core de datos) migran a la capa de datos. Va ANTES del useMemo
  // de rutas (es entrada del filtro). addRegistro APENDE; updateRegistroEstado solo
  // toca `estado`; deleteRegistro filtra. Optimista vía setQueryData.
  const { data: registros = [] } = useRegistrosQuery(dataCompanyId)
  const addRegistro = useCallback((registro: Registro) => {
    dataQueryClient.setQueryData<Registro[]>(aguaKeys.registros(dataCompanyId), (old = []) => [...old, registro])
  }, [dataQueryClient, dataCompanyId])
  const updateRegistroEstado = useCallback((id: string, estado: Registro['estado']) => {
    dataQueryClient.setQueryData<Registro[]>(aguaKeys.registros(dataCompanyId), (old = []) => old.map(r => (r.id === id ? { ...r, estado } : r)))
  }, [dataQueryClient, dataCompanyId])
  const deleteRegistro = useCallback((id: string) => {
    dataQueryClient.setQueryData<Registro[]>(aguaKeys.registros(dataCompanyId), (old = []) => old.filter(r => r.id !== id))
  }, [dataQueryClient, dataCompanyId])
  const { data: rutasRaw = [] } = useRutasQuery(dataCompanyId)
  const rutas = useMemo(
    () => filterRutasByProjectAccess({
      rutas: rutasRaw,
      contadores,
      unidades,
      registros,
      accessibleProjectIds: new Set(proyectos.map(p => p.id)),
      userId: currentUser?.user_id ?? '',
    }),
    [rutasRaw, contadores, unidades, registros, proyectos, currentUser?.user_id],
  )
  // Mutaciones optimistas sobre el caché de rutas (espejan addRuta/updateRuta/
  // deleteRuta del antiguo useData). RutasSection sigue haciendo el INSERT/
  // UPDATE/DELETE en Supabase y luego llama a estos callbacks.
  const addRuta = useCallback((ruta: Ruta) => {
    dataQueryClient.setQueryData<Ruta[]>(aguaKeys.rutas(dataCompanyId), (old = []) => [ruta, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateRuta = useCallback((id: string, partial: Partial<Ruta>) => {
    dataQueryClient.setQueryData<Ruta[]>(aguaKeys.rutas(dataCompanyId), (old = []) => old.map(r => (r.id === id ? { ...r, ...partial } : r)))
  }, [dataQueryClient, dataCompanyId])
  const deleteRuta = useCallback((id: string) => {
    dataQueryClient.setQueryData<Ruta[]>(aguaKeys.rutas(dataCompanyId), (old = []) => old.filter(r => r.id !== id))
  }, [dataQueryClient, dataCompanyId])

  // T7: `tarifas` también migran a la capa de datos (scope company, sin filtro
  // por proyecto). Se conservan los nombres para no tocar TarifasSection ni el
  // resto de consumidores.
  const { data: tarifas = [] } = useTarifasQuery(dataCompanyId)
  const addTarifa = useCallback((tarifa: Tarifa) => {
    dataQueryClient.setQueryData<Tarifa[]>(aguaKeys.tarifas(dataCompanyId), (old = []) => [tarifa, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateTarifa = useCallback((id: string, partial: Partial<Tarifa>) => {
    dataQueryClient.setQueryData<Tarifa[]>(aguaKeys.tarifas(dataCompanyId), (old = []) => old.map(t => (t.id === id ? { ...t, ...partial } : t)))
  }, [dataQueryClient, dataCompanyId])
  const deleteTarifa = useCallback((id: string) => {
    dataQueryClient.setQueryData<Tarifa[]>(aguaKeys.tarifas(dataCompanyId), (old = []) => old.filter(t => t.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `proveedoresEnergia` migran a la capa de datos (scope company). Parte del
  // módulo de energía (hoy bajo agua; Track T1 / serv:S1 lo separará).
  const { data: proveedoresEnergia = [] } = useProveedoresEnergiaQuery(dataCompanyId)
  const addProveedorEnergia = useCallback((proveedor: ProveedorEnergia) => {
    dataQueryClient.setQueryData<ProveedorEnergia[]>(aguaKeys.proveedoresEnergia(dataCompanyId), (old = []) => [proveedor, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateProveedorEnergia = useCallback((id: string, partial: Partial<ProveedorEnergia>) => {
    dataQueryClient.setQueryData<ProveedorEnergia[]>(aguaKeys.proveedoresEnergia(dataCompanyId), (old = []) => old.map(p => (p.id === id ? { ...p, ...partial } : p)))
  }, [dataQueryClient, dataCompanyId])
  const deleteProveedorEnergia = useCallback((id: string) => {
    dataQueryClient.setQueryData<ProveedorEnergia[]>(aguaKeys.proveedoresEnergia(dataCompanyId), (old = []) => old.filter(p => p.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `tarifasEnergia` migran a la capa de datos (scope company). Energía.
  const { data: tarifasEnergia = [] } = useTarifasEnergiaQuery(dataCompanyId)
  const addTarifaEnergia = useCallback((tarifa: TarifaEnergia) => {
    dataQueryClient.setQueryData<TarifaEnergia[]>(aguaKeys.tarifasEnergia(dataCompanyId), (old = []) => [tarifa, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateTarifaEnergia = useCallback((id: string, partial: Partial<TarifaEnergia>) => {
    dataQueryClient.setQueryData<TarifaEnergia[]>(aguaKeys.tarifasEnergia(dataCompanyId), (old = []) => old.map(t => (t.id === id ? { ...t, ...partial } : t)))
  }, [dataQueryClient, dataCompanyId])
  const deleteTarifaEnergia = useCallback((id: string) => {
    dataQueryClient.setQueryData<TarifaEnergia[]>(aguaKeys.tarifasEnergia(dataCompanyId), (old = []) => old.filter(t => t.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `fuentesEnergia` migran a la capa de datos (scope company). Energía.
  const { data: fuentesEnergia = [] } = useFuentesEnergiaQuery(dataCompanyId)
  const addFuenteEnergia = useCallback((fuente: FuenteEnergia) => {
    dataQueryClient.setQueryData<FuenteEnergia[]>(aguaKeys.fuentesEnergia(dataCompanyId), (old = []) => [fuente, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateFuenteEnergia = useCallback((id: string, partial: Partial<FuenteEnergia>) => {
    dataQueryClient.setQueryData<FuenteEnergia[]>(aguaKeys.fuentesEnergia(dataCompanyId), (old = []) => old.map(f => (f.id === id ? { ...f, ...partial } : f)))
  }, [dataQueryClient, dataCompanyId])
  const deleteFuenteEnergia = useCallback((id: string) => {
    dataQueryClient.setQueryData<FuenteEnergia[]>(aguaKeys.fuentesEnergia(dataCompanyId), (old = []) => old.filter(f => f.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `facturasEnergia` migran a la capa de datos (cierra el grupo de energía).
  const { data: facturasEnergia = [] } = useFacturasEnergiaQuery(dataCompanyId)
  const addFacturaEnergia = useCallback((factura: FacturaEnergia) => {
    dataQueryClient.setQueryData<FacturaEnergia[]>(aguaKeys.facturasEnergia(dataCompanyId), (old = []) => [factura, ...old])
  }, [dataQueryClient, dataCompanyId])
  const updateFacturaEnergia = useCallback((id: string, partial: Partial<FacturaEnergia>) => {
    dataQueryClient.setQueryData<FacturaEnergia[]>(aguaKeys.facturasEnergia(dataCompanyId), (old = []) => old.map(f => (f.id === id ? { ...f, ...partial } : f)))
  }, [dataQueryClient, dataCompanyId])
  const deleteFacturaEnergia = useCallback((id: string) => {
    dataQueryClient.setQueryData<FacturaEnergia[]>(aguaKeys.facturasEnergia(dataCompanyId), (old = []) => old.filter(f => f.id !== id))
  }, [dataQueryClient, dataCompanyId])
  // T7: `fuentesAgua` migran a la capa de datos. setFuentesAgua reemplaza la lista
  // en caché (lo usa CalidadSection vía onFuentesUpdated). recargarFuentesAgua del
  // useData previo no se usaba en App, así que se elimina.
  const { data: fuentesAgua = [] } = useFuentesAguaQuery(dataCompanyId)
  const setFuentesAgua = useCallback((fuentes: FuenteAgua[]) => {
    dataQueryClient.setQueryData<FuenteAgua[]>(aguaKeys.fuentesAgua(dataCompanyId), fuentes)
  }, [dataQueryClient, dataCompanyId])
  // T7: `registrosCalidad` migran a la capa de datos. setRegistrosCalidad reemplaza
  // la lista en caché (lo usa CalidadSection vía onRegistrosCalidadUpdated).
  const { data: registrosCalidad = [] } = useRegistrosCalidadQuery(dataCompanyId)
  const setRegistrosCalidad = useCallback((registros: RegistroCalidad[]) => {
    dataQueryClient.setQueryData<RegistroCalidad[]>(aguaKeys.registrosCalidad(dataCompanyId), registros)
  }, [dataQueryClient, dataCompanyId])
  // T7: `empresa` (objeto único del tenant) migra a la capa de datos. Read-only en
  // App (useData no exponía setter); default {} igual que el INITIAL_DATA previo.
  const { data: empresa = {} as Empresa } = useEmpresaQuery(dataCompanyId)
  // T7: `clientes` migran a la capa de datos (RLS por junction company_clientes;
  // su PII ya NO se persiste en localStorage). addCliente APENDE (no prepend) para
  // conservar el orden original de useData.
  const { data: clientes = [] } = useClientesQuery(dataCompanyId)
  const addCliente = useCallback((cliente: Cliente) => {
    dataQueryClient.setQueryData<Cliente[]>(aguaKeys.clientes(dataCompanyId), (old = []) => [...old, cliente])
  }, [dataQueryClient, dataCompanyId])
  const updateCliente = useCallback((id: string, partial: Partial<Cliente>) => {
    dataQueryClient.setQueryData<Cliente[]>(aguaKeys.clientes(dataCompanyId), (old = []) => old.map(c => (c.id === id ? { ...c, ...partial } : c)))
  }, [dataQueryClient, dataCompanyId])
  const deleteCliente = useCallback((id: string) => {
    dataQueryClient.setQueryData<Cliente[]>(aguaKeys.clientes(dataCompanyId), (old = []) => old.filter(c => c.id !== id))
  }, [dataQueryClient, dataCompanyId])

  // ── Global keyboard shortcuts + Command Palette (Cmd+K, g X, ?) ────────
  // Los hooks se llaman incondicionalmente (Rules of Hooks). Si no hay
  // usuario, los bindings quedan vacios y nada se dispara. El palette y el
  // modal se renderizan solo dentro del bloque autenticado.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const registeredCommands = useRegisteredCommands()
  // F-recents: ultimos 5 items navegados desde el palette. Persistido en
  // localStorage por user — la key es generica porque solo hay un palette
  // global y la app cambia de usuario via logout (que recarga la pagina).
  const { recent: recentCommandIds, push: pushRecent } = useRecentItems(
    'aquacontrol:palette:recents:v1',
    { maxItems: 5 },
  )
  const { pinned: pinnedCommandIds, togglePin: togglePinCommand } = usePinnedItems(
    'aquacontrol:palette:pinned:v1',
    { maxItems: 3 },
  )

  const navCommands = currentUser
    ? buildNavCommands(currentUser, canViewModule, (s) => navigate(sectionToPath(s)))
    : []
  const allCommands = [...navCommands, ...registeredCommands]

  // Vim-style shortcuts: 'g X' navega a la seccion correspondiente. Solo se
  // crean para las secciones donde NAV_COMMANDS define un shortcut y el
  // usuario tiene acceso (mismo filtro que buildNavCommands).
  const shortcutBindings: ShortcutBinding[] = currentUser
    ? [
        ...NAV_COMMANDS
          .filter(d => d.shortcut)
          .filter(d => !d.roles || d.roles.includes(currentUser.role))
          .filter(d => !d.module || canViewModule(d.module))
          .map(d => ({
            sequence: d.shortcut!,
            description: `Ir a ${d.label}`,
            category: 'Navegacion',
            handler: () => navigate(sectionToPath(d.id)),
          })),
        {
          sequence: '?',
          description: 'Mostrar atajos de teclado',
          category: 'Ayuda',
          handler: () => setHelpOpen(true),
        },
      ]
    : []

  useKeyboardShortcuts(shortcutBindings)

  // Identify the signed-in user for analytics + error monitoring (both no-op
  // when their env vars are absent).
  useEffect(() => {
    if (!currentUser) return
    const traits = { company_id: currentUser.company_id, role: currentUser.role }
    identify(currentUser.user_id, traits)
    // Super-properties: cada evento que dispare la app llevará company_id y role
    // automáticamente, así no hay que pasarlos en cada track() del código.
    registerSuperProperties({ company_id: currentUser.company_id, role: currentUser.role })
    setMonitoringUser({ id: currentUser.user_id, companyId: currentUser.company_id, role: currentUser.role })
  }, [currentUser?.user_id])

  const handleLogout = useCallback(() => {
    resetAnalytics()
    setMonitoringUser(null)
    logout()
  }, [logout])

  // agua:A1 — navegación basada en URL (react-router-dom v6). El sidebar/topbar
  // siguen hablando AppSection; aquí derivamos sección desde location y
  // mapeamos navegaciones a navigate(path).
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection: AppSection = pathToSection(location.pathname) ?? 'clientes'
  const navigateSection = useCallback((section: AppSection) => {
    navigate(sectionToPath(section))
  }, [navigate])

  const [rutaActivaParaLecturas, setRutaActivaParaLecturas] = useState<Ruta | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showSignupCompany, setShowSignupCompany] = useState(false)
  const [unreadComunicacion, setUnreadComunicacion] = useState(0)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  // Legacy: kept for backward compatibility with old reset links already sent
  const [resetToken] = useState<string | null>(getResetToken)

  // Handle Gmail OAuth callback when Google redirects back to the app
  useEffect(() => {
    const gmailParams = detectGmailOAuthCallback()
    if (gmailParams) {
      void handleGmailOAuthCallback(gmailParams)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onEjecutarRuta = useCallback((ruta: Ruta) => {
    setRutaActivaParaLecturas(ruta)
    navigate(sectionToPath('lecturas'))
  }, [navigate])

  const fetchUnreadComunicacion = useCallback(async () => {
    if (!currentUser?.company_id) return
    // `planned` uses the cheap pg_class estimate; falls back to an approximate count
    // without scanning the whole table. Avoids COUNT(*) every 60s.
    const { count } = await supabase
      .from('conversations')
      .select('id', { count: 'planned', head: true })
      .eq('company_id', currentUser.company_id)
      .eq('status', 'abierta')
    setUnreadComunicacion(count ?? 0)
  }, [currentUser?.company_id])

  useEffect(() => {
    fetchUnreadComunicacion()
    // Refresh every 5 min instead of 1 min (realtime channel in useConversations covers active changes).
    const interval = setInterval(fetchUnreadComunicacion, 300_000)
    return () => clearInterval(interval)
  }, [fetchUnreadComunicacion])

  // F4.1.2: promptUpgrade dispatcha este evento cuando el usuario elige "Ver
  // planes" desde un CTA de limite alcanzado.
  useEffect(() => {
    const handler = () => navigate(sectionToPath('perfil'))
    window.addEventListener(OPEN_BILLING_EVENT, handler)
    return () => window.removeEventListener(OPEN_BILLING_EVENT, handler)
  }, [navigate])

  // Set default section based on role after login.
  // Only redirects from `/` — a user who bookmarked or refreshed a specific
  // route keeps the route they asked for.
  useEffect(() => {
    if (!currentUser) return
    if (location.pathname !== '/' && location.pathname !== '') return
    let target: AppSection = 'clientes'
    if (currentUser.role === 'company_owner') target = 'admin_dashboard'
    else if (currentUser.role === 'super_admin') target = 'superadmin_empresas'
    else if (currentUser.role === 'collector') target = 'cobros'
    else if (!canViewModule('clientes')) target = 'perfil'
    navigate(sectionToPath(target), { replace: true })
    // 'cliente' role is handled by its own portal render path — no section needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.user_id, currentUser?.role])

  // T7 · agua:A4 — La carga de datos tras login ya no es imperativa: cada hook de
  // la capa de datos (useProyectosQuery, useRegistrosQuery, …) se dispara solo vía
  // su `enabled: !!companyId` cuando currentUser resuelve, y revalida on-focus. Los
  // errores se manejan por query (retry + estados de error por sección) en lugar
  // del antiguo prompt global de "recargar".

  // Password recovery via Supabase native flow (PASSWORD_RECOVERY event)
  if (isPasswordRecovery || resetToken) {
    return (
      <Suspense fallback={<AuthSplash />}>
        <PasswordResetPage onBack={() => window.location.replace(window.location.pathname)} />
      </Suspense>
    )
  }

  // Google OAuth user without app_users profile — needs to complete onboarding
  if (needsOnboarding && pendingOAuthUser) {
    return (
      <Suspense fallback={<AuthSplash />}>
        <OAuthOnboardingScreen
          googleUser={pendingOAuthUser}
          onSuccess={completeOnboarding}
          onCancel={() => window.location.replace(window.location.pathname)}
        />
      </Suspense>
    )
  }

  // Not authenticated
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-primary) 55%, var(--at-primary-2) 100%)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
          <div style={{ filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.35))' }}>
            <BrandLogo size={64} />
          </div>
          <div style={{
            width: '40px', height: '40px',
            border: '3px solid rgba(255,255,255,0.25)',
            borderTop: '3px solid white',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <div style={{ color: 'white', fontSize: '15px', fontWeight: 500, letterSpacing: '0.02em', opacity: 0.9 }}>
            Cargando AdministraTodo…
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!currentUser) {
    if (showRegister) {
      return (
        <Suspense fallback={<AuthSplash />}>
          <RegisterScreen
            onBack={() => setShowRegister(false)}
            onRegistered={async (email, password) => {
              setShowRegister(false)
              await login(email, password)
            }}
          />
        </Suspense>
      )
    }
    if (showSignupCompany) {
      return (
        <Suspense fallback={<AuthSplash />}>
          <SignupCompanyScreen
            onBack={() => setShowSignupCompany(false)}
            onSignedUp={() => {
              // El usuario debe confirmar email antes de poder iniciar sesion.
              // Volvemos al landing para que use el form de login normal cuando
              // tenga confirmado el correo.
              setShowSignupCompany(false)
            }}
          />
        </Suspense>
      )
    }
    return (
      <Suspense fallback={<AuthSplash />}>
        <LandingPage
          onLogin={login}
          onLoginWithGoogle={loginWithGoogle}
          onForgotPassword={() => setShowPasswordReset(true)}
          onRegister={() => setShowRegister(true)}
          onSignupCompany={() => setShowSignupCompany(true)}
          mfaChallenge={mfaChallenge ? { email: mfaChallenge.email } : null}
          onVerifyMfa={verifyMfaChallenge}
          onCancelMfa={cancelMfaChallenge}
        />
        {showPasswordReset && (
          <PasswordResetModal onClose={() => setShowPasswordReset(false)} />
        )}
      </Suspense>
    )
  }

  // Cliente users get their own portal — no admin data needed
  if (currentUser.role === 'cliente') {
    const tieneCondominios = !!currentUser.servicio_condominios
    const tieneAgua = currentUser.servicio_agua !== false
    if (tieneCondominios && tieneAgua) {
      return (
        <Suspense fallback={<AuthSplash />}>
          <DualServicePortal currentUser={currentUser} onLogout={handleLogout} />
        </Suspense>
      )
    }
    if (tieneCondominios) {
      return (
        <Suspense fallback={<AuthSplash />}>
          <CondominiosClientPortal currentUser={currentUser} onLogout={handleLogout} />
        </Suspense>
      )
    }
    return (
      <Suspense fallback={<AuthSplash />}>
        <CustomerPortal currentUser={currentUser} onLogout={handleLogout} />
      </Suspense>
    )
  }

  // Banner: rutas pendientes asignadas al usuario actual
  const hoy = new Date().toISOString().split('T')[0]
  const rutasPendientes = rutas.filter((r: Ruta) =>
    r.asignado_a === currentUser.user_id &&
    !r.completada &&
    r.fecha_programada &&
    r.fecha_programada >= hoy
  )
  const proximaRuta = rutasPendientes.sort((a: Ruta, b: Ruta) =>
    (a.fecha_programada ?? '').localeCompare(b.fecha_programada ?? '')
  )[0]

  // Restricted users (viewer/operator/...) only see their assigned projects (RLS-enforced).
  // When a condominios section is open but they have no authorized active project, show a
  // "no project assigned" notice instead of an empty selector.
  const condominiosSinProyecto =
    !dataLoading &&
    activeSection.startsWith('condominios') &&
    proyectos.filter(p => p.estado === 'activo').length === 0

  // Authenticated app
  // serv:S1 — Energía como módulo de 1er nivel con sub-rutas /energia/<tab>.
  // El mismo elemento sirve a `/energia` (tab por defecto) y `/energia/:tab`
  // (deep-link), evitando duplicar el bloque de props.
  const energiaSection = (
    <ErrorBoundary sectionName="servicios_energia">
      <ServiciosEnergiaSection
        fuentesAgua={fuentesAgua}
        proveedoresEnergia={proveedoresEnergia}
        tarifasEnergia={tarifasEnergia}
        fuentesEnergia={fuentesEnergia}
        facturasEnergia={facturasEnergia}
        proyectos={proyectos}
        moneda={moneda}
        onProveedorAdded={addProveedorEnergia}
        onProveedorUpdated={updateProveedorEnergia}
        onProveedorDeleted={deleteProveedorEnergia}
        onTarifaAdded={addTarifaEnergia}
        onTarifaUpdated={updateTarifaEnergia}
        onTarifaDeleted={deleteTarifaEnergia}
        onFuenteAdded={addFuenteEnergia}
        onFuenteUpdated={updateFuenteEnergia}
        onFuenteDeleted={deleteFuenteEnergia}
        onFacturaAdded={addFacturaEnergia}
        onFacturaUpdated={updateFacturaEnergia}
        onFacturaDeleted={deleteFacturaEnergia}
      />
    </ErrorBoundary>
  )

  return (
    <SessionProvider value={currentUser}>
    <PermissionsProvider>
      {/* Toaster montado a nivel app: lib/toast emite mensajes non-blocking
          en la esquina superior derecha para success/warning/info no críticos.
          Confirmaciones destructivas usan shared/Dialog (confirm/notify). */}
      <Toaster richColors position="top-right" closeButton />

      {/* Global CommandPalette (Cmd+K / Ctrl+K) — agrega secciones top-level
          mas los comandos registrados por componentes hijos (ej: tabs de
          condominios via commandRegistry). */}
      <CommandPalette
        items={allCommands}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        placeholder="Buscar sección o tab…"
        recentIds={recentCommandIds}
        onItemSelected={(item) => pushRecent(item.id)}
        pinnedIds={pinnedCommandIds}
        onTogglePin={togglePinCommand}
      />
      <KeyboardShortcutsHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        bindings={shortcutBindings}
      />

      <style>{`
        @media (max-width: 767px) {
          .app-sidebar {
            position: fixed !important;
            top: 0; left: 0;
            height: 100vh;
            z-index: 200;
            transform: translateX(-256px);
            transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .app-sidebar.open { transform: translateX(0); }
          .app-backdrop { display: block !important; }
          .app-hamburger { display: flex !important; }
          .app-main { padding: 16px !important; }
          .app-topbar { padding: 0 14px !important; }
          .app-alert-banner { padding: 10px 14px !important; flex-wrap: wrap; gap: 8px; }
        }
        @media (max-width: 480px) {
          .app-online-badge { display: none !important; }
        }
        @media (min-width: 768px) {
          .app-sidebar { position: sticky !important; transform: none !important; transition: none; }
          .app-backdrop { display: none !important; }
          .app-hamburger { display: none !important; }
        }
      `}</style>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--at-bg)' }}>
        <div
          className="app-backdrop"
          onClick={() => setSidebarOpen(false)}
          style={{
            display: 'none',
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 199,
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? 'auto' : 'none',
            transition: 'opacity 0.28s',
          }}
        />
      <Sidebar
        activeSection={activeSection}
        userRole={currentUser.role}
        currentUser={currentUser}
        canViewModule={canViewModule}
        onSelect={(section) => { navigateSection(section); setSidebarOpen(false) }}
        onPrefetch={prefetchSection}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        unreadComunicacion={unreadComunicacion}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {proximaRuta && (
          <div className="app-alert-banner" style={{
            background: 'linear-gradient(90deg, #fffbeb, #fefce8)',
            borderBottom: '1px solid #fde68a',
            padding: '10px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '8px',
                background: 'rgba(217,119,6,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', flexShrink: 0,
              }}>📋</div>
              <span style={{ fontSize: '13.5px', color: '#78350f', fontWeight: 500 }}>
                Tienes <strong style={{ color: '#92400e' }}>{rutasPendientes.length} ruta{rutasPendientes.length !== 1 ? 's' : ''}</strong> programada{rutasPendientes.length !== 1 ? 's' : ''}.
                {' '}Próxima: <strong style={{ color: '#92400e' }}>{proximaRuta.nombre}</strong> el{' '}
                {new Date(proximaRuta.fecha_programada! + 'T12:00:00').toLocaleDateString('es-GT')}
              </span>
            </div>
            <button
              onClick={() => navigateSection('rutas')}
              style={{
                padding: '6px 14px',
                background: '#d97706',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '12.5px',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 4px rgba(217,119,6,0.3)',
              }}
            >
              Ver Rutas →
            </button>
          </div>
        )}
        <Topbar activeSection={activeSection} currentUser={currentUser} onMenuToggle={() => setSidebarOpen(prev => !prev)} onNavigate={navigateSection} sidebarOpen={sidebarOpen} />
        <PresenceBar currentUser={currentUser} activeSection={activeSection} />
        <TrialExpirationBanner companyId={currentUser.company_id ?? null} />
        <main className="app-main" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div style={{ width: 36, height: 36, border: '3px solid var(--at-line)', borderTop: '3px solid var(--at-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>}>
          <Routes>
            <Route path="/clientes" element={
              <ErrorBoundary sectionName="clientes">
                {canViewModule('clientes') ? (
                  <ClientesSection
                    clientes={clientes}
                    unidades={unidades}
                    userId={currentUser.user_id}
                    companyId={currentUser.company_id}
                    onClienteAdded={addCliente}
                    onClienteUpdated={updateCliente}
                    onClienteDeleted={deleteCliente}
                  />
                ) : (
                  <AccessDenied />
                )}
              </ErrorBoundary>
            } />
            <Route path="/lecturas" element={
              <ErrorBoundary sectionName="lecturas">
                {canViewModule('lecturas') ? (
                  <LecturasSection
                    clientes={clientes}
                    unidades={unidades}
                    contadores={contadores}
                    registros={registros}
                    tarifas={tarifas}
                    proyectos={proyectos}
                    moneda={moneda}
                    onRegistroAdded={addRegistro}
                    rutaActiva={rutaActivaParaLecturas}
                    onClearRuta={() => setRutaActivaParaLecturas(null)}
                    onRutaCompletada={id => {
                      // Las rutas recurrentes no se marcan como completadas: cada
                      // ocurrencia se completa por separado y la ruta sigue activa.
                      const r = rutas.find(x => x.id === id)
                      if (!r || (r.frecuencia ?? 'unica') === 'unica') updateRuta(id, { completada: true })
                    }}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/historial" element={
              <ErrorBoundary sectionName="historial">
                {canViewModule('tabla') ? (
                  <HistorialSection
                    registros={registros}
                    clientes={clientes}
                    proyectos={proyectos}
                    unidades={unidades}
                    contadores={contadores}
                    userRole={currentUser.role}
                    moneda={moneda}
                    onEstadoUpdated={updateRegistroEstado}
                    onRegistroDeleted={deleteRegistro}
                    canEdit={canEdit('tabla')}
                    canChangeStatus={canChangeStatus('tabla')}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/cobros" element={
              <ErrorBoundary sectionName="cobros">
                <RoleGuard userRole={currentUser.role} allowedRoles={['collector', 'admin', 'super_admin', 'company_owner']}>
                <CobrosSection
                  registros={registros}
                  clientes={clientes}
                  moneda={moneda}
                  onEstadoUpdated={updateRegistroEstado}
                  onRegistroUpdated={(id, partial) => {
                    if (partial.monto_pagado !== undefined) {
                      updateRegistroEstado(id, partial.estado ?? 'pendiente')
                    }
                  }}
                />
                </RoleGuard>
              </ErrorBoundary>
            } />
            <Route path="/dashboard" element={
              <ErrorBoundary sectionName="dashboard">
                {canViewModule('dashboard') ? (
                  <DashboardSection registros={registros} moneda={moneda} isLoading={dataLoading} />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/admin-dashboard" element={
              <ErrorBoundary sectionName="admin_dashboard">
                <RoleGuard userRole={currentUser.role} allowedRoles={['company_owner']}>
                <AdminClientDashboard
                  currentUser={currentUser}
                  data={{
                    clientes,
                    registros,
                    proyectos,
                    contadores,
                    fuentesAgua,
                    registrosCalidad,
                    rutas,
                    tarifas,
                    unidades,
                  }}
                  moneda={moneda}
                  isLoading={dataLoading}
                  onDataRefresh={refrescarDatos}
                  onNavigateSection={navigateSection}
                />
                </RoleGuard>
              </ErrorBoundary>
            } />
            <Route path="/mapa" element={
              <ErrorBoundary sectionName="mapa">
                {canViewModule('mapa') ? (
                  <MapaSection
                    clientes={clientes}
                    registros={registros}
                    companyId={currentUser.company_id}
                    canConfigurar={currentUser.role === 'company_owner' || currentUser.role === 'super_admin'}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/rutas" element={
              <ErrorBoundary sectionName="rutas">
                {canViewModule('rutas') ? (
                  <RutasSection
                    clientes={clientes}
                    contadores={contadores}
                    unidades={unidades}
                    proyectos={proyectos}
                    rutas={rutas}
                    userRole={currentUser.role}
                    companyId={currentUser.company_id}
                    onRutaAdded={addRuta}
                    onRutaUpdated={updateRuta}
                    onRutaDeleted={deleteRuta}
                    onEjecutarRuta={onEjecutarRuta}
                    canCreate={canCreate('rutas')}
                    canEdit={canEdit('rutas')}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/calidad" element={
              <ErrorBoundary sectionName="calidad">
                {canViewModule('calidad') ? (
                  <CalidadSection
                    fuentesAgua={fuentesAgua}
                    registrosCalidad={registrosCalidad}
                    empresa={empresa}
                    userId={currentUser.user_id}
                    onFuentesUpdated={setFuentesAgua}
                    onRegistrosCalidadUpdated={setRegistrosCalidad}
                    canCreate={canCreate('calidad')}
                    canEdit={canEdit('calidad')}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/configuracion" element={
              <ErrorBoundary sectionName="configuracion">
                <RoleGuard userRole={currentUser.role} allowedRoles={['admin', 'super_admin', 'company_owner']}>
                <ConfiguracionSection onLogout={handleLogout} />
                </RoleGuard>
              </ErrorBoundary>
            } />
            <Route path="/perfil" element={
              <ErrorBoundary sectionName="perfil">
                <PerfilSection currentUser={currentUser} onUpdateProfile={updateProfile} />
              </ErrorBoundary>
            } />
            <Route path="/empresa" element={
              <ErrorBoundary sectionName="empresa">
                <RoleGuard userRole={currentUser.role} allowedRoles={['company_owner']}>
                <EmpresaSection currentUser={currentUser} />
                </RoleGuard>
              </ErrorBoundary>
            } />
            <Route path="/tarifas" element={
              <ErrorBoundary sectionName="tarifas">
                {canViewModule('tarifas') ? (
                  <TarifasSection
                    tarifas={tarifas}
                    proyectos={proyectos}
                    moneda={moneda}
                    onTarifaAdded={addTarifa}
                    onTarifaUpdated={updateTarifa}
                    onTarifaDeleted={deleteTarifa}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/unidades" element={
              <ErrorBoundary sectionName="unidades">
                {canViewModule('unidades') ? (
                  <UnidadesSection
                    unidades={unidades}
                    contadores={contadores}
                    clientes={clientes}
                    proyectos={proyectos}
                    maxUnidadesPorTipo={maxUnidadesPorTipo}
                    onUnidadAdded={addUnidad}
                    onUnidadUpdated={updateUnidad}
                    onUnidadDeleted={deleteUnidad}
                    onContadorUpdated={updateContador}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/contadores" element={
              <ErrorBoundary sectionName="contadores">
                {canViewModule('contadores') ? (
                  <ContadoresSection
                    contadores={contadores}
                    tarifas={tarifas}
                    unidades={unidades}
                    moneda={moneda}
                    onContadorAdded={addContador}
                    onContadorUpdated={updateContador}
                    onContadorDeleted={deleteContador}
                  />
                ) : <AccessDenied />}
              </ErrorBoundary>
            } />
            <Route path="/superadmin" element={
              <ErrorBoundary sectionName="superadmin">
                <RoleGuard userRole={currentUser.role} allowedRoles={['super_admin']}>
                <SuperAdminSection />
                </RoleGuard>
              </ErrorBoundary>
            } />
            <Route path="/comunicacion" element={
              <ErrorBoundary sectionName="comunicacion">
                <ComunicacionSection
                  currentUser={currentUser}
                  clientes={clientes}
                  proyectos={proyectos}
                  unidades={unidades}
                  canCreate={canCreate('comunicacion')}
                  canEdit={canEdit('comunicacion')}
                />
              </ErrorBoundary>
            } />
            {/* serv:S1 — Energía 1er nivel: `/energia` (tab por defecto) +
                `/energia/:tab` deep-linkable. Mismo elemento (energiaSection). */}
            <Route path="/energia" element={energiaSection} />
            <Route path="/energia/:tab" element={energiaSection} />
            {/* cond:A1 sub-rutas: `/condominios/panel` es el selector de
                proyecto (CondominiosDashboard). Cualquier otro segmento se
                interpreta como un tab del registry; tabs desconocidos caen
                a 'panel'. `/condominios` (sin segmento) entra al tab por
                defecto del registry. */}
            <Route path="/condominios/panel" element={
              condominiosSinProyecto ? <SinProyectoAsignado /> : (
                <CondominiosDashboard
                  currentUser={currentUser}
                  proyectos={proyectos}
                  unidades={unidades}
                  onNavigateSection={navigateSection}
                />
              )
            } />
            <Route path="/condominios/:tab" element={
              condominiosSinProyecto ? <SinProyectoAsignado /> : (
                <ErrorBoundary sectionName="condominios">
                  <CondominiosSection proyectos={proyectos} unidades={unidades} currentUser={currentUser} canCreate={canCreate} canEdit={canEdit} />
                </ErrorBoundary>
              )
            } />
            <Route path="/condominios" element={
              condominiosSinProyecto ? <SinProyectoAsignado /> : (
                <ErrorBoundary sectionName="condominios">
                  <CondominiosSection
                    proyectos={proyectos}
                    unidades={unidades}
                    currentUser={currentUser}
                    canCreate={canCreate}
                    canEdit={canEdit}
                  />
                </ErrorBoundary>
              )
            } />
            {/* `/` y rutas no reconocidas: el efecto de default-by-role replaces a la
                ruta correcta. Render vacío mientras tanto. */}
            <Route path="/" element={null} />
            <Route path="*" element={<Navigate to={sectionToPath('clientes')} replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
    </div>
    </PermissionsProvider>
    </SessionProvider>
  )
}
