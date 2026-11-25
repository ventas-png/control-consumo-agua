// Reglas puras de las lecturas omitidas en ruta (sin red ni Supabase): los
// motivos, qué exige la pantalla antes de mandar una omisión y cómo se arma la
// ruta «de pendientes» para retomarlas. El acceso a datos está en
// src/domain/agua/lecturasOmitidas.ts, que reexporta todo esto.

import type { GPS, Ruta } from '../types'

export const MOTIVOS_OMISION = [
  { value: 'acceso_obstruido', label: 'Contador obstruido', ayuda: 'Un vehículo u objeto tapa el contador' },
  { value: 'propiedad_cerrada', label: 'Propiedad cerrada', ayuda: 'No hay acceso al contador' },
  { value: 'contador_ilegible', label: 'Contador ilegible o dañado', ayuda: 'Vidrio empañado, sucio o roto' },
  { value: 'riesgo_seguridad', label: 'Riesgo de seguridad', ayuda: 'Perro suelto, zona insegura' },
  { value: 'contador_no_encontrado', label: 'Contador no encontrado', ayuda: 'No está donde indica el registro' },
  { value: 'otro', label: 'Otro motivo', ayuda: 'Explíquelo en el detalle' },
] as const

export type MotivoOmision = (typeof MOTIVOS_OMISION)[number]['value']
export type EstadoOmision = 'pendiente' | 'resuelta' | 'descartada'

export interface LecturaOmitida {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  contador_id: string | null
  ruta_id: string | null
  motivo: MotivoOmision
  detalle: string | null
  foto_path: string | null
  gps: GPS | null
  omitida_por: string | null
  omitida_por_nombre: string | null
  omitida_at: string
  estado: EstadoOmision
  registro_id: string | null
  cerrada_at: string | null
  cerrada_por: string | null
  nota_cierre: string | null
}

export function etiquetaMotivo(motivo: string): string {
  return MOTIVOS_OMISION.find(m => m.value === motivo)?.label ?? motivo
}

/** Motivos en los que no se puede exigir foto: acercarse es el riesgo. */
const MOTIVOS_SIN_FOTO: ReadonlySet<MotivoOmision> = new Set(['riesgo_seguridad'])

export function fotoObligatoria(motivo: MotivoOmision | ''): boolean {
  return motivo !== '' && !MOTIVOS_SIN_FOTO.has(motivo)
}

/**
 * Lo que la pantalla exige antes de mandar la omisión. El servidor vuelve a
 * exigir lo suyo (motivo de la lista, detalle en «otro»); esto sólo evita el
 * viaje de red y dice qué falta en palabras del lecturista.
 */
export function validarOmision(datos: {
  motivo: MotivoOmision | ''
  detalle: string
  tieneFoto: boolean
}): string | null {
  if (!datos.motivo) return 'Elija el motivo por el que no se pudo leer.'
  if (datos.motivo === 'otro' && datos.detalle.trim().length < 5) {
    return 'Explique el motivo en el detalle (mínimo 5 caracteres).'
  }
  if (fotoObligatoria(datos.motivo) && !datos.tieneFoto) {
    return 'Tome una foto como evidencia de por qué no se pudo leer.'
  }
  return null
}

/** Días completos desde que se omitió (para ordenar y avisar de las viejas). */
export function diasPendiente(omitidaAt: string, ahora: Date = new Date()): number {
  const ms = ahora.getTime() - new Date(omitidaAt).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

// ── Retomar las pendientes ──────────────────────────────────────────────────
// Para tomar después las lecturas que faltaron se arma una ruta «de
// pendientes» en memoria: Nueva Lectura la recorre igual que una ruta
// programada (parada por parada, con «Saltar» si vuelve a no poderse). No se
// guarda en `rutas`: su id lleva un prefijo que nunca es un uuid, y al
// terminarla no se marca nada como completado.

export const PREFIJO_RUTA_PENDIENTES = 'pendientes:'

export function esRutaDePendientes(ruta: { id: string } | null | undefined): boolean {
  return !!ruta && ruta.id.startsWith(PREFIJO_RUTA_PENDIENTES)
}

/**
 * La ruta que recorre las omisiones dadas, en el orden recibido. Sólo entran
 * las que tienen contador: una unidad sin contadores no tiene nada que leer
 * (se revisa y se descarta).
 */
export function rutaDePendientes(
  omisiones: Pick<LecturaOmitida, 'contador_id'>[],
  nombre: string,
  ahora: Date = new Date(),
): Ruta | null {
  const contadorIds = [...new Set(omisiones.map(o => o.contador_id).filter((id): id is string => !!id))]
  if (contadorIds.length === 0) return null
  return {
    id: `${PREFIJO_RUTA_PENDIENTES}${ahora.getTime()}`,
    nombre,
    tipo_ruta: 'contadores',
    project_id: null,
    cliente_ids: [],
    contador_ids: contadorIds,
    unidad_ids: [],
    completada: false,
    created_at: ahora.toISOString(),
    frecuencia: 'unica',
  }
}
