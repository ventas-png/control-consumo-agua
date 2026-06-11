// Reglas puras del feature Rutas (P1 #3, refactor de RutasSection): validación
// del formulario, armado del payload, filtros de elementos disponibles,
// descripción de recurrencia y estado de la ruta. Sin dependencias de React ni
// Supabase para que sea testeable de forma aislada.
import type { Cliente, Contador, FrecuenciaRuta, Ruta, Unidad } from '../types'

export type TipoRuta = 'clientes' | 'contadores' | 'unidades'

export interface RutaForm {
  nombre: string
  descripcion: string
  project_id: string
  fecha_programada: string
  asignado_a: string
  asignado_nombre: string
  asignado_email: string
  asignado_telefono: string
  frecuencia: FrecuenciaRuta
  dias_semana: number[]
  intervalo_dias: string
  dia_mes: string
  fechas_especificas: string[]
  hora_programada: string
  recurrencia_activa: boolean
  fecha_inicio: string
  fecha_fin: string
  recordatorio_anticipacion_min: number
  recordatorio_canales: string[]
}

// ISO: 1 = lunes … 7 = domingo
export const DIAS_NOMBRE: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' }

export function describirRecurrencia(ruta: Ruta): string {
  const f = ruta.frecuencia ?? 'unica'
  const hora = ruta.hora_programada ? ` · ${String(ruta.hora_programada).slice(0, 5)}` : ''
  if (f === 'unica') return 'Una vez'
  if (f === 'diaria') return `Diaria${hora}`
  if (f === 'semanal') {
    const dias = (ruta.dias_semana ?? []).slice().sort((a, b) => a - b).map(d => DIAS_NOMBRE[d]).join(', ')
    return `Semanal${dias ? `: ${dias}` : ''}${hora}`
  }
  if (f === 'quincenal') return `Cada ${ruta.intervalo_dias ?? 14} días${hora}`
  if (f === 'mensual') return `Mensual · día ${ruta.dia_mes ?? 1}${hora}`
  if (f === 'fechas') return `${(ruta.fechas_especificas ?? []).length} fecha(s)${hora}`
  return 'Una vez'
}

export interface EstadoRuta {
  label: 'Completada' | 'Vencida' | 'Hoy' | 'Pendiente'
  color: string
  bg: string
}

