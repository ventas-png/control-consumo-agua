// domain/condominios/rutinasRecorrido.ts — el RECORRIDO de una rutina de limpieza
// (20261102000000): primero las áreas, en el orden en que se van a intervenir;
// dentro de cada una, sus actividades.
//
// Vive fuera de la vista a propósito: el editor es de arrastrar y soltar, y cada
// gesto (meter un área entre dos, pasar una actividad de un área a otra, subirla
// por encima del borde de su área) es una regla que se prueba sin montar React
// ni simular eventos de arrastre. La vista sólo traduce gestos a estas llamadas.
//
// INMUTABLE. Toda operación devuelve un recorrido nuevo, o EL MISMO objeto si el
// gesto no cambia nada (área ya presente, actividad repetida en esa área,
// destino fuera de rango). La vista lo usa para avisar en vez de fallar callada.
//
// EL GRUPO LEGADO. Las rutinas anteriores a 20261102000000 tienen pasos sin
// área. Se muestran como una parada con `area_id: null`, SIEMPRE primera (así
// las materializa la base) y sólo pueden vaciarse: nada se arrastra hacia ella,
// y desaparece cuando queda vacía.
//
// La foto que se guarda es el recorrido tal cual (`ParadaPayload[]`): la RPC
// `guardar_recorrido_rutina` reconcilia contra lo guardado por identidad
// natural, así que el editor no necesita conocer ids de fila.
import type { PlantillaTareaCargo, RutinaActividad, RutinaArea } from '../../types'

// `type` y no `interface`: la foto viaja como Json a la RPC, y sólo los alias
// de tipo son asignables a su firma de índice.
export type PasoRecorrido = { plantilla_tarea_id: string; obligatoria: boolean }
export type ParadaRecorrido = { area_id: string | null; actividades: PasoRecorrido[] }
export type Recorrido = ParadaRecorrido[]
/** Lo que recibe `guardar_recorrido_rutina`: el recorrido, sin transformar. */
export type ParadaPayload = ParadaRecorrido

/** Una posición dentro del recorrido: parada y, para actividades, el índice. */
export interface PosicionPaso { parada: number; indice: number }

const esLegado = (p: ParadaRecorrido | undefined) => p?.area_id === null

/** Primer índice donde puede ir una parada de verdad (detrás del grupo legado). */
function primerHueco(rec: Recorrido): number {
  return esLegado(rec[0]) ? 1 : 0
}

/** Quita el grupo legado si quedó vacío: no hay nada que guardar ahí. */
function sinLegadoVacio(rec: Recorrido): Recorrido {
  return esLegado(rec[0]) && rec[0].actividades.length === 0 ? rec.slice(1) : rec
}

/** Reconstruye el recorrido de una rutina desde sus filas. */
export function recorridoDesdeFilas(
  rutinaId: string,
  paradas: RutinaArea[],
  pasos: RutinaActividad[],
): Recorrido {
  const propias = paradas
    .filter(p => p.rutina_id === rutinaId)
    .sort((a, b) => a.orden - b.orden || a.created_at.localeCompare(b.created_at))
  const conocidas = new Set(propias.map(p => p.id))
  const suyos = pasos
    .filter(p => p.rutina_id === rutinaId)
    .sort((a, b) => a.orden - b.orden || a.created_at.localeCompare(b.created_at))
  const aPaso = (p: RutinaActividad): PasoRecorrido => ({
    plantilla_tarea_id: p.plantilla_tarea_id,
    obligatoria: p.obligatoria,
  })

  const rec: Recorrido = propias.map(parada => ({
    area_id: parada.area_id,
    actividades: suyos.filter(p => p.rutina_area_id === parada.id).map(aPaso),
  }))
  // Un paso que apunta a una parada que no vino (no debería pasar: la FK lo
  // impide) se trata como legado antes que perderlo de vista.
  const legado = suyos.filter(p => !p.rutina_area_id || !conocidas.has(p.rutina_area_id))
  return legado.length > 0 ? [{ area_id: null, actividades: legado.map(aPaso) }, ...rec] : rec
}

export function tieneArea(rec: Recorrido, areaId: string): boolean {
  return rec.some(p => p.area_id === areaId)
}

