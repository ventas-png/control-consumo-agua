import type { AppSection, UserSession } from '../types'
import type { CommandItem } from '../components/shared/CommandPalette'

// ============================================================================
// navigationCommands — Items del CommandPalette para navegacion top-level.
// ============================================================================
// Mapea cada AppSection a un CommandItem con label, icono y atajo opcional.
// Se filtra por permisos (canViewModule + RoleGuard equivalentes) antes de
// pasar al palette para no mostrar lo que el usuario no puede abrir.
//
// El `shortcut` aqui es solo informativo (se muestra en el item del palette
// y en el modal de ayuda `?`). El binding real esta en App.tsx via el hook
// useKeyboardShortcuts.

export interface NavCommandDef {
  id: AppSection
  label: string
  icon?: string
  category: string
  /** Atajo vim-style (ej: 'g c') — solo para los mas frecuentes. */
  shortcut?: string
  /** Roles que pueden ver (alguno del array). Vacio = todos. */
  roles?: UserSession['role'][]
  /** Modulo para chequeo via canViewModule. */
  module?: string
}

export const NAV_COMMANDS: NavCommandDef[] = [
  // ── Agua ──
  { id: 'clientes',         label: 'Clientes',           icon: '👥', category: 'Agua',         shortcut: 'g c', module: 'clientes' },
  { id: 'lecturas',         label: 'Lecturas',           icon: '📊', category: 'Agua',         shortcut: 'g l', module: 'lecturas' },
  { id: 'tabla',            label: 'Historial',          icon: '📋', category: 'Agua',         shortcut: 'g h', module: 'tabla' },
  { id: 'cobros',           label: 'Cobros',             icon: '💰', category: 'Agua',         shortcut: 'g b', roles: ['collector', 'admin', 'super_admin', 'company_owner'] },
  { id: 'mapa',             label: 'Mapa',               icon: '🗺',  category: 'Agua',         shortcut: 'g m', module: 'mapa' },
  { id: 'rutas',            label: 'Rutas',              icon: '🛣',  category: 'Agua',         shortcut: 'g r', module: 'rutas' },
  { id: 'calidad',          label: 'Calidad del agua',   icon: '💧', category: 'Agua',                          module: 'calidad' },
  { id: 'contadores',       label: 'Contadores',         icon: '🔢', category: 'Agua',                          module: 'contadores' },
  { id: 'tarifas',          label: 'Tarifas',            icon: '💲', category: 'Agua',                          module: 'tarifas' },
  { id: 'unidades',         label: 'Unidades',           icon: '🏠', category: 'Agua',                          module: 'unidades' },

  // ── Dashboards ──
  { id: 'dashboard',        label: 'Dashboard',          icon: '📈', category: 'Dashboards',   shortcut: 'g d', module: 'dashboard' },
  { id: 'admin_dashboard',  label: 'Admin Dashboard',    icon: '📊', category: 'Dashboards',   shortcut: 'g a', roles: ['company_owner'] },

  // ── Operaciones ──
  { id: 'condominios',      label: 'Condominios',        icon: '🏢', category: 'Operaciones',  shortcut: 'g o' },
  { id: 'comunicacion',     label: 'Comunicación',       icon: '💬', category: 'Operaciones',                   module: 'comunicacion' },
  { id: 'servicios_energia',label: 'Energía',            icon: '⚡', category: 'Operaciones',                   module: 'servicios_energia' },

  // ── Cuenta ──
  { id: 'empresa_proyectos',label: 'Mis Proyectos',      icon: '📁', category: 'Cuenta',       shortcut: 'g p', roles: ['company_owner'] },
  { id: 'configuracion',    label: 'Configuración',      icon: '⚙️',  category: 'Cuenta',       shortcut: 'g s', roles: ['admin', 'super_admin', 'company_owner'] },
  { id: 'perfil',           label: 'Mi cuenta',          icon: '👤', category: 'Cuenta',       shortcut: 'g u' },
  { id: 'superadmin_empresas', label: 'Empresas (admin)', icon: '🏛',  category: 'Cuenta',                       roles: ['super_admin'] },
]

/**
 * Construye los CommandItems para el palette respetando permisos.
 * - role-gate via NavCommandDef.roles
 * - module-gate via canViewModule (pasado por el caller para no acoplar a
 *   ningun hook especifico — App.tsx ya tiene usePermissions().canViewModule)
 */
export function buildNavCommands(
  currentUser: UserSession,
  canViewModule: (module: string) => boolean,
  navigateSection: (section: AppSection) => void,
): CommandItem[] {
  const out: CommandItem[] = []
  for (const def of NAV_COMMANDS) {
    if (def.roles && def.roles.length > 0 && !def.roles.includes(currentUser.role)) continue
    if (def.module && !canViewModule(def.module)) continue
    out.push({
      id: `nav:${def.id}`,
      label: def.label,
      icon: def.icon,
      group: def.category,
      keywords: def.shortcut,
      onSelect: () => navigateSection(def.id),
    })
  }
  return out
}
