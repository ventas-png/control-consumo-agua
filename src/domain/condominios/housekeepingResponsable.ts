// domain/condominios/housekeepingResponsable.ts — el responsable de un servicio de
// housekeeping es un USUARIO elegible del proyecto (20261030000100), no un texto.
//
// Quién es elegible lo decide la base (hk_responsable_elegible: habilitado, de la
// empresa, con acceso al proyecto y con el módulo) y lo valida un trigger en cada
// INSERT/UPDATE. Este módulo solo pide el catálogo (RPC hk_responsables_elegibles,
// que exige al llamador el mismo acceso que para escribir el servicio) y deriva lo
// que la pantalla muestra. Filtrar el selector aquí NO sustituye a la base: una
// petición directa con otro id la rechaza el trigger con HK_RESPONSABLE_NO_ELEGIBLE.
import { supabase } from '../../lib/supabase'
import type { AppUser } from '../usuarios/queries'
import type { ServicioHousekeeping } from '../../types'

/** Prefijo con el que la base rechaza un responsable no elegible (ERRCODE 23514). */
export const ERROR_RESPONSABLE_NO_ELEGIBLE = 'HK_RESPONSABLE_NO_ELEGIBLE'

/**
 * Catálogo de responsables elegibles para un proyecto. Un error significa que el
 * llamador no puede asignar en ese proyecto (42501) o que no hay red: se devuelve
 * para que la pantalla lo diga en vez de ofrecer una lista vacía como si nadie
 * fuera elegible.
 */
export async function fetchResponsablesElegibles(projectId: string): Promise<{ data: AppUser[]; error: string | null }> {
  const { data, error } = await supabase.rpc('hk_responsables_elegibles', { p_project_id: projectId })
  if (error) return { data: [], error: error.message }
  return { data: (data as AppUser[] | null) ?? [], error: null }
}

export type EstadoResponsable =
  /** Vinculado a un usuario que sigue siendo elegible. */
  | { kind: 'vinculado'; userId: string }
  /** Vinculado a un usuario que ya no es elegible (acceso revocado, deshabilitado…). */
  | { kind: 'requiere_reasignacion'; userId: string }
  /** Solo tiene el texto anterior a 20261030000100. */
  | { kind: 'anterior_sin_vincular'; texto: string }
  | { kind: 'sin_responsable' }

/**
 * Qué responsable muestra la pantalla para un servicio. `elegibles` es el catálogo
 * del proyecto del servicio; `null` mientras no se haya cargado (entonces no se
 * afirma «requiere reasignación»: no se sabe).
 */
export function estadoResponsable(
  s: Pick<ServicioHousekeeping, 'responsable_user_id' | 'responsable'>,
  elegibles: readonly AppUser[] | null,
): EstadoResponsable {
  if (s.responsable_user_id) {
    if (elegibles && !elegibles.some(u => u.id === s.responsable_user_id)) {
      return { kind: 'requiere_reasignacion', userId: s.responsable_user_id }
    }
    return { kind: 'vinculado', userId: s.responsable_user_id }
  }
  const texto = s.responsable?.trim()
  if (texto) return { kind: 'anterior_sin_vincular', texto }
  return { kind: 'sin_responsable' }
}

/** Al crear: el usuario conectado va preseleccionado SOLO si es elegible aquí. */
export function preseleccionResponsable(userId: string | null | undefined, elegibles: readonly AppUser[] | null): string | null {
  if (!userId || !elegibles) return null
  return elegibles.some(u => u.id === userId) ? userId : null
}

/** Buscador del selector: nombre o rol, sin distinguir mayúsculas ni acentos. */
export function filtrarElegibles(elegibles: readonly AppUser[], texto: string): AppUser[] {
  const q = normalizar(texto)
  if (!q) return [...elegibles]
  return elegibles.filter(u => normalizar(u.full_name).includes(q) || normalizar(u.role).includes(q))
}

function normalizar(t: string | null | undefined): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Texto de la línea «Responsable» del informe PDF (nombres ya resueltos). */
export function lineaResponsablePdf(estado: EstadoResponsable, nombre: (id: string) => string | undefined): string {
  switch (estado.kind) {
    case 'vinculado': return `Responsable: ${nombre(estado.userId) ?? `Usuario ${estado.userId.slice(0, 8)}`}`
    case 'requiere_reasignacion': return `Responsable: ${nombre(estado.userId) ?? `Usuario ${estado.userId.slice(0, 8)}`} (requiere reasignación)`
    case 'anterior_sin_vincular': return `Responsable anterior sin vincular: ${estado.texto}`
    case 'sin_responsable': return 'Responsable: —'
  }
}

/** Mensaje legible cuando la base rechaza el responsable. */
export function mensajeErrorResponsable(mensaje: string): string {
  return mensaje.includes(ERROR_RESPONSABLE_NO_ELEGIBLE)
    ? 'El responsable debe ser un usuario habilitado de la empresa con acceso a este proyecto y al módulo de housekeeping. Elige otro.'
    : mensaje
}
