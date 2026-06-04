import type { AppSection } from '../../types'

// agua:B11 — registry de navegación para los breadcrumbs (T6 · UX).
//
// Fuente única de la jerarquía Sección › Subsección que consume <Breadcrumbs>.
// Espeja la estructura de grupos/tabs del Sidebar (`NAV` en Sidebar.tsx): cada
// AppSection pertenece (o no) a un grupo de 1er nivel. El breadcrumb deriva el
// trail desde aquí, así no se duplican literales sueltos por la app y el
// crumb refleja fielmente el árbol del menú.
//
// Diseño:
//   - `groupId`/`groupLabel`: presentes cuando la sección vive dentro de un
//     grupo del sidebar (ej. "Manejo Agua"). El crumb del grupo es navegable y
//     lleva a la sección "ancla" del grupo (`anchor`).
//   - secciones standalone (Empresas, Config. del sistema) no tienen grupo: su
//     breadcrumb es de un solo nivel.

export interface NavGroupMeta {
  id: string
  label: string
  /** Sección a la que navega el crumb del grupo (1ª/representativa del grupo). */
  anchor: AppSection
}

export interface SectionCrumbMeta {
  /** Etiqueta corta de la sección (coincide con el item del sidebar). */
  label: string
  /** Grupo de 1er nivel al que pertenece, si aplica. */
  group?: NavGroupMeta
}

// Grupos de 1er nivel (mismos labels que las cabeceras del Sidebar).
const GROUP_PLATAFORMA: NavGroupMeta = { id: 'plataforma', label: 'Administración Plataforma', anchor: 'clientes' }
const GROUP_AGUA: NavGroupMeta = { id: 'agua', label: 'Manejo Agua', anchor: 'dashboard' }
const GROUP_SERVICIOS: NavGroupMeta = { id: 'servicios', label: 'Servicios', anchor: 'servicios_energia' }
const GROUP_CONDOMINIOS: NavGroupMeta = { id: 'condominios_grp', label: 'Manejo Condominios', anchor: 'condominios_dashboard' }

// Mapa AppSection → metadatos de breadcrumb. Las etiquetas de sección espejan
// las del Sidebar para que el crumb diga lo mismo que el menú.
export const SECTION_CRUMBS: Record<AppSection, SectionCrumbMeta> = {
  // ── Administración Plataforma ──
  empresa_proyectos: { label: 'Mis Proyectos', group: GROUP_PLATAFORMA },
  clientes: { label: 'Clientes', group: GROUP_PLATAFORMA },
  unidades: { label: 'Unidades', group: GROUP_PLATAFORMA },
  perfil: { label: 'Mi Cuenta', group: GROUP_PLATAFORMA },

  // ── Manejo Agua ──
  admin_dashboard: { label: 'Dashboard', group: GROUP_AGUA },
  dashboard: { label: 'Dashboard', group: GROUP_AGUA },
  comunicacion: { label: 'Comunicación', group: GROUP_AGUA },
  contadores: { label: 'Contadores', group: GROUP_AGUA },
  tarifas: { label: 'Tarifas', group: GROUP_AGUA },
  cobros: { label: 'Cobros', group: GROUP_AGUA },
  lecturas: { label: 'Nueva Lectura', group: GROUP_AGUA },
  rutas: { label: 'Rutas', group: GROUP_AGUA },
  calidad: { label: 'Calidad Agua', group: GROUP_AGUA },
  mapa: { label: 'Mapa', group: GROUP_AGUA },
  tabla: { label: 'Historial', group: GROUP_AGUA },

  // ── Servicios ──
  servicios_energia: { label: 'Energía', group: GROUP_SERVICIOS },

  // ── Manejo Condominios ──
  condominios_dashboard: { label: 'Panel', group: GROUP_CONDOMINIOS },
  condominios_visitantes: { label: 'Visitantes', group: GROUP_CONDOMINIOS },
  condominios_cuotas: { label: 'Cuotas', group: GROUP_CONDOMINIOS },
  condominios_mantenimiento: { label: 'Mantenimiento', group: GROUP_CONDOMINIOS },
  condominios: { label: 'Módulo Completo', group: GROUP_CONDOMINIOS },
  paquetes: { label: 'Paquetería', group: GROUP_CONDOMINIOS },

  // ── Standalone (sin grupo) ──
  superadmin_empresas: { label: 'Empresas' },
  configuracion: { label: 'Config. del sistema' },
}

export interface Crumb {
  /** Texto visible del nivel. */
  label: string
  /**
   * Destino de navegación al hacer click. `undefined` en el último nivel
   * (página actual, no navegable — recibe aria-current="page").
   */
  target?: AppSection
}

/**
 * Construye el trail de breadcrumbs para la sección activa.
 *
 * - Sección con grupo → `[Grupo (→ ancla), Sección (actual)]`.
 * - Sección standalone → `[Sección (actual)]`.
 *
 * El último crumb nunca lleva `target` (es la página actual). El crumb del
 * grupo apunta a su sección ancla para "subir de nivel" sin recarga.
 */
export function buildBreadcrumbs(activeSection: AppSection): Crumb[] {
  const meta = SECTION_CRUMBS[activeSection]
  const crumbs: Crumb[] = []
  if (meta.group) {
    // El crumb de grupo navega a su ancla. Si la sección activa YA es la ancla
    // (p. ej. estás en "Dashboard", ancla de "Manejo Agua"), se omite el target
    // para no enlazar a la página actual — queda como rótulo del nivel superior.
    const anchor = meta.group.anchor
    crumbs.push({
      label: meta.group.label,
      target: anchor === activeSection ? undefined : anchor,
    })
  }
  crumbs.push({ label: meta.label })
  return crumbs
}
