// Historial de consumo de un contador: une el historial importado (lecturas que
// la empresa llevaba a mano, tabla agua_historial_lecturas) con las lecturas del
// sistema (registros), y calcula contra qué comparar una lectura nueva.
//
// Puro: no consulta nada. La base es la fuente de verdad del cobro; esto sólo
// alimenta lo que se le muestra al lecturista mientras captura.

/** Un punto de la serie: una lectura y/o el consumo de su periodo. */
export interface PuntoConsumo {
  /** AAAA-MM-DD */
  fecha: string
  lectura: number | null
  consumo: number | null
  origen: 'historial' | 'sistema'
}

export interface EstadisticasConsumo {
  /** Promedio de los últimos `ventana` consumos (> 0) antes de la fecha de referencia. */
  promedioReciente: number | null
  /** Cuántos consumos entraron en ese promedio. */
  nReciente: number
  /** Consumo del mismo mes del año anterior, si lo hay. */
  mismoMesAnterior: number | null
  /** Etiqueta del mes comparado, p. ej. «nov 2025». */
  etiquetaMismoMes: string | null
  /** Cuántos periodos vienen del historial importado. */
  nHistorial: number
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const dosDig = (n: number) => String(n).padStart(2, '0')

function fechaValida(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > ultimo) return null
  return `${y}-${dosDig(m)}-${dosDig(d)}`
}

/**
 * Lee la fecha de una fila del historial. Acepta lo que sale de una hoja
 * llevada a mano: fecha de Excel (número de serie u objeto Date), AAAA-MM-DD,
 * DD/MM/AAAA, y sólo el mes —AAAA-MM o MM/AAAA—, que se guarda como el día 1
 * de ese mes. Devuelve AAAA-MM-DD o null si no se entiende.
 */
export function normalizarFechaHistorial(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null
    return fechaValida(raw.getFullYear(), raw.getMonth() + 1, raw.getDate())
  }
  if (typeof raw === 'number') {
    // Número de serie de Excel (días desde 1899-12-30).
    if (!Number.isFinite(raw) || raw < 1 || raw > 120000) return null
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000)
    return fechaValida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (m) return fechaValida(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return fechaValida(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) return fechaValida(+m[1], +m[2], 1)
  m = s.match(/^(\d{1,2})[/-](\d{4})$/)
  if (m) return fechaValida(+m[2], +m[1], 1)
  return null
}

/**
 * Lee un número de la hoja: admite coma o punto decimal y separadores de miles
 * con espacio. Vacío → null; texto que no es número → NaN (es un error de fila).
 */
export function leerNumeroHistorial(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  const s = String(raw).trim().replace(/\s/g, '')
  if (s === '') return null
  const normal = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN
}

/**
 * Clave para buscar un contador por número de serie: sin mayúsculas, sin
 * espacios en los bordes y con cualquier tirada de espacios de en medio (también
 * tabuladores y espacios duros de Excel) contada como uno. «VSC3-1 70304021» y
 * «VSC3-1   70304021» son el mismo contador. La base compara igual
 * (20261208000000).
 */
export function claveSerie(serie: string | null | undefined): string {
  return (serie ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Une historial y lecturas del sistema en una sola serie ordenada por fecha, y
 * completa el consumo que falta con la diferencia contra la lectura anterior.
 * Si las dos fuentes traen la misma fecha, gana la del sistema. Una lectura
 * más baja que la anterior (medidor reiniciado o cambiado) deja ese consumo
 * sin calcular: no se inventa.
 */
export function serieConsumo(
  historial: Array<{ fecha: string; lectura: number | null; consumo: number | null }>,
  sistema: Array<{ fecha: string; lectura_actual?: number | null; consumo?: number | null }>,
): PuntoConsumo[] {
  const porFecha = new Map<string, PuntoConsumo>()
  for (const h of historial) {
    const fecha = h.fecha.slice(0, 10)
    porFecha.set(fecha, { fecha, lectura: h.lectura ?? null, consumo: h.consumo ?? null, origen: 'historial' })
  }
  for (const r of sistema) {
    const fecha = r.fecha.slice(0, 10)
    porFecha.set(fecha, {
      fecha,
      lectura: typeof r.lectura_actual === 'number' ? r.lectura_actual : null,
      consumo: typeof r.consumo === 'number' ? r.consumo : null,
      origen: 'sistema',
    })
  }
  const serie = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
  let anterior: number | null = null
  for (const p of serie) {
    if (p.consumo === null && p.lectura !== null && anterior !== null && p.lectura >= anterior) {
      p.consumo = Math.round((p.lectura - anterior) * 10000) / 10000
    }
    if (p.lectura !== null) anterior = p.lectura
  }
  return serie
}

/**
 * Contra qué comparar una lectura nueva tomada en `fechaRef` (AAAA-MM-DD):
 * el promedio de los últimos `ventana` consumos (los ceros no cuentan, igual
 * que en el aviso de salto anómalo) y el consumo del mismo mes del año anterior.
 */
export function estadisticasConsumo(
  serie: PuntoConsumo[],
  fechaRef: string,
  ventana = 6,
): EstadisticasConsumo {
  const ref = fechaRef.slice(0, 10)
  const previos = serie.filter(p => p.fecha < ref)
  const consumos = previos
    .filter(p => typeof p.consumo === 'number' && p.consumo > 0)
    .slice(-ventana)
    .map(p => p.consumo as number)
  const promedioReciente = consumos.length
    ? Math.round((consumos.reduce((a, b) => a + b, 0) / consumos.length) * 100) / 100
    : null

  const [y, m] = ref.split('-').map(Number)
  const mesAnterior = `${y - 1}-${dosDig(m)}`
  const delMes = previos.filter(p => p.fecha.startsWith(mesAnterior) && typeof p.consumo === 'number')
  const mismoMesAnterior = delMes.length ? (delMes[delMes.length - 1].consumo as number) : null

  return {
    promedioReciente,
    nReciente: consumos.length,
    mismoMesAnterior,
    etiquetaMismoMes: mismoMesAnterior !== null ? `${MESES[m - 1]} ${y - 1}` : null,
    nHistorial: serie.filter(p => p.origen === 'historial').length,
  }
}