/** Mete un área como parada nueva en `en` (por defecto, al final). */
export function insertarParada(rec: Recorrido, areaId: string, en = rec.length): Recorrido {
  if (tieneArea(rec, areaId)) return rec
  const pos = Math.min(Math.max(en, primerHueco(rec)), rec.length)
  return [...rec.slice(0, pos), { area_id: areaId, actividades: [] }, ...rec.slice(pos)]
}

/**
 * Mueve la parada `desde` para que quede ANTES de la que hoy está en `hasta`
 * (`hasta = rec.length` la manda al final). Es la semántica de la línea de
 * inserción que el editor dibuja entre dos paradas.
 */
export function moverParada(rec: Recorrido, desde: number, hasta: number): Recorrido {
  const min = primerHueco(rec)
  if (desde < min || desde >= rec.length) return rec
  const destino = Math.min(Math.max(hasta, min), rec.length)
  const final = destino > desde ? destino - 1 : destino
  if (final === desde) return rec
  const sin = [...rec.slice(0, desde), ...rec.slice(desde + 1)]
  return [...sin.slice(0, final), rec[desde], ...sin.slice(final)]
}

/**
 * Varias áreas de una vez (la ventana «＋ Áreas»): al final, en el orden dado.
 * Las que ya están —o vienen repetidas en la lista— se saltan.
 */
export function insertarParadas(rec: Recorrido, areaIds: string[]): Recorrido {
  return areaIds.reduce((r, id) => insertarParada(r, id), rec)
}

export function quitarParada(rec: Recorrido, indice: number): Recorrido {
  if (indice < 0 || indice >= rec.length) return rec
  return [...rec.slice(0, indice), ...rec.slice(indice + 1)]
}

function conActividades(rec: Recorrido, parada: number, actividades: PasoRecorrido[]): Recorrido {
  return rec.map((p, i) => (i === parada ? { ...p, actividades } : p))
}

/** Agrega una actividad del catálogo a una parada (al final, o en `en`). */
export function insertarActividad(
  rec: Recorrido,
  parada: number,
  plantillaId: string,
  en?: number,
): Recorrido {
  const destino = rec[parada]
  if (!destino || esLegado(destino)) return rec
  if (destino.actividades.some(a => a.plantilla_tarea_id === plantillaId)) return rec
  const pos = Math.min(Math.max(en ?? destino.actividades.length, 0), destino.actividades.length)
  const actividades = [
    ...destino.actividades.slice(0, pos),
    { plantilla_tarea_id: plantillaId, obligatoria: true },
    ...destino.actividades.slice(pos),
  ]
  return conActividades(rec, parada, actividades)
}

/**
 * Varias actividades de una vez en una parada (la ventana «＋ Actividades»): al
 * final, en el orden dado. Las que esa parada ya tiene se saltan.
 */
export function insertarActividades(rec: Recorrido, parada: number, plantillaIds: string[]): Recorrido {
  return plantillaIds.reduce((r, id) => insertarActividad(r, parada, id), rec)
}

/**
 * Mueve una actividad a otra posición, en su parada o en otra. `destino.indice`
 * tiene la misma semántica que en `moverParada`: queda ANTES de la que hoy
 * ocupa ese lugar. No entra en una parada que ya la tiene (sería la misma tarea
 * dos veces en el mismo sitio) ni en el grupo legado.
 */
export function moverActividad(rec: Recorrido, origen: PosicionPaso, destino: PosicionPaso): Recorrido {
  const de = rec[origen.parada]
  const a = rec[destino.parada]
  const paso = de?.actividades[origen.indice]
  if (!de || !a || !paso) return rec

  if (origen.parada === destino.parada) {
    const hasta = Math.min(Math.max(destino.indice, 0), de.actividades.length)
    const final = hasta > origen.indice ? hasta - 1 : hasta
    if (final === origen.indice) return rec
    const sin = de.actividades.filter((_, i) => i !== origen.indice)
    return conActividades(rec, origen.parada, [...sin.slice(0, final), paso, ...sin.slice(final)])
  }

  if (esLegado(a)) return rec
  if (a.actividades.some(x => x.plantilla_tarea_id === paso.plantilla_tarea_id)) return rec
  const pos = Math.min(Math.max(destino.indice, 0), a.actividades.length)
  const movido = conActividades(
    conActividades(rec, origen.parada, de.actividades.filter((_, i) => i !== origen.indice)),
    destino.parada,
    [...a.actividades.slice(0, pos), paso, ...a.actividades.slice(pos)],
  )
  return sinLegadoVacio(movido)
}

