// Estado de cuenta en PDF: lo que se le entrega al residente o se lleva a una
// junta. Mismo lenguaje visual que el informe de asamblea (banda oscura, acento
// teal, pie paginado). Imprime EXACTAMENTE lo que calculó el servidor —saldo
// inicial, movimientos con su saldo acumulado, saldo final—; aquí no se suma nada.
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency, formatDateShort } from '../../lib/format'
import { TIPO_CARGO_LABELS, type EstadoCuenta } from '../../types/contabilidad'

const DARK: [number, number, number] = [15, 23, 42]
const TEAL: [number, number, number] = [13, 148, 136]

export interface EstadoCuentaPdfInput {
  /** Nombre de la contabilidad (empresa o proyecto) que emite el estado. */
  entidadNombre: string
  monedaBase: string
  /** El estado COMPLETO del rango (todas las páginas de movimientos). */
  estado: EstadoCuenta
}

const tipoCargo = (t: string | null) => (t ? TIPO_CARGO_LABELS[t] ?? t : 'Sin tipo de cargo')

/** Texto del período, tal como se imprime. */
export function periodoEstadoCuenta(desde: string | null, hasta: string | null): string {
  if (desde && hasta) return `Del ${formatDateShort(desde)} al ${formatDateShort(hasta)}`
  if (hasta) return `Al ${formatDateShort(hasta)}`
  if (desde) return `Desde el ${formatDateShort(desde)}`
  return 'Todos los movimientos'
}

/** Nombre del archivo: sin acentos ni espacios, estable para el mismo sujeto y corte. */
export function nombreArchivoEstadoCuenta(estado: Pick<EstadoCuenta, 'sujeto' | 'hasta'>): string {
  const quien = (estado.sujeto?.nombre ?? 'sujeto')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sujeto'
  return `estado-cuenta-${quien}${estado.hasta ? `-al-${estado.hasta}` : ''}.pdf`
}

export function construirEstadoCuentaPdf({ entidadNombre, monedaBase, estado }: EstadoCuentaPdfInput): jsPDF {
  const fmt = (n: number | null | undefined) => formatCurrency(n ?? 0, monedaBase)
  const doc = new jsPDF()
  const w = doc.internal.pageSize.width

  doc.setFillColor(...DARK)
  doc.rect(0, 0, w, 13, 'F')
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
  doc.text(entidadNombre, 14, 9)
  doc.text(new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' }), w - 14, 9, { align: 'right' })
  doc.setTextColor(0)

  let y = 24
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text('Estado de cuenta', 14, y)
  y += 7
  doc.setFontSize(11)
  doc.text(
    `${estado.sujeto?.nombre ?? '—'}${estado.sujeto?.codigo_auxiliar ? ` · ${estado.sujeto.codigo_auxiliar}` : ''}`,
    14, y,
  )
  y += 5
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
  doc.text(
    `${estado.sujeto?.tipo === 'unidad' ? 'Unidad' : 'Cliente'} · ${periodoEstadoCuenta(estado.desde, estado.hasta)} · cifras en ${monedaBase}, de pólizas publicadas`,
    14, y,
  )
  doc.setTextColor(0)
  y += 7

  autoTable(doc, {
    startY: y,
    head: [['Saldo inicial', 'Cargos del período', 'Abonos del período', 'Saldo final']],
    body: [[fmt(estado.resumen.saldo_inicial), fmt(estado.resumen.cargos), fmt(estado.resumen.abonos), fmt(estado.resumen.saldo_final)]],
    theme: 'grid',
    headStyles: { fillColor: TEAL, halign: 'center', fontSize: 9 },
    bodyStyles: { halign: 'center', fontSize: 11, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6

  if (estado.por_tipo.length > 1) {
    autoTable(doc, {
      startY: y,
      head: [['Por tipo de cargo', 'Saldo inicial', 'Cargos', 'Abonos', 'Saldo final']],
      body: estado.por_tipo.map((t) => [tipoCargo(t.tipo_cargo), fmt(t.saldo_inicial), fmt(t.cargos), fmt(t.abonos), fmt(t.saldo_final)]),
      theme: 'striped',
      headStyles: { fillColor: DARK, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      // Encabezado incluido: una columna de importes se lee alineada de arriba abajo.
      didParseCell: (d) => { if (d.column.index >= 1) d.cell.styles.halign = 'right' },
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  }

  // El detalle abre con el saldo inicial y cierra con el final: la columna Saldo se puede seguir renglón a renglón.
  const filas: (string | { content: string; styles: Record<string, unknown> })[][] = [
    ['', '', { content: 'Saldo inicial', styles: { fontStyle: 'italic' } }, '', '', fmt(estado.resumen.saldo_inicial)],
    ...estado.movimientos.map((m) => [
      formatDateShort(m.fecha),
      m.asiento_numero != null ? `#${m.asiento_numero}` : '—',
      `${m.documento}${m.concepto && m.concepto !== m.documento ? ` — ${m.concepto}` : ''}${m.es_reverso ? ' (reverso)' : ''}`,
      m.cargo ? fmt(m.cargo) : '',
      m.abono ? fmt(m.abono) : '',
      fmt(m.saldo),
    ]),
  ]
  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Póliza', 'Concepto', 'Cargo', 'Abono', 'Saldo']],
    body: filas,
    foot: [['', '', 'Totales del período', fmt(estado.resumen.cargos), fmt(estado.resumen.abonos), fmt(estado.resumen.saldo_final)]],
    theme: 'striped',
    headStyles: { fillColor: DARK, fontSize: 8 },
    footStyles: { fillColor: [241, 245, 249], textColor: 0, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 20 }, 1: { cellWidth: 16 },
      3: { halign: 'right', cellWidth: 26 }, 4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'right', cellWidth: 28 },
    },
    didParseCell: (d) => { if (d.column.index >= 3) d.cell.styles.halign = 'right' },
    showFoot: 'lastPage',
    margin: { left: 14, right: 14, bottom: 18 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7

  const sf = estado.saldo_a_favor
  if (sf && (sf.saldo_final !== 0 || sf.abonos !== 0 || sf.aplicaciones !== 0)) {
    if (y > doc.internal.pageSize.height - 30) { doc.addPage(); y = 20 }
    doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.text(`Saldo a favor disponible: ${fmt(sf.saldo_final)}`, 14, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
    doc.text('Es dinero recibido de más o por anticipado. No está restado del saldo final: se aplica a un cargo cuando se solicite.', 14, y + 4.5)
    doc.setTextColor(0)
  }

  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    const h = doc.internal.pageSize.height
    doc.setFontSize(8); doc.setTextColor(120)
    doc.text('Saldo según la contabilidad publicada. Los documentos aún sin póliza no están incluidos.', 14, h - 8)
    doc.text(`Página ${i} de ${paginas}`, w - 14, h - 8, { align: 'right' })
    doc.setTextColor(0)
  }
  return doc
}

export function descargarEstadoCuentaPdf(input: EstadoCuentaPdfInput): void {
  construirEstadoCuentaPdf(input).save(nombreArchivoEstadoCuenta(input.estado))
}
