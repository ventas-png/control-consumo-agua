// domain/condominios/puntosVerificacion.ts — reglas puras del catálogo de
// puntos de verificación (20260921000100).
//
// La comparación de nombres reutiliza `normalizarNombreArea`, que es el espejo
// en cliente de `public.areas_normalizar_nombre`: la BD usa esa MISMA función en
// el índice único `uq_puntos_verif_nombre_normalizado`, así que lo que aquí se
// considera duplicado es exactamente lo que allá va a rebotar con 23505.
import { normalizarNombreArea } from './areas'
import type { AreaCondominio, PuntoVerificacion } from '../../types'

/**
 * El punto del área cuyo nombre normalizado choca con `nombre`, si existe.
 * `excluirId` permite renombrar un punto sin chocar consigo mismo.
 */
export function puntoDuplicado(
  nombre: string,
  areaId: string,
  puntos: PuntoVerificacion[],
  excluirId?: string,
): PuntoVerificacion | null {
  const norm = normalizarNombreArea(nombre)
  if (!norm) return null
  return puntos.find(p =>
    p.id !== excluirId &&
    p.area_id === areaId &&
    normalizarNombreArea(p.nombre) === norm,
  ) ?? null
}

/** Resultado de leer el textarea de alta masiva. */
export interface AltaMasiva {
  /** Nombres a crear, en el orden en que se escribieron. */
  nuevos: string[]
  /** Los que ya existen en el área (o se repiten en el propio texto). */
  repetidos: string[]
}

/**
 * Lee el pegado de alta masiva: una línea = un punto.
 *
 * Descarta líneas vacías, recorta espacios y filtra DOS clases de repetido —
 * los que ya están en el catálogo del área y los que el propio texto trae dos
 * veces— para que pegar una lista dos veces no fabrique duplicados ni haga
 * rebotar el lote entero por el índice único. El texto original no se reescribe:
 * la normalización solo compara.
 */
export function parsearAltaMasiva(
  texto: string,
  areaId: string,
  existentes: PuntoVerificacion[],
): AltaMasiva {
  const nuevos: string[] = []
  const repetidos: string[] = []
  const vistos = new Set<string>()

  for (const linea of texto.split('\n')) {
    const nombre = linea.trim()
    if (!nombre) continue
    const norm = normalizarNombreArea(nombre)
    if (!norm) continue
    if (vistos.has(norm) || puntoDuplicado(nombre, areaId, existentes)) {
      repetidos.push(nombre)
      continue
    }
    vistos.add(norm)
    nuevos.push(nombre)
  }

  return { nuevos, repetidos }
}

/**
 * Áreas activas que todavía no tienen NINGÚN punto en el catálogo.
 *
 * Es el insumo de "generar desde áreas": el atajo para arrancar un condominio
 * entero de un tirón, que crea un punto por área usando el nombre del área. Solo
 * las que están vacías — un área con puntos propios ya fue trabajada a mano y
 * regenerarla le metería un duplicado semántico ("Piscina" junto a "Bomba de la
 * piscina").
 */
export function areasSinPuntos(
  areas: AreaCondominio[],
  puntos: PuntoVerificacion[],
): AreaCondominio[] {
  const conPuntos = new Set(puntos.map(p => p.area_id))
  return areas
    .filter(a => a.activo && !conPuntos.has(a.id))
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}
