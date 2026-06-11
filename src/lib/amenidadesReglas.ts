// Reglas puras de amenidades y reservas (auditoría P1 #3, fase A del refactor
// de AmenidadesTab). Antes vivían dentro del componente de ~1.9k líneas y
// PortalReservasTab las importaba desde ahí (acoplando el portal al chunk
// completo del tab). Son la lógica de NEGOCIO de reservas: mantener puras y
// testeadas.
import type { Amenidad, BloqueoAmenidad, ReservaAmenidad } from '../types'

/** ¿El bloqueo (rango de fechas + horario opcional) pisa la reserva propuesta? */
export function bloqueoSolapaReserva(b: BloqueoAmenidad, fecha: string, hi: string, hf: string): boolean {
  if (fecha < b.fecha_inicio || fecha > b.fecha_fin) return false
  if (!b.hora_inicio || !b.hora_fin) return true   // día completo
  return hi < b.hora_fin && hf > b.hora_inicio
}

export function esFinDeSemana(fecha: string): boolean {
  if (!fecha) return false
  const dow = new Date(fecha + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}

/** Tarifa de uso vigente para la fecha (tarifa de fin de semana si aplica). */
export function tarifaAplicable(amen: Amenidad, fecha: string): number {
  if (!amen.requiere_tarifa) return 0
  const base = Number(amen.tarifa_uso ?? 0)
  if (esFinDeSemana(fecha) && amen.tarifa_uso_finde != null) {
    return Number(amen.tarifa_uso_finde)
  }
  return base
}

/** Horas (decimales) entre dos 'HH:MM' del mismo día. */
export function diferenciaHoras(hi: string, hf: string): number {
  const [h1, m1] = hi.split(':').map(Number)
  const [h2, m2] = hf.split(':').map(Number)
  return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60
}

/** Suma minutos a un 'HH:MM' (envuelve a las 24 h; nunca negativo). */
export function addMinutosToTime(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutos
  const hh = Math.floor(Math.max(0, total) / 60) % 24
  const mm = Math.max(0, total) % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Valida las reglas configurables de la amenidad (duración máxima, antelación
 * mínima, límite de reservas por unidad/mes). Devuelve el mensaje de error o
 * null si la reserva es válida.
 */
export function validarReglasAmenidad(
  amen: Amenidad,
  fecha: string,
  horaInicio: string,
  horaFin: string,
  unidadId: string,
  reservasExistentes: ReservaAmenidad[],
): string | null {
  if (amen.duracion_max_horas != null && amen.duracion_max_horas > 0) {
    const horas = diferenciaHoras(horaInicio, horaFin)
    if (horas > amen.duracion_max_horas + 1e-6) {
      return `La duración máxima permitida es de ${amen.duracion_max_horas} horas.`
    }
  }
  if (amen.horas_minimas_antelacion != null && amen.horas_minimas_antelacion > 0) {
    const inicio = new Date(`${fecha}T${horaInicio}:00`)
    const ahora = new Date()
    const horasAntelacion = (inicio.getTime() - ahora.getTime()) / 3600000
    if (horasAntelacion < amen.horas_minimas_antelacion) {
      return `Debes reservar con al menos ${amen.horas_minimas_antelacion} h de anticipación.`
    }
  }
  if (amen.max_reservas_mes_unidad != null && amen.max_reservas_mes_unidad > 0) {
    const mes = fecha.slice(0, 7)
    const usadas = reservasExistentes.filter(r =>
      r.amenidad_id === amen.id &&
      r.unidad_id === unidadId &&
      r.estado !== 'cancelada' &&
      r.fecha.startsWith(mes)
    ).length
    if (usadas >= amen.max_reservas_mes_unidad) {
      return `Esta unidad ya alcanzó el límite de ${amen.max_reservas_mes_unidad} reserva(s) en ${mes} para esta amenidad.`
    }
  }
  return null
}

// ── Calendario semanal ──────────────────────────────────────────────────────

export const DIAS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export function lunesDeSemana(ref: Date): Date {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - dow)
  return d
}

export function diasDeSemana(lunes: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes)
    d.setDate(d.getDate() + i)
    return d
  })
}
