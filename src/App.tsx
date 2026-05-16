import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import Swal from 'sweetalert2'
import type { AppSection, Ruta, UserSession } from './types'
import { supabase } from './lib/supabase'
import { useAuth } from './hooks/useAuth'
import { useData } from './hooks/useData'
import { initEmailJS } from './lib/email'
import { LoginScreen } from './components/auth/LoginScreen'
import { PasswordResetModal } from './components/auth/PasswordResetModal'
import { PasswordResetPage } from './components/auth/PasswordResetPage'
import { RegisterScreen } from './components/auth/RegisterScreen'
import OAuthOnboardingScreen from './components/auth/OAuthOnboardingScreen'
import { CustomerPortal } from './components/portal/CustomerPortal'
import { CondominiosClientPortal } from './components/portal/CondominiosClientPortal'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RoleGuard } from './components/shared/AccessDenied'
import { usePermissions } from './hooks/usePermissions'

const ClientesSection = lazy(() => import('./components/clientes/ClientesSection').then(m => ({ default: m.ClientesSection })))
const LecturasSection = lazy(() => import('./components/lecturas/LecturasSection').then(m => ({ default: m.LecturasSection })))
const HistorialSection = lazy(() => import('./components/historial/HistorialSection').then(m => ({ default: m.HistorialSection })))
const DashboardSection = lazy(() => import('./components/dashboard/DashboardSection').then(m => ({ default: m.DashboardSection })))
const AdminClientDashboard = lazy(() => import('./components/admin-dashboard/AdminClientDashboard').then(m => ({ default: m.AdminClientDashboard })))
const MapaSection = lazy(() => import('./components/mapa/MapaSection').then(m => ({ default: m.MapaSection })))
const CalidadSection = lazy(() => import('./components/calidad/CalidadSection').then(m => ({ default: m.CalidadSection })))
const RutasSection = lazy(() => import('./components/rutas/RutasSection').then(m => ({ default: m.RutasSection })))
const ConfiguracionSection = lazy(() => import('./components/configuracion/ConfiguracionSection').then(m => ({ default: m.ConfiguracionSection })))
const PerfilSection = lazy(() => import('./components/perfil/PerfilSection').then(m => ({ default: m.PerfilSection })))
const EmpresaSection = lazy(() => import('./components/empresa/EmpresaSection').then(m => ({ default: m.EmpresaSection })))
const SuperAdminSection = lazy(() => import('./components/superadmin/SuperAdminSection').then(m => ({ default: m.SuperAdminSection })))
const TarifasSection = lazy(() => import('./components/tarifas/TarifasSection').then(m => ({ default: m.TarifasSection })))
const ContadoresSection = lazy(() => import('./components/contadores/ContadoresSection').then(m => ({ default: m.ContadoresSection })))
const UnidadesSection = lazy(() => import('./components/unidades/UnidadesSection').then(m => ({ default: m.UnidadesSection })))
const CobrosSection = lazy(() => import('./components/cobros/CobrosSection').then(m => ({ default: m.CobrosSection })))
const ComunicacionSection = lazy(() => import('./components/comunicacion/ComunicacionSection').then(m => ({ default: m.ComunicacionSection })))
const ServiciosEnergiaSection = lazy(() => import('./components/servicios-energia/ServiciosEnergiaSection'))
const CondominiosSection = lazy(() => import('./components/condominios/CondominiosSection').then(m => ({ default: m.CondominiosSection })))
const CondominiosDashboard = lazy(() => import('./components/condominios/CondominiosDashboard').then(m => ({ default: m.CondominiosDashboard })))

initEmailJS()

