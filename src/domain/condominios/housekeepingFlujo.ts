// domain/condominios/housekeepingFlujo.ts — reglas puras del flujo por pasos de un
// servicio de housekeeping (20261031000000). Sin imports de supabase: se prueba solo.
//
// La base es la que manda: trg_hk_estado_transicion rechaza (23514, HK_TRANSICION_INVALIDA)
// cualquier salto que no esté aquí, y lo que aquí es «solo admin» lo decide con el rol real
// de la sesión. La pantalla usa estas reglas para enseñar los botones correctos, no para
// autorizar.
import type { EstadoHousekeeping, ReservaSTRResumen, ReservaSTRVinculable, ServicioHousekeeping } from '../../types'

/** Prefijo con el que la base rechaza una transición (ERRCODE 23514). */
export const ERROR_TRANSICION_INVALIDA = 'HK_TRANSICION_INVALIDA'
/** Prefijos de rechazo al vincular una reserva (ERRCODE 23514). */
export const ERROR_RESERVA_FUERA_DE_ALCANCE = 'HK_RESERVA_FUERA_DE_ALCANCE'
export const ERROR_RESERVA_CANCELADA = 'HK_RESERVA_CANCELADA'
export const ERROR_RESERVA_UNIDAD_DISTINTA = 'HK_RESERVA_UNIDAD_DISTINTA'
/** Rechazos de hk_notificar_informe (ERRCODE 23514). */
export const ERROR_INFORME_NO_COMPLETADO = 'HK_INFORME_NO_COMPLETADO'
export const ERROR_EMAIL_INVALIDO = 'HK_EMAIL_INVALIDO'
export const ERROR_SIN_DESTINATARIOS = 'HK_SIN_DESTINATARIOS'

/** Hora tentativa de ingreso que asume el recordatorio previo cuando el servicio no trae hora. */
export const HORA_INGRESO_POR_DEFECTO = '08:00'

/**
 * Transiciones: `libre` las hace cualquiera que pueda escribir el servicio; `admin` solo
 * company_owner/admin (y super_admin). Lo que no está es inválido para todos (p. ej.
 * completado → cancelado, en_proceso → pendiente).
 */
export const TRANSICIONES: Readonly<Record<EstadoHousekeeping, Readonly<Partial<Record<EstadoHousekeeping, 'libre' | 'admin'>>>>> = {
  pendiente:  { en_proceso: 'libre', cancelado: 'libre', completado: 'admin' },
  en_proceso: { completado: 'libre', cancelado: 'libre' },
  completado: { en_proceso: 'admin' },
  cancelado:  { pendiente: 'admin' },
}

export function transicionPermitida(de: EstadoHousekeeping, a: EstadoHousekeeping, esAdmin: boolean): boolean {
  if (de === a) return true
  const regla = TRANSICIONES[de]?.[a]
  if (!regla) return false
  return regla === 'libre' || esAdmin
}

/** `esAdmin` para las transiciones reservadas: el mismo criterio que hk_transicion_estado. */
export function esAdminDeTransiciones(role: string | null | undefined): boolean {
  return role === 'company_owner' || role === 'admin' || role === 'super_admin' || role === 'superadmin'
}

/** Mensaje legible cuando la base rechaza una transición o un vínculo. Lo demás se devuelve tal cual. */
export function mensajeErrorFlujo(mensaje: string): string {
  if (mensaje.includes(ERROR_TRANSICION_INVALIDA)) {
    return 'Ese cambio de estado no está permitido: un servicio se inicia (Iniciar servicio) y después se finaliza. Saltar o reabrir es solo para dueño o administrador.'
  }
  if (mensaje.includes(ERROR_RESERVA_FUERA_DE_ALCANCE)) return 'La reserva debe ser de este mismo proyecto.'
  if (mensaje.includes(ERROR_RESERVA_CANCELADA)) return 'No se puede vincular una reserva cancelada.'
  if (mensaje.includes(ERROR_RESERVA_UNIDAD_DISTINTA)) return 'La unidad del servicio no coincide con la de la reserva.'
  if (mensaje.includes(ERROR_INFORME_NO_COMPLETADO)) return 'El informe se envía cuando el servicio está finalizado.'
  if (mensaje.includes(ERROR_EMAIL_INVALIDO)) return 'El correo del destinatario no es válido.'
  if (mensaje.includes(ERROR_SIN_DESTINATARIOS)) return 'Elige a los administradores o escribe un destinatario.'
  return mensaje
}

/** Minutos entre dos instantes ISO; null si falta alguno o el fin es anterior al inicio. */
export function minutosDedicados(inicioIso: string | null | undefined, finIso: string | null | undefined): number | null {
  if (!inicioIso || !finIso) return null
  const a = Date.parse(inicioIso), b = Date.parse(finIso)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / 60_000)
}

