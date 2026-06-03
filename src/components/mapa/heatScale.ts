// serv:S18 — Escala de "mapa de calor" para el MapView. Lógica pura y testeable:
// normaliza un peso (p. ej. consumo m³) dentro del rango del dataset y deriva el
// color (azul = frío → rojo = caliente), radio y opacidad del punto de calor.

export interface HeatStyle {
  color: string
  radius: number
  fillOpacity: number
}

const RADIUS_MIN = 14
const RADIUS_MAX = 30
const OPACITY_MIN = 0.35
const OPACITY_MAX = 0.7

const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

/** Posición normalizada de `weight` en [min,max]; 0.5 si el rango es plano. */
export function normalizar(weight: number, min: number, max: number): number {
  return max > min ? clamp01((weight - min) / (max - min)) : 0.5
}

export function heatStyle(weight: number, min: number, max: number): HeatStyle {
  const t = normalizar(weight, min, max)
  return {
    // Hue 240 (azul, frío) → 0 (rojo, caliente).
    color: `hsl(${Math.round((1 - t) * 240)}, 90%, 50%)`,
    radius: RADIUS_MIN + t * (RADIUS_MAX - RADIUS_MIN),
    fillOpacity: OPACITY_MIN + t * (OPACITY_MAX - OPACITY_MIN),
  }
}
