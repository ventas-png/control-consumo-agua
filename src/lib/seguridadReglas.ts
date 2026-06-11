// Reglas puras del feature Seguridad (P1 #3, refactor de SeguridadTab):
// progreso de rondas, vigencia de fotos de visitantes, filtrado de reservas
// STR para control de acceso y formato de la descripción de novedades. Sin
// dependencias de React ni Supabase para que sea testeable de forma aislada.
import type { PuntoControlRuta, ReservaSTR, VisitaControl, Visitante } from '../types'

/** Avance del checklist de una ronda: puntos completados y porcentaje. */
export function progresoRonda(
  puntos: PuntoControlRuta[],
  visitas: VisitaControl[]
): { completados: number; progreso: number } {
  const completados = visitas.filter(v => v.estado !== 'pendiente').length
  const progreso = puntos.length > 0 ? Math.round((completados / puntos.length) * 100) : 0
  return { completados, progreso }
}

/** Duración de una ronda en minutos (en curso = hasta ahora). */
export function duracionRondaMin(inicio: string, fin: string | null | undefined, ahoraMs: number): number {
  const hasta = fin ? new Date(fin).getTime() : ahoraMs
  return Math.round((hasta - new Date(inicio).getTime()) / 60000)
}

/** Noches entre la entrada y la salida de una reserva STR. */
export function nochesReserva(fechaEntrada: string, fechaSalida: string): number {
  return Math.max(0, Math.round((new Date(fechaSalida).getTime() - new Date(fechaEntrada).getTime()) / 86400000))
}

const DIAS_90_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Marca qué fotos del historial de un visitante (buscado por DPI) superan los
 * 90 días: se evalúa el registro más reciente que tenga cada tipo de foto.
 */
export function calcularFotosExpiradas(
  registros: Visitante[],
  ahoraMs: number
): { foto: boolean; documento: boolean; vehiculo: boolean } {
  const esVencida = (r: Visitante | undefined) => !!r && (ahoraMs - new Date(r.hora_entrada).getTime()) > DIAS_90_MS
  return {
    foto: esVencida(registros.find(r => r.foto_url)),
    documento: esVencida(registros.find(r => r.foto_documento_url)),
    vehiculo: esVencida(registros.find(r => r.foto_vehiculo_url)),
  }
}

/**
 * Reservas STR elegibles para registrar ingreso: confirmadas o en curso, que
 * no hayan vencido ni se hayan ingresado ya, filtradas por huésped/unidad y
 * ordenadas con las llegadas de hoy (o pasadas) primero.
 */
export function filtrarReservasSTRAcceso(
  reservas: ReservaSTR[],
  hoy: string,
  busqueda: string,
  ingresadas: Set<string>
): ReservaSTR[] {
  return reservas
    .filter(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy && !ingresadas.has(r.id))
    .filter(r => !busqueda || r.huesped_nombre.toLowerCase().includes(busqueda.toLowerCase()) || (r.unidad_nombre ?? '').toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => {
      // Hoy y pasadas primero, luego futuras por fecha ascendente
      const aHoy = a.fecha_entrada <= hoy
      const bHoy = b.fecha_entrada <= hoy
      if (aHoy !== bHoy) return aHoy ? -1 : 1
      return a.fecha_entrada.localeCompare(b.fecha_entrada)
    })
}

/**
 * Separa la descripción de una novedad en "datos del registro" (primer bloque
 * antes de un doble salto de línea) y el comentario libre del guardia.
 */
export function separarDescripcionNovedad(descripcion: string): { datosRegistro: string | null; comentario: string } {
  const partes = descripcion.split('\n\n')
  const tieneDatos = partes.length >= 2
  return {
    datosRegistro: tieneDatos ? partes[0] : null,
    comentario: tieneDatos ? partes.slice(1).join('\n\n') : descripcion,
  }
}
