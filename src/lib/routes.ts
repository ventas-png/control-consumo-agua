import type { AppSection } from '../types'

// agua:A1 — single source of truth for AppSection ↔ URL mapping.
// Sidebar/Topbar/NotificationBell/AdminClientDashboard/CondominiosDashboard
// still speak AppSection; App.tsx adapts that to navigate() using this table.

export const SECTION_TO_PATH: Record<AppSection, string> = {
  clientes: '/clientes',
  lecturas: '/lecturas',
  tabla: '/historial',
  dashboard: '/dashboard',
  admin_dashboard: '/admin-dashboard',
  cobros: '/cobros',
  mapa: '/mapa',
  rutas: '/rutas',
  tarifas: '/tarifas',
  unidades: '/unidades',
  contadores: '/contadores',
  calidad: '/calidad',
  configuracion: '/configuracion',
  perfil: '/perfil',
  empresa_proyectos: '/empresa',
  superadmin_empresas: '/superadmin',
  comunicacion: '/comunicacion',
  servicios_energia: '/energia',
  condominios: '/condominios',
  condominios_dashboard: '/condominios/panel',
  condominios_visitantes: '/condominios/visitantes',
  condominios_cuotas: '/condominios/cuotas',
  condominios_mantenimiento: '/condominios/mantenimiento',
  paquetes: '/paquetes',
}

const PATH_TO_SECTION: Record<string, AppSection> = Object.fromEntries(
  Object.entries(SECTION_TO_PATH).map(([k, v]) => [v, k as AppSection])
) as Record<string, AppSection>

export function sectionToPath(section: AppSection): string {
  return SECTION_TO_PATH[section]
}

// Returns null when no AppSection maps to the path (e.g. `/`, `/dev/components`).
// Callers default to 'clientes' when they need a non-null value for UI chrome.
export function pathToSection(pathname: string): AppSection | null {
  // Strip trailing slash so `/cobros/` resolves like `/cobros`.
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname
  if (PATH_TO_SECTION[normalized]) return PATH_TO_SECTION[normalized]
  // Longest-prefix fallback for future nested condominios routes (cond:A1).
  // `/condominios/cuotas/123` still highlights `condominios_cuotas` in sidebar.
  let best: AppSection | null = null
  let bestLen = 0
  for (const [path, section] of Object.entries(PATH_TO_SECTION)) {
    if ((normalized === path || normalized.startsWith(path + '/')) && path.length > bestLen) {
      best = section
      bestLen = path.length
    }
  }
  return best
}
