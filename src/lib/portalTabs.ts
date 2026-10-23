// lib/portalTabs.ts — Tabs del portal de condominios y su visibilidad: por rol
// del residente (portal propietario/inquilino) y por la configuración que la
// empresa guarda para cada condominio (projects.portal_tabs_ocultos). Módulo
// puro (sin React/Supabase) para que la regla de visibilidad sea testeable sin
// montar el portal.

export type PortalTab =
  | 'mi_unidad' | 'reservas' | 'cuenta' | 'tickets' | 'visitantes' | 'paquetes'
  | 'correspondencia'
  | 'anuncios' | 'rentas' | 'mudanza' | 'mascotas' | 'vehiculos' | 'asambleas' | 'transparencia'

export interface PortalTabDef {
  id: PortalTab
  label: string
  icon: string
  /** Qué encuentra el residente ahí (lo lee quien configura el portal). */
  descripcion: string
}

export const PORTAL_TABS: PortalTabDef[] = [
  { id: 'mi_unidad',     label: 'Mi Unidad',       icon: '🏠', descripcion: 'Datos de la unidad, accesos de su familia y mensajes a la administración.' },
  { id: 'reservas',      label: 'Reservas',        icon: '🏊', descripcion: 'Reservar amenidades y ver sus próximas reservas.' },
  { id: 'cuenta',        label: 'Mi Cuenta',       icon: '💳', descripcion: 'Cuotas, deuda pendiente, pago en línea y saldo a favor.' },
  { id: 'tickets',       label: 'Mantenimiento',   icon: '🔧', descripcion: 'Reportar fallas y seguir sus tickets de mantenimiento.' },
  { id: 'visitantes',    label: 'Visitantes',      icon: '🚪', descripcion: 'Pre-registrar visitas y ver quién llegó a su unidad.' },
  { id: 'paquetes',      label: 'Paquetería',      icon: '📦', descripcion: 'Paquetes que esperan en portería y lo que dejó para un tercero. Apagada, tampoco sale el aviso de paquetes al entrar.' },
  { id: 'correspondencia', label: 'Correspondencia', icon: '📬', descripcion: 'Cartas y documentos que llegaron a la unidad.' },
  { id: 'anuncios',      label: 'Anuncios',        icon: '📢', descripcion: 'Avisos de la administración y comunicados dirigidos a su unidad.' },
  { id: 'asambleas',     label: 'Asambleas',       icon: '🏛️', descripcion: 'Asambleas del condominio y voto por su unidad.' },
  { id: 'transparencia', label: 'Transparencia',   icon: '📊', descripcion: 'Presupuesto, gastos por categoría y fondo de reserva.' },
  { id: 'rentas',        label: 'Rentas',          icon: '🏨', descripcion: 'Solicitar autorización para rentar la unidad.' },
  { id: 'mudanza',       label: 'Mudanzas',        icon: '🚛', descripcion: 'Solicitar autorización de mudanza (entrada o salida).' },
  { id: 'mascotas',      label: 'Mascotas',        icon: '🐾', descripcion: 'Registrar las mascotas de la unidad.' },
  { id: 'vehiculos',     label: 'Vehículos',       icon: '🚗', descripcion: 'Registrar los vehículos de la unidad.' },
]

// Tabs OPERATIVOS: lo que un residente no-propietario puede hacer en la unidad.
// En 'cuenta' el RLS ya acota las cuotas al rol responsable (arrendatario/NULL),
// y 'mudanza' es relevante para el inquilino (entrada/salida de la unidad; su
// RLS ya lo cubre vía mis_unidades_ids — decisión de producto en 20260713080000).
// Lo que queda fuera es del dueño: rentas (autorización/contratos/STR),
// asambleas (voto por unidad) y transparencia financiera.
// 'correspondencia' entra aquí junto a 'paquetes': lo que llega a la unidad es
// del que la habita, y el RLS solo le proyecta las piezas de SU unidad (la
// dirigida a la administración no lleva unidad_id y nunca le llega).
// 'mascotas' y 'vehiculos' también: la mascota y el carro son de quien vive en
// la unidad. Las RPC de 20261031000500 dejan registrar a cualquier residente
// (mis_unidades_ids) y retirar/dar de baja a quien registró o al propietario.
const TABS_NO_PROPIETARIO: readonly PortalTab[] = [
  'mi_unidad', 'reservas', 'cuenta', 'tickets', 'visitantes', 'paquetes',
  'correspondencia', 'anuncios', 'mudanza', 'mascotas', 'vehiculos',
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

/** Tab que ve sólo el propietario (el inquilino/familiar no la tiene por rol). */
export function esTabSoloPropietario(id: PortalTab): boolean {
  return !TABS_NO_PROPIETARIO.includes(id)
}

// ── Configuración por condominio (projects.portal_tabs_ocultos, 20261106000000) ──

/**
 * Tabs que la empresa no puede apagar. 'mi_unidad' es la de aterrizaje y a la
 * que el portal vuelve cuando la activa deja de estar permitida: sin ella el
 * portal se quedaría sin destino.
 */
export const PORTAL_TABS_FIJOS: readonly PortalTab[] = ['mi_unidad']

/** Tabs que la empresa prende o apaga por condominio. Espejo del CHECK
 *  `projects_portal_tabs_ocultos_check`: la base rechaza cualquier otro id. */
export const PORTAL_TABS_CONFIGURABLES: readonly PortalTab[] =
  PORTAL_TABS.map(t => t.id).filter(id => !PORTAL_TABS_FIJOS.includes(id))

/**
 * Lo que llega de la base, saneado: sólo ids configurables, sin repetidos y en
 * el orden de PORTAL_TABS. Cualquier otra cosa (null, una columna que todavía
 * no existe, un id viejo) se lee como «no hay nada apagado»: el portal nunca
 * pierde pestañas por un dato que no entiende.
 */
export function normalizarTabsOcultos(raw: unknown): PortalTab[] {
  if (!Array.isArray(raw)) return []
  const pedidos = new Set(raw.filter((x): x is string => typeof x === 'string'))
  return PORTAL_TABS_CONFIGURABLES.filter(id => pedidos.has(id))
}

/**
 * Tabs del portal para el residente: las que su rol permite en la unidad y que
 * la empresa no apagó en ese condominio. 'mi_unidad' siempre está.
 */
export function tabsVisiblesPortal(
  rol: string | null | undefined,
  ocultos: readonly string[] | null | undefined,
): PortalTab[] {
  const apagados = new Set(normalizarTabsOcultos(ocultos))
  return tabsForRol(rol).filter(id => !apagados.has(id))
}
