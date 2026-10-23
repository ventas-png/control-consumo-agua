import { diasEntreFechasCalendario, parseFechaCalendario, sumarDiasCalendario } from '../../lib/format'
import type { ControlPlagas, TipoControlPlagas } from '../../types'

// ============================================================================
// Control de plagas: próxima visita y proyección POR TIPO.
// ============================================================================
// Una fumigación mensual y una inspección trimestral son calendarios distintos:
// si la próxima visita se toma de la última visita de cualquier tipo, una
// inspección de hoy «borra» la fumigación que toca la semana que viene. Aquí
// cada tipo lleva su propio calendario:
//
//   - la próxima visita es la que dejó programada la última visita del tipo;
//   - si no dejó ninguna, la probable: la última realizada más su frecuencia
//     típica (mediana de los intervalos recientes entre visitas realizadas);
//   - con esa frecuencia se proyectan las que siguen dentro del horizonte, y
//     con el costo promedio del tipo, cuánto costarán.

/** Horizonte de la proyección, en días desde hoy. */
export const DIAS_PROYECCION = 90

/** Cuántos intervalos (y costos) recientes cuentan para la frecuencia y el promedio. */
const RECIENTES = 6

/** La más reciente primero: por fecha y, el mismo día, por hora de captura. */
export const masRecientePrimero = (a: ControlPlagas, b: ControlPlagas) =>
  b.fecha.localeCompare(a.fecha) || (b.created_at ?? '').localeCompare(a.created_at ?? '')

const realizada = (v: ControlPlagas) => v.resultado !== 'no_realizado'

function mediana(valores: number[]): number {
  const s = [...valores].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Cada cuántos días suele tocar un tipo de visita: la mediana de los últimos
 * intervalos entre visitas realizadas (una visita extra o una atrasada no la
 * mueven). Con menos de dos visitas realizadas se usa el plazo que se dejó
 * programado (próxima visita − fecha). `null` si no hay con qué estimar.
 */
export function intervaloTipico(visitas: readonly ControlPlagas[]): number | null {
  const fechas = [...new Set(visitas.filter(realizada).map(v => v.fecha))].sort()
  const entre = fechas.slice(1)
    .map((f, i) => diasEntreFechasCalendario(fechas[i], f))
    .filter((d): d is number => d !== null && d > 0)
  if (entre.length > 0) return Math.round(mediana(entre.slice(-RECIENTES)))

  const programados = [...visitas].sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(v => diasEntreFechasCalendario(v.fecha, v.proxima_visita))
    .filter((d): d is number => d !== null && d > 0)
  return programados.length > 0 ? Math.round(mediana(programados.slice(-RECIENTES))) : null
}

export interface PlanTipo {
  tipo: TipoControlPlagas
  /** La visita más reciente del tipo (realizada o no). */
  ultima: ControlPlagas
  /** Cada cuántos días suele tocar; `null` si aún no se puede estimar. */
  intervaloDias: number | null
  /** Próxima visita ('YYYY-MM-DD'): la programada o, si no hay, la probable. */
  proxima: string | null
  origen: 'programada' | 'probable' | null
  /** Las que siguen a la próxima dentro del horizonte, a la misma frecuencia. */
  siguientes: string[]
  /** Costo promedio de las visitas recientes con costo; `null` si ninguna lo tiene. */
  costoPromedio: number | null
}

/**
 * El calendario de cada tipo con historial, el más urgente primero (los que no
 * tienen próxima visita, al final).
 *
 * Si la próxima ya pasó, las siguientes se cuentan desde hoy: la atrasada se
 * hará, como pronto, hoy, y la frecuencia corre desde ahí.
 */
export function planPorTipo(
  registros: readonly ControlPlagas[],
  hoy: string,
  horizonte = DIAS_PROYECCION,
): PlanTipo[] {
  const tipos = [...new Set(registros.map(r => r.tipo))]
  const planes = tipos.map((tipo): PlanTipo => {
    const visitas = registros.filter(r => r.tipo === tipo).sort(masRecientePrimero)
    const ultima = visitas[0]
    const intervaloDias = intervaloTipico(visitas)

    let proxima: string | null = null
    let origen: PlanTipo['origen'] = null
    if (parseFechaCalendario(ultima.proxima_visita)) {
      proxima = ultima.proxima_visita!
      origen = 'programada'
    } else {
      const base = visitas.find(realizada)
      const probable = base && intervaloDias ? sumarDiasCalendario(base.fecha, intervaloDias) : null
      if (probable) { proxima = probable; origen = 'probable' }
    }

    const siguientes: string[] = []
    if (proxima && intervaloDias) {
      let d = (diasEntreFechasCalendario(hoy, proxima) ?? 0) < 0 ? hoy : proxima
      for (;;) {
        d = sumarDiasCalendario(d, intervaloDias)!
        const dias = diasEntreFechasCalendario(hoy, d)
        if (dias === null || dias > horizonte) break
        siguientes.push(d)
      }
    }

    const costos = visitas.map(v => v.costo).filter((c): c is number => c != null && Number.isFinite(c)).slice(0, RECIENTES)
    const costoPromedio = costos.length > 0 ? costos.reduce((s, c) => s + c, 0) / costos.length : null

    return { tipo, ultima, intervaloDias, proxima, origen, siguientes, costoPromedio }
  })
  return planes.sort((a, b) => {
    if (a.proxima && b.proxima) return a.proxima.localeCompare(b.proxima)
    return a.proxima ? -1 : b.proxima ? 1 : 0
  })
}

export interface ResumenProyeccion {
  /** Visitas pendientes hasta el horizonte (las atrasadas cuentan: siguen por hacer). */
  visitas: number
  /** Costo estimado de las visitas cuyo tipo tiene costo de referencia. */
  costo: number
  /** Cuántas de esas visitas no tienen costo de referencia. */
  sinCosto: number
}

export function resumenProyeccion(planes: readonly PlanTipo[], hoy: string, horizonte = DIAS_PROYECCION): ResumenProyeccion {
  let visitas = 0
  let costo = 0
  let sinCosto = 0
  for (const p of planes) {
    if (!p.proxima) continue
    const diasProxima = diasEntreFechasCalendario(hoy, p.proxima)
    const n = (diasProxima !== null && diasProxima <= horizonte ? 1 : 0) + p.siguientes.length
    visitas += n
    if (p.costoPromedio === null) sinCosto += n
    else costo += p.costoPromedio * n
  }
  return { visitas, costo, sinCosto }
}
