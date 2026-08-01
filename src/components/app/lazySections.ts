// Declaraciones lazy del shell de la app (P1 #4, extraídas de App.tsx).
// Mantiene la estrategia de chunks: auth/portales con lazy plano (no entran al
// bundle autenticado) y secciones navegables con lazyWithPreload para el
// prefetch on-hover del Sidebar.
import type { AppSection } from '../../types'
import { lazySafe as lazy, lazyWithPreload } from '../../lib/lazyWithPreload'

// Auth + landing flow — lazy para que NO entre al bundle principal de la app
// autenticada (donde el ~99% del tiempo de uso ocurre). En primer load el
// usuario sin sesion paga el coste de descargar Landing/Register/etc, pero
// el usuario autenticado nunca los carga.
export const LandingPage = lazy(() => import('../landing/LandingPage').then(m => ({ default: m.LandingPage })))
export const PasswordResetModal = lazy(() => import('../auth/PasswordResetModal').then(m => ({ default: m.PasswordResetModal })))
export const PasswordResetPage = lazy(() => import('../auth/PasswordResetPage').then(m => ({ default: m.PasswordResetPage })))
export const RegisterScreen = lazy(() => import('../auth/RegisterScreen').then(m => ({ default: m.RegisterScreen })))
export const SignupCompanyScreen = lazy(() => import('../auth/SignupCompanyScreen').then(m => ({ default: m.SignupCompanyScreen })))
export const OAuthOnboardingScreen = lazy(() => import('../auth/OAuthOnboardingScreen'))
// T3/plat:P3 — landing pública de aceptación de invitación (/aceptar-invitacion).
export const AcceptInvitationPage = lazy(() => import('../onboarding/AcceptInvitationPage').then(m => ({ default: m.AcceptInvitationPage })))
// Suite legal pública e indexable (/politica-privacidad, /terminos-servicio,
// /acuerdo-dpa-cookies). Sessionless — se resuelve con early-return antes del gate
// de auth, igual que /aceptar-invitacion. Lazy para no entrar al bundle autenticado.
export const LegalPage = lazy(() => import('../legal/LegalPage'))

// Cliente-role portals — solo se cargan para usuarios con role='cliente'.
// La inmensa mayoria son admins/staff que nunca tocan estos componentes.
export const CustomerPortal = lazy(() => import('../portal/CustomerPortal').then(m => ({ default: m.CustomerPortal })))
export const CondominiosClientPortal = lazy(() => import('../portal/CondominiosClientPortal').then(m => ({ default: m.CondominiosClientPortal })))

// agua:A8 — secciones navegables vía sidebar usan lazyWithPreload para poder
// prefetch del chunk al hacer hover/focus sobre su item (ver SECTION_PRELOADERS).
export const ClientesSection = lazyWithPreload(() => import('../clientes/ClientesSection').then(m => ({ default: m.ClientesSection })))
export const LecturasSection = lazyWithPreload(() => import('../lecturas/LecturasSection').then(m => ({ default: m.LecturasSection })))
export const HistorialSection = lazyWithPreload(() => import('../historial/HistorialSection').then(m => ({ default: m.HistorialSection })))
export const DashboardSection = lazyWithPreload(() => import('../dashboard/DashboardSection').then(m => ({ default: m.DashboardSection })))
export const AdminClientDashboard = lazyWithPreload(() => import('../admin-dashboard/AdminClientDashboard').then(m => ({ default: m.AdminClientDashboard })))
export const MapaSection = lazyWithPreload(() => import('../mapa/MapaSection').then(m => ({ default: m.MapaSection })))
export const CalidadSection = lazyWithPreload(() => import('../calidad/CalidadSection').then(m => ({ default: m.CalidadSection })))
export const RutasSection = lazyWithPreload(() => import('../rutas/RutasSection').then(m => ({ default: m.RutasSection })))
export const ConfiguracionSection = lazyWithPreload(() => import('../configuracion/ConfiguracionSection').then(m => ({ default: m.ConfiguracionSection })))
export const PerfilSection = lazyWithPreload(() => import('../perfil/PerfilSection').then(m => ({ default: m.PerfilSection })))
export const EmpresaSection = lazyWithPreload(() => import('../empresa/EmpresaSection').then(m => ({ default: m.EmpresaSection })))
export const SuperAdminSection = lazyWithPreload(() => import('../superadmin/SuperAdminSection').then(m => ({ default: m.SuperAdminSection })))
export const TarifasSection = lazyWithPreload(() => import('../tarifas/TarifasSection').then(m => ({ default: m.TarifasSection })))
export const ContadoresSection = lazyWithPreload(() => import('../contadores/ContadoresSection').then(m => ({ default: m.ContadoresSection })))
export const UnidadesSection = lazyWithPreload(() => import('../unidades/UnidadesSection').then(m => ({ default: m.UnidadesSection })))
export const CobrosSection = lazyWithPreload(() => import('../cobros/CobrosSection').then(m => ({ default: m.CobrosSection })))
export const ComunicacionSection = lazyWithPreload(() => import('../comunicacion/ComunicacionSection').then(m => ({ default: m.ComunicacionSection })))
export const ServiciosEnergiaSection = lazyWithPreload(() => import('../servicios-energia/ServiciosEnergiaSection'))
export const CondominiosSection = lazyWithPreload(() => import('../condominios/CondominiosSection').then(m => ({ default: m.CondominiosSection })))
export const CondominiosDashboard = lazyWithPreload(() => import('../condominios/CondominiosDashboard').then(m => ({ default: m.CondominiosDashboard })))
export const ContabilidadSection = lazyWithPreload(() => import('../contabilidad/ContabilidadSection').then(m => ({ default: m.ContabilidadSection })))

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
  contabilidad: () => { ContabilidadSection.preload() },
}

export function prefetchSection(section: AppSection): void {
  SECTION_PRELOADERS[section]?.()
}
