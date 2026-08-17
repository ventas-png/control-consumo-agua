import { hoyLocalISO } from './lib/format'
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { lazySafe as lazy } from './lib/lazyWithPreload'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { OPEN_BILLING_EVENT, OPEN_AMPLIAR_EVENT } from './components/shared/promptUpgrade'
import { TrialExpirationBanner } from './components/shared/TrialExpirationBanner'
import { PastDueBanner } from './components/shared/PastDueBanner'
import { CompanySuspendedBanner } from './components/shared/CompanySuspendedBanner'
import { SetupWizard } from './components/onboarding/SetupWizard'
import { BrandingApplier } from './components/branding/BrandingApplier'
import { Toaster } from 'sonner'
import type { AppSection, Ruta } from './types'
import { sectionToPath, pathToSection } from './lib/routes'
import { sectionForPath, type SectionKey } from './components/condominios/sections'
import { fetchOpenConversationsCount } from './domain/comunicacion/conversations'
import { useAuth } from './hooks/useAuth'
import { useAguaData } from './hooks/useAguaData'
import { getResetToken, detectGmailOAuthCallback, handleGmailOAuthCallback } from './lib/gmailOAuth'
import { SessionProvider } from './components/shared/SessionContext'
import { PermissionsProvider } from './components/shared/PermissionsContext'
import { identify, registerSuperProperties, resetAnalytics } from './lib/analytics'
import { setMonitoringUser } from './lib/monitoring'
import { BrandLogo } from './components/shared/BrandLogo'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { Breadcrumbs } from './components/layout/Breadcrumbs'
import { usePermissions } from './hooks/usePermissions'
import { CommandPalette } from './components/shared/CommandPalette'
import { KeyboardShortcutsHelp } from './components/shared/KeyboardShortcutsHelp'
import { useRegisteredCommands } from './lib/commandRegistry'
import { useRecentItems } from './hooks/useRecentItems'
import { usePinnedItems } from './hooks/usePinnedItems'
import { buildNavCommands, NAV_COMMANDS } from './lib/navigationCommands'
import { useKeyboardShortcuts, type ShortcutBinding } from './hooks/useKeyboardShortcuts'
import {
  AcceptInvitationPage, CondominiosClientPortal, CustomerPortal, LandingPage,
  LegalPage, OAuthOnboardingScreen, PasswordResetModal, PasswordResetPage,
  RegisterScreen, SignupCompanyScreen, prefetchSection,
} from './components/app/lazySections'
import { AuthSplash, DualServicePortal, PresenceBar } from './components/app/shell'
import { APP_ROUTES, renderAppRoute, type AppRoutesCtx } from './components/app/routes'
import { MfaGate } from './components/auth/MfaGate'

// F3.13: ComponentShowcase dev route (/dev/components). `lazy()` va a nivel de
// módulo, no dentro del render: llamarlo en cada render crea un TIPO de componente
// nuevo cada vez, y React desmonta y remonta el árbol entero al cambiar el tipo.
const LazyShowcase = lazy(() =>
  import('./components/dev/ComponentShowcase').then(m => ({ default: m.ComponentShowcase })),
)

/** Rutas públicas que se resuelven ANTES del router y del gate de auth. */
const LEGAL_ROUTES: Record<string, 'privacy' | 'tos' | 'dpa'> = {
  '/politica-privacidad': 'privacy',
  '/terminos-servicio': 'tos',
  '/acuerdo-dpa-cookies': 'dpa',
}

/**
 * Raíz de la app. SOLO resuelve las tres rutas públicas sessionless y, si no
 * aplica ninguna, delega en `<AppShell/>`.
 *
 * POR QUÉ ESTÁ PARTIDO EN DOS (auditoría 2026-07-28, PR-33)
 * Antes esto era un único componente: los tres `return` de abajo vivían al
 * principio de `App()` y los ~31 hooks venían DESPUÉS. Eso viola las Rules of
 * Hooks — en esas rutas el componente renderizaba con 0 hooks y en el resto con
 * 31. No explotaba porque las tres rutas son terminales (se entra por carga
 * completa y no se navega desde ellas dentro de la app), pero bastaba con que
 * algo llamara a `navigate()` estando en una para que React viera 31 hooks donde
 * antes hubo 0 y lanzara "Rendered more hooks than during the previous render".
 *
 * Partirlo lo hace estructuralmente imposible: aquí no hay ningún hook, y
 * `AppShell` —que los tiene todos— o se monta entero o no se monta. El
 * comentario que había en el bloque de atajos afirmando que los hooks se llamaban
 * incondicionalmente ahora es cierto.
 */
