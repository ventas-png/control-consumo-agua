import { dateLocalISO } from '../../lib/format'
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

const MS_DIA = 86_400_000
const aFecha = (iso: string): string => iso.slice(0, 10)
const parseUTC = (fecha: string): number => Date.parse(fecha + 'T00:00:00Z')

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
  const proxMs = parseUTC(aFecha(ultimaFecha)) + frecuenciaDias * MS_DIA
  const proximaFecha = dateLocalISO(new Date(proxMs))
  const dias = Math.round((proxMs - parseUTC(aFecha(hoy))) / MS_DIA)
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
