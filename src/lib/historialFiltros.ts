// Reglas puras del Historial de Lecturas: resolución del # de contador de un
// registro, predicado de filtrado (cliente, # de contador, estado, fechas,
// proyecto, unidad y tipo de agua) y el recorte de unidades por proyecto para
// que el dropdown de unidad solo liste las del proyecto seleccionado.
// Sin dependencias de React ni Supabase → testeable en aislamiento.
import type { Registro, Contador, Unidad } from '../types'
import { parseFechaCalendario } from '../lib/format'

export interface HistorialFiltros {
  /** Texto libre: coincide con nombre del cliente o # de contador. */
  texto: string
  estado: string
  proyecto: string
  unidad: string
  tipoAgua: string
  fechaInicio: string
  fechaFin: string
}

/** Número de serie (# de contador) asociado a un registro vía su `contador_id`. */
export function numeroContadorDeRegistro(
  registro: Registro,
  contadoresById: Map<string, Contador>,
): string | null {
  if (!registro.contador_id) return null
  return contadoresById.get(registro.contador_id)?.numero_serie ?? null
}

/** ¿El registro pasa todos los filtros activos? Filtro vacío = no restringe. */
export function registroCoincide(
  registro: Registro,
  filtros: HistorialFiltros,
  contadoresById: Map<string, Contador>,
): boolean {
  const needle = filtros.texto.toLowerCase().trim()
  const contador = registro.contador_id ? contadoresById.get(registro.contador_id) : undefined

  const matchTxt = !needle
    || (registro.cliente_nombre ?? '').toLowerCase().includes(needle)
    || (contador?.numero_serie ?? '').toLowerCase().includes(needle)

  const matchEstado = !filtros.estado || registro.estado === filtros.estado

  // `registros.fecha` es timestamptz; los filtros son fechas de calendario de
  // un <input type="date">, así que sus límites son medianoche y fin de día
  // LOCALES. El límite inferior se parseaba como medianoche UTC y en GMT-6
  // dejaba pasar lecturas de las últimas 6 horas del día anterior.
  const fecha = new Date(registro.fecha)
  const desde = parseFechaCalendario(filtros.fechaInicio)
  const hasta = parseFechaCalendario(filtros.fechaFin)
  hasta?.setHours(23, 59, 59, 999)
  const matchFechaInicio = !desde || fecha >= desde
  const matchFechaFin = !hasta || fecha <= hasta

  const matchProyecto = !filtros.proyecto || registro.project_id === filtros.proyecto
  const matchUnidad = !filtros.unidad || contador?.unidad_id === filtros.unidad
  const matchTipoAgua = !filtros.tipoAgua || contador?.tipo_agua === filtros.tipoAgua

  return matchTxt && matchEstado && matchFechaInicio && matchFechaFin
    && matchProyecto && matchUnidad && matchTipoAgua
}

/**
 * Unidades disponibles para el dropdown de unidad: recortadas al proyecto
 * seleccionado. Sin proyecto seleccionado devuelve todas.
 */
export function unidadesDelProyecto(unidades: Unidad[], proyectoId: string): Unidad[] {
  if (!proyectoId) return unidades
  return unidades.filter(u => u.project_id === proyectoId)
}