export default function App() {
  if (typeof window !== 'undefined') {
    const { pathname, search } = window.location

    // Solo accesible si el usuario navega manualmente — no está en el sidebar.
    if (pathname === '/dev/components') {
      return (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Cargando…</div>}>
          <LazyShowcase />
        </Suspense>
      )
    }

    // T3/plat:P3 — landing de aceptación de invitación. Es sessionless: el
    // invitado todavía no tiene cuenta, así que se resuelve antes del gate de auth.
    if (pathname === '/aceptar-invitacion') {
      return (
        <Suspense fallback={<AuthSplash />}>
          <AcceptInvitationPage />
        </Suspense>
      )
    }

    // Suite legal pública (RGPD/CCPA + verificación de APIs de Google): páginas
    // 100% públicas e indexables, también sessionless.
    const legalDoc = LEGAL_ROUTES[pathname]
    if (legalDoc) {
      const legalLang = new URLSearchParams(search).get('lang') === 'en' ? 'en' : 'es'
      return (
        <Suspense fallback={<AuthSplash />}>
          <LegalPage doc={legalDoc} lang={legalLang} />
        </Suspense>
      )
    }
  }

  return <AppShell />
}

/**
 * La aplicación autenticada. Todos los hooks viven aquí y se ejecutan siempre:
 * este componente solo se monta cuando ninguna ruta pública aplicó.
 */
