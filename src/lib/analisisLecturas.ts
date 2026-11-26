// Análisis gráfico de lecturas (Historial → «Análisis gráfico»): reglas puras
// que convierten las lecturas del sistema y el historial importado en series
// mensuales para graficar sin descargar nada.
//
// Puro: sin React ni Supabase. La sección pasa lo que ya tiene en memoria
// (`registros`, `contadores`, `unidades`) y el historial importado del proyecto.
import type { Registro, Contador } from '../types'
import type { HistorialLectura } from '../domain/agua/historialLecturas'
import { filasDeHistorial } from './historialImportado'
import { diaLocalDeInstante, esFechaCalendario, mesLocalISO } from './format'

/** Ventanas que ofrece el análisis, en meses. */
export const PERIODOS_MESES = [1, 3, 6, 9, 12, 18, 24] as const
export type PeriodoMeses = (typeof PERIODOS_MESES)[number]

/** Una lectura, del sistema o del historial importado, lista para agregar. */
export interface PuntoAnalisis {
  /** null: lectura vieja del sistema que no quedó ligada a un contador. */
  contadorId: string | null
  projectId: string | null
  /** AAAA-MM-DD (día local de la lectura). */
  dia: string
  /** AAAA-MM */
  mes: string
  lectura: number | null
  consumo: number | null
  origen: 'sistema' | 'historial'
}

/** Qué se analiza. Vacío = no restringe. */
export interface FiltroAnalisis {
  proyectoId: string
  unidadIds: string[]
  contadorIds: string[]
  tipoAgua: string
}

export interface MesAnalisis {
  /** AAAA-MM */
  mes: string
  /** m³ del mes (sistema + historial). */
  consumo: number
  /** m³ del mes que vienen del historial importado. */
  consumoHistorial: number
  /** Lecturas tomadas en el mes (sistema + historial). */
  lecturas: number
  lecturasHistorial: number
  /** Contadores distintos con al menos una lectura en el mes. */
  contadores: number
}

export interface KpisAnalisis {
  consumoTotal: number
  /** Consumo total entre los meses de la ventana (incluye los meses sin lecturas). */
  promedioMensual: number
  lecturas: number
  /** Contadores con al menos una lectura en la ventana. */
  contadoresLeidos: number
  mesPico: { mes: string; consumo: number } | null
  /** Consumo de la ventana del mismo largo inmediatamente anterior. */
  consumoPeriodoAnterior: number
  /** Variación contra esa ventana (0.12 = +12 %); null si antes no hubo consumo. */
  variacion: number | null
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «nov 2026» para un AAAA-MM. */
export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  if (!y || !m) return mes
  return `${MESES_CORTOS[m - 1]} ${y}`
}

/**
 * Los `n` meses calendario que terminan en el mes de `hoy` (incluido), del más
 * viejo al más reciente: «3 meses» el 26 de noviembre son sep, oct y nov.
 */
export function mesesDelPeriodo(n: number, hoy: Date = new Date()): string[] {
  const meses: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    meses.push(mesLocalISO(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)))
  }
  return meses
}

/** Día local (AAAA-MM-DD) de una fecha de lectura: de calendario o instante. */
export function diaDeLectura(fecha: string | null | undefined): string | null {
  if (!fecha) return null
  if (esFechaCalendario(fecha)) return fecha
  return diaLocalDeInstante(fecha)
}

const numeroOnull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Une lecturas del sistema e historial importado en una sola lista de puntos.
 *
 * Para no contar dos veces un mes, el historial de un contador sólo vale hasta
 * el mes ANTERIOR a su primera lectura del sistema (la misma regla del portal
 * del residente). Esa primera lectura se busca en TODOS los registros, no sólo
 * en los de la ventana.
 */
