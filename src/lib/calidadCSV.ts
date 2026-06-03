import type { RegistroCalidad } from '../types'
import { TIPOLOGIAS_CALIDAD } from '../components/calidad/constants'
import { cumplimientoPorcentaje } from './calidadTendencia'

// serv:S27 — Export del historial de calidad a CSV (reportes regulatorios).
// Lógica pura y testeable: arma el texto CSV (RFC 4180) a partir de los
// registros ya filtrados. La descarga vive en el componente.

// Escapa una celda: entrecomilla si contiene coma, comilla o salto de línea, y
// duplica las comillas internas.
function celda(valor: string | number): string {
  const s = String(valor)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function registrosCalidadToCSV(registros: RegistroCalidad[]): string {
  // Columnas dinámicas: unión de todos los parámetros presentes, ordenadas, para
  // que cada análisis quede alineado aunque midan parámetros distintos.
  const paramKeys = Array.from(
    new Set(registros.flatMap(r => Object.keys(r.parametros ?? {}))),
  ).sort()

  const header = ['Fecha', 'Fuente', 'Nombre', 'Tipología', 'Resultado', '% Cumplimiento', ...paramKeys, 'Observaciones']

  const filas = registros.map(r => {
    const fuente = r.fuentes_agua
    const tipo = fuente?.tipo_agua
    const tipologia = tipo ? TIPOLOGIAS_CALIDAD[tipo] : null
    const pct = cumplimientoPorcentaje(r.cumplimiento ?? {})
    return [
      (r.fecha ?? '').slice(0, 10),
      fuente?.identificador ?? '',
      fuente?.nombre ?? '',
      tipologia ? tipologia.label : (tipo ?? ''),
      r.cumple_total ? 'CUMPLE' : 'NO CUMPLE',
      pct === null ? '' : String(pct),
      ...paramKeys.map(k => {
        const v = r.parametros?.[k]
        return v === undefined || v === null ? '' : String(v)
      }),
      r.observaciones ?? '',
    ]
  })

  return [header, ...filas].map(fila => fila.map(celda).join(',')).join('\r\n')
}
