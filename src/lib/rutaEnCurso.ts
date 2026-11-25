// Progreso de la ruta de lecturas EN CURSO, persistido en el dispositivo.
//
// Problema: qué ruta se está ejecutando, por cuál parada va y qué contadores ya
// se leyeron vivía sólo en memoria de React. Cualquier recarga a media ruta
// —una versión nueva de la PWA, el sistema matando la pestaña al abrir la
// cámara o WhatsApp, un chunk viejo, un «deslizar para recargar»— dejaba al
// lecturista otra vez en «Unidad 1 de N», sin descontar lo que ya había
// guardado.
//
// Aquí se guarda lo mínimo para retomarla: la ruta, quién la ejecuta, el índice
// de la parada y los contadores ya leídos. Las LECTURAS no viven aquí (ésas ya
// están en el servidor o en la cola offline): esto es sólo la posición.
//
// El almacenamiento se abstrae para probar la lógica sin navegador, igual que
// en lecturasOutbox.

import type { Ruta } from '../types'

export interface RutaEnCurso {
  rutaId: string
  /**
   * Copia de la ruta cuando NO vive en la base (la ruta «de pendientes» que se
   * arma en memoria): sin ella, tras una recarga no habría de dónde sacarla.
   */
  ruta?: Ruta
  /** Quién la ejecuta: el progreso de un usuario no se le retoma a otro. */
  userId: string
  /** Índice de la parada actual dentro de la ruta. */
  index: number
  /** Contadores ya leídos en esta ejecución. */
  leidos: string[]
  /** Epoch ms de la última actividad (para caducar ejecuciones abandonadas). */
  actualizadaEn: number
}

export interface RutaEnCursoStorage {
  leer(): string | null
  escribir(valor: string | null): void
}

const CLAVE_STORAGE = 'ruta_en_curso_v1'

/**
 * Una ejecución sin actividad en este tiempo se considera abandonada. Importa
 * sobre todo en rutas recurrentes: el progreso de la ocurrencia de ayer no debe
 * colarse en la de hoy.
 */
export const RUTA_EN_CURSO_TTL_MS = 16 * 60 * 60 * 1000

/** Storage sobre localStorage. Degrada a no-op si no está disponible. */
export function localStorageRutaEnCurso(): RutaEnCursoStorage {
  return {
    leer: () => { try { return localStorage.getItem(CLAVE_STORAGE) } catch { return null } },
    escribir: (v) => {
      try {
        if (v === null) localStorage.removeItem(CLAVE_STORAGE)
        else localStorage.setItem(CLAVE_STORAGE, v)
      } catch { /* quota / modo privado */ }
    },
  }
}

/** La ruta en curso vigente, o null si no hay, está corrupta o caducó. */
export function leerRutaEnCurso(storage: RutaEnCursoStorage, ahora: number): RutaEnCurso | null {
  const crudo = storage.leer()
  if (!crudo) return null
  try {
    const v = JSON.parse(crudo) as Partial<RutaEnCurso> | null
    if (!v || typeof v.rutaId !== 'string' || typeof v.userId !== 'string') return null
    const actualizadaEn = typeof v.actualizadaEn === 'number' ? v.actualizadaEn : 0
    if (ahora - actualizadaEn > RUTA_EN_CURSO_TTL_MS) return null
    const index = typeof v.index === 'number' && Number.isInteger(v.index) && v.index >= 0 ? v.index : 0
    const leidos = Array.isArray(v.leidos) ? v.leidos.filter((x): x is string => typeof x === 'string') : []
    const ruta = v.ruta && typeof v.ruta === 'object' && v.ruta.id === v.rutaId ? v.ruta : undefined
    return { rutaId: v.rutaId, userId: v.userId, index, leidos, actualizadaEn, ...(ruta ? { ruta } : {}) }
  } catch {
    return null
  }
}

/**
 * Marca una ruta como en curso. Si YA era la ruta en curso de ese usuario, se
 * conserva su progreso: volver a pulsar «Ejecutar» tras una recarga retoma, no
 * reinicia.
 */
export function iniciarRutaEnCurso(
  storage: RutaEnCursoStorage,
  rutaId: string,
  userId: string,
  ahora: number,
  /** Sólo para rutas que no están en la base (ver `RutaEnCurso.ruta`). */
  ruta?: Ruta,
): RutaEnCurso {
  const previa = leerRutaEnCurso(storage, ahora)
  const estado: RutaEnCurso = previa && previa.rutaId === rutaId && previa.userId === userId
    ? { ...previa, actualizadaEn: ahora }
    : { rutaId, userId, index: 0, leidos: [], actualizadaEn: ahora, ...(ruta ? { ruta } : {}) }
  storage.escribir(JSON.stringify(estado))
  return estado
}

/** Actualiza la posición de la ruta en curso. No-op si la ruta en curso es otra. */
export function guardarProgresoRuta(
  storage: RutaEnCursoStorage,
  rutaId: string,
  progreso: { index: number; leidos: Iterable<string> },
  ahora: number,
): void {
  const previa = leerRutaEnCurso(storage, ahora)
  if (!previa || previa.rutaId !== rutaId) return
  storage.escribir(JSON.stringify({
    ...previa,
    index: progreso.index,
    leidos: [...new Set(progreso.leidos)],
    actualizadaEn: ahora,
  } satisfies RutaEnCurso))
}

/** Olvida la ruta en curso (se completó o el operador la detuvo). */
export function limpiarRutaEnCurso(storage: RutaEnCursoStorage): void {
  storage.escribir(null)
}

/** Una parada de la ruta, reducida a lo que hace falta para saber si ya se leyó. */
export interface ParadaRuta {
  /** Contadores que hay que leer en la parada. */
  contadorIds: string[]
}

/**
 * Por cuál parada retomar: la primera, desde el índice guardado, a la que aún
 * le falte algún contador por leer. Cubre el caso de que la recarga caiga
 * DESPUÉS de guardar la lectura pero ANTES de avanzar (p. ej. con el diálogo de
 * WhatsApp abierto). Devuelve `paradas.length` si ya no queda nada pendiente.
 *
 * Una parada sin contadores no se puede dar por leída: se retoma en ella para
 * que el operador decida.
 */
export function indiceDeReanudacion(
  paradas: ParadaRuta[],
  indexGuardado: number,
  leidos: ReadonlySet<string>,
): number {
  const desde = Math.min(Math.max(0, indexGuardado), paradas.length)
  for (let i = desde; i < paradas.length; i++) {
    const { contadorIds } = paradas[i]
    if (contadorIds.length === 0 || contadorIds.some(id => !leidos.has(id))) return i
  }
  return paradas.length
}