export function puntosDeAnalisis(
  registros: Registro[],
  historial: HistorialLectura[],
  contadoresById: Map<string, Contador>,
): PuntoAnalisis[] {
  const puntos: PuntoAnalisis[] = []
  const primerMesSistema = new Map<string, string>()

  for (const r of registros) {
    if (r.deleted_at) continue
    const dia = diaDeLectura(r.fecha)
    if (!dia) continue
    const mes = dia.slice(0, 7)
    const contadorId = r.contador_id ?? null
    if (contadorId) {
      const previo = primerMesSistema.get(contadorId)
      if (!previo || mes < previo) primerMesSistema.set(contadorId, mes)
    }
    puntos.push({
      contadorId,
      projectId: r.project_id ?? (contadorId ? contadoresById.get(contadorId)?.project_id ?? null : null),
      dia,
      mes,
      lectura: numeroOnull(r.lectura_actual),
      consumo: numeroOnull(r.consumo),
      origen: 'sistema',
    })
  }

  // filasDeHistorial deduce el consumo que no vino anotado (lectura − la previa
  // del mismo contador), igual que la tabla del Historial.
  for (const fila of filasDeHistorial(historial, contadoresById, [], [])) {
    const datos = fila.historico
    if (!datos || !fila.contador_id) continue
    const dia = fila.fecha.slice(0, 10)
    const mes = dia.slice(0, 7)
    const tope = primerMesSistema.get(fila.contador_id)
    if (tope && mes >= tope) continue
    puntos.push({
      contadorId: fila.contador_id,
      projectId: fila.project_id ?? null,
      dia,
      mes,
      lectura: datos.lectura,
      consumo: datos.consumo,
      origen: 'historial',
    })
  }

  return puntos
}

/** Contadores que entran en el análisis según el filtro. */
export function contadoresEnAlcance(contadores: Contador[], filtro: FiltroAnalisis): Contador[] {
  const unidades = new Set(filtro.unidadIds)
  const ids = new Set(filtro.contadorIds)
  return contadores.filter(c =>
    (!filtro.proyectoId || c.project_id === filtro.proyectoId)
    && (unidades.size === 0 || (!!c.unidad_id && unidades.has(c.unidad_id)))
    && (ids.size === 0 || ids.has(c.id))
    && (!filtro.tipoAgua || c.tipo_agua === filtro.tipoAgua))
}

/**
 * Puntos del filtro. Una lectura sin contador sólo entra cuando el filtro no
 * pide unidad, contador ni tipo de agua (no hay cómo saber a cuál pertenece).
 */
export function filtrarPuntos(
  puntos: PuntoAnalisis[],
  filtro: FiltroAnalisis,
  alcance: Contador[],
): PuntoAnalisis[] {
  const ids = new Set(alcance.map(c => c.id))
  const sinRestriccionDeContador = filtro.unidadIds.length === 0
    && filtro.contadorIds.length === 0 && !filtro.tipoAgua
  return puntos.filter(p => {
    if (p.contadorId) return ids.has(p.contadorId)
    return sinRestriccionDeContador && (!filtro.proyectoId || p.projectId === filtro.proyectoId)
  })
}

/** Totales por mes de la ventana (los meses sin lecturas salen en cero). */
export function resumenPorMes(puntos: PuntoAnalisis[], meses: string[]): MesAnalisis[] {
  const porMes = new Map<string, MesAnalisis & { ids: Set<string> }>()
  for (const mes of meses) {
    porMes.set(mes, { mes, consumo: 0, consumoHistorial: 0, lecturas: 0, lecturasHistorial: 0, contadores: 0, ids: new Set() })
  }
  for (const p of puntos) {
    const m = porMes.get(p.mes)
    if (!m) continue
    m.lecturas++
    if (p.origen === 'historial') m.lecturasHistorial++
    if (p.consumo !== null) {
      m.consumo += p.consumo
      if (p.origen === 'historial') m.consumoHistorial += p.consumo
    }
    if (p.contadorId) m.ids.add(p.contadorId)
  }
  return meses.map(mes => {
    const { ids, ...m } = porMes.get(mes)!
    return { ...m, consumo: redondear(m.consumo), consumoHistorial: redondear(m.consumoHistorial), contadores: ids.size }
  })
}

/**
 * Consumo mensual de cada grupo (contador, unidad…) en el orden de `meses`.
 * Un mes sin lectura queda en `null`, no en 0: «no se leyó» no es «no consumió»,
 * y la gráfica lo muestra como un hueco en vez de una caída a cero.
 */
