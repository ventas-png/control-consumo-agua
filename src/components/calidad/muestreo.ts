import { diasEntreFechasCalendario, esFechaCalendario, sumarDiasCalendario } from '../../lib/format'
// serv:S26 — Programa de muestreo de calidad. Lógica pura y testeable: deriva el
// estado de muestreo de cada fuente a partir de su frecuencia (días) y la fecha
// de su última muestra registrada (registros_calidad). Sin React/DOM.

export type EstadoMuestreo = 'sin_programa' | 'sin_muestras' | 'al_dia' | 'proximo' | 'vencido'

export interface MuestreoInfo {
  estado: EstadoMuestreo
  /** Fecha esperada del próximo muestreo ('YYYY-MM-DD'), o null si no aplica. */
  proximaFecha: string | null
  /** Días hasta el próximo muestreo (negativo = vencido hace N días), o null. */
  dias: number | null
}

// Las fechas de este módulo son fechas de CALENDARIO ('YYYY-MM-DD'): un día del
// almanaque, no un instante. Toda la aritmética se delega en src/lib/format.ts
// —`sumarDiasCalendario` y `diasEntreFechasCalendario`— para no mantener una
// segunda implementación de fechas. El defecto que esto corrige era justamente
// el round-trip prohibido: se parseaba el día como medianoche UTC y luego se
// formateaba como día LOCAL, así que en cualquier huso negativo la próxima
// fecha retrocedía un día (America/Guatemala: '2026-05-31' → '2026-05-30').
const aFecha = (iso: string): string => iso.slice(0, 10)

/**
 * Última fecha de muestra (registro de calidad) por fuente. Acepta fechas con o
 * sin hora; compara y devuelve como 'YYYY-MM-DD'.
 */
export function ultimaMuestraPorFuente(registros: { fuente_id: string; fecha: string }[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of registros) {
    if (!r.fuente_id || !r.fecha) continue
    const f = aFecha(r.fecha)
    const prev = out.get(r.fuente_id)
    if (!prev || f > prev) out.set(r.fuente_id, f)
  }
  return out
}

/**
 * Estado de muestreo de una fuente. La ventana de "próximo" es proporcional a la
 * frecuencia (20%, mínimo 2 días) para que sirva igual con cadencias cortas o
 * largas. `hoy` en 'YYYY-MM-DD'.
 */
export function estadoMuestreo(
  ultimaFecha: string | null | undefined,
  frecuenciaDias: number | null | undefined,
  hoy: string,
): MuestreoInfo {
  if (frecuenciaDias == null || !Number.isFinite(frecuenciaDias) || frecuenciaDias <= 0) {
    return { estado: 'sin_programa', proximaFecha: null, dias: null }
  }
  if (!ultimaFecha) {
    return { estado: 'sin_muestras', proximaFecha: null, dias: null }
  }
  const proximaFecha = sumarDiasCalendario(aFecha(ultimaFecha), frecuenciaDias)
  const dias = esFechaCalendario(proximaFecha)
    ? diasEntreFechasCalendario(aFecha(hoy), proximaFecha)
    : null
  // Una fecha ilegible (o un desborde del calendario) deja el programa sin
  // ancla evaluable: se degrada a 'sin_muestras' —el mismo estado que cuando no
  // hay muestra alguna— en lugar de propagar 'NaN-NaN-NaN' y un `dias` NaN, que
  // además se clasificaban como 'al_dia' y pintaban el chip en verde.
  if (proximaFecha === null || dias === null) {
    return { estado: 'sin_muestras', proximaFecha: null, dias: null }
  }
  const ventana = Math.max(2, Math.ceil(frecuenciaDias * 0.2))
  const estado: EstadoMuestreo = dias < 0 ? 'vencido' : dias <= ventana ? 'proximo' : 'al_dia'
  return { estado, proximaFecha, dias }
}

/** Etiqueta + colores (tokens del tema, dark-mode-safe) por estado de muestreo. */
export const MUESTREO_META: Record<EstadoMuestreo, { label: string; tint: string; color: string }> = {
  sin_programa: { label: 'Sin programa', tint: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
  sin_muestras: { label: 'Sin muestras', tint: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  al_dia:       { label: 'Al día',       tint: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  proximo:      { label: 'Próximo',      tint: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  vencido:      { label: 'Vencido',      tint: 'var(--at-danger-tint)',  color: 'var(--at-danger-strong)' },
}
