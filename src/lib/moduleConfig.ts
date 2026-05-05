import type { AguaRole, ModulePermission, UserRole } from '../types'

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

/** Permisos de módulos de agua por agua_role (usados al crear/cambiar rol de agua). */
export const AGUA_ROLE_PERMISSIONS: Record<AguaRole, Pick<ModulePermission, 'can_view' | 'can_create' | 'can_edit' | 'can_change_status'>> = {
  admin:     { can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
  operator:  { can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
  collector: { can_view: true,  can_create: true,  can_edit: false, can_change_status: true },
  viewer:    { can_view: true,  can_create: false, can_edit: false, can_change_status: false },
}

/** Keys de módulos agrupados por línea de servicio (usados en Sidebar y modal de permisos). */
export const WATER_MODULE_KEYS = new Set([
  'dashboard', 'lecturas', 'cobros', 'rutas', 'calidad',
  'mapa', 'tabla', 'contadores', 'tarifas', 'servicios_energia',
])
export const CONDOMINIOS_MODULE_KEYS = new Set(['condominios'])

/** Módulos que no son configurables (siempre visibles para su rol). */
export const NON_CONFIGURABLE_MODULES = ['perfil', 'admin_dashboard', 'empresa_proyectos', 'superadmin_empresas'] as const

/** Roles que siempre tienen acceso total (bypass del sistema de permisos). */
export const EXEMPT_ROLES: readonly UserRole[] = ['super_admin', 'company_owner', 'cliente'] as const

/**
 * Templates de permisos por defecto para cada rol configurable.
 * Se usa en la UI de "Restaurar Predeterminados" y al crear usuarios.
 * Debe estar sincronizado con la función SQL populate_default_module_permissions().
 */
export const ROLE_DEFAULT_TEMPLATES: Record<string, ModulePermission[]> = {
  admin: [
    { module_key: 'clientes',          can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'lecturas',          can_view: true,  can_create: true,  can_edit: false, can_change_status: false },
    { module_key: 'tabla',             can_view: true,  can_create: false, can_edit: true,  can_change_status: true },
    { module_key: 'dashboard',         can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'cobros',            can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'mapa',              can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'calidad',           can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'rutas',             can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'tarifas',           can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'unidades',          can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'contadores',        can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'servicios_energia', can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'configuracion',     can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'comunicacion',      can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'condominios',       can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
  ],
  operator: [
    { module_key: 'clientes',          can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'lecturas',          can_view: true,  can_create: true,  can_edit: false, can_change_status: false },
    { module_key: 'tabla',             can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'dashboard',         can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'mapa',              can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'calidad',           can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'rutas',             can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'contadores',        can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'servicios_energia', can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'comunicacion',      can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'condominios',       can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
  ],
  viewer: [
    { module_key: 'tabla',           can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'dashboard',       can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'mapa',            can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'servicios_energia', can_view: true, can_create: false, can_edit: false, can_change_status: false },
  ],
  collector: [
    { module_key: 'cobros',          can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'comunicacion',    can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
  ],
}
