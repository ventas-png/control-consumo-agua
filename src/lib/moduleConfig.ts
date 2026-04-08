import type { ModulePermission, UserRole } from '../types'

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
  { key: 'clientes',       label: 'Clientes',        actions: ['view', 'create', 'edit', 'change_status'] },
  { key: 'lecturas',       label: 'Nueva Lectura',   actions: ['view', 'create'] },
  { key: 'tabla',           label: 'Historial',       actions: ['view', 'edit', 'change_status'] },
  { key: 'dashboard',       label: 'Dashboard',       actions: ['view'] },
  { key: 'cobros',          label: 'Cobros',          actions: ['view', 'create', 'edit', 'change_status'] },
  { key: 'mapa',            label: 'Mapa',            actions: ['view'] },
  { key: 'calidad',         label: 'Calidad Agua',    actions: ['view', 'create', 'edit'] },
  { key: 'rutas',           label: 'Rutas',           actions: ['view', 'create', 'edit'] },
  { key: 'tarifas',         label: 'Tarifas',         actions: ['view', 'create', 'edit'] },
  { key: 'unidades',        label: 'Unidades',        actions: ['view', 'create', 'edit'] },
  { key: 'contadores',      label: 'Contadores',      actions: ['view', 'create', 'edit'] },
  { key: 'configuracion',   label: 'Configuración',   actions: ['view', 'edit'] },
  { key: 'comunicacion',    label: 'Comunicación',    actions: ['view', 'create', 'edit'] },
] as const

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
    { module_key: 'clientes',       can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'lecturas',       can_view: true,  can_create: true,  can_edit: false, can_change_status: false },
    { module_key: 'tabla',           can_view: true,  can_create: false, can_edit: true,  can_change_status: true },
    { module_key: 'dashboard',       can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'cobros',          can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'mapa',            can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'calidad',         can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'rutas',           can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'tarifas',         can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'unidades',        can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'contadores',      can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'configuracion',   can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'comunicacion',    can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
  ],
  operator: [
    { module_key: 'clientes',       can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'lecturas',       can_view: true,  can_create: true,  can_edit: false, can_change_status: false },
    { module_key: 'tabla',           can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'dashboard',       can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'mapa',            can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'calidad',         can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
    { module_key: 'rutas',           can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'contadores',      can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
    { module_key: 'comunicacion',    can_view: true,  can_create: false, can_edit: true,  can_change_status: false },
  ],
  viewer: [
    { module_key: 'tabla',           can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'dashboard',       can_view: true,  can_create: false, can_edit: false, can_change_status: false },
    { module_key: 'mapa',            can_view: true,  can_create: false, can_edit: false, can_change_status: false },
  ],
  collector: [
    { module_key: 'cobros',          can_view: true,  can_create: true,  can_edit: true,  can_change_status: true },
    { module_key: 'comunicacion',    can_view: true,  can_create: true,  can_edit: true,  can_change_status: false },
  ],
}
