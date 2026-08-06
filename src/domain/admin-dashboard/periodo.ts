// domain/admin-dashboard/periodo.ts — Helpers puros del rango de fechas del
// dashboard admin.
//
// Caso que resuelven: empresas con histórico cargado (lecturas mensuales cuya
// última fecha quedó semanas o meses atrás) abrían el dashboard con la ventana
// por defecto "últimos 30 días" vacía: los KPIs marcaban 0 aunque Historial y
// Clientes sí mostraran lecturas, dando la impresión de que el dashboard "no
// computa" (reporte de Cascadas de Vista Hermosa). Estos helpers detectan la
// ventana vacía y derivan el rango que cubre el ciclo de lecturas más reciente.

/** Proyección mínima de un registro para estos helpers. */
export interface RegistroFecha {
  fecha: string
}

export interface PeriodoFechas {
  desde: string
  hasta: string
}

// `fecha` llega como 'YYYY-MM-DD' o como timestamp ISO; comparar el prefijo
// YYYY-MM-DD funciona lexicográficamente en ambos casos (misma convención que
// el filtro de AdminDashboardStats/AdminConsumoTipologia).
const soloFecha = (fecha: string) => fecha.slice(0, 10)

/** Cuántos registros caen dentro de [desde, hasta] (límites inclusivos). */
export function contarRegistrosEnPeriodo(
  registros: RegistroFecha[],
  desde?: string,
  hasta?: string,
): number {
  let n = 0
  for (const r of registros) {
    const f = soloFecha(r.fecha)
    if ((!desde || f >= desde) && (!hasta || f <= hasta)) n++
  }
  return n
}

/** Fecha (YYYY-MM-DD) de la lectura más reciente, o null si no hay registros. */
export function ultimaFechaLectura(registros: RegistroFecha[]): string | null {
  let max: string | null = null
  for (const r of registros) {
    const f = soloFecha(r.fecha)
    if (!max || f > max) max = f
  }
  return max
}

/**
 * Rango que cubre el ciclo de lecturas más reciente: desde 30 días antes de la
 * última lectura hasta hoy (o hasta la última lectura si viniera con fecha
 * futura). Devuelve null cuando no hay registros de los que derivar el rango.
 */
export function periodoUltimaLectura(
  registros: RegistroFecha[],
  hoy: Date = new Date(),
): PeriodoFechas | null {
  const ultima = ultimaFechaLectura(registros)
  if (!ultima) return null
  // Mediodía UTC para que el -30 días no cruce de día por zona horaria.
  const d = new Date(`${ultima}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() - 30)
  const desde = d.toISOString().slice(0, 10)
  const hoyStr = hoy.toISOString().slice(0, 10)
  return { desde, hasta: ultima > hoyStr ? ultima : hoyStr }
}