function AppShell() {
  const { currentUser, loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, oauthError, login, loginWithGoogle, logout, updateProfile, mfaChallenge, verifyMfaChallenge, cancelMfaChallenge } = useAuth()
  const { canViewModule, canCreate, canEdit, canChangeStatus, canApprove, canDelete } = usePermissions(currentUser)

  // agua:A1 — navegación basada en URL (react-router-dom v6). El sidebar/topbar
  // siguen hablando AppSection; aquí derivamos sección desde location y
  // mapeamos navegaciones a navigate(path).
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection: AppSection = pathToSection(location.pathname) ?? 'clientes'
  // Sección activa del Módulo Completo de Condominios (las 10 secciones viven en
  // el sidebar global). null cuando no estamos en una sección del módulo.
  const activeCondominiosSection: SectionKey | null = sectionForPath(location.pathname)
  const navigateSection = useCallback((section: AppSection) => {
    navigate(sectionToPath(section))
  }, [navigate])

  // T7 · agua:A4 — toda la capa de datos del módulo agua (queries TanStack +
  // callbacks optimistas sobre caché) vive en useAguaData (P1 #4).
  const agua = useAguaData(currentUser)

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

  const [rutaActivaParaLecturas, setRutaActivaParaLecturas] = useState<Ruta | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showSignupCompany, setShowSignupCompany] = useState(false)
  // P0 #10: enforcement de MFA por empresa. Se resetea al cambiar de usuario;
  // el MfaGate lo pone en true si ya hay factor verificado o tras enrolar.
  const [mfaSatisfied, setMfaSatisfied] = useState(false)
  useEffect(() => { setMfaSatisfied(false) }, [currentUser?.user_id])
  const [unreadComunicacion, setUnreadComunicacion] = useState(0)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  // Legacy: kept for backward compatibility with old reset links already sent
  const [resetToken] = useState<string | null>(getResetToken)

  // Handle Gmail OAuth callback when Google redirects back to the app.
  // `[]` es exhaustivo de verdad: las dos funciones son imports de módulo
  // (`lib/gmailOAuth`), no valores del render — de ahí que ya no lleve la
  // supresión de `exhaustive-deps` que tenía.
  useEffect(() => {
    const gmailParams = detectGmailOAuthCallback()
    if (gmailParams) {
      void handleGmailOAuthCallback(gmailParams)
    }
  }, [])

  const onEjecutarRuta = useCallback((ruta: Ruta) => {
    setRutaActivaParaLecturas(ruta)
    navigate(sectionToPath('lecturas'))
  }, [navigate])

  const clearRutaActiva = useCallback(() => setRutaActivaParaLecturas(null), [])

  // El badge cuenta lo mismo que el usuario puede abrir: para un rol no exento,
  // solo las conversaciones de sus proyectos (`agua.proyectos` ya viene acotado).
  const comunicacionProjectIds = useMemo(
    () => agua.projectScope.exempt ? undefined : agua.proyectos.map(p => p.id),
    [agua.projectScope, agua.proyectos],
  )

  const fetchUnreadComunicacion = useCallback(async () => {
    if (!currentUser?.company_id) return
    setUnreadComunicacion(await fetchOpenConversationsCount(currentUser.company_id, comunicacionProjectIds))
  }, [currentUser?.company_id, comunicacionProjectIds])

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

  // Límite de proyectos/unidades alcanzado: promptUpgrade dispatcha este
  // evento al elegir "Ampliar plan" → navegar a Empresa, donde
  // EmpresaProyectosSection abre el modal de ampliación (flag sessionStorage).
  useEffect(() => {
    const handler = () => navigate(sectionToPath('empresa_proyectos'))
    window.addEventListener(OPEN_AMPLIAR_EVENT, handler)
    return () => window.removeEventListener(OPEN_AMPLIAR_EVENT, handler)
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
          initialAuthError={oauthError}
        />
        {showPasswordReset && (
          <PasswordResetModal onClose={() => setShowPasswordReset(false)} />
        )}
      </Suspense>
    )
  }

  // P0 #10: si la empresa exige 2FA y el usuario aún no tiene un factor
  // verificado, bloqueá el shell hasta enrolar. El MfaGate satisface de
  // inmediato si ya hay factor (clientes no tienen company → mfa_required falsy).
  if (currentUser.mfa_required && !mfaSatisfied) {
    return <MfaGate onSatisfied={() => setMfaSatisfied(true)} onLogout={logout} />
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
  const hoy = hoyLocalISO()
  const rutasPendientes = agua.rutas.filter((r: Ruta) =>
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
    !agua.dataLoading &&
    activeSection.startsWith('condominios') &&
    agua.proyectos.filter(p => p.estado === 'activo').length === 0

  // F3.11 (P1 quick win): onboarding. Un company_owner/admin cuya empresa aún no
  // tiene proyectos ve el SetupWizard (crea el primero). Se evalúa SOLO tras
  // cargar los datos → nunca parpadea; empresas ya configuradas jamás lo ven.
  // Solo aplica a quien ve la empresa entera: para un admin acotado a sus
  // proyectos asignados, "no veo ninguno" no significa "la empresa no tiene".
  const necesitaOnboarding =
    !agua.dataLoading &&
    (currentUser.role === 'company_owner' || currentUser.role === 'admin') &&
    agua.projectScope.exempt &&
    !!currentUser.company_id &&
    agua.proyectos.length === 0

  // Contexto que consumen los renders del registro declarativo de rutas (P1 #4).
  const routesCtx: AppRoutesCtx = {
    currentUser,
    canViewModule, canCreate, canEdit, canChangeStatus, canApprove, canDelete,
    agua,
    condominiosSinProyecto,
    navigateSection,
    handleLogout,
    updateProfile,
    rutaActivaParaLecturas,
    clearRutaActiva,
    onEjecutarRuta,
  }

  // Authenticated app
  return (
    <SessionProvider value={currentUser}>
    <PermissionsProvider>
      {/* Toaster montado a nivel app: lib/toast emite mensajes non-blocking
          en la esquina superior derecha para success/warning/info no críticos.
          Confirmaciones destructivas usan shared/Dialog (confirm/notify). */}
      <Toaster richColors position="top-right" closeButton />

      {/* F3.11: onboarding — wizard de configuración inicial para empresas sin
          proyectos. autoOpen al montar; onComplete recarga el dominio agua para
          que la app muestre el proyecto recién creado y el wizard se desmonte. */}
      {necesitaOnboarding && (
        <SetupWizard currentUser={currentUser} autoOpen onComplete={agua.refrescarDatos} />
      )}

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

      {/* El CSS responsive del shell (.app-sidebar, etc.) vive ahora en
          src/styles/runtime.css (I24: CSP sin 'unsafe-inline' en style-src). */}
      <div data-context="admin" className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--at-bg)' }}>
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
        activeCondominiosSection={activeCondominiosSection}
        onSelect={(section) => { navigateSection(section); setSidebarOpen(false) }}
        onNavigatePath={(path) => { navigate(path); setSidebarOpen(false) }}
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
        <Topbar activeSection={activeSection} onMenuToggle={() => setSidebarOpen(prev => !prev)} onNavigate={navigateSection} sidebarOpen={sidebarOpen} />
        {/* T6/agua:B11 — breadcrumbs de navegación (Sección › Subsección), bajo el topbar. */}
        <Breadcrumbs activeSection={activeSection} onNavigate={navigateSection} />
        <PresenceBar activeSection={activeSection} />
        <TrialExpirationBanner companyId={currentUser.company_id ?? null} />
        {/* P0 #2: dunning — aviso de pago fallido + cuenta atrás a solo-lectura. */}
        <PastDueBanner companyId={currentUser.company_id ?? null} />
        {/* Ciclo de vida: aviso de empresa suspendida para sesiones ya abiertas. */}
        <CompanySuspendedBanner companyId={currentUser.company_id ?? null} />
        {/* plat:P20 — aplica el color de marca de la empresa a toda la app (efecto, no UI). */}
        <BrandingApplier companyId={currentUser.company_id ?? null} />
        <main className="app-main" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div style={{ width: 36, height: 36, border: '3px solid var(--at-line)', borderTop: '3px solid var(--at-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>}>
          <Routes>
            {APP_ROUTES.map(def => (
              <Route key={def.path} path={def.path} element={renderAppRoute(def, routesCtx)} />
            ))}
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
