// domain/condominios/balanceJornada.ts — Lo esperado y lo ocurrido, uno al lado
// del otro (fase 2).
//
// QUÉ HACE. Lee. Nada más. Pone la vara que la fase 1 congeló en el bloque
// (`bloques_turno.politica`) junto al marcaje que efectivamente ocurrió, y dice
// en qué se diferencian: cuántos minutos tarde, en qué tramo cae esa demora,
// cuánto se salió antes, cuánto descanso se excedió por tipo, y cuánto quedó
// por encima de la jornada.
//
// LO QUE SIGUE SIN HACER. Cambiar un número de la planilla. `calcular_horas_
// personal` devuelve exactamente lo mismo con esto puesto que sin esto — hay una
// invariante de sandbox que lo comprueba comparando la fila entera antes y
// después. Debitar la demora, exigir la compensación y reconocer la extra es la
// fase 4, y no se hace hasta poder mirar un mes real de estas comparaciones.
//
// POR QUÉ EL CÓMPUTO ESTÁ EN SQL Y NO AQUÍ. Porque la medianoche. La misma
// jornada de 22:00 a 06:00 que produjo #839 vuelve a aparecer en cada resta:
// entrar 00:30 a un turno de las 22:00 son 150 minutos tarde, no −1290. Esa
// regla ya vive en `turnos_horas_jornada` y ahora en `turnos_minutos_desvio`;
// duplicarla en TypeScript sería garantizar que un día divergan.
import { supabase } from '../../lib/supabase'
import { reportDegradedQuery } from '../queryFetch'

/** Los tres tramos en que puede caer una demora. `null` = no hubo demora. */
export type TramoDemora = 'sin_consecuencia' | 'compensable' | 'debitada'

/** Cada cosa que el día no cumplió. Vacío = el día cumple. */
export type HallazgoBalance =
  | 'sin_vara'
  | 'politica_ambigua'
  | 'sin_planificar'
  | 'turno_partido'
  | 'sin_marcaje'
  | 'marcajes_multiples'
  | 'marcaje_ambiguo'
  | 'jornada_abierta'
  | 'demora'
  | 'salida_temprana'
  | 'exceso_descanso'
  | 'extra_sin_autorizar'

/** Un día de una persona: lo esperado, lo ocurrido y la diferencia. */
export interface BalanceDia {
  personal_id: string
  nombre: string
  cargo: string | null
  fecha: string
  // Lo esperado
  bloque_id: string | null
  /** Cuántos bloques tuvo el día. >1 = turno partido, y entonces no se juzga. */
  bloques: number | null
  turno_inicio: string | null
  turno_fin: string | null
  horas_planificadas: number | null
  tiene_vara: boolean
  // Lo ocurrido
  registro_id: string | null
  /** TODOS los marcajes vigentes del día. La pantalla marca cada uno. */
  registro_ids: string[]
  registros: number
  hora_entrada: string | null
  hora_salida: string | null
  horas_estadia: number | null
  horas_descanso: number | null
  horas_laborales: number | null
  // La comparación
  minutos_tarde: number | null
  tramo_demora: TramoDemora | null
  minutos_salida_temprana: number | null
  minutos_exceso_descanso: number | null
  /** `null` = no se puede saber (turno partido con un solo marcaje). */
  horas_sobre_jornada: number | null
  extra_requiere_autorizacion: boolean | null
  cumple: boolean
  hallazgos: HallazgoBalance[]
}

/**
 * POR QUÉ SE DISTINGUEN DOS FALLOS.
 *
 * No ver el balance porque no te corresponde y no verlo porque la consulta se
 * cayó se parecen en la pantalla —en los dos casos no hay balance— y no se
 * parecen en nada para quien mira:
 *
 *   · `sin_permiso` es el diseño funcionando. La cuenta no tiene el permiso del
 *     tab, o el condominio no es suyo. La función responde 42501 y la sección
 *     simplemente no aparece: el marcaje sigue igual y no hay nada que avisar.
 *     Poner una advertencia acá sería avisar de que el candado cerró.
 *
 *   · `operacional` es la red, la base o un bug. Ahí SÍ hay algo que decir, y lo
 *     que no se puede hacer es callarlo: sin balance, cada fila queda sin su
 *     línea «Contra la jornada», que es exactamente el aspecto de un día sin
 *     hallazgos. Un fallo pintado como «todo en orden» es peor que no calcular
 *     nada, porque nadie va a volver a mirar.
 *
 * 42501 lo levanta la función tanto por el permiso del tab como por el alcance
 * de proyecto, y las dos cosas significan lo mismo para quien pregunta: este
 * balance no es tuyo.
 */
export type FalloBalance = 'sin_permiso' | 'operacional'

function clasificarFallo(error: { code?: string; message?: string }): FalloBalance {
  if (error.code === '42501') return 'sin_permiso'
  // El código es lo fiable; el texto es la red de seguridad para los caminos
  // donde PostgREST no lo propaga (un 403 del gateway, por ejemplo).
  if (/permission denied|no autorizado/i.test(error.message ?? '')) return 'sin_permiso'
  return 'operacional'
}

/**
 * El balance de un rango de días. Lo resuelve la base con la vara congelada en
 * cada bloque, no con la vigente hoy: una jornada que en marzo daba 45 min de
 * almuerzo se sigue juzgando con esos 45 aunque en septiembre den 60.
 */
