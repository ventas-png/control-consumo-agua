import { datetimeLocalISO, diasEntreFechasCalendario } from '../../lib/format'
import { etiquetaCargo } from './rrhhCatalogos'
import type { CargoCatalogo, IncidenteSeguridad, PersonalCondominio } from '../../types'

// ============================================================================
// Incidentes de seguridad: seguimiento y antigüedad.
// ============================================================================

/** Estados en los que el incidente sigue pendiente de atender. */
export const ESTADOS_ABIERTOS = ['reportado', 'investigando'] as const

export const estaAbierto = (i: Pick<IncidenteSeguridad, 'estado'>) =>
  (ESTADOS_ABIERTOS as readonly string[]).includes(i.estado)

/**
 * Días que lleva abierto un incidente desde su fecha (0 el mismo día); `null`
 * si ya no está abierto o la fecha no es válida.
 */
export function diasAbierto(i: Pick<IncidenteSeguridad, 'estado' | 'fecha'>, hoy: Date = new Date()): number | null {
  if (!estaAbierto(i)) return null
  const dias = diasEntreFechasCalendario(i.fecha, hoy)
  return dias === null ? null : Math.max(0, dias)
}

/**
 * Agrega una nota al seguimiento con su fecha, hora y autor:
 * «[2026-10-26 14:05 · Ana López] Se revisaron las cámaras».
 *
 * Antes el seguimiento era un solo texto que había que reescribir desde
 * «Editar»: no quedaba constancia de cuándo ni quién anotó cada avance.
 * Lo anterior se conserva tal cual; la nota nueva va al final.
 */
export function agregarSeguimiento(actual: string | null | undefined, nota: string, cuando: Date = new Date(), autor?: string | null): string {
  const texto = nota.trim()
  const previo = (actual ?? '').trimEnd()
  if (!texto) return previo
  const quien = autor?.trim()
  const linea = `[${datetimeLocalISO(cuando).replace('T', ' ')}${quien ? ` · ${quien}` : ''}] ${texto}`
  return previo ? `${previo}\n${linea}` : linea
}

/** Más reciente primero: por fecha, hora y, si coinciden, hora de captura. */
export const masRecientePrimero = (a: IncidenteSeguridad, b: IncidenteSeguridad) =>
  b.fecha.localeCompare(a.fecha) || (b.hora ?? '').localeCompare(a.hora ?? '') || (b.created_at ?? '').localeCompare(a.created_at ?? '')

/**
 * «Reportado por» propuesto al registrar: el usuario que lo registra. Si su
 * cuenta está vinculada a una ficha de empleado activa del condominio
 * (personal_condominio.user_id), con su cargo: «Ana López — Guardia».
 */
export function reportanteDe(
  userId: string | null | undefined,
  nombreUsuario: string | null | undefined,
  personal: readonly PersonalCondominio[],
  cargos: readonly CargoCatalogo[] = [],
): string {
  const ficha = userId ? personal.find(p => p.user_id === userId && p.estado !== 'inactivo') : undefined
  if (ficha) return ficha.cargo ? `${ficha.nombre} — ${etiquetaCargo(ficha.cargo, cargos)}` : ficha.nombre
  return (nombreUsuario ?? '').trim()
}