export function seriesPorGrupo(
  puntos: PuntoAnalisis[],
  meses: string[],
  grupoDe: (p: PuntoAnalisis) => string | null,
): Map<string, Array<number | null>> {
  const indice = new Map(meses.map((m, i) => [m, i]))
  const series = new Map<string, Array<number | null>>()
  for (const p of puntos) {
    const i = indice.get(p.mes)
    const clave = grupoDe(p)
    if (i === undefined || clave === null || p.consumo === null) continue
    let serie = series.get(clave)
    if (!serie) { serie = meses.map(() => null); series.set(clave, serie) }
    serie[i] = (serie[i] ?? 0) + p.consumo
  }
  for (const serie of series.values()) serie.forEach((v, i) => { serie[i] = v === null ? null : redondear(v) })
  return series
}

export interface FilaRanking { clave: string; consumo: number; lecturas: number }

/** Los grupos de mayor consumo en la ventana, de mayor a menor. */
export function rankingConsumo(
  puntos: PuntoAnalisis[],
  meses: string[],
  grupoDe: (p: PuntoAnalisis) => string | null,
  limite = 10,
): FilaRanking[] {
  const enVentana = new Set(meses)
  const acumulado = new Map<string, FilaRanking>()
  for (const p of puntos) {
    if (!enVentana.has(p.mes)) continue
    const clave = grupoDe(p)
    if (clave === null) continue
    const fila = acumulado.get(clave) ?? { clave, consumo: 0, lecturas: 0 }
    fila.lecturas++
    if (p.consumo !== null) fila.consumo += p.consumo
    acumulado.set(clave, fila)
  }
  return [...acumulado.values()]
    .map(f => ({ ...f, consumo: redondear(f.consumo) }))
    .sort((a, b) => b.consumo - a.consumo || a.clave.localeCompare(b.clave))
    .slice(0, limite)
}

/** Lecturas del medidor de un contador en la ventana, en orden de fecha. */
export function lecturasDelMedidor(
  puntos: PuntoAnalisis[],
  contadorId: string,
  meses: string[],
): Array<{ dia: string; lectura: number; origen: PuntoAnalisis['origen'] }> {
  const enVentana = new Set(meses)
  const porDia = new Map<string, { dia: string; lectura: number; origen: PuntoAnalisis['origen'] }>()
  for (const p of puntos) {
    if (p.contadorId !== contadorId || p.lectura === null || !enVentana.has(p.mes)) continue
    // Si el mismo día hay lectura del sistema e importada, gana la del sistema.
    const previa = porDia.get(p.dia)
    if (previa && previa.origen === 'sistema' && p.origen === 'historial') continue
    porDia.set(p.dia, { dia: p.dia, lectura: p.lectura, origen: p.origen })
  }
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

/** Cifras de cabecera de la ventana, con la comparación contra la anterior. */
export function kpisAnalisis(puntos: PuntoAnalisis[], meses: string[]): KpisAnalisis {
  const resumen = resumenPorMes(puntos, meses)
  const consumoTotal = redondear(resumen.reduce((s, m) => s + m.consumo, 0))
  const lecturas = resumen.reduce((s, m) => s + m.lecturas, 0)
  const enVentana = new Set(meses)
  const leidos = new Set<string>()
  for (const p of puntos) if (p.contadorId && enVentana.has(p.mes)) leidos.add(p.contadorId)

  let mesPico: KpisAnalisis['mesPico'] = null
  for (const m of resumen) if (m.consumo > 0 && (!mesPico || m.consumo > mesPico.consumo)) mesPico = { mes: m.mes, consumo: m.consumo }

  const anteriores = mesesAnteriores(meses)
  const consumoPeriodoAnterior = redondear(
    resumenPorMes(puntos, anteriores).reduce((s, m) => s + m.consumo, 0),
  )

  return {
    consumoTotal,
    promedioMensual: meses.length ? redondear(consumoTotal / meses.length) : 0,
    lecturas,
    contadoresLeidos: leidos.size,
    mesPico,
    consumoPeriodoAnterior,
    variacion: consumoPeriodoAnterior > 0 ? (consumoTotal - consumoPeriodoAnterior) / consumoPeriodoAnterior : null,
  }
}

/** La ventana del mismo largo que termina justo antes de `meses`. */
export function mesesAnteriores(meses: string[]): string[] {
  if (meses.length === 0) return []
  const [y, m] = meses[0].split('-').map(Number)
  return mesesDelPeriodo(meses.length, new Date(y, m - 2, 1))
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}