/** «2 h 30 min», «45 min», «0 min». */
export function formatearDuracion(minutos: number | null): string {
  if (minutos === null) return '—'
  const h = Math.floor(minutos / 60), m = minutos % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Horas dedicadas de un servicio (completado_en − iniciado_en), ya formateadas. */
export function horasDedicadas(s: Pick<ServicioHousekeeping, 'iniciado_en' | 'completado_en'>): string {
  return formatearDuracion(minutosDedicados(s.iniciado_en, s.completado_en))
}

/** «HM-001 · Ana Pérez · 08/11 → 12/11» para la tarjeta y el selector. */
export function etiquetaReserva(r: Pick<ReservaSTRResumen, 'codigo_confirmacion' | 'huesped_nombre' | 'fecha_entrada' | 'fecha_salida'>
  | Pick<ReservaSTRVinculable, 'codigo_confirmacion' | 'huesped_nombre' | 'fecha_entrada' | 'fecha_salida'>): string {
  const partes = [r.codigo_confirmacion?.trim(), r.huesped_nombre?.trim()].filter(Boolean)
  const fechas = [fechaCorta(r.fecha_entrada), fechaCorta(r.fecha_salida)].filter(Boolean).join(' → ')
  if (fechas) partes.push(fechas)
  return partes.join(' · ') || 'Reserva'
}

function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}` : iso
}

/**
 * Orden del selector de reservas: primero las de la unidad elegida, después las que
 * cubren la fecha del servicio, luego en curso, y por fecha de entrada. Es presentación;
 * la RPC ya devuelve solo en curso + confirmadas del proyecto.
 */
export function sugerirReservas(
  reservas: readonly ReservaSTRVinculable[],
  ctx: { unidadId?: string | null; fecha?: string | null },
): ReservaSTRVinculable[] {
  const puntos = (r: ReservaSTRVinculable): number =>
    (ctx.unidadId && r.unidad_id === ctx.unidadId ? 4 : 0)
    + (ctx.fecha && r.fecha_entrada <= ctx.fecha && ctx.fecha <= r.fecha_salida ? 2 : 0)
    + (r.estado === 'en_curso' ? 1 : 0)
  return [...reservas].sort((a, b) => puntos(b) - puntos(a) || a.fecha_entrada.localeCompare(b.fecha_entrada) || a.id.localeCompare(b.id))
}

/** Buscador del selector: código, huésped o unidad, sin mayúsculas ni acentos. */
export function filtrarReservas(reservas: readonly ReservaSTRVinculable[], texto: string): ReservaSTRVinculable[] {
  const q = normalizar(texto)
  if (!q) return [...reservas]
  return reservas.filter(r => normalizar(r.codigo_confirmacion).includes(q) || normalizar(r.huesped_nombre).includes(q) || normalizar(r.unidad_nombre).includes(q))
}

function normalizar(t: string | null | undefined): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Un destinatario tecleado es un correo, un teléfono (para WhatsApp) o nada. */
export function clasificarDestinatario(texto: string): { kind: 'email'; valor: string } | { kind: 'telefono'; valor: string } | null {
  const t = texto.trim()
  if (!t) return null
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return { kind: 'email', valor: t }
  const digitos = t.replace(/[\s().-]/g, '')
  if (/^\+?\d{7,15}$/.test(digitos)) return { kind: 'telefono', valor: digitos.replace(/^\+/, '') }
  return null
}

/** Enlace wa.me con el texto ya codificado (sin API de Meta: lo abre el dispositivo). */
export function construirEnlaceWhatsApp(telefono: string | null | undefined, texto: string): string {
  const num = (telefono ?? '').replace(/[^\d]/g, '')
  const base = num ? `https://wa.me/${num}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(texto)}`
}

/** Texto plano del informe para WhatsApp (el PDF con fotos se comparte aparte). */
export function resumenTextoInforme(
  s: Pick<ServicioHousekeeping, 'tipo' | 'fecha' | 'hora_inicio' | 'iniciado_en' | 'completado_en' | 'hallazgos_ingreso' | 'inconvenientes' | 'observaciones_cierre' | 'reserva_str_resumen'>,
  ctx: { unidad?: string | null; responsable?: string | null; tipoEtiqueta: string },
): string {
  const lineas = [
    `🧹 Informe de housekeeping · ${ctx.tipoEtiqueta}`,
    `Unidad: ${ctx.unidad ?? '—'} · Fecha: ${fechaLarga(s.fecha)}${s.hora_inicio ? ` · ingreso tentativo ${s.hora_inicio.slice(0, 5)}` : ''}`,
    `Responsable: ${ctx.responsable ?? '—'}`,
    `Horas dedicadas: ${horasDedicadas(s)}`,
  ]
  if (s.reserva_str_resumen) lineas.push(`Reserva: ${etiquetaReserva(s.reserva_str_resumen)}`)
  lineas.push(`Estado al ingresar: ${s.hallazgos_ingreso?.trim() || 'sin observaciones'}`)
  lineas.push(`Inconvenientes: ${s.inconvenientes?.trim() || 'ninguno'}`)
  lineas.push(`Resultado: ${s.observaciones_cierre?.trim() || 'sin observaciones'}`)
  return lineas.join('\n')
}

function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
