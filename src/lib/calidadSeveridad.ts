// serv:S20 — Validación de muestras de laboratorio + niveles de severidad por
// parámetro, sobre los umbrales regulados (TIPOLOGIAS_CALIDAD).
//
// Es una capa de UX del cliente: el cumplimiento booleano AUTORITATIVO lo calcula
// el servidor (serv:S22, trigger en registros_calidad). La severidad gradúa "qué
// tan fuera de norma" está cada lectura para priorizar la atención.
//
// Modelo de severidad (elegido): "% del ancho del rango".
//   - dentro de [min,max]            → ok
//   - fuera, exceso ≤ 10% del ancho  → leve
//   - fuera, exceso ≤ 50% del ancho  → moderado
//   - fuera, exceso > 50% del ancho  → critico
//   - microbiológicos ("debe ser 0"): cualquier presencia → critico

export type Severidad = 'ok' | 'leve' | 'moderado' | 'critico'

export interface RangoParametro {
  min: number
  max: number
}

export interface ValidacionValor {
  valido: boolean
  motivo?: string
}

/**
 * Una muestra de laboratorio debe ser numérica y no negativa. Vacío = no
 * ingresado (válido; cada parámetro es opcional en el formulario).
 */
export function validarValorParametro(valorStr: string): ValidacionValor {
  const s = valorStr.trim()
  if (s === '') return { valido: true }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { valido: false, motivo: 'Valor no numérico' }
  if (parseFloat(s) < 0) return { valido: false, motivo: 'No puede ser negativo' }
  return { valido: true }
}

/**
 * Severidad de un valor respecto al rango regulado. Devuelve null cuando el
 * valor está vacío o es inválido (eso lo cubre validarValorParametro).
 */
export function severidadParametro(rango: RangoParametro, valorStr: string): Severidad | null {
  const s = valorStr.trim()
  if (s === '' || !validarValorParametro(s).valido) return null

  const num = parseFloat(s)
  const { min, max } = rango

  // Microbiológicos / "debe ser 0": cualquier presencia es crítica.
  if (min === 0 && max === 0) return num === 0 ? 'ok' : 'critico'

  if (num >= min && num <= max) return 'ok'

  const span = max - min
  const exceso = num < min ? min - num : num - max
  const ratio = span > 0 ? exceso / span : Infinity
  if (ratio <= 0.1) return 'leve'
  if (ratio <= 0.5) return 'moderado'
  return 'critico'
}

/** Etiqueta + colores (tokens del tema) por nivel de severidad. */
export const SEVERIDAD_META: Record<Severidad, { label: string; color: string; border: string; tint: string }> = {
  ok:       { label: 'En norma', color: 'var(--at-success-strong)', border: 'var(--at-success)', tint: 'var(--at-success-tint)' },
  leve:     { label: 'Leve',     color: 'var(--at-warning-strong)', border: 'var(--at-warning)', tint: 'var(--at-warning-tint)' },
  moderado: { label: 'Moderado', color: 'var(--at-warning)',        border: 'var(--at-warning)', tint: 'var(--at-warning-tint)' },
  critico:  { label: 'Crítico',  color: 'var(--at-danger-strong)',  border: 'var(--at-danger)',  tint: 'var(--at-danger-tint)' },
}
