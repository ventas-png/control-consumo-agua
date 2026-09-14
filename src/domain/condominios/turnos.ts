// domain/condominios/turnos.ts — reglas del control de asignación de turnos.
//
// Vive fuera de los tabs a propósito, igual que limpieza.ts: son las decisiones
// del módulo (cuándo cae una regla, qué pasa si ese día es festivo o la persona
// está de vacaciones, cuántas horas son ordinarias y cuántas extra) y se prueban
// sin montar React ni Supabase.
//
// ── POR QUÉ ESTÁ DUPLICADO CON EL SQL ──────────────────────────────────────
// `reglaAplicaEn()` es el espejo de `turnos_regla_aplica()` (20260820000200) y
// `horasJornada()` el de `turnos_horas_jornada()` (20260820000000). No es un
// descuido: la BD materializa el PASADO Y EL PRESENTE en `bloques_turno`, pero
// el calendario tiene que poder pintar CUALQUIER mes futuro —incluido uno que
// nadie ha generado todavía— sin escribir una fila. Sin esta copia, abrir
// "marzo del año que viene" exigiría generar marzo.
//
// La consecuencia es un contrato: si cambia una de las dos implementaciones,
// cambia la otra. Los mismos casos se prueban en los dos lados
// (src/domain/condominios/__tests__/turnos.test.ts y
// supabase/tests/turnos/assert.sql, invariantes 6-12).
//
// ── VOCABULARIOS DE TURNO ──────────────────────────────────────────────────
// El repo arrastra tres y esta feature NO añade un cuarto: la jornada
// (`PlantillaHorario`) es la fuente de verdad de las horas, y declara con qué
// etiqueta de `bloques_turno` se corresponde. `TURNO_A_TURNO_PERSONAL` es el
// puente hacia el vocabulario del expediente.
import type {
  AsignacionTurno,
  AusenciaPersonal,
  BloqueTurno,
  DiaNoLaborable,
  ExcepcionTurno,
  FrecuenciaTurno,
  PersonalCondominio,
  PlantillaHorario,
  TurnoPersonal,
  TurnoTipo,
} from '../../types'
import { diaISOSemana } from '../../lib/calendario'

// ── Catálogos para la UI ────────────────────────────────────────────────────

/** Las once periodicidades, con la etiqueta que ve el administrador. */
export const FRECUENCIAS: { value: FrecuenciaTurno; label: string; ayuda: string }[] = [
  { value: 'unica',      label: 'Única',       ayuda: 'Un solo día' },
  { value: 'diaria',     label: 'Diaria',      ayuda: 'Todos los días, o cada N días' },
  { value: 'semanal',    label: 'Semanal',     ayuda: 'Los días de la semana que elijas' },
  { value: 'quincenal',  label: 'Quincenal',   ayuda: 'Esos mismos días, semana de por medio' },
  { value: 'mensual_dias', label: 'Días del mes', ayuda: 'Los días del mes que elijas, todos los meses' },
  { value: 'mensual',    label: 'Mensual',     ayuda: 'Un día fijo de cada mes' },
  { value: 'bimestral',  label: 'Bimestral',   ayuda: 'Un día fijo cada 2 meses' },
  { value: 'trimestral', label: 'Trimestral',  ayuda: 'Un día fijo cada 3 meses' },
  { value: 'semestral',  label: 'Semestral',   ayuda: 'Un día fijo cada 6 meses' },
  { value: 'anual',      label: 'Anual',       ayuda: 'Un día fijo cada año' },
  { value: 'fechas',     label: 'Fechas fijas', ayuda: 'Solo las fechas que listes' },
]

/** Días ISO para los selectores. 1 = lunes, 7 = domingo. */
export const DIAS_ISO: { value: number; label: string; corto: string }[] = [
  { value: 1, label: 'Lunes',     corto: 'L' },
  { value: 2, label: 'Martes',    corto: 'M' },
  { value: 3, label: 'Miércoles', corto: 'X' },
  { value: 4, label: 'Jueves',    corto: 'J' },
  { value: 5, label: 'Viernes',   corto: 'V' },
  { value: 6, label: 'Sábado',    corto: 'S' },
  { value: 7, label: 'Domingo',   corto: 'D' },
]