/**
 * Subir/bajar una actividad con botones (teclado, pantallas táctiles sin
 * arrastre). En el borde de su área cruza a la vecina: subir la primera la
 * lleva al FINAL del área anterior, bajar la última al PRINCIPIO de la
 * siguiente. Devuelve null si no hay a dónde ir.
 */
export function destinoVecino(rec: Recorrido, origen: PosicionPaso, delta: -1 | 1): PosicionPaso | null {
  const parada = rec[origen.parada]
  if (!parada) return null
  const dentro = origen.indice + delta
  if (dentro >= 0 && dentro < parada.actividades.length) {
    // Dentro de la parada: «antes de» el vecino, o detrás del de abajo.
    return { parada: origen.parada, indice: delta === -1 ? dentro : dentro + 1 }
  }
  const vecina = origen.parada + delta
  const otra = rec[vecina]
  if (!otra || esLegado(otra)) return null
  const id = parada.actividades[origen.indice]?.plantilla_tarea_id
  if (otra.actividades.some(a => a.plantilla_tarea_id === id)) return null
  return { parada: vecina, indice: delta === -1 ? otra.actividades.length : 0 }
}

export function quitarActividad(rec: Recorrido, parada: number, indice: number): Recorrido {
  const p = rec[parada]
  if (!p || !p.actividades[indice]) return rec
  return sinLegadoVacio(conActividades(rec, parada, p.actividades.filter((_, i) => i !== indice)))
}

export function alternarObligatoria(rec: Recorrido, parada: number, indice: number): Recorrido {
  const p = rec[parada]
  const paso = p?.actividades[indice]
  if (!p || !paso) return rec
  return conActividades(rec, parada, p.actividades.map((a, i) =>
    i === indice ? { ...a, obligatoria: !a.obligatoria } : a))
}

// ── Tiempo ────────────────────────────────────────────────────────────────────

export interface TiempoParada {
  /** Suma de las duraciones declaradas de sus actividades. */
  minutos: number
  /** Actividades que NO declaran duración: sin esto el total miente por defecto. */
  sinDato: number
  /** Minutos acumulados del recorrido al llegar a esta parada. */
  desde: number
  /** …y al terminarla. */
  hasta: number
}

export interface TiempoRecorrido {
  /** Paradas reales (sin el grupo legado). */
  paradas: number
  pasos: number
  minutos: number
  sinDato: number
  porParada: TiempoParada[]
}

/**
 * El tiempo que va acumulando el recorrido: cada parada suma lo que declaran
 * sus actividades, y arranca donde terminó la anterior.
 */
export function tiempoRecorrido(rec: Recorrido, porPlantilla: Map<string, PlantillaTareaCargo>): TiempoRecorrido {
  let acumulado = 0
  let sinDato = 0
  let pasos = 0
  const porParada = rec.map(parada => {
    let minutos = 0
    let faltan = 0
    for (const paso of parada.actividades) {
      const min = porPlantilla.get(paso.plantilla_tarea_id)?.duracion_estimada_min
      if (min == null) faltan++
      else minutos += min
    }
    const desde = acumulado
    acumulado += minutos
    sinDato += faltan
    pasos += parada.actividades.length
    return { minutos, sinDato: faltan, desde, hasta: acumulado }
  })
  return {
    paradas: rec.filter(p => !esLegado(p)).length,
    pasos,
    minutos: acumulado,
    sinDato,
    porParada,
  }
}

/** Minutos de una jornada 'HH:MM[:SS]'–'HH:MM[:SS]'; cruza la medianoche si termina antes. */
export function minutosJornada(inicio: string, fin: string): number {
  const a = aMinutos(inicio)
  const b = aMinutos(fin)
  if (a == null || b == null) return 0
  return b > a ? b - a : b + 24 * 60 - a
}

/** 'HH:MM' de `hora` + `minutos`, dando la vuelta al día. null si la hora no se entiende. */
export function horaMas(hora: string, minutos: number): string | null {
  const base = aMinutos(hora)
  if (base == null) return null
  const t = (((base + minutos) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function aMinutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** "1 h 45 min" a partir de minutos; "—" si nada del recorrido declara duración. */
export function formatearMinutos(minutos: number): string {
  if (minutos <= 0) return '—'
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/** ¿Dos recorridos son la misma foto? (para saber si hay cambios sin guardar). */
export function mismoRecorrido(a: Recorrido, b: Recorrido): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
