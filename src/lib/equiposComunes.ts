// Catálogo de EQUIPOS del condominio (equipos_comunes): categorías, estados y la
// alerta de mantenimiento. Funciones puras compartidas por el tab Equipos, la
// carga masiva y las pruebas. Desde 20261122000000 este catálogo es también la
// fuente de las herramientas y el equipo de las actividades (antes, Inventario).
import type { CategoriaEquipo, EquipoComun, EstadoEquipo } from '../types'
import { hoyLocalISO } from './format'

export const CATEGORIAS_EQUIPO: { value: CategoriaEquipo; label: string; icon: string }[] = [
  { value: 'bomba',            label: 'Bomba',            icon: '💧' },
  { value: 'ascensor',         label: 'Ascensor',         icon: '🛗' },
  { value: 'generador',        label: 'Generador',        icon: '⚡' },
  { value: 'planta_electrica', label: 'Planta eléctrica', icon: '🔌' },
  { value: 'camara',           label: 'Cámara',           icon: '📷' },
  { value: 'extintor',         label: 'Extintor',         icon: '🧯' },
  { value: 'herramienta',      label: 'Herramienta',      icon: '🔧' },
  { value: 'limpieza',         label: 'Limpieza',         icon: '🧹' },
  { value: 'jardineria',       label: 'Jardinería',       icon: '🌿' },
  { value: 'seguridad',        label: 'Seguridad',        icon: '🛡️' },
  { value: 'otro',             label: 'Otro',             icon: '⚙️' },
]

export const ESTADOS_EQUIPO: { value: EstadoEquipo; label: string; color: string }[] = [
  { value: 'operativo',      label: 'Operativo',         color: 'var(--at-success)' },
  { value: 'mantenimiento',  label: 'En mantenimiento',  color: 'var(--at-warning)' },
  { value: 'fuera_servicio', label: 'Fuera de servicio', color: 'var(--at-danger)' },
  { value: 'baja',           label: 'De baja',           color: 'var(--at-ink-3)' },
]

/** Con el próximo mantenimiento a este plazo o menos, el equipo ya pide atención. */
export const DIAS_AVISO_MANTO = 30

export const categoriaEquipo = (value: string) =>
  CATEGORIAS_EQUIPO.find(c => c.value === value) ?? CATEGORIAS_EQUIPO[CATEGORIAS_EQUIPO.length - 1]
export const estadoEquipo = (value: string) =>
  ESTADOS_EQUIPO.find(s => s.value === value) ?? ESTADOS_EQUIPO[0]

/** Días que faltan (negativos si ya pasó) para una fecha `YYYY-MM-DD`; null sin fecha. */
export function diasParaManto(fecha: string | null | undefined, hoy: string = hoyLocalISO()): number | null {
  if (!fecha) return null
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number)
  const [hy, hm, hd] = hoy.split('-').map(Number)
  if ([y, m, d, hy, hm, hd].some(n => !Number.isFinite(n))) return null
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hy, hm - 1, hd)) / 86400000)
}

export type AlertaManto = 'vencido' | 'proximo' | 'ok' | 'sin_fecha'

/** Un equipo de baja no avisa: ya no se le da mantenimiento. */
export function alertaManto(equipo: Pick<EquipoComun, 'proximo_mantenimiento' | 'estado'>, hoy?: string): AlertaManto {
  if (equipo.estado === 'baja') return 'sin_fecha'
  const dias = diasParaManto(equipo.proximo_mantenimiento, hoy)
  if (dias === null) return 'sin_fecha'
  if (dias < 0) return 'vencido'
  if (dias <= DIAS_AVISO_MANTO) return 'proximo'
  return 'ok'
}

export const requiereAtencion = (equipo: Pick<EquipoComun, 'proximo_mantenimiento' | 'estado'>, hoy?: string) =>
  ['vencido', 'proximo'].includes(alertaManto(equipo, hoy))