/** Frecuencias que usan `dias_semana`; el resto ignora ese campo. */
export const FRECUENCIAS_POR_DIA_SEMANA: FrecuenciaTurno[] = ['semanal', 'quincenal']

/** Frecuencias que usan `dias_mes` (el gemelo mensual de `dias_semana`). */
export const FRECUENCIAS_POR_DIAS_MES: FrecuenciaTurno[] = ['mensual_dias']

/** Días del mes para el selector de `mensual_dias`. */
export const DIAS_DEL_MES: number[] = Array.from({ length: 31 }, (_, i) => i + 1)

/** Frecuencias que usan `dia_mes` / `mes_ancla`. */
export const FRECUENCIAS_POR_MES: FrecuenciaTurno[] = [
  'mensual', 'bimestral', 'trimestral', 'semestral', 'anual',
]

/** Cuántos meses salta cada periodicidad larga. */
const MESES_POR_FRECUENCIA: Partial<Record<FrecuenciaTurno, number>> = {
  mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12,
}

/**
 * Puente entre el turno del bloque y el del expediente. Existe porque
 * `leTocaArea()` (limpieza.ts:59-67) compara `programacion_limpieza.turno`
 * (diurno/nocturno) con `personal_condominio.turno`, mientras `bloques_turno`
 * usa manana/tarde/noche: sin traducción, un empleado nunca encaja.
 */
export const TURNO_A_TURNO_PERSONAL: Record<TurnoTipo, TurnoPersonal> = {
  manana: 'diurno',
  tarde: 'diurno',
  noche: 'nocturno',
}

// ── Aritmética de la jornada ────────────────────────────────────────────────

/**
 * Minutos desde medianoche de un `HH:MM` o `HH:MM:SS`. NaN-safe → null.
 *
 * LOS SEGUNDOS CUENTAN, y devuelve fracción de minuto por eso. Aceptaba el
 * formato con segundos y los TIRABA, lo que estuvo bien mientras todas las
 * horas venían de un `<input type="time">` (que graba `HH:MM`). Desde que el
 * marcaje de autoservicio las pone el servidor con segundos (20260908000000),
 * descartarlos convertía dos marcajes del mismo minuto en `fin == inicio` — y
 * la regla de abajo lo leía como cruce de medianoche: 34 segundos de jornada
 * mostrados como 24 HORAS. Pasó en producción el primer día.
 *
 * Además rompía el contrato con `turnos_horas_jornada()`, que usa
 * `EXTRACT(EPOCH FROM time)` y por tanto SIEMPRE contó los segundos: la misma
 * fila valía 24 h en pantalla y 0.01 h en la nómina.
 */
export function minutosDesdeMedianoche(hora: string | null | undefined): number | null {
  if (!hora) return null
  const [h, m, s] = hora.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m + (Number.isFinite(s) ? s / 60 : 0)
}

const minutosDe = minutosDesdeMedianoche

/**
 * Horas efectivas de una jornada, descontando el descanso.
 *
 * Un `fin <= inicio` se interpreta SIEMPRE como cruce de medianoche, aunque
 * nadie haya marcado la bandera. Es exactamente el bug que hoy hace desaparecer
 * el turno nocturno de PresenciaPersonalTab (:167-174): 22:00→06:00 daba −960
 * minutos y la UI escondía la fila.
 */
export function horasJornada(
  inicio: string | null | undefined,
  fin: string | null | undefined,
  cruzaMedianoche = false,
  minutosDescanso = 0,
): number | null {
  const ini = minutosDe(inicio)
  const f = minutosDe(fin)
  if (ini === null || f === null) return null
  const finReal = cruzaMedianoche || f <= ini ? f + 1440 : f
  const total = (finReal - ini - (minutosDescanso || 0)) / 60
  return Math.max(0, Math.round(total * 100) / 100)
}

