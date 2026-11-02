// domain/condominios/piscina.ts — Calidad del agua de piscinas y jacuzzis:
// los parámetros que miden las tiras de prueba, con la franja «OK» impresa en
// el frasco, y qué es un cuerpo de agua (tipo + nombre).
import type { ControlPiscina, TipoCuerpoAgua } from '../../types'

export type NivelAgua = 'ok' | 'warn' | 'bad'

export type ClaveParametroAgua =
  | 'ph' | 'cloro' | 'cloro_total' | 'bromo' | 'dureza_total'
  | 'acido_cianurico' | 'alcalinidad_total' | 'cobre' | 'sal'

export interface ParametroAgua {
  key: ClaveParametroAgua
  label: string
  /** Etiqueta corta para columnas y tarjetas. */
  corto: string
  unidad: '' | 'ppm'
  /** Franja ideal (la «OK» de la tira). null = sólo se anota, no se califica. */
  ideal: [number, number] | null
  /** Fuera de la ideal pero dentro de esta banda: «revisar»; fuera de ambas: «fuera de rango». */
  aviso: [number, number] | null
  step: string
  max?: number
  /** Texto de ayuda cuando no hay franja ideal. */
  ayuda?: string
}

/**
 * Las franjas salen de la tira de 7 parámetros (dureza, cloro libre, bromo,
 * cloro total, ácido cianúrico, alcalinidad, pH) y de las de cobre y sal. Los
 * dos primeros —pH y cloro libre— conservan los rangos que el tab ya usaba.
 */
export const PARAMETROS_AGUA: ParametroAgua[] = [
  { key: 'ph',                label: 'pH',                      corto: 'pH',          unidad: '',    ideal: [7.2, 7.8],  aviso: [7.0, 8.0],   step: '0.01', max: 14 },
  { key: 'cloro',             label: 'Cloro libre (ppm)',       corto: 'Cloro libre', unidad: 'ppm', ideal: [0.5, 3],    aviso: [0.2, 4],     step: '0.01' },
  { key: 'cloro_total',       label: 'Cloro total (ppm)',       corto: 'Cloro total', unidad: 'ppm', ideal: [1, 3],      aviso: [0.5, 5],     step: '0.01' },
  { key: 'bromo',             label: 'Bromo (ppm)',             corto: 'Bromo',       unidad: 'ppm', ideal: [2, 6],      aviso: [1, 10],      step: '0.1' },
  { key: 'dureza_total',      label: 'Dureza total (ppm)',      corto: 'Dureza',      unidad: 'ppm', ideal: [250, 500],  aviso: [100, 1000],  step: '1' },
  { key: 'acido_cianurico',   label: 'Ácido cianúrico (ppm)',   corto: 'Ác. cianúrico', unidad: 'ppm', ideal: [30, 100], aviso: [20, 150],   step: '1' },
  { key: 'alcalinidad_total', label: 'Alcalinidad total (ppm)', corto: 'Alcalinidad', unidad: 'ppm', ideal: [80, 120],   aviso: [40, 180],    step: '1' },
  { key: 'cobre',             label: 'Cobre (ppm)',             corto: 'Cobre',       unidad: 'ppm', ideal: [0, 0.4],    aviso: [0, 1],       step: '0.01' },
  { key: 'sal',               label: 'Sal (ppm)',               corto: 'Sal',         unidad: 'ppm', ideal: null,        aviso: null,         step: '1', ayuda: 'Piscinas de sal: 2700–3400' },
]

export const PARAMETRO_AGUA: Record<ClaveParametroAgua, ParametroAgua> =
  Object.fromEntries(PARAMETROS_AGUA.map(p => [p.key, p])) as Record<ClaveParametroAgua, ParametroAgua>

/** «7.2–7.8», o '' si el parámetro no se califica. */
export const textoRango = (p: ParametroAgua) => p.ideal ? `${p.ideal[0]}–${p.ideal[1]}` : ''

/** ok / warn / bad para un valor; sin valor o sin franja, ok. */
export function nivelDe(p: ParametroAgua, valor: number | null | undefined): NivelAgua {
  if (valor == null || !p.ideal) return 'ok'
  if (valor >= p.ideal[0] && valor <= p.ideal[1]) return 'ok'
  if (p.aviso && valor >= p.aviso[0] && valor <= p.aviso[1]) return 'warn'
  return 'bad'
}

export const NIVEL_COLOR: Record<NivelAgua, string> = { ok: 'var(--at-success)', warn: 'var(--at-warning)', bad: 'var(--at-danger)' }
// En palabras, no sólo en color.
export const NIVEL_TEXTO: Record<NivelAgua, string> = { ok: 'En rango', warn: 'Revisar: cerca del límite', bad: 'Fuera de rango' }

/** Los parámetros medidos en el registro que quedaron fuera de rango (bad). */
export function parametrosFueraDeRango(r: ControlPiscina): ParametroAgua[] {
  return PARAMETROS_AGUA.filter(p => nivelDe(p, r[p.key]) === 'bad')
}

export const TIPOS_CUERPO_AGUA: Record<TipoCuerpoAgua, { label: string; icon: string }> = {
  piscina: { label: 'Piscina', icon: '🏊' },
  jacuzzi: { label: 'Jacuzzi', icon: '🛁' },
}
export const tipoCuerpoAgua = (tipo: string | null | undefined) =>
  TIPOS_CUERPO_AGUA[(tipo ?? 'piscina') as TipoCuerpoAgua] ?? TIPOS_CUERPO_AGUA.piscina

/** Identidad de un cuerpo de agua: su tipo y su nombre («piscina:Principal»). */
export const claveCuerpoAgua = (r: Pick<ControlPiscina, 'tipo' | 'piscina'>) => `${r.tipo ?? 'piscina'}:${r.piscina}`

/** El más reciente: por fecha, hora y, si coinciden, por hora de captura. */
export const masRecientePiscina = (a: ControlPiscina, b: ControlPiscina) =>
  b.fecha.localeCompare(a.fecha) || (b.hora ?? '').localeCompare(a.hora ?? '') || (b.created_at ?? '').localeCompare(a.created_at ?? '')
