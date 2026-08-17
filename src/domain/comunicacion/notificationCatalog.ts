// domain/comunicacion/notificationCatalog.ts — clasificación del feed de la
// campana.
//
// La campana enseñaba una lista plana: veinte filas iguales en las que había
// que leer cada título para saber si lo nuevo era un mensaje, un comunicado o
// una solicitud. Este módulo pone nombre a los `tipo` que producen los
// triggers/edges y los agrupa, para que la campana pueda decir "3 mensajes ·
// 2 difusiones · 1 solicitud" antes de que nadie lea nada.
//
// Es TS puro (sin imports de supabase) para poder probarlo sin arrastrar el
// cliente, igual que notificationBellPos.
import type { AppSection, UserNotification } from '../../types'
import { SECTION_TO_PATH } from '../../lib/routes'

export type NotificationGroup =
  | 'mensajes'
  | 'difusiones'
  | 'solicitudes'
  | 'reservas'
  | 'paquetes'
  | 'cobros'
  | 'operacion'
  | 'cuenta'
  | 'otros'

export interface GroupMeta {
  /** Etiqueta en plural para el resumen ("3 mensajes"). */
  label: string
  /** Singular, para cuando el conteo es 1 ("1 mensaje"). */
  labelSingular: string
  icon: string
  /** Orden en el resumen: lo conversacional primero, el ruido al final. */
  order: number
}

export const GROUP_META: Record<NotificationGroup, GroupMeta> = {
  mensajes:    { label: 'mensajes',    labelSingular: 'mensaje',    icon: '💬', order: 0 },
  difusiones:  { label: 'difusiones',  labelSingular: 'difusión',   icon: '📢', order: 1 },
  solicitudes: { label: 'solicitudes', labelSingular: 'solicitud',  icon: '📥', order: 2 },
  reservas:    { label: 'reservas',    labelSingular: 'reserva',    icon: '🏊', order: 3 },
  paquetes:    { label: 'paquetes',    labelSingular: 'paquete',    icon: '📦', order: 4 },
  cobros:      { label: 'cobros',      labelSingular: 'cobro',      icon: '💰', order: 5 },
  operacion:   { label: 'operación',   labelSingular: 'operación',  icon: '🛠️', order: 6 },
  cuenta:      { label: 'cuenta',      labelSingular: 'cuenta',     icon: '🔐', order: 7 },
  otros:       { label: 'avisos',      labelSingular: 'aviso',      icon: '🔔', order: 8 },
}

// `tipo` exactos que emiten los productores. Los que no estén aquí caen en
// `otros` vía los prefijos de abajo o, en último término, por defecto: un tipo
// nuevo nunca debe hacer desaparecer la fila de la campana.
const TIPO_TO_GROUP: Record<string, NotificationGroup> = {
  mensaje: 'mensajes',
  difusion: 'difusiones',
  anuncio: 'difusiones',
  solicitud: 'solicitudes',
  reserva: 'reservas',
  seguridad: 'cuenta',
  ruta_recordatorio: 'operacion',
  cierre_ciclo_automatico: 'operacion',
  alerta_notificaciones: 'operacion',
}

// Familias con varios tipos (`paquete_pendiente`, `paquete_retirado`, …). Se
// consultan por prefijo para no tener que listar cada variante nueva.
const PREFIX_TO_GROUP: ReadonlyArray<[string, NotificationGroup]> = [
  ['paquete_', 'paquetes'],
  ['cuota_', 'cobros'],
  ['recibo_', 'cobros'],
]

/** Grupo al que pertenece un `tipo`. Nunca lanza: lo desconocido es 'otros'. */
export function groupOf(tipo: string | null | undefined): NotificationGroup {
  const t = (tipo ?? '').trim()
  // `hasOwnProperty` y no un truthy check directo: `tipo` es texto libre en la
  // BD y `TIPO_TO_GROUP['constructor']` devolvería una función por prototipo.
  if (Object.prototype.hasOwnProperty.call(TIPO_TO_GROUP, t)) return TIPO_TO_GROUP[t]
  for (const [prefix, group] of PREFIX_TO_GROUP) {
    if (t.startsWith(prefix)) return group
  }
  return 'otros'
}

export interface GroupCount {
  group: NotificationGroup
  meta: GroupMeta
  /** No leídas del grupo — es lo que se enseña en el resumen. */
  unread: number
  /** Total del grupo (leídas incluidas) — gobierna si el filtro existe. */
  total: number
}

/**
 * Conteos por grupo, ordenados por `GROUP_META.order`. Sólo devuelve grupos con
 * al menos una notificación: un grupo vacío no es información, es ruido.
 */
export function groupCounts(items: readonly UserNotification[]): GroupCount[] {
  const acc = new Map<NotificationGroup, { unread: number; total: number }>()
  for (const n of items) {
    const g = groupOf(n.tipo)
    const cur = acc.get(g) ?? { unread: 0, total: 0 }
    cur.total += 1
    if (!n.leido) cur.unread += 1
    acc.set(g, cur)
  }
  return [...acc.entries()]
    .map(([group, c]) => ({ group, meta: GROUP_META[group], unread: c.unread, total: c.total }))
    .sort((a, b) => a.meta.order - b.meta.order)
}

/**
 * Resumen textual de lo NO leído: "3 mensajes · 1 difusión". Cadena vacía si no
 * hay nada sin leer, para que la campana sepa no pintar la línea.
 */
export function resumenNoLeidas(items: readonly UserNotification[]): string {
  return groupCounts(items)
    .filter(c => c.unread > 0)
    .map(c => `${c.unread} ${c.unread === 1 ? c.meta.labelSingular : c.meta.label}`)
    .join(' · ')
}

/**
 * `seccion` viene de la BD como texto libre: los productores escriben destinos
 * que no siempre son un AppSection ('anuncios' lo es del portal del residente,
 * no de la app de staff). Sin este filtro, `sectionToPath` devolvía `undefined`
 * y la campana llamaba a `navigate(undefined)`.
 */
export function toAppSection(seccion: string | null | undefined): AppSection | null {
  if (!seccion) return null
  // `hasOwnProperty` y no `in`: con `in`, 'constructor' o 'toString' pasarían el
  // filtro por la cadena de prototipos y volveríamos a navegar a undefined.
  return Object.prototype.hasOwnProperty.call(SECTION_TO_PATH, seccion)
    ? (seccion as AppSection)
    : null
}
