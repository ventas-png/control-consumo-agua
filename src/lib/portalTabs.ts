// lib/portalTabs.ts — Tabs del portal de condominios y su visibilidad por rol
// del residente (portal propietario/inquilino). Módulo puro (sin React/Supabase)
// para que la regla de visibilidad sea testeable sin montar el portal.

export type PortalTab =
  | 'mi_unidad' | 'reservas' | 'cuenta' | 'tickets' | 'visitantes' | 'paquetes'
  | 'anuncios' | 'rentas' | 'mudanza' | 'asambleas' | 'transparencia'

export const PORTAL_TABS: { id: PortalTab; label: string; icon: string }[] = [
  { id: 'mi_unidad',     label: 'Mi Unidad',       icon: '🏠' },
  { id: 'reservas',      label: 'Reservas',        icon: '🏊' },
  { id: 'cuenta',        label: 'Mi Cuenta',       icon: '💳' },
  { id: 'tickets',       label: 'Mantenimiento',   icon: '🔧' },
  { id: 'visitantes',    label: 'Visitantes',      icon: '🚪' },
  { id: 'paquetes',      label: 'Paquetería',      icon: '📦' },
  { id: 'anuncios',      label: 'Anuncios',        icon: '📢' },
  { id: 'asambleas',     label: 'Asambleas',       icon: '🏛️' },
  { id: 'transparencia', label: 'Transparencia',   icon: '📊' },
  { id: 'rentas',        label: 'Rentas',          icon: '🏨' },
  { id: 'mudanza',       label: 'Mudanzas',        icon: '🚛' },
]

// Tabs OPERATIVOS: lo que un residente no-propietario puede hacer en la unidad.
// En 'cuenta' el RLS ya acota las cuotas al rol responsable (arrendatario/NULL),
// así que el tab es seguro para el inquilino. Lo que queda fuera es del dueño:
// rentas (autorización/contratos/STR), mudanza, asambleas (voto por unidad) y
// transparencia financiera.
const TABS_NO_PROPIETARIO: readonly PortalTab[] = [
  'mi_unidad', 'reservas', 'cuenta', 'tickets', 'visitantes', 'paquetes', 'anuncios',
]

/**
 * Tabs visibles para el rol del residente en la unidad seleccionada.
 * `rol` viene de portal_mis_unidades() ('propietario' | 'arrendatario' |
 * 'familiar' | 'otro'). Sin rol (dato legacy o degradado) se asume propietario:
 * los residentes existentes son dueños por backfill y un inquilino nuevo SIEMPRE
 * trae rol — y aunque viera un tab de más, el RLS no le proyecta datos ajenos.
 */
export function tabsForRol(rol: string | null | undefined): PortalTab[] {
  if (!rol || rol === 'propietario') return PORTAL_TABS.map(t => t.id)
  return [...TABS_NO_PROPIETARIO]
}
