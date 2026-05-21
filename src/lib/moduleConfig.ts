import type { UserRole } from '../types'

export type ModuleAction = 'view' | 'create' | 'edit' | 'change_status'

export interface ModuleDefinition {
  key: string
  label: string
  actions: readonly ModuleAction[]
}

/**
 * Módulos de negocio configurables.
 * NO incluye: perfil, admin_dashboard, empresa_proyectos, superadmin_empresas
 * (esos se controlan solo por rol, no son configurables).
 */
export const CONFIGURABLE_MODULES: readonly ModuleDefinition[] = [
  { key: 'clientes',          label: 'Clientes',           actions: ['view', 'create', 'edit', 'change_status'] },
  { key: 'lecturas',          label: 'Nueva Lectura',      actions: ['view', 'create'] },
  { key: 'tabla',             label: 'Historial',          actions: ['view', 'edit', 'change_status'] },
  { key: 'dashboard',         label: 'Dashboard',          actions: ['view'] },
  { key: 'cobros',            label: 'Cobros',             actions: ['view', 'create', 'edit', 'change_status'] },
  { key: 'mapa',              label: 'Mapa',               actions: ['view'] },
  { key: 'calidad',           label: 'Calidad Agua',       actions: ['view', 'create', 'edit'] },
  { key: 'rutas',             label: 'Rutas',              actions: ['view', 'create', 'edit'] },
  { key: 'tarifas',           label: 'Tarifas',            actions: ['view', 'create', 'edit'] },
  { key: 'unidades',          label: 'Unidades',           actions: ['view', 'create', 'edit'] },
  { key: 'contadores',        label: 'Contadores',         actions: ['view', 'create', 'edit'] },
  { key: 'servicios_energia', label: 'Servicio Energético',actions: ['view', 'create', 'edit', 'change_status'] },
  { key: 'configuracion',     label: 'Configuración',      actions: ['view', 'edit'] },
  { key: 'comunicacion',      label: 'Comunicación',       actions: ['view', 'create', 'edit'] },
  { key: 'condominios',       label: 'Condominios',        actions: ['view', 'create', 'edit', 'change_status'] },
] as const

/** Keys de módulos agrupados por línea de servicio (usados en Sidebar y modal de permisos). */
export const WATER_MODULE_KEYS = new Set([
  'dashboard', 'lecturas', 'cobros', 'rutas', 'calidad',
  'mapa', 'tabla', 'contadores', 'tarifas', 'servicios_energia',
])
export const CONDOMINIOS_MODULE_KEYS = new Set(['condominios', 'condominios_dashboard', 'condominios_visitantes', 'condominios_cuotas', 'condominios_mantenimiento'])

/** Módulos que no son configurables (siempre visibles para su rol). */
export const NON_CONFIGURABLE_MODULES = ['perfil', 'admin_dashboard', 'empresa_proyectos', 'superadmin_empresas'] as const

/**
 * Roles que siempre tienen acceso total (bypass del sistema de permisos).
 * Debe coincidir con los roles exentos en la BD (user_has_permission:
 * super_admin / company_owner / admin) y con EXEMPT_PLATFORM_ROLES en
 * permissions.ts. 'cliente' se mantiene porque el portal del residente no
 * pasa por el sidebar de módulos del personal.
 */
export const EXEMPT_ROLES: readonly UserRole[] = ['super_admin', 'company_owner', 'admin', 'cliente'] as const
