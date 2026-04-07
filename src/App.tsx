import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import type { AppSection, Ruta } from './types'
import { useAuth } from './hooks/useAuth'
import { useData } from './hooks/useData'
import { initEmailJS } from './lib/email'
import { LoginScreen } from './components/auth/LoginScreen'
import { PasswordResetModal } from './components/auth/PasswordResetModal'
import { PasswordResetPage } from './components/auth/PasswordResetPage'
import { RegisterScreen } from './components/auth/RegisterScreen'
import { CustomerPortal } from './components/portal/CustomerPortal'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { ClientesSection } from './components/clientes/ClientesSection'
import { LecturasSection } from './components/lecturas/LecturasSection'
import { HistorialSection } from './components/historial/HistorialSection'
import { DashboardSection } from './components/dashboard/DashboardSection'
import { AdminClientDashboard } from './components/admin-dashboard/AdminClientDashboard'
import { MapaSection } from './components/mapa/MapaSection'
import { CalidadSection } from './components/calidad/CalidadSection'
import { RutasSection } from './components/rutas/RutasSection'
import { ConfiguracionSection } from './components/configuracion/ConfiguracionSection'
import { PerfilSection } from './components/perfil/PerfilSection'
import { EmpresaSection } from './components/empresa/EmpresaSection'
import { SuperAdminSection } from './components/superadmin/SuperAdminSection'
import { TarifasSection } from './components/tarifas/TarifasSection'
import { ContadoresSection } from './components/contadores/ContadoresSection'
import { UnidadesSection } from './components/unidades/UnidadesSection'
import { CobrosSection } from './components/cobros/CobrosSection'
import { ErrorBoundary } from './components/ErrorBoundary'
import { RoleGuard } from './components/shared/AccessDenied'

initEmailJS()

// Detect password reset token in URL
function getResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('reset_token')
}

export default function App() {
  const { currentUser, loading, login, loginWithGoogle, logout, updateProfile } = useAuth()
  const {
    clientes, registros, empresa, fuentesAgua, registrosCalidad, rutas, tarifas, contadores, unidades, proyectos,
    moneda, maxUnidadesPorTipo,
    cargarDatos, addCliente, updateCliente, deleteCliente, addRegistro, updateRegistroEstado,
    setFuentesAgua, setRegistrosCalidad, addRuta, updateRuta, deleteRuta,
    addTarifa, updateTarifa, deleteTarifa,
    addContador, updateContador, deleteContador,
    addUnidad, updateUnidad, deleteUnidad,
  } = useData()

  const [rutaActivaParaLecturas, setRutaActivaParaLecturas] = useState<Ruta | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showRegister, setShowRegister] = useState(false)

  const defaultSection = (): AppSection => {
    // Will be resolved after login when currentUser is available
    return 'clientes'
  }
  const [activeSection, setActiveSection] = useState<AppSection>(defaultSection)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [resetToken] = useState<string | null>(getResetToken)
  const [dataLoaded, setDataLoaded] = useState(false)

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
  }, [currentUser?.user_id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Password reset page (token in URL)
  if (resetToken) {
    return <PasswordResetPage token={resetToken} onBack={() => window.location.replace(window.location.pathname)} />
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
          <PasswordResetModal empresa={empresa} onClose={() => setShowPasswordReset(false)} />
        )}
      </>
    )
  }

  // Cliente users get their own portal — no admin data needed
  if (currentUser.role === 'cliente') {
    return <CustomerPortal currentUser={currentUser} onLogout={logout} />
  }

  function onEjecutarRuta(ruta: Ruta) {
    setRutaActivaParaLecturas(ruta)
    setActiveSection('lecturas')
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
        onSelect={(section) => { setActiveSection(section); setSidebarOpen(false) }}
        onLogout={logout}
        isOpen={sidebarOpen}
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
          {activeSection === 'clientes' && (
            <ErrorBoundary sectionName="clientes">
              <ClientesSection
                clientes={clientes}
                userRole={currentUser.role}
                userId={currentUser.user_id}
                currentUser={currentUser}
                companyId={currentUser.company_id}
                onClienteAdded={addCliente}
                onClienteUpdated={updateCliente}
                onClienteDeleted={deleteCliente}
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
                moneda={moneda}
                onRegistroAdded={addRegistro}
                rutaActiva={rutaActivaParaLecturas}
                onClearRuta={() => setRutaActivaParaLecturas(null)}
                onRutaCompletada={id => updateRuta(id, { completada: true })}
              />
            </ErrorBoundary>
          )}
          {activeSection === 'tabla' && (
            <ErrorBoundary sectionName="historial">
              <HistorialSection
                registros={registros}
                clientes={clientes}
                userRole={currentUser.role}
                moneda={moneda}
                onEstadoUpdated={updateRegistroEstado}
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
              />
              </RoleGuard>
            </ErrorBoundary>
          )}
          {activeSection === 'dashboard' && (
            <ErrorBoundary sectionName="dashboard">
              <DashboardSection registros={registros} moneda={moneda} />
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
                rutas={rutas}
                userRole={currentUser.role}
                onRutaAdded={addRuta}
                onRutaUpdated={updateRuta}
                onRutaDeleted={deleteRuta}
                onEjecutarRuta={onEjecutarRuta}
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
        </main>
      </div>
    </div>
    </>
  )
}
