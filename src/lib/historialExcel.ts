// Descarga a Excel del Historial de Lecturas: las MISMAS filas que la tabla
// muestra con los filtros activos (lecturas del sistema y, si se eligió un
// proyecto, su historial importado), más una hoja «Resumen» con los filtros
// aplicados y los totales. Puro: sin React ni Supabase; la escritura del
// archivo la hace lib/xlsx.ts.
import type { Contador, Proyecto, Registro, Unidad } from '../types'
import type { XlsxSheet } from './xlsx'
import type { HistorialFiltros } from './historialFiltros'
import { ESTADO_HISTORICO, type FilaLectura } from './historialImportado'
import { dateLocalISO, diaLocalDeInstante } from './format'

export interface ContextoExcelHistorial {
  contadoresById: Map<string, Contador>
  unidades: Unidad[]
  proyectos: Pick<Proyecto, 'id' | 'nombre'>[]
  moneda: string
  /** Total a cobrar de una lectura del sistema (el mismo que muestra la tabla). */
  totalDe: (r: Registro) => number
  /** Etiqueta legible de cada tipo de agua. */
  tiposAgua?: Record<string, string>
}

const ESTADOS: Record<string, string> = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  mora: 'Mora',
  [ESTADO_HISTORICO]: 'Histórico (importado)',
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' local de una fecha de calendario o de un instante. */
function dia(valor: string | null | undefined): string {
  if (!valor) return ''
  if (RE_DIA.test(valor)) return valor
  return diaLocalDeInstante(valor) ?? ''
}

const redondear2 = (n: number) => Math.round(n * 100) / 100

/** Hojas del archivo: «Lecturas» (una fila por lectura) y «Resumen». */
export function hojasExcelHistorial(
  filas: FilaLectura[],
  filtros: HistorialFiltros,
  ctx: ContextoExcelHistorial,
  generado: Date = new Date(),
): XlsxSheet[] {
  const unidadesById = new Map(ctx.unidades.map(u => [u.id, u]))
  const proyectosById = new Map(ctx.proyectos.map(p => [p.id, p]))
  const tipoAgua = (t?: string | null) => (t ? ctx.tiposAgua?.[t] ?? t : '')

  const encabezado = [
    'Fecha', 'Proyecto', 'Unidad', 'Cliente', '# Contador', 'Tipo de agua',
    'Lectura anterior', 'Lectura actual', 'Consumo (m³)', `Total (${ctx.moneda})`,
    'Estado', 'Fecha de pago', 'Notas',
  ]

  let registros = 0, historicas = 0
  let consumo = 0, monto = 0, pagado = 0, pendiente = 0, mora = 0

  const filasHoja = filas.map(r => {
    const contador = r.contador_id ? ctx.contadoresById.get(r.contador_id) : undefined
    const unidad = contador?.unidad_id ? unidadesById.get(contador.unidad_id) : undefined
    const proyecto = r.project_id ? proyectosById.get(r.project_id) : undefined
    const comunes = [
      dia(r.fecha),
      proyecto?.nombre ?? '',
      unidad?.nombre ?? '',
      r.cliente_nombre ?? '',
      contador?.numero_serie ?? '',
      tipoAgua(contador?.tipo_agua),
    ]
    if (r.historico) {
      // Referencia importada: lo que no se anotó queda en blanco (no en 0) y
      // no tiene total, estado de pago ni fecha de pago.
      historicas++
      return [
        ...comunes,
        r.historico.anterior ?? '',
        r.historico.lectura ?? '',
        r.historico.consumo ?? '',
        '',
        ESTADOS[ESTADO_HISTORICO],
        '',
        r.notas ?? '',
      ]
    }
    const total = redondear2(ctx.totalDe(r))
    registros++
    consumo += r.consumo || 0
    monto += total
    if (r.estado === 'pagado') pagado += total
    else if (r.estado === 'pendiente') pendiente += total
    else if (r.estado === 'mora') mora += total
    return [
      ...comunes,
      r.lectura_anterior,
      r.lectura_actual,
      r.consumo,
      total,
      ESTADOS[r.estado] ?? r.estado,
      dia(r.fecha_pago),
      r.notas ?? '',
    ]
  })

  const nombreUnidad = filtros.unidad ? unidadesById.get(filtros.unidad)?.nombre ?? filtros.unidad : ''
  const nombreProyecto = filtros.proyecto ? proyectosById.get(filtros.proyecto)?.nombre ?? filtros.proyecto : ''
  const hora = `${String(generado.getHours()).padStart(2, '0')}:${String(generado.getMinutes()).padStart(2, '0')}`

  const resumen: XlsxSheet = {
    name: 'Resumen',
    colWidths: [30, 40],
    rows: [
      ['Historial de Lecturas'],
      ['Generado', `${dateLocalISO(generado)} ${hora}`],
      [],
      ['Filtros'],
      ['Proyecto', nombreProyecto || 'Todos'],
      ['Unidad', nombreUnidad || 'Todas'],
      ['Estado', filtros.estado ? ESTADOS[filtros.estado] ?? filtros.estado : 'Todos'],
      ['Tipo de agua', filtros.tipoAgua ? tipoAgua(filtros.tipoAgua) : 'Todos'],
      ['Desde', filtros.fechaInicio || '—'],
      ['Hasta', filtros.fechaFin || '—'],
      ['Búsqueda', filtros.texto.trim() || '—'],
      [],
      ['Totales (sin el historial importado)'],
      ['Lecturas', registros],
      ['Consumo (m³)', redondear2(consumo)],
      [`Total (${ctx.moneda})`, redondear2(monto)],
      [`Pagado (${ctx.moneda})`, redondear2(pagado)],
      [`Pendiente (${ctx.moneda})`, redondear2(pendiente)],
      [`En mora (${ctx.moneda})`, redondear2(mora)],
      ['Lecturas del historial importado', historicas],
    ],
  }

  return [
    {
      name: 'Lecturas',
      colWidths: [12, 24, 18, 30, 22, 16, 14, 14, 14, 14, 20, 14, 40],
      rows: [encabezado, ...filasHoja],
    },
    resumen,
  ]
}

/** Nombre del archivo: historial-lecturas[-proyecto]-AAAA-MM-DD. */
export function nombreArchivoHistorial(
  filtros: HistorialFiltros,
  proyectos: Pick<Proyecto, 'id' | 'nombre'>[],
  hoy: string,
): string {
  const nombre = filtros.proyecto ? proyectos.find(p => p.id === filtros.proyecto)?.nombre ?? '' : ''
  const slug = nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ['historial-lecturas', slug, hoy].filter(Boolean).join('-')
}