export async function fetchBalanceDias(params: {
  projectId: string
  desde: string
  hasta: string
}): Promise<{ dias: BalanceDia[]; error: string | null; fallo: FalloBalance | null }> {
  const { data, error } = await supabase.rpc('presencia_balance_dia', {
    p_project_id: params.projectId,
    p_desde: params.desde,
    p_hasta: params.hasta,
  })
  reportDegradedQuery('condominios.fetchBalanceDias', error)
  if (error) return { dias: [], error: error.message, fallo: clasificarFallo(error) }
  return { dias: (data as BalanceDia[] | null) ?? [], error: null, fallo: null }
}

/** Cómo se lee cada hallazgo, en la frase que va en pantalla. */
const FRASES: Record<HallazgoBalance, string> = {
  sin_vara: 'la jornada no declara qué espera',
  politica_ambigua: 'los bloques del día esperan cosas distintas',
  turno_partido: 'turno partido: no se puede repartir la presencia entre los bloques',
  sin_planificar: 'no había turno planificado',
  sin_marcaje: 'el turno no se cubrió',
  marcajes_multiples: 'varios marcajes en el mismo día: las horas se suman, pero no se pueden repartir entre los bloques',
  marcaje_ambiguo: 'una hora capturada a mano no se puede ubicar en el día del turno',
  jornada_abierta: 'la jornada quedó abierta',
  demora: 'entró tarde',
  salida_temprana: 'salió antes',
  exceso_descanso: 'excedió el descanso',
  extra_sin_autorizar: 'trabajó de más sin autorización',
}

/**
 * Los hallazgos del día en palabras, con el número que los sustenta.
 *
 * Cada frase lleva su magnitud a propósito: «entró tarde» invita a discutir,
 * «entró 12 min tarde (se compensa)» dice exactamente qué pasó y qué sigue.
 */
export function hallazgosEnPalabras(dia: BalanceDia): string[] {
  return dia.hallazgos.map((h) => {
    switch (h) {
      case 'demora': {
        const tramo =
          dia.tramo_demora === 'compensable'
            ? ' (se compensa)'
            : dia.tramo_demora === 'debitada'
              ? ' (se debita)'
              : ''
        return `entró ${redondear(dia.minutos_tarde)} min tarde${tramo}`
      }
      case 'salida_temprana':
        return `salió ${redondear(dia.minutos_salida_temprana)} min antes`
      case 'exceso_descanso':
        return `excedió el descanso en ${redondear(dia.minutos_exceso_descanso)} min`
      case 'extra_sin_autorizar':
        return `${redondear(dia.horas_sobre_jornada)} h sobre la jornada, sin autorizar`
      default:
        return FRASES[h]
    }
  })
}

/** Los minutos como los diría una persona: sin decimales que nadie mira. */
function redondear(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '?'
  return String(Math.round(n * 100) / 100)
}

/** El resumen de un rango: cuántos días se juzgaron y cuántos cumplieron. */
export interface ResumenBalance {
  dias: number
  /** Días con vara y con jornada cerrada: los únicos que se pueden juzgar. */
  juzgables: number
  cumplen: number
  minutosTarde: number
  minutosSalidaTemprana: number
  minutosExcesoDescanso: number
  horasSobreJornada: number
}

/**
 * Suma un rango. Los días que no se pueden juzgar (sin vara, sin marcaje, con la
 * jornada abierta, turno partido) se cuentan aparte en vez de contarse como
 * incumplidos: un turno de esta noche que todavía no cerró no es una falta.
 */
export function resumirBalance(dias: BalanceDia[]): ResumenBalance {
  const juzgable = (d: BalanceDia) =>
    d.tiene_vara &&
    !d.hallazgos.includes('sin_marcaje') &&
    !d.hallazgos.includes('jornada_abierta') &&
    !d.hallazgos.includes('turno_partido') &&
    !d.hallazgos.includes('marcajes_multiples') &&
    !d.hallazgos.includes('marcaje_ambiguo')
  // `cumple` YA sale de la base como «no hay ni un hallazgo», y esta condición
  // lo vuelve a exigir acá. No es desconfianza en el SQL: es que este recuento
  // es lo que alguien va a mirar para decir «el equipo cumplió», y una fila con
  // hallazgos contada entre los cumplidos convierte el resumen en lo contrario
  // de lo que dice ser. Que las dos capas tengan que estar de acuerdo es la
  // única forma de que una regresión en cualquiera de las dos se note.
  const cumplido = (d: BalanceDia) => juzgable(d) && d.cumple && d.hallazgos.length === 0
  return {
    dias: dias.length,
    juzgables: dias.filter(juzgable).length,
    cumplen: dias.filter(cumplido).length,
    minutosTarde: suma(dias.map((d) => d.minutos_tarde)),
    minutosSalidaTemprana: suma(dias.map((d) => d.minutos_salida_temprana)),
    minutosExcesoDescanso: suma(dias.map((d) => d.minutos_exceso_descanso)),
    horasSobreJornada: suma(dias.map((d) => d.horas_sobre_jornada)),
  }
}

function suma(ns: (number | null)[]): number {
  return ns.reduce<number>((acc, n) => acc + (n ?? 0), 0)
}