export function estadoRuta(ruta: Ruta, hoy: string): EstadoRuta {
  if (ruta.completada) return { label: 'Completada', color: 'var(--at-success-strong)', bg: 'var(--at-success-tint)' }
  if (ruta.fecha_programada && ruta.fecha_programada < hoy)
    return { label: 'Vencida', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' }
  if (ruta.fecha_programada === hoy) return { label: 'Hoy', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' }
  return { label: 'Pendiente', color: 'var(--at-primary-hover)', bg: 'var(--at-primary-soft)' }
}

/**
 * Valida el formulario antes de guardar. Devuelve el mensaje de advertencia a
 * mostrar, o null si la ruta es válida. (Mismas reglas que tenía handleGuardar.)
 */
export function validarRuta(
  form: RutaForm,
  tipoRuta: TipoRuta,
  totales: { clientes: number; contadores: number; unidades: number }
): string | null {
  if (!form.nombre.trim()) return 'El nombre de la ruta es obligatorio'
  if (!form.project_id) return 'Selecciona el proyecto de la ruta'
  if (tipoRuta === 'clientes' && totales.clientes === 0) return 'Agrega al menos un cliente a la ruta'
  if (tipoRuta === 'contadores' && totales.contadores === 0) return 'Agrega al menos un contador a la ruta'
  if (tipoRuta === 'unidades' && totales.unidades === 0) return 'Agrega al menos una unidad a la ruta'
  // Validaciones de periodicidad
  if (form.frecuencia === 'unica' && !form.fecha_programada) return 'Indica la fecha programada de la ruta'
  if (form.frecuencia === 'semanal' && form.dias_semana.length === 0) return 'Selecciona al menos un día de la semana'
  if (form.frecuencia === 'quincenal' && !form.fecha_inicio) return 'Para una ruta quincenal indica la fecha de inicio'
  if (form.frecuencia === 'fechas' && form.fechas_especificas.length === 0) return 'Agrega al menos una fecha específica'
  return null
}

/** Arma el payload de insert/update de la ruta a partir del formulario. */
export function construirPayloadRuta(
  form: RutaForm,
  tipoRuta: TipoRuta,
  clienteIds: string[],
  contadorIds: string[],
  unidadIds: string[]
) {
  const esRecurrente = form.frecuencia !== 'unica'
  return {
    nombre: form.nombre.trim(),
    descripcion: form.descripcion.trim() || null,
    project_id: form.project_id,
    tipo_ruta: tipoRuta,
    cliente_ids: tipoRuta === 'clientes' ? clienteIds : [],
    contador_ids: tipoRuta === 'contadores' ? contadorIds : [],
    unidad_ids: tipoRuta === 'unidades' ? unidadIds : [],
    asignado_a: form.asignado_a || null,
    asignado_nombre: form.asignado_nombre || null,
    asignado_email: form.asignado_email || null,
    asignado_telefono: form.asignado_telefono || null,
    fecha_programada: form.fecha_programada || null,
    // Periodicidad
    frecuencia: form.frecuencia,
    recurrencia_activa: esRecurrente ? form.recurrencia_activa : false,
    dias_semana: form.frecuencia === 'semanal' ? form.dias_semana : [],
    intervalo_dias: form.frecuencia === 'quincenal' ? (parseInt(form.intervalo_dias, 10) || 14) : null,
    dia_mes: form.frecuencia === 'mensual' ? (parseInt(form.dia_mes, 10) || 1) : null,
    fechas_especificas: form.frecuencia === 'fechas' ? form.fechas_especificas : [],
    hora_programada: form.hora_programada || null,
    fecha_inicio: esRecurrente ? (form.fecha_inicio || null) : null,
    fecha_fin: esRecurrente ? (form.fecha_fin || null) : null,
    recordatorio_anticipacion_min: Number(form.recordatorio_anticipacion_min) || 1440,
    recordatorio_canales: form.recordatorio_canales,
  }
}

export function filtrarClientesDisponibles(clientes: Cliente[], enRuta: Cliente[], busqueda: string): Cliente[] {
  return clientes.filter(
    c =>
      !enRuta.find(r => r.id === c.id) &&
      (c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        c.codigo.toLowerCase().includes(busqueda.toLowerCase()))
  )
}

export function filtrarContadoresDisponibles(
  contadores: Contador[],
  enRuta: Contador[],
  busqueda: string,
  projectId: string
): Contador[] {
  return contadores.filter(c => {
    if (!c.activo) return false
    if (enRuta.find(r => r.id === c.id)) return false
    if (!projectId || c.project_id !== projectId) return false
    const texto = busqueda.toLowerCase()
    if (!texto) return true
    return (
      c.numero_serie.toLowerCase().includes(texto) ||
      (c.descripcion ?? '').toLowerCase().includes(texto)
    )
  })
}

export function filtrarUnidadesDisponibles(
  unidades: Unidad[],
  enRuta: Unidad[],
  busqueda: string,
  projectId: string
): Unidad[] {
  return unidades.filter(u => {
    if (!u.activo) return false
    if (enRuta.find(r => r.id === u.id)) return false
    if (!projectId || u.project_id !== projectId) return false
    const texto = busqueda.toLowerCase()
    if (!texto) return true
    return (
      u.nombre.toLowerCase().includes(texto) ||
      u.tipo.toLowerCase().includes(texto)
    )
  })
}

/**
 * Construye el destino y mensaje de WhatsApp para notificar la asignación de
 * una ruta. Devuelve null si la ruta no tiene teléfono asignado.
 */
export function construirWhatsAppRuta(ruta: Ruta, countryCode: string): { tel: string; msg: string } | null {
  if (!ruta.asignado_telefono) return null
  let tel = ruta.asignado_telefono.replace(/[^0-9]/g, '')
  if (tel.length === 8) tel = countryCode + tel
  const fecha = ruta.fecha_programada
    ? new Date(ruta.fecha_programada + 'T12:00:00').toLocaleDateString('es-GT')
    : 'Por confirmar'
  const totalItems = ruta.tipo_ruta === 'contadores'
    ? ruta.contador_ids.length
    : ruta.tipo_ruta === 'unidades'
    ? ruta.unidad_ids.length
    : ruta.cliente_ids.length
  const labelItems = ruta.tipo_ruta === 'contadores'
    ? 'contadores'
    : ruta.tipo_ruta === 'unidades'
    ? 'unidades'
    : 'clientes'
  const msg =
    `Hola ${ruta.asignado_nombre ?? ''}, se te ha asignado una ruta de lecturas:\n` +
    `📋 *${ruta.nombre}*\n` +
    `📅 Fecha programada: ${fecha}\n` +
    `📍 Total de ${labelItems}: ${totalItems}\n` +
    (ruta.descripcion ? `📝 ${ruta.descripcion}\n` : '') +
    `\nPor favor asegúrate de completarla el día indicado.`
  return { tel, msg }
}
