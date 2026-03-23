import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import type { AppSection, Ruta } from './types'
import { useAuth } from './hooks/useAuth'
import { useData } from './hooks/useData'
import { initEmailJS } from './lib/email'
import { LoginScreen } from './components/auth/LoginScreen'
import { PasswordResetModal } from './components/auth/PasswordResetModal'
import { PasswordResetPage } from './components/auth/PasswordResetPage'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { ClientesSection } from './components/clientes/ClientesSection'
import { LecturasSection } from './components/lecturas/LecturasSection'
import { HistorialSection } from './components/historial/HistorialSection'
import { DashboardSection } from './components/dashboard/DashboardSection'
import { MapaSection } from './components/mapa/MapaSection'
import { CalidadSection } from './components/calidad/CalidadSection'
import { RutasSection } from './components/rutas/RutasSection'
import { ConfiguracionSection } from './components/configuracion/ConfiguracionSection'
import { PerfilSection } from './components/perfil/PerfilSection'
import { EmpresaSection } from './components/empresa/EmpresaSection'
import { SuperAdminSection } from './components/superadmin/SuperAdminSection'
import { TarifasSection } from './components/tarifas/TarifasSection'

initEmailJS()

// Detect password reset token in URL
function getResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('reset_token')
}

export default function App() {
  const { currentUser, loading, login, loginWithGoogle, logout, updateProfile } = useAuth()
  const {
    clientes, registros, empresa, fuentesAgua, registrosCalidad, rutas, tarifas,
    cargarDatos, addCliente, addRegistro, updateRegistroEstado,
    setFuentesAgua, setRegistrosCalidad, addRuta, updateRuta, deleteRuta,
    addTarifa, updateTarifa, deleteTarifa,
  } = useData()

  const [rutaActivaParaLecturas, setRutaActivaParaLecturas] = useState<Ruta | null>(null)

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
        setActiveSection('empresa_proyectos')
      } else if (currentUser.role === 'super_admin') {
        setActiveSection('superadmin_empresas')
      }
    }
  }, [currentUser?.user_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load data after login
  useEffect(() => {
    if (currentUser && !dataLoaded) {
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)' }}>
        <div style={{ color: 'white', fontSize: '20px', fontWeight: 600 }}>Cargando...</div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <>
        <LoginScreen onLogin={login} onLoginWithGoogle={loginWithGoogle} onForgotPassword={() => setShowPasswordReset(true)} />
        {showPasswordReset && (
          <PasswordResetModal empresa={empresa} onClose={() => setShowPasswordReset(false)} />
        )}
      </>
    )
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
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f1f5f9' }}>
      <Sidebar
        activeSection={activeSection}
        userRole={currentUser.role}
        currentUser={currentUser}
        onSelect={setActiveSection}
        onLogout={logout}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {proximaRuta && (
          <div style={{ background: '#fef9c3', borderBottom: '2px solid #fde047', padding: '10px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: '14px', color: '#854d0e', fontWeight: 600 }}>
              📋 Tienes {rutasPendientes.length} ruta{rutasPendientes.length !== 1 ? 's' : ''} programada{rutasPendientes.length !== 1 ? 's' : ''}.
              {' '}Próxima: <strong>{proximaRuta.nombre}</strong> el{' '}
              {new Date(proximaRuta.fecha_programada! + 'T12:00:00').toLocaleDateString('es-GT')}
            </span>
            <button
              onClick={() => setActiveSection('rutas')}
              style={{ padding: '6px 14px', background: '#d97706', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}
            >
              Ver Rutas
            </button>
          </div>
        )}
        <Topbar activeSection={activeSection} currentUser={currentUser} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '28px' }}>
          {activeSection === 'clientes' && (
            <ClientesSection
              clientes={clientes}
              userRole={currentUser.role}
              userId={currentUser.user_id}
              onClienteAdded={addCliente}
            />
          )}
          {activeSection === 'lecturas' && (
            <LecturasSection
              clientes={clientes}
              registros={registros}
              userRole={currentUser.role}
              onRegistroAdded={addRegistro}
              rutaActiva={rutaActivaParaLecturas}
              onClearRuta={() => setRutaActivaParaLecturas(null)}
              onRutaCompletada={id => updateRuta(id, { completada: true })}
            />
          )}
          {activeSection === 'tabla' && (
            <HistorialSection
              registros={registros}
              clientes={clientes}
              userRole={currentUser.role}
              onEstadoUpdated={updateRegistroEstado}
            />
          )}
          {activeSection === 'dashboard' && (
            <DashboardSection registros={registros} />
          )}
          {activeSection === 'mapa' && (
            <MapaSection clientes={clientes} registros={registros} />
          )}
          {activeSection === 'rutas' && (
            <RutasSection
              clientes={clientes}
              rutas={rutas}
              userRole={currentUser.role}
              onRutaAdded={addRuta}
              onRutaUpdated={updateRuta}
              onRutaDeleted={deleteRuta}
              onEjecutarRuta={onEjecutarRuta}
            />
          )}
          {activeSection === 'calidad' && (
            <CalidadSection
              fuentesAgua={fuentesAgua}
              registrosCalidad={registrosCalidad}
              empresa={empresa}
              userId={currentUser.user_id}
              onFuentesUpdated={setFuentesAgua}
              onRegistrosCalidadUpdated={setRegistrosCalidad}
            />
          )}
          {activeSection === 'configuracion' && (
            <ConfiguracionSection onLogout={logout} />
          )}
          {activeSection === 'perfil' && (
            <PerfilSection currentUser={currentUser} onUpdateProfile={updateProfile} />
          )}
          {activeSection === 'empresa_proyectos' && (
            <EmpresaSection currentUser={currentUser} />
          )}
          {activeSection === 'tarifas' && (
            <TarifasSection
              tarifas={tarifas}
              userRole={currentUser.role}
              currentUser={currentUser}
              onTarifaAdded={addTarifa}
              onTarifaUpdated={updateTarifa}
              onTarifaDeleted={deleteTarifa}
            />
          )}
          {activeSection === 'superadmin_empresas' && (
            <SuperAdminSection />
          )}
        </main>
      </div>
    </div>
  )
}
