// Lógica pura de las visitas frecuentes (pre-autorizaciones de ingreso).
//
// Una visita frecuente es una persona que el residente autoriza por
// anticipado (empleada doméstica, familiar, proveedor) y que la administración
// aprueba. En portería, al registrar el ingreso, el guardia la busca aquí y el
// sistema revisa si se presenta dentro de lo autorizado: estado aprobado,
// activa, vigente en calendario, día de la semana y franja horaria. Si cumple,
// el ingreso queda como pre-autorizado; si no, el guardia tiene que confirmar
// con el residente si da o no el ingreso.
//
// Sin React ni Supabase a propósito: lo consume la pestaña del guardia, la de
// administración y el portal del residente, y se prueba sola.
import type { EstadoVisitaFrecuente, RelacionVisitaFrecuente, VisitaFrecuente } from '../types'

export type DiaSemana = 'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo'

/** Orden de la semana tal como se guarda en `dias_permitidos`. */
export const DIAS_SEMANA: DiaSemana[] = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
export const DIA_LABEL_CORTO: Record<DiaSemana, string> = {
  lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D',
}
export const DIA_LABEL: Record<DiaSemana, string> = {
  lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo',
}

export const RELACIONES_VISITA: { value: RelacionVisitaFrecuente; label: string; icon: string }[] = [
  { value: 'familiar',  label: 'Familiar',  icon: '👨‍👩‍👧' },
  { value: 'empleado',  label: 'Empleado',  icon: '👷' },
  { value: 'proveedor', label: 'Proveedor', icon: '🚚' },
  { value: 'amigo',     label: 'Amigo',     icon: '👋' },
  { value: 'otro',      label: 'Otro',      icon: '👤' },
]

export function relacionLabel(relacion: RelacionVisitaFrecuente | string): string {
  return RELACIONES_VISITA.find(r => r.value === relacion)?.label ?? relacion
}

export const ESTADO_VISITA_LABEL: Record<EstadoVisitaFrecuente, string> = {
  pendiente: 'Pendiente de aprobación',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
}

/**
 * Estado efectivo: las filas anteriores a 20261107000000 no traen `estado` y
 * las creó la administración, así que se leen como aprobadas.
 */
export function estadoVisita(v: Pick<VisitaFrecuente, 'estado'>): EstadoVisitaFrecuente {
  return v.estado ?? 'aprobada'
}

/** Día de la semana LOCAL de un instante. */
export function diaSemanaLocal(d: Date): DiaSemana {
  // getDay(): 0 = domingo … 6 = sábado.
  const idx = d.getDay()
  return DIAS_SEMANA[idx === 0 ? 6 : idx - 1]
}

/** 'HH:MM' local de un instante. */
export function horaLocalHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' local de un instante. */
export function fechaLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Normaliza una hora que puede venir de Postgres (`time` → 'HH:MM:SS') o de un
 * <input type="time"> ('HH:MM') a 'HH:MM'. Devuelve null si está vacía.
 */
