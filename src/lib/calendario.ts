// lib/calendario.ts — helpers puros de grilla mensual.
//
// Existen porque el repo ya tiene TRES copias del mismo cálculo: CalendarioTab
// (:39-50), CalendarioMantenimientoTab (:88-107) y CumpleanosTab (:113-131).
// Los tabs de turnos habrían sido la cuarta. Aquí viven una vez y se prueban
// solos; migrar los tres antiguos queda como trabajo aparte para no mezclarlo
// con la feature.
//
// Todo trabaja sobre fechas ISO locales (`YYYY-MM-DD`), NUNCA sobre
// `Date.toISOString()`: en husos negativos eso devuelve el día siguiente a
// partir de las 18:00 y el calendario se corre un día entero. La regla está
// además impuesta por eslint (no-restricted-syntax).

/** Nombres de mes en español, indexados por `Date.getMonth()`. */
export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

/** Encabezados de la grilla, empezando en LUNES (ISO), no en domingo. */
export const DIAS_SEMANA_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Fecha ISO local a partir de año / mes (0-11) / día. */
export function fechaISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Celdas de la grilla del mes: `null` en los huecos de relleno y el número de
 * día en el resto. La semana empieza en LUNES —el calendario laboral se lee así
 * y `dias_semana` de una regla usa ISO 1..7— y se rellena hasta completar
 * semanas enteras para que la grilla CSS no se desalinee.
 */
export function gridMes(year: number, month: number): (number | null)[] {
  // getDay(): 0 = domingo. Se rota para que lunes sea 0.
  const primerDia = (new Date(year, month, 1).getDay() + 6) % 7
  const diasDelMes = new Date(year, month + 1, 0).getDate()
  const celdas: (number | null)[] = Array(primerDia).fill(null)
  for (let d = 1; d <= diasDelMes; d++) celdas.push(d)
  while (celdas.length % 7 !== 0) celdas.push(null)
  return celdas
}

/** Día ISO de la semana (1 = lunes … 7 = domingo) de una fecha `YYYY-MM-DD`. */
export function diaISOSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  // Mediodía local: un cambio de horario de ±1 h no puede mover el día.
  return ((new Date(y, m - 1, d, 12).getDay() + 6) % 7) + 1
}

/** Suma (o resta) meses a un par año/mes, normalizando el desbordamiento. */
export function moverMes(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

/** Primer y último día del mes, en ISO local. Útil para acotar consultas. */
export function rangoMes(year: number, month: number): { desde: string; hasta: string } {
  return {
    desde: fechaISO(year, month, 1),
    hasta: fechaISO(year, month, new Date(year, month + 1, 0).getDate()),
  }
}
