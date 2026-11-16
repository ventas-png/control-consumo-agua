// Estado mensual de una propiedad en PDF, para enviárselo al propietario: lo
// mismo que la hoja de Excel (reservas del mes con su desglose, ocupación,
// ingresos) más la liquidación (acreditado − comisión − gastos = a pagar).
// No se guarda: con los mismos datos sale siempre el mismo documento.
// jsPDF se importa al generar, no al abrir la pestaña.
import type { ConceptoRenta, GastoRenta, LiquidacionRenta, PropiedadRenta, ReservaUnificada } from '../../../types'
import {
  CARGO_GASTO_LABEL, CATEGORIA_GASTO_LABEL, claveReserva, conceptosDeBloque, nombreMes, tieneDesglose, totalesDesglose, type ResumenMes,
} from '../../../domain/rentas/finanzas'
import { noches } from '../../../domain/rentas/logica'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'

export interface DatosEstadoMensual {
  /** Nombre de la administradora, si se conoce. */
  empresa?: string | null
  propiedad: PropiedadRenta
  resumen: ResumenMes
  /** Reservas no canceladas que ENTRAN en el mes. */
  reservas: ReservaUnificada[]
  liquidaciones: Map<string, LiquidacionRenta>
  conceptos: ConceptoRenta[]
  /** Gastos de la propiedad en el mes. */
  gastos: GastoRenta[]
  moneda: string
}

/** Lo que dice el documento (puro, para probarlo sin jsPDF). */
export function contenidoEstadoMensual(d: DatosEstadoMensual) {
  const { resumen: r, moneda } = d
  const $ = (n: number) => formatCurrency(n, moneda)
  const anfitrion = conceptosDeBloque(d.conceptos, 'anfitrion')
    .filter(c => r.porConcepto.some(x => x.concepto.id === c.id && x.total !== 0))

  const reservas = {
    encabezado: ['Entrada', 'Noches', 'Reserva', 'Huésp.', ...anfitrion.map(c => `${c.signo === -1 ? '− ' : ''}${c.nombre}`), 'Total recibido'],
    filas: d.reservas.map(x => {
      const importes = d.liquidaciones.get(claveReserva(x))?.importes
      const con = tieneDesglose(importes)
      return [
        formatFechaCalendario(x.fecha_entrada), String(noches(x.fecha_entrada, x.fecha_salida)),
        x.codigo_confirmacion || x.huesped_nombre, String(x.num_huespedes),
        ...anfitrion.map(c => (con && typeof importes?.[c.id] === 'number' ? $(importes[c.id]) : '')),
        $(con ? totalesDesglose(d.conceptos, importes).anfitrion : x.monto_total ?? 0),
      ]
    }),
    pie: ['', '', 'Totales', String(r.personas),
      ...anfitrion.map(c => $(r.porConcepto.find(x => x.concepto.id === c.id)?.total ?? 0)), $(r.acreditadoReservas)],
  }

  const liquidacion: [string, string][] = [['Acreditación del mes', $(r.acreditado)]]
  if (r.comisionPct > 0) liquidacion.push([`− Comisión de administración (${r.comisionPct}% de ${$(r.baseComision)})`, $(r.comision)])
  if (r.gastosPropietario > 0) liquidacion.push(['− Gastos a cargo del propietario', $(r.gastosPropietario)])

  return {
    titulo: 'ESTADO MENSUAL DE LA PROPIEDAD',
    subtitulo: `${d.propiedad.nombre} · ${nombreMes(r.mes)}`,
    cabecera: [
      ...(d.empresa ? [['Administra', d.empresa] as [string, string]] : []),
      ['Propietario', d.propiedad.propietario_nombre || '—'],
      ['Ocupación', `${r.ocupacionPct}% · ${r.nochesOcupadas} de ${r.dias} noches`],
      ['Estadías', `${r.estadias} · ${r.personas} personas${r.personasPromedio === null ? '' : ` (${r.personasPromedio} por estadía)`}`],
    ] as [string, string][],
    reservas,
    rentaContratos: r.rentaContratos > 0 ? $(r.rentaContratos) : null,
    gastos: d.gastos.filter(g => g.a_cargo_de === 'propietario').map(g => [
      formatFechaCalendario(g.fecha), g.descripcion, CATEGORIA_GASTO_LABEL[g.categoria], CARGO_GASTO_LABEL[g.a_cargo_de], $(g.monto),
    ]),
    liquidacion,
    aPagar: ['A pagar al propietario', $(r.pagoPropietario)] as [string, string],
    archivo: `estado_${d.propiedad.nombre.replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase()}_${r.mes}.pdf`,
  }
}

export async function descargarEstadoMensual(d: DatosEstadoMensual): Promise<void> {
  const c = contenidoEstadoMensual(d)
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const M = 14
  const PW = doc.internal.pageSize.getWidth()
  const ultimaY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(c.titulo, M, 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(c.subtitulo, M, 22)
  autoTable(doc, {
    startY: 26, theme: 'plain', margin: { left: M, right: M }, body: c.cabecera,
    styles: { fontSize: 9, cellPadding: 0.8 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 } },
  })

  const ultima = c.reservas.encabezado.length - 1
  autoTable(doc, {
    startY: ultimaY() + 4, margin: { left: M, right: M },
    head: [c.reservas.encabezado], body: c.reservas.filas.length > 0 ? c.reservas.filas : [['Sin estadías que entren este mes']],
    foot: c.reservas.filas.length > 0 ? [c.reservas.pie] : undefined,
    styles: { fontSize: 7.5, cellPadding: 1.2, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 }, footStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
    didParseCell: h => { if (h.column.index >= 4 || h.column.index === 1 || h.column.index === 3) h.cell.styles.halign = 'right' },
    columnStyles: { [ultima]: { fontStyle: 'bold' } },
  })

  if (c.gastos.length > 0) {
    autoTable(doc, {
      startY: ultimaY() + 5, margin: { left: M, right: M },
      head: [['Fecha', 'Gasto a cargo del propietario', 'Categoría', 'A cargo de', 'Monto']], body: c.gastos,
      styles: { fontSize: 8, cellPadding: 1.2 }, headStyles: { fillColor: [90, 90, 90], textColor: 255 },
      columnStyles: { 4: { halign: 'right' } },
    })
  }

  const cuerpo = [...(c.rentaContratos ? [['Renta de contratos (incluida en la acreditación)', c.rentaContratos]] : []), ...c.liquidacion]
  autoTable(doc, {
    startY: ultimaY() + 6, theme: 'plain', margin: { left: PW - M - 120, right: M }, tableWidth: 120,
    body: cuerpo, foot: [c.aPagar],
    styles: { fontSize: 9.5, cellPadding: 1.2 }, columnStyles: { 1: { halign: 'right' } },
    footStyles: { fontStyle: 'bold', fontSize: 11, fillColor: [235, 235, 235], textColor: 20 },
    didParseCell: h => { if (h.section === 'foot' && h.column.index === 1) h.cell.styles.halign = 'right' },
  })
  doc.save(c.archivo)
}