export function horaHHMM(valor: string | null | undefined): string | null {
  if (!valor) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(valor)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * ¿`hora` ('HH:MM') cae dentro de la franja [desde, hasta]? Una franja sin
 * límite por un lado se toma abierta por ese lado. Si `hasta` < `desde` la
 * franja cruza la medianoche (turno nocturno 22:00–06:00).
 */
export function horaDentroDeFranja(hora: string, desde: string | null, hasta: string | null): boolean {
  if (!desde && !hasta) return true
  if (desde && !hasta) return hora >= desde
  if (!desde && hasta) return hora <= hasta
  if (desde! <= hasta!) return hora >= desde! && hora <= hasta!
  return hora >= desde! || hora <= hasta!
}

/** Días permitidos efectivos: lista vacía o nula = todos los días. */
export function diasPermitidos(v: Pick<VisitaFrecuente, 'dias_permitidos'>): DiaSemana[] {
  const dias = (v.dias_permitidos ?? []).filter((d): d is DiaSemana => (DIAS_SEMANA as string[]).includes(d))
  return dias.length === 0 ? [...DIAS_SEMANA] : DIAS_SEMANA.filter(d => dias.includes(d))
}

/** 'L–V', 'L, X, V', 'Todos los días'. */
export function describirDias(v: Pick<VisitaFrecuente, 'dias_permitidos'>): string {
  const dias = diasPermitidos(v)
  if (dias.length === 7) return 'Todos los días'
  const idx = dias.map(d => DIAS_SEMANA.indexOf(d))
  const consecutivos = idx.every((n, i) => i === 0 || n === idx[i - 1] + 1)
  if (consecutivos && dias.length >= 3) return `${DIA_LABEL_CORTO[dias[0]]}–${DIA_LABEL_CORTO[dias[dias.length - 1]]}`
  return dias.map(d => DIA_LABEL_CORTO[d]).join(', ')
}

/** '08:00–17:00', 'desde 08:00', 'hasta 17:00' o 'Cualquier hora'. */
export function describirHorario(v: Pick<VisitaFrecuente, 'hora_desde' | 'hora_hasta'>): string {
  const desde = horaHHMM(v.hora_desde)
  const hasta = horaHHMM(v.hora_hasta)
  if (!desde && !hasta) return 'Cualquier hora'
  if (desde && !hasta) return `desde ${desde}`
  if (!desde && hasta) return `hasta ${hasta}`
  return `${desde}–${hasta}`
}

/** 'Hasta 2026-12-31', 'Del 2026-11-01 al 2026-12-31' o '' si no hay límite. */
export function describirVigencia(v: Pick<VisitaFrecuente, 'vigente_desde' | 'vigente_hasta'>): string {
  const desde = v.vigente_desde?.slice(0, 10)
  const hasta = v.vigente_hasta?.slice(0, 10)
  if (desde && hasta) return `Del ${desde} al ${hasta}`
  if (hasta) return `Hasta ${hasta}`
  if (desde) return `Desde ${desde}`
  return ''
}

export interface EvaluacionVisitaFrecuente {
  /** true = el ingreso puede registrarse como pre-autorizado sin consultar al residente. */
  cumple: boolean
  /** Reglas incumplidas, en palabras para el guardia. Vacío si cumple. */
  motivos: string[]
  /** Lo autorizado, en una línea ('L–V · 08:00–17:00 · Hasta 2026-12-31'). */
  autorizado: string
}

/**
 * Revisa si la persona se presenta dentro de lo autorizado en el instante
 * `ahora` (hora LOCAL del dispositivo del guardia): estado aprobado, activa,
 * vigencia en calendario, día de la semana y franja horaria. Devuelve TODOS
 * los motivos incumplidos, no solo el primero: el guardia se los lee al
 * residente.
 */
export function evaluarVisitaFrecuente(v: VisitaFrecuente, ahora: Date = new Date()): EvaluacionVisitaFrecuente {
  const motivos: string[] = []
  const estado = estadoVisita(v)
  if (estado === 'pendiente') motivos.push('La administración aún no aprueba esta autorización')
  if (estado === 'rechazada') motivos.push(`La administración rechazó esta autorización${v.motivo_rechazo ? ` (${v.motivo_rechazo})` : ''}`)
  if (!v.activo) motivos.push('La autorización está suspendida')

  const hoy = fechaLocalYMD(ahora)
  const desde = v.vigente_desde?.slice(0, 10)
  const hasta = v.vigente_hasta?.slice(0, 10)
  if (desde && hoy < desde) motivos.push(`La autorización inicia el ${desde}`)
  if (hasta && hoy > hasta) motivos.push(`La autorización venció el ${hasta}`)

  const dia = diaSemanaLocal(ahora)
  const dias = diasPermitidos(v)
  if (!dias.includes(dia)) motivos.push(`Hoy es ${DIA_LABEL[dia]} y solo tiene autorizado ${describirDias(v)}`)

  const hora = horaLocalHHMM(ahora)
  const hDesde = horaHHMM(v.hora_desde)
  const hHasta = horaHHMM(v.hora_hasta)
  if (!horaDentroDeFranja(hora, hDesde, hHasta)) motivos.push(`Son las ${hora} y su horario autorizado es ${describirHorario(v)}`)

  const autorizado = [describirDias(v), describirHorario(v), describirVigencia(v)].filter(Boolean).join(' · ')
  return { cumple: motivos.length === 0, motivos, autorizado }
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function soloAlfanumerico(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

export interface CriteriosBusquedaFrecuente {
  nombre?: string
  identificacion?: string
  placa?: string
  /** Si se indica, solo coincidencias de esa unidad. */
  unidadId?: string
}

/**
 * Visitas frecuentes que coinciden con lo que el guardia va tecleando (mínimo
 * 3 caracteres en nombre, identificación o placa). Aprobadas y activas
 * primero; las pendientes/rechazadas/suspendidas también salen —el guardia
 * tiene que saber que la persona "existe" aunque no cumpla— pero al final.
 * Máximo 5.
 */
export function buscarVisitasFrecuentes(
  lista: VisitaFrecuente[],
  c: CriteriosBusquedaFrecuente,
): VisitaFrecuente[] {
  const nombre = normalizar(c.nombre ?? '')
  const ident = soloAlfanumerico(c.identificacion ?? '')
  const placa = soloAlfanumerico(c.placa ?? '')
  if (nombre.length < 3 && ident.length < 3 && placa.length < 3) return []
  const peso = (v: VisitaFrecuente) => (estadoVisita(v) === 'aprobada' && v.activo ? 0 : estadoVisita(v) === 'pendiente' ? 1 : 2)
  return lista
    .filter(v => !c.unidadId || v.unidad_id === c.unidadId)
    .filter(v =>
      (nombre.length >= 3 && normalizar(v.nombre).includes(nombre)) ||
      (ident.length >= 3 && soloAlfanumerico(v.identificacion ?? '').includes(ident)) ||
      (placa.length >= 3 && soloAlfanumerico(v.placa_vehiculo ?? '').includes(placa)),
    )
    .sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre))
    .slice(0, 5)
}

export type MedioAutorizacionResidente = 'llamada' | 'intercom' | 'portal' | 'presencial' | 'otro'
export const MEDIOS_AUTORIZACION: { value: MedioAutorizacionResidente; label: string }[] = [
  { value: 'llamada',    label: 'Llamada telefónica' },
  { value: 'intercom',   label: 'Intercomunicador' },
  { value: 'portal',     label: 'Mensaje / portal' },
  { value: 'presencial', label: 'En persona' },
  { value: 'otro',       label: 'Otro medio' },
]

export interface AutorizacionResidenteForm {
  decision: '' | 'autoriza' | 'deniega'
  medio: MedioAutorizacionResidente
  /** Nombre de quien respondió por la unidad. */
  quien: string
  comentario: string
}

export const autorizacionResidenteVacia = (): AutorizacionResidenteForm => ({
  decision: '', medio: 'llamada', quien: '', comentario: '',
})

/**
 * Texto que queda en `visitantes.autorizacion_detalle` (o en la novedad de
 * ingreso denegado): qué incumplía y quién decidió. Es lo que la
 * administración lee después, así que va completo y en una sola línea.
 */
export function describirAutorizacionResidente(
  ev: EvaluacionVisitaFrecuente | null,
  a: AutorizacionResidenteForm,
): string {
  const partes: string[] = []
  if (ev && !ev.cumple) partes.push(`Fuera de lo autorizado: ${ev.motivos.join('; ')}`)
  const medio = MEDIOS_AUTORIZACION.find(m => m.value === a.medio)?.label ?? a.medio
  const quien = a.quien.trim()
  partes.push(
    a.decision === 'deniega'
      ? `El residente${quien ? ` (${quien})` : ''} NO autorizó el ingreso por ${medio.toLowerCase()}`
      : `Autorizó el residente${quien ? ` (${quien})` : ''} por ${medio.toLowerCase()}`,
  )
  if (a.comentario.trim()) partes.push(a.comentario.trim())
  return partes.join(' · ')
}