// Shown when a client has both servicio_agua and servicio_condominios active
function DualServicePortal({ currentUser, onLogout }: { currentUser: UserSession; onLogout: () => void }) {
  const [activeService, setActiveService] = useState<'condominios' | 'agua'>('condominios')
  return (
    <div>
      <div style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: 'white',
        borderBottom: '2px solid #e2e8f0',
        display: 'flex', justifyContent: 'center', gap: '6px',
        padding: '8px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <button
          onClick={() => setActiveService('condominios')}
          style={{
            padding: '7px 22px', borderRadius: '20px', border: 'none',
            background: activeService === 'condominios' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#f1f5f9',
            color: activeService === 'condominios' ? 'white' : '#64748b',
            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.18s',
          }}
        >🏢 Condominios</button>
        <button
          onClick={() => setActiveService('agua')}
          style={{
            padding: '7px 22px', borderRadius: '20px', border: 'none',
            background: activeService === 'agua' ? 'linear-gradient(135deg, #0ea5e9, #0d9488)' : '#f1f5f9',
            color: activeService === 'agua' ? 'white' : '#64748b',
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
    void Swal.fire({
      icon: 'success',
      title: '¡Cuenta de Google conectada!',
      html: `Los correos se enviarán desde <strong>${json.email ?? 'tu cuenta de Google'}</strong>.`,
      confirmButtonText: 'Entendido',
    })
  } else {
    const err = await res.json() as { error?: string }
    void Swal.fire({ icon: 'error', title: 'Error al conectar Google', text: err.error ?? 'Intenta nuevamente.' })
  }
}

export default function App() {
  const { currentUser, loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, login, loginWithGoogle, logout, updateProfile } = useAuth()
  const {
    clientes, registros, empresa, fuentesAgua, registrosCalidad, rutas, tarifas, contadores, unidades, proyectos,
    moneda, maxUnidadesPorTipo,
    proveedoresEnergia, tarifasEnergia, fuentesEnergia, facturasEnergia,
    isLoading: dataLoading,
    cargarDatos, addCliente, updateCliente, deleteCliente, addRegistro, updateRegistroEstado,
    setFuentesAgua, setRegistrosCalidad, addRuta, updateRuta, deleteRuta,
    addTarifa, updateTarifa, deleteTarifa,
    addContador, updateContador, deleteContador,
    addUnidad, updateUnidad, deleteUnidad,
    addProveedorEnergia, updateProveedorEnergia, deleteProveedorEnergia,
    addTarifaEnergia, updateTarifaEnergia, deleteTarifaEnergia,
    addFuenteEnergia, updateFuenteEnergia, deleteFuenteEnergia,
    addFacturaEnergia, updateFacturaEnergia, deleteFacturaEnergia,
  } = useData(currentUser?.company_id, currentUser?.user_id, currentUser?.role, currentUser?.condominios_role)

  const { canViewModule, canCreate, canEdit, canChangeStatus } = usePermissions(currentUser)

  const [activeSection, setActiveSection] = useState<AppSection>('clientes')
  const [rutaActivaParaLecturas, setRutaActivaParaLecturas] = useState<Ruta | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [unreadComunicacion, setUnreadComunicacion] = useState(0)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  // Legacy: kept for backward compatibility with old reset links already sent
  const [resetToken] = useState<string | null>(getResetToken)
  const [dataLoaded, setDataLoaded] = useState(false)

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
    setActiveSection('lecturas')
  }, [])

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

  // Set default section based on role after login
  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === 'company_owner') {
        setActiveSection('admin_dashboard')
      } else if (currentUser.role === 'super_admin') {
        setActiveSection('superadmin_empresas')
      } else if (currentUser.role === 'collector') {
        setActiveSection('cobros')
      }
      // 'cliente' role is handled by its own portal render path — no section needed
    }
  }, [currentUser?.user_id, currentUser?.role])

  // Load data after login (skip for cliente — portal loads its own data)
  useEffect(() => {
    if (currentUser && !dataLoaded && currentUser.role !== 'cliente') {
      cargarDatos()
        .then(() => setDataLoaded(true))
        .catch((err: unknown) => {
          console.error('Error loading data:', err)
          if (navigator.onLine) {
            Swal.fire({
              icon: 'error',
              title: 'Error al cargar datos',
              text: 'No se pudieron cargar los datos. Intente recargar la página.',
              confirmButtonText: 'Recargar',
            }).then((r: { isConfirmed: boolean }) => r.isConfirmed && window.location.reload())
          }
        })
    }
  }, [currentUser, dataLoaded, cargarDatos])

  // Password recovery via Supabase native flow (PASSWORD_RECOVERY event)
  if (isPasswordRecovery || resetToken) {
    return <PasswordResetPage onBack={() => window.location.replace(window.location.pathname)} />
  }

  // Google OAuth user without app_users profile — needs to complete onboarding
  if (needsOnboarding && pendingOAuthUser) {
    return (
      <OAuthOnboardingScreen
        googleUser={pendingOAuthUser}
        onSuccess={completeOnboarding}
        onCancel={() => window.location.replace(window.location.pathname)}
      />
    )
  }

  // Not authenticated
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '48px', height: '48px',
            border: '3px solid rgba(255,255,255,0.25)',
            borderTop: '3px solid white',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <div style={{ color: 'white', fontSize: '15px', fontWeight: 500, letterSpacing: '0.02em', opacity: 0.9 }}>
            Cargando AquaControl…
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!currentUser) {
    if (showRegister) {
      return (
        <RegisterScreen
          onBack={() => setShowRegister(false)}
          onRegistered={async (email, password) => {
            setShowRegister(false)
            await login(email, password)
          }}
        />
      )
    }
    return (
      <>
        <LoginScreen
          onLogin={login}
          onLoginWithGoogle={loginWithGoogle}
          onForgotPassword={() => setShowPasswordReset(true)}
          onRegister={() => setShowRegister(true)}
        />
        {showPasswordReset && (
          <PasswordResetModal onClose={() => setShowPasswordReset(false)} />
        )}
      </>
    )
  }

  // Cliente users get their own portal — no admin data needed
  if (currentUser.role === 'cliente') {
    const tieneCondominios = !!currentUser.servicio_condominios
    const tieneAgua = currentUser.servicio_agua !== false
    if (tieneCondominios && tieneAgua) {
      return <DualServicePortal currentUser={currentUser} onLogout={logout} />
    }
    if (tieneCondominios) {
      return <CondominiosClientPortal currentUser={currentUser} onLogout={logout} />
    }
    return <CustomerPortal currentUser={currentUser} onLogout={logout} />
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

  // Authenticated app
  return (
    <>
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
      <div style={{ display: 'flex', minHeight: '100vh', background: '#f0f4f8' }}>
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
        onSelect={(section) => { setActiveSection(section); setSidebarOpen(false) }}
        onLogout={logout}
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
              onClick={() => setActiveSection('rutas')}
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
        <Topbar activeSection={activeSection} currentUser={currentUser} onMenuToggle={() => setSidebarOpen(prev => !prev)} />
        <main className="app-main" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTop: '3px solid #0ea5e9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>}>
          {activeSection === 'clientes' && (
            <ErrorBoundary sectionName="clientes">
              <ClientesSection
                clientes={clientes}
                unidades={unidades}
                userRole={currentUser.role}
                userId={currentUser.user_id}
                currentUser={currentUser}
                companyId={currentUser.company_id}
                onClienteAdded={addCliente}
                onClienteUpdated={updateCliente}
                onClienteDeleted={deleteCliente}
                canCreate={canCreate('clientes')}
                canEdit={canEdit('clientes')}
                canChangeStatus={canChangeStatus('clientes')}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'lecturas' && (
            <ErrorBoundary sectionName="lecturas">
              <LecturasSection
                clientes={clientes}
                unidades={unidades}
                contadores={contadores}
                registros={registros}
                tarifas={tarifas}
                userRole={currentUser.role}
                currentUser={currentUser}
                proyectos={proyectos}
                moneda={moneda}
                onRegistroAdded={addRegistro}
                rutaActiva={rutaActivaParaLecturas}
                onClearRuta={() => setRutaActivaParaLecturas(null)}
                onRutaCompletada={id => updateRuta(id, { completada: true })}
                canCreate={canCreate('lecturas')}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'tabla' && (
            <ErrorBoundary sectionName="historial">
              <HistorialSection
                registros={registros}
                clientes={clientes}
                proyectos={proyectos}
                unidades={unidades}
                contadores={contadores}
                userRole={currentUser.role}
                moneda={moneda}
                onEstadoUpdated={updateRegistroEstado}
                canEdit={canEdit('tabla')}
                canChangeStatus={canChangeStatus('tabla')}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'cobros' && (
            <ErrorBoundary sectionName="cobros">
              <RoleGuard userRole={currentUser.role} allowedRoles={['collector', 'admin', 'super_admin', 'company_owner']}>
              <CobrosSection
                registros={registros}
                clientes={clientes}
                userRole={currentUser.role}
                currentUser={currentUser}
                moneda={moneda}
                onEstadoUpdated={updateRegistroEstado}
                onRegistroUpdated={(id, partial) => {
                  if (partial.monto_pagado !== undefined) {
                    updateRegistroEstado(id, partial.estado ?? 'pendiente')
                  }
                }}
                canCreate={canCreate('cobros')}
                canEdit={canEdit('cobros')}
                canChangeStatus={canChangeStatus('cobros')}
              />
              </RoleGuard>
            </ErrorBoundary>
          )}
          {activeSection === 'dashboard' && (
            <ErrorBoundary sectionName="dashboard">
              <DashboardSection registros={registros} moneda={moneda} isLoading={dataLoading} />
            </ErrorBoundary>
          )}
          {activeSection === 'admin_dashboard' && (
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
                onDataRefresh={cargarDatos}
                onNavigateSection={setActiveSection}
              />
              </RoleGuard>
            </ErrorBoundary>
          )}
          {activeSection === 'mapa' && (
            <ErrorBoundary sectionName="mapa">
              <MapaSection clientes={clientes} registros={registros} />
            </ErrorBoundary>
          )}
          {activeSection === 'rutas' && (
            <ErrorBoundary sectionName="rutas">
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
            </ErrorBoundary>
          )}
          {activeSection === 'calidad' && (
            <ErrorBoundary sectionName="calidad">
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
            </ErrorBoundary>
          )}
          {activeSection === 'configuracion' && (
            <ErrorBoundary sectionName="configuracion">
              <RoleGuard userRole={currentUser.role} allowedRoles={['admin', 'super_admin', 'company_owner']}>
              <ConfiguracionSection onLogout={logout} />
              </RoleGuard>
            </ErrorBoundary>
          )}
          {activeSection === 'perfil' && (
            <ErrorBoundary sectionName="perfil">
              <PerfilSection currentUser={currentUser} onUpdateProfile={updateProfile} />
            </ErrorBoundary>
          )}
          {activeSection === 'empresa_proyectos' && (
            <ErrorBoundary sectionName="empresa">
              <RoleGuard userRole={currentUser.role} allowedRoles={['company_owner']}>
              <EmpresaSection currentUser={currentUser} />
              </RoleGuard>
            </ErrorBoundary>
          )}
          {activeSection === 'tarifas' && (
            <ErrorBoundary sectionName="tarifas">
              <TarifasSection
                tarifas={tarifas}
                proyectos={proyectos}
                userRole={currentUser.role}
                currentUser={currentUser}
                moneda={moneda}
                onTarifaAdded={addTarifa}
                onTarifaUpdated={updateTarifa}
                onTarifaDeleted={deleteTarifa}
                canCreate={canCreate('tarifas')}
                canEdit={canEdit('tarifas')}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'unidades' && (
            <ErrorBoundary sectionName="unidades">
              <UnidadesSection
                unidades={unidades}
                contadores={contadores}
                clientes={clientes}
                proyectos={proyectos}
                userRole={currentUser.role}
                currentUser={currentUser}
                maxUnidadesPorTipo={maxUnidadesPorTipo}
                onUnidadAdded={addUnidad}
                onUnidadUpdated={updateUnidad}
                onUnidadDeleted={deleteUnidad}
                onContadorUpdated={updateContador}
                canCreate={canCreate('unidades')}
                canEdit={canEdit('unidades')}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'contadores' && (
            <ErrorBoundary sectionName="contadores">
              <ContadoresSection
                contadores={contadores}
                tarifas={tarifas}
                unidades={unidades}
                userRole={currentUser.role}
                currentUser={currentUser}
                moneda={moneda}
                onContadorAdded={addContador}
                onContadorUpdated={updateContador}
                onContadorDeleted={deleteContador}
                canCreate={canCreate('contadores')}
                canEdit={canEdit('contadores')}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'superadmin_empresas' && (
            <ErrorBoundary sectionName="superadmin">
              <RoleGuard userRole={currentUser.role} allowedRoles={['super_admin']}>
              <SuperAdminSection />
              </RoleGuard>
            </ErrorBoundary>
          )}
          {activeSection === 'comunicacion' && (
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
          )}
          {activeSection === 'servicios_energia' && (
            <ErrorBoundary sectionName="servicios_energia">
              <ServiciosEnergiaSection
                fuentesAgua={fuentesAgua}
                proveedoresEnergia={proveedoresEnergia}
                tarifasEnergia={tarifasEnergia}
                fuentesEnergia={fuentesEnergia}
                facturasEnergia={facturasEnergia}
                proyectos={proyectos}
                currentUser={currentUser}
                moneda={moneda}
                canCreate={canCreate('servicios_energia')}
                canEdit={canEdit('servicios_energia')}
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
          )}
          {activeSection === 'condominios_dashboard' && (
            <CondominiosDashboard
              currentUser={currentUser}
              proyectos={proyectos}
              unidades={unidades}
              onNavigateSection={setActiveSection}
            />
          )}
          {activeSection === 'condominios_visitantes' && (
            <ErrorBoundary sectionName="condominios">
              <CondominiosSection proyectos={proyectos} unidades={unidades} currentUser={currentUser} canCreate={canCreate} canEdit={canEdit} initialTab="visitantes" />
            </ErrorBoundary>
          )}
          {activeSection === 'condominios_cuotas' && (
            <ErrorBoundary sectionName="condominios">
              <CondominiosSection proyectos={proyectos} unidades={unidades} currentUser={currentUser} canCreate={canCreate} canEdit={canEdit} initialTab="cuotas" />
            </ErrorBoundary>
          )}
          {activeSection === 'condominios_mantenimiento' && (
            <ErrorBoundary sectionName="condominios">
              <CondominiosSection proyectos={proyectos} unidades={unidades} currentUser={currentUser} canCreate={canCreate} canEdit={canEdit} initialTab="mantenimiento" />
            </ErrorBoundary>
          )}
          {activeSection === 'condominios' && (
            <ErrorBoundary sectionName="condominios">
              <CondominiosSection
                proyectos={proyectos}
                unidades={unidades}
                currentUser={currentUser}
                canCreate={canCreate}
                canEdit={canEdit}
              />
            </ErrorBoundary>
          )}
          </Suspense>
        </main>
      </div>
    </div>
    </>
  )
}