/** Tramos de la franja nocturna, en minutos desde el inicio del día. */
const FRANJAS_NOCTURNAS: [number, number][] = [[0, 360], [1200, 1800], [2640, 2880]]

/**
 * Horas de la jornada que caen en la franja nocturna 20:00–06:00 (art. 116 del
 * Código de Trabajo de Guatemala). Se informan aparte, sin factor: el recargo
 * nocturno depende del contrato y esto cuenta horas, no decide sueldos.
 */
export function horasNocturnas(
  inicio: string | null | undefined,
  fin: string | null | undefined,
  cruzaMedianoche = false,
): number | null {
  const ini = minutosDe(inicio)
  const f = minutosDe(fin)
  if (ini === null || f === null) return null
  const finReal = cruzaMedianoche || f <= ini ? f + 1440 : f
  const solape = FRANJAS_NOCTURNAS.reduce(
    (acc, [desde, hasta]) => acc + Math.max(0, Math.min(finReal, hasta) - Math.max(ini, desde)),
    0,
  )
  return Math.round((solape / 60) * 100) / 100
}

/** `8.5` → `"8h 30m"`. Vacío legible cuando no hay dato. */
export function formatHoras(horas: number | null | undefined): string {
  if (horas === null || horas === undefined) return '—'
  const h = Math.floor(horas)
  const m = Math.round((horas - h) * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ── Recurrencia ─────────────────────────────────────────────────────────────

/** Partes numéricas de una fecha ISO local, sin pasar por `Date`. */
function partes(fecha: string): { y: number; m: number; d: number } {
  const [y, m, d] = fecha.split('-').map(Number)
  return { y, m, d }
}

/** Días entre dos fechas ISO. Mediodía local para que el DST no mueva el día. */
function diasEntre(desde: string, hasta: string): number {
  const a = partes(desde)
  const b = partes(hasta)
  const ms = new Date(b.y, b.m - 1, b.d, 12).getTime() - new Date(a.y, a.m - 1, a.d, 12).getTime()
  return Math.round(ms / 86400000)
}

/** Último día del mes de una fecha ISO (28/29/30/31). */
function ultimoDiaDelMes(fecha: string): number {
  const { y, m } = partes(fecha)
  return new Date(y, m, 0).getDate()
}

/**
 * ¿Cae esta regla en esta fecha?
 *
 * Espejo exacto de `turnos_regla_aplica()` (20260820000200). Ver la cabecera
 * del módulo para por qué existen las dos.
 */
export function reglaAplicaEn(
  regla: Pick<
    AsignacionTurno,
    'frecuencia' | 'fecha_inicio' | 'dias_semana' | 'intervalo_dias'
    | 'dia_mes' | 'mes_ancla' | 'fechas_especificas'
  > & Partial<Pick<AsignacionTurno, 'dias_mes'>>,
  fecha: string,
): boolean {
  if (!fecha || !regla.fecha_inicio || fecha < regla.fecha_inicio) return false

  const dias = regla.dias_semana ?? []
  // Sin días declarados el filtro semanal no filtra: la regla cubre la semana
  // entera. Con días declarados, solo esos.
  const encajaDia = dias.length === 0 || dias.includes(diaISOSemana(fecha))

  switch (regla.frecuencia) {
    case 'unica':
      return fecha === regla.fecha_inicio

    case 'diaria':
      return diasEntre(regla.fecha_inicio, fecha) % Math.max(regla.intervalo_dias || 1, 1) === 0

    case 'semanal':
      return encajaDia

    case 'quincenal':
      // Semanas completas desde el inicio: la 0, la 2, la 4… Contar por semana y
      // no por día es lo que hace que "lunes y jueves cada quince días" caiga en
      // las dos semanas alternas correctas.
      return encajaDia && Math.floor(diasEntre(regla.fecha_inicio, fecha) / 7) % 2 === 0

    case 'mensual_dias': {
      // El gemelo mensual de 'semanal': los días del mes marcados, todos los
      // meses. Un día que ese mes no existe (31 en febrero) se recorta al
      // último real, igual que las periodicidades de día fijo. Sin lista se cae
      // de vuelta en `dia_mes`, para no producir una regla que no cae nunca.
      const ultimo = ultimoDiaDelMes(fecha)
      const dia = partes(fecha).d
      const marcados = regla.dias_mes ?? []
      if (marcados.length === 0) {
        return dia === Math.min(regla.dia_mes ?? partes(regla.fecha_inicio).d, ultimo)
      }
      return marcados.some(d => Math.min(d, ultimo) === dia)
    }

    case 'fechas':
      return (regla.fechas_especificas ?? []).includes(fecha)

    case 'mensual':
    case 'bimestral':
    case 'trimestral':
    case 'semestral':
    case 'anual': {
      const saltoMeses = MESES_POR_FRECUENCIA[regla.frecuencia] ?? 1
      const ini = partes(regla.fecha_inicio)
      const act = partes(fecha)
      const offset = (act.y - ini.y) * 12 + (act.m - (regla.mes_ancla ?? ini.m))
      if (((offset % saltoMeses) + saltoMeses) % saltoMeses !== 0) return false
      // Día 31 en un mes de 30 cae el 30, y en febrero el 28 o el 29. Recortar
      // es lo único razonable: saltarse el mes dejaría al empleado sin turno
      // siete veces al año.
      const objetivo = Math.min(regla.dia_mes ?? ini.d, ultimoDiaDelMes(fecha))
      return act.d === objetivo
    }

    default:
      return false
  }
}

/** Fechas ISO en que la regla cae dentro de `[desde, hasta]`, ya acotadas a su vigencia. */
export function fechasDeRegla(regla: AsignacionTurno, desde: string, hasta: string): string[] {
  if (!regla.activa) return []
  const inicio = desde > regla.fecha_inicio ? desde : regla.fecha_inicio
  const fin = regla.fecha_fin && regla.fecha_fin < hasta ? regla.fecha_fin : hasta
  if (inicio > fin) return []

  const out: string[] = []
  const { y, m, d } = partes(inicio)
  const cursor = new Date(y, m - 1, d, 12)
  const total = diasEntre(inicio, fin)
  for (let i = 0; i <= total; i++) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (reglaAplicaEn(regla, iso)) out.push(iso)
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/** Resumen legible de la periodicidad, para la tarjeta de la regla. */
export function describirRegla(regla: AsignacionTurno): string {
  const etiqueta = FRECUENCIAS.find(f => f.value === regla.frecuencia)?.label ?? regla.frecuencia
  const dias = regla.dias_semana ?? []

  if (regla.frecuencia === 'unica') return `Solo el ${regla.fecha_inicio}`
  if (regla.frecuencia === 'fechas') {
    const n = (regla.fechas_especificas ?? []).length
    return `${n} ${n === 1 ? 'fecha fija' : 'fechas fijas'}`
  }
  if (regla.frecuencia === 'diaria') {
    const cada = regla.intervalo_dias && regla.intervalo_dias > 1
    return cada ? `Cada ${regla.intervalo_dias} días` : 'Todos los días'
  }
  if (regla.frecuencia === 'mensual_dias') {
    const marcados = (regla.dias_mes ?? []).slice().sort((a, b) => a - b)
    return marcados.length
      ? `Días del mes · ${marcados.join(', ')}`
      : `Días del mes · ${regla.dia_mes ?? partes(regla.fecha_inicio).d}`
  }
  if (FRECUENCIAS_POR_DIA_SEMANA.includes(regla.frecuencia)) {
    const nombres = dias.length
      ? dias.slice().sort((a, b) => a - b).map(d => DIAS_ISO.find(x => x.value === d)?.corto ?? '?').join('·')
      : 'todos los días'
    return `${etiqueta} · ${nombres}`
  }
  return `${etiqueta} · día ${regla.dia_mes ?? partes(regla.fecha_inicio).d}`
}

// ── Excepciones del calendario ──────────────────────────────────────────────

/** El día no laborable de esa fecha, si lo hay. */
export function diaNoLaborableEn(dias: DiaNoLaborable[], fecha: string): DiaNoLaborable | undefined {
  return dias.find(d => d.fecha === fecha)
}

/**
 * La ausencia que cubre esa fecha para esa persona.
 *
 * Solo cuentan las APROBADAS: una solicitud pendiente no puede dejar la garita
 * sin cubrir. Es la misma condición que aplica `generar_bloques_turno()`.
 */
export function ausenciaEn(
  ausencias: AusenciaPersonal[],
  personalId: string,
  fecha: string,
): AusenciaPersonal | undefined {
  return ausencias.find(
    a => a.personal_id === personalId
      && a.estado === 'aprobada'
      && a.fecha_inicio <= fecha
      && a.fecha_fin >= fecha,
  )
}

/**
 * La excepción que quita el turno de esa persona ese día, si existe.
 *
 * Es por (persona, fecha) y no por regla a propósito: lo que el administrador
 * decidió al pulsar «Quitar» es que esa persona no viene ese día, y cambiar de
 * regla después no debería resucitar el turno.
 */
export function excepcionEn(
  excepciones: ExcepcionTurno[],
  personalId: string,
  fecha: string,
): ExcepcionTurno | undefined {
  return excepciones.find(e => e.personal_id === personalId && e.fecha === fecha)
}

/** Días naturales que abarca una ausencia (inclusive en ambos extremos). */
export function diasDeAusencia(a: Pick<AusenciaPersonal, 'fecha_inicio' | 'fecha_fin'>): number {
  return diasEntre(a.fecha_inicio, a.fecha_fin) + 1
}

/**
 * Días de una ausencia que realmente cuestan jornada: se descuentan los días no
 * laborables. Es el número que consume el saldo de vacaciones — cobrarle al
 * empleado el asueto que cae dentro de sus vacaciones sería quitárselo.
 */
export function diasHabilesDeAusencia(
  a: Pick<AusenciaPersonal, 'fecha_inicio' | 'fecha_fin'>,
  noLaborables: DiaNoLaborable[],
): number {
  const total = diasDeAusencia(a)
  const feriados = noLaborables.filter(d => d.fecha >= a.fecha_inicio && d.fecha <= a.fecha_fin).length
  return Math.max(0, total - feriados)
}

// ── Vista de calendario ─────────────────────────────────────────────────────

/** Qué le pasa a una persona un día concreto. */
export interface CeldaTurno {
  fecha: string
  personalId: string
  /** Bloque ya materializado en la BD, si existe. */
  bloque?: BloqueTurno
  /** Regla que cubre ese día aunque todavía no se haya generado el bloque. */
  regla?: AsignacionTurno
  plantilla?: PlantillaHorario
  ausencia?: AusenciaPersonal
  noLaborable?: DiaNoLaborable
  /** Día que un administrador quitó a mano: la regla no manda aquí. */
  excepcion?: ExcepcionTurno
  /**
   * El turno está programado pero la persona no puede cubrirlo (ausencia
   * aprobada, o festivo que la regla no declara cubrir). El generador nunca
   * crea estos, pero SÍ aparecen cuando la ausencia se aprueba DESPUÉS de
   * generar: el bloque viejo se queda y hay que verlo.
   */
  enConflicto: boolean
}

/**
 * Estado de una persona en un día, mezclando lo materializado (`bloques`) con lo
 * que las reglas predicen. Un mes futuro sin generar se pinta igual que uno
 * generado: es lo que justifica que la recurrencia viva también en TypeScript.
 */
export function celdaDe(
  fecha: string,
  personalId: string,
  fuentes: {
    bloques: BloqueTurno[]
    reglas: AsignacionTurno[]
    plantillas: PlantillaHorario[]
    ausencias: AusenciaPersonal[]
    noLaborables: DiaNoLaborable[]
    excepciones?: ExcepcionTurno[]
  },
): CeldaTurno {
  const bloque = fuentes.bloques.find(b => b.personal_id === personalId && b.fecha === fecha)
  const excepcion = excepcionEn(fuentes.excepciones ?? [], personalId, fecha)
  // Una excepción SIN bloque deja el día vacío: la regla ya no predice nada
  // ahí. Con bloque manda el bloque —quien reasignó el día después de quitarlo
  // decidió lo contrario— y la excepción solo queda como rastro.
  const reglaVigente = bloque?.asignacion_id
    ? fuentes.reglas.find(r => r.id === bloque.asignacion_id)
    : fuentes.reglas.find(r => r.personal_id === personalId && reglaAplicaEn(r, fecha)
        && r.activa && r.fecha_inicio <= fecha && (!r.fecha_fin || r.fecha_fin >= fecha))
  const regla = !bloque && excepcion ? undefined : reglaVigente

  const plantillaId = bloque?.plantilla_horario_id ?? regla?.plantilla_horario_id
  const plantilla = plantillaId ? fuentes.plantillas.find(p => p.id === plantillaId) : undefined
  const ausencia = ausenciaEn(fuentes.ausencias, personalId, fecha)
  const noLaborable = diaNoLaborableEn(fuentes.noLaborables, fecha)

  const hayTurno = Boolean(bloque || regla)
  const chocaConFestivo = Boolean(noLaborable) && !regla?.cubre_dias_no_laborables

  return {
    fecha,
    personalId,
    bloque,
    regla,
    plantilla,
    ausencia,
    noLaborable,
    excepcion,
    enConflicto: hayTurno && (Boolean(ausencia) || chocaConFestivo),
  }
}

/**
 * ¿Se puede tocar este día desde el calendario?
 *
 * Dos candados, y ninguno es el permiso RBAC (ese lo pone el tab aparte):
 *   · LO PASADO NO SE EDITA. El calendario programa el futuro; corregir lo que
 *     ya ocurrió es trabajo de Presencia y de las correcciones de marcaje
 *     (20260908000200), que dejan rastro de quién cambió qué.
 *   · LO YA EMPEZADO TAMPOCO. Un bloque en curso, completado o incompleto
 *     arrastra su checklist de `tareas_bloque` y sus revisiones; moverle la
 *     jornada por debajo dejaría el checklist hablando de otro turno.
 *
 * El día de hoy SÍ se edita: a las 6 de la mañana todavía se puede decidir
 * quién cubre la noche.
 */
export function celdaEditable(celda: CeldaTurno, hoy: string): boolean {
  if (celda.fecha < hoy) return false
  return !celda.bloque || celda.bloque.estado === 'pendiente'
}

/** Por qué no se puede editar esta celda. `null` = sí se puede. */
export function motivoNoEditable(celda: CeldaTurno, hoy: string): string | null {
  if (celda.fecha < hoy) return 'Ese día ya pasó: el calendario solo programa de hoy en adelante.'
  if (celda.bloque && celda.bloque.estado !== 'pendiente') {
    return 'El turno ya arrancó y tiene tareas asociadas: se corrige desde Presencia, no aquí.'
  }
  return null
}

/** Horas que una celda representa: las del bloque si existe, si no las de la jornada. */
export function horasDeCelda(celda: CeldaTurno): number | null {
  if (celda.ausencia) return 0
  if (celda.bloque?.horas_planificadas != null) return celda.bloque.horas_planificadas
  if (celda.bloque) return horasJornada(celda.bloque.hora_inicio, celda.bloque.hora_fin, celda.bloque.cruza_medianoche ?? false)
  if (celda.plantilla) return celda.plantilla.horas_jornada ?? horasJornada(
    celda.plantilla.hora_inicio, celda.plantilla.hora_fin,
    celda.plantilla.cruza_medianoche, celda.plantilla.minutos_descanso,
  )
  return null
}

/** Empleados a los que se les puede asignar un turno hoy. */
export function asignables(personal: PersonalCondominio[]): PersonalCondominio[] {
  // 'vacaciones' e 'incapacidad' NO se filtran: la regla se define para meses y
  // la ausencia de esta semana no debería impedir programar el trimestre. Quien
  // decide día a día es `ausenciaEn()`.
  return personal.filter(p => p.estado !== 'inactivo')
}
