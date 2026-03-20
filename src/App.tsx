import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import type { AppSection } from './types'
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
import { ConfiguracionSection } from './components/configuracion/ConfiguracionSection'
import { PerfilSection } from './components/perfil/PerfilSection'

initEmailJS()

// Detect password reset token in URL
function getResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('reset_token')
}

export default function App() {
  const { currentUser, loading, login, loginWithGoogle, logout, updateProfile } = useAuth()
  const {
    clientes, registros, empresa, fuentesAgua, registrosCalidad,
    cargarDatos, addCliente, addRegistro, updateRegistroEstado,
    setFuentesAgua, setRegistrosCalidad,
  } = useData()

  const [activeSection, setActiveSection] = useState<AppSection>('clientes')
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [resetToken] = useState<string | null>(getResetToken)
  const [dataLoaded, setDataLoaded] = useState(false)

  // Load data after login
  useEffect(() => {
    if (currentUser && !dataLoaded) {
      cargarDatos()
        .then(() => setDataLoaded(true))
        .catch(err => {
          console.error('Error loading data:', err)
          if (navigator.onLine) {
            Swal.fire({
              icon: 'error',
              title: 'Error al cargar datos',
              text: 'No se pudieron cargar los datos. Intente recargar la página.',
              confirmButtonText: 'Recargar',
            }).then(r => r.isConfirmed && window.location.reload())
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
        </main>
      </div>
    </div>
  )
}
