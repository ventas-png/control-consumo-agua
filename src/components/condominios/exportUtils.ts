import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

// ── Excel ─────────────────────────────────────────────────────────────────────

export interface ExcelSheet {
  name: string
  headers: string[]
  rows: (string | number | null | undefined)[][]
}

export function exportarExcel(filename: string, sheets: ExcelSheet[]): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const data: (string | number | null | undefined)[][] = [sheet.headers, ...sheet.rows]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = sheet.headers.map((h, i) => ({
      wch: Math.max(
        h.length + 2,
        ...sheet.rows.map(r => String(r[i] ?? '').length),
        8
      ),
    }))
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

const DARK: [number, number, number] = [15, 23, 42]
const TEAL: [number, number, number] = [13, 148, 136]

function paginaFooter(doc: jsPDF): void {
  const n = (doc.internal as unknown as { getNumberOfPages(): number }).getNumberOfPages()
  const w = doc.internal.pageSize.width
  const h = doc.internal.pageSize.height
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setTextColor(160)
    doc.text(`Página ${i} de ${n}`, w / 2, h - 6, { align: 'center' })
    doc.setTextColor(0)
  }
}

function headerBand(doc: jsPDF, proyectoNombre: string): number {
  const w = doc.internal.pageSize.width
  doc.setFillColor(...DARK)
  doc.rect(0, 0, w, 13, 'F')
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text(proyectoNombre, 14, 9)
  doc.text(
    new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' }),
    w - 14,
    9,
    { align: 'right' }
  )
  doc.setTextColor(0)
  return 13
}

// ── Generic table PDF ─────────────────────────────────────────────────────────

export interface PDFTablaConfig {
  titulo: string
  subtitulo?: string
  proyectoNombre?: string
  headers: string[]
  rows: (string | number)[][]
  rightAlignCols?: number[]
  totalesRow?: (string | number)[]
  filename: string
  landscape?: boolean
}

export function exportarPDFTabla({
  titulo, subtitulo, proyectoNombre = 'Condominio',
  headers, rows, rightAlignCols = [], totalesRow, filename,
  landscape,
}: PDFTablaConfig): void {
  const isLandscape = landscape ?? headers.length > 6
  const doc = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait' })

  let y = headerBand(doc, proyectoNombre)
  y += 7

  doc.setFontSize(15); doc.setFont('helvetica', 'bold')
  doc.text(titulo, 14, y)
  y += 6

  if (subtitulo) {
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
    doc.text(subtitulo, 14, y)
    doc.setTextColor(0)
    y += 6
  }
  y += 2

  const colStyles: Record<number, { halign: 'right' }> = {}
  rightAlignCols.forEach(c => { colStyles[c] = { halign: 'right' } })

  autoTable(doc, {
    startY: y,
    head: [headers],
    body: rows,
    foot: totalesRow ? [totalesRow] : undefined,
    theme: 'striped',
    headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: [241, 245, 249] as [number,number,number], textColor: DARK, fontStyle: 'bold', fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number,number,number] },
    columnStyles: colStyles,
    margin: { left: 14, right: 14 },
  })

  paginaFooter(doc)
  doc.save(`${filename}.pdf`)
}

// ── Estado de cuenta por residente ────────────────────────────────────────────

export interface MovimientoEC {
  fecha: string
  descripcion: string
  cargo: number
  abono: number
  estado: string
}

export function exportarPDFEstadoCuenta(
  movimientos: MovimientoEC[],
  unidadNombre: string,
  anio: number,
  moneda: string,
  proyectoNombre = 'Condominio'
): void {
  const doc = new jsPDF({ orientation: 'portrait' })
  const totalCargos = movimientos.reduce((s, m) => s + m.cargo, 0)
  const totalAbonos = movimientos.reduce((s, m) => s + m.abono, 0)
  const saldo = totalCargos - totalAbonos

  let y = headerBand(doc, proyectoNombre)
  y += 7

  doc.setFontSize(15); doc.setFont('helvetica', 'bold')
  doc.text('Estado de Cuenta', 14, y)
  y += 6
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
  doc.text(`${unidadNombre} — Período ${anio}`, 14, y)
  doc.setTextColor(0)
  y += 8

  // KPI boxes
  const boxes = [
    { label: 'Cargos', value: `${moneda} ${totalCargos.toFixed(2)}`, color: [239, 68, 68] as [number,number,number] },
    { label: 'Abonos', value: `${moneda} ${totalAbonos.toFixed(2)}`, color: [22, 163, 74] as [number,number,number] },
    { label: 'Saldo', value: saldo <= 0 ? 'Al día ✓' : `${moneda} ${saldo.toFixed(2)}`, color: saldo <= 0 ? [22, 163, 74] as [number,number,number] : [239, 68, 68] as [number,number,number] },
  ]
  const bw = (doc.internal.pageSize.width - 28) / boxes.length
  boxes.forEach((b, i) => {
    const bx = 14 + i * (bw + 4)
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(bx, y, bw, 18, 2, 2, 'F')
    doc.setFontSize(7.5); doc.setTextColor(100); doc.setFont('helvetica', 'normal')
    doc.text(b.label, bx + bw / 2, y + 6, { align: 'center' })
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...b.color)
    doc.text(b.value, bx + bw / 2, y + 14, { align: 'center' })
  })
  doc.setTextColor(0)
  y += 24

  let saldoAcum = 0
  const rows = movimientos.map(m => {
    saldoAcum += m.cargo - m.abono
    return [
      m.fecha,
      m.descripcion,
      m.cargo > 0 ? `${moneda} ${m.cargo.toFixed(2)}` : '—',
      m.abono > 0 ? `${moneda} ${m.abono.toFixed(2)}` : '—',
      saldoAcum > 0 ? `${moneda} ${saldoAcum.toFixed(2)}` : '✓',
      m.estado,
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Descripción', 'Cargo', 'Abono', 'Saldo acum.', 'Estado']],
    body: rows,
    foot: [[
      '', 'TOTALES',
      `${moneda} ${totalCargos.toFixed(2)}`,
      `${moneda} ${totalAbonos.toFixed(2)}`,
      saldo <= 0 ? '✓ Al día' : `${moneda} ${saldo.toFixed(2)}`,
      '',
    ]],
    theme: 'striped',
    headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [241, 245, 249] as [number,number,number], textColor: DARK, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number,number,number] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  doc.setFontSize(7.5); doc.setTextColor(150)
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  doc.text('Este documento es de carácter informativo. Para consultas comuníquese con la administración.', 14, finalY)

  paginaFooter(doc)
  doc.save(`estado-cuenta-${unidadNombre}-${anio}.pdf`)
}

// ── Carta de cobro ─────────────────────────────────────────────────────────────

export interface DeudorCobro {
  unidadNombre: string
  t0_30: number; t31_60: number; t61_90: number; t90plus: number
  total: number; cuotasCount: number
}

export function exportarPDFCartaCobro(
  deudor: DeudorCobro,
  moneda: string,
  proyectoNombre = 'Condominio'
): void {
  const doc = new jsPDF({ orientation: 'portrait' })
  const hoy = new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })

  let y = headerBand(doc, proyectoNombre)
  y += 10

  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('CARTA DE COBRO', 14, y)
  y += 6
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
  doc.text(hoy, 14, y)
  doc.setTextColor(0)
  y += 10

  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text(`Estimado(a) residente de la unidad`, 14, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text(deudor.unidadNombre, 14, y)
  y += 8
  doc.setFont('helvetica', 'normal')
  doc.text('Nos permitimos informarle que a la fecha presenta el siguiente saldo pendiente', 14, y)
  doc.text('con la administración del condominio:', 14, y + 5)
  y += 14

  // Saldo box
  doc.setFillColor(254, 242, 242)
  doc.roundedRect(14, y, doc.internal.pageSize.width - 28, 22, 3, 3, 'F')
  doc.setFontSize(9); doc.setTextColor(220, 38, 38)
  doc.text('Saldo total pendiente', 24, y + 8)
  doc.setFontSize(18); doc.setFont('helvetica', 'bold')
  doc.text(`${moneda} ${deudor.total.toFixed(2)}`, 24, y + 18)
  doc.setTextColor(0)
  y += 30

  const tramos: [string, number][] = [
    ['0–30 días', deudor.t0_30], ['31–60 días', deudor.t31_60],
    ['61–90 días', deudor.t61_90], ['+90 días (mora grave)', deudor.t90plus],
  ].filter(([, v]) => (v as number) > 0) as [string, number][]

  autoTable(doc, {
    startY: y,
    head: [['Tramo de mora', `Monto (${moneda})`]],
    body: tramos.map(([t, v]) => [t, v.toFixed(2)]),
    foot: [['Total', deudor.total.toFixed(2)]],
    theme: 'grid',
    headStyles: { fillColor: TEAL, textColor: 255, fontSize: 9 },
    footStyles: { fillColor: [241, 245, 249] as [number,number,number], fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
  const texto = [
    'Le solicitamos atender este pago a la brevedad para evitar recargos adicionales.',
    'Para regularizar su situación puede comunicarse con la administración o realizar',
    'su pago en los medios habilitados.',
  ]
  texto.forEach((line, i) => doc.text(line, 14, tableEnd + i * 6))

  const firmY = tableEnd + 36
  doc.setFont('helvetica', 'bold')
  doc.text('Atentamente,', 14, firmY)
  doc.setFont('helvetica', 'normal')
  doc.text('Administración del Condominio', 14, firmY + 5)
  doc.text(proyectoNombre, 14, firmY + 10)

  doc.setFontSize(7.5); doc.setTextColor(150)
  doc.text('Este documento es de carácter informativo y no constituye acción legal.', 14, doc.internal.pageSize.height - 12)

  paginaFooter(doc)
  doc.save(`carta-cobro-${deudor.unidadNombre.replace(/\s+/g, '-')}.pdf`)
}

// ── Informe mensual ───────────────────────────────────────────────────────────

export interface InformeExport {
  periodo: string
  total_cuotas: number
  cuotas_pagadas: number
  cuotas_morosas: number
  total_recaudado: number
  total_gastos: number
  num_tickets: number
  tickets_resueltos: number
  num_visitantes: number
  num_incidentes: number
  firmado_por?: string | null
  notas?: string | null
}

export function exportarPDFInformeMensual(
  inf: InformeExport,
  moneda: string,
  proyectoNombre = 'Condominio'
): void {
  const doc = new jsPDF({ orientation: 'portrait' })
  const saldo = inf.total_recaudado - inf.total_gastos
  const tasaRecaudacion = inf.total_cuotas > 0
    ? Math.round((inf.cuotas_pagadas / inf.total_cuotas) * 100)
    : 0

  let y = headerBand(doc, proyectoNombre)
  y += 8

  doc.setFontSize(15); doc.setFont('helvetica', 'bold')
  doc.text('Informe Mensual de Operación', 14, y)
  y += 6
  doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(80)
  doc.text(`Período: ${inf.periodo}`, 14, y)
  doc.setTextColor(0)
  y += 10

  // KPI grid — 3 columns × 2 rows
  const kpis = [
    { label: 'Total recaudado', value: `${moneda} ${inf.total_recaudado.toFixed(2)}`, color: [22, 163, 74] as [number,number,number] },
    { label: 'Total gastos', value: `${moneda} ${inf.total_gastos.toFixed(2)}`, color: [239, 68, 68] as [number,number,number] },
    { label: 'Saldo neto', value: `${saldo >= 0 ? '+' : ''}${moneda} ${saldo.toFixed(2)}`, color: saldo >= 0 ? [22, 163, 74] as [number,number,number] : [239, 68, 68] as [number,number,number] },
    { label: 'Recaudación', value: `${tasaRecaudacion}%`, color: tasaRecaudacion >= 80 ? [22, 163, 74] as [number,number,number] : [217, 119, 6] as [number,number,number] },
    { label: 'Tickets', value: `${inf.num_tickets} (${inf.tickets_resueltos} res.)`, color: [124, 58, 237] as [number,number,number] },
    { label: 'Visitantes / Incidentes', value: `${inf.num_visitantes} / ${inf.num_incidentes}`, color: [3, 105, 161] as [number,number,number] },
  ]
  const cols = 3
  const bw = (doc.internal.pageSize.width - 28 - (cols - 1) * 4) / cols
  kpis.forEach((k, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols)
    const bx = 14 + col * (bw + 4)
    const by = y + row * 22
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(bx, by, bw, 18, 2, 2, 'F')
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
    doc.text(k.label, bx + bw / 2, by + 6, { align: 'center' })
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...k.color)
    doc.text(k.value, bx + bw / 2, by + 14, { align: 'center' })
  })
  doc.setTextColor(0)
  y += Math.ceil(kpis.length / cols) * 22 + 8

  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor']],
    body: [
      ['Cuotas generadas', inf.total_cuotas],
      ['Cuotas pagadas', inf.cuotas_pagadas],
      ['Cuotas morosas', inf.cuotas_morosas],
      ['Tasa de recaudación', `${tasaRecaudacion}%`],
      ['Total recaudado', `${moneda} ${inf.total_recaudado.toFixed(2)}`],
      ['Total gastos', `${moneda} ${inf.total_gastos.toFixed(2)}`],
      ['Saldo neto del período', `${moneda} ${saldo.toFixed(2)}`],
      ['Tickets abiertos', inf.num_tickets],
      ['Tickets resueltos', inf.tickets_resueltos],
      ['Visitantes registrados', inf.num_visitantes],
      ['Incidentes registrados', inf.num_incidentes],
      ['Firmado por', inf.firmado_por ?? '—'],
    ],
    theme: 'striped',
    headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number,number,number] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })

  if (inf.notas) {
    const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    doc.setFillColor(255, 251, 235)
    doc.roundedRect(14, tableEnd, doc.internal.pageSize.width - 28, 24, 2, 2, 'F')
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 83, 9)
    doc.text('Notas del administrador:', 18, tableEnd + 7)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0)
    doc.text(inf.notas.slice(0, 200), 18, tableEnd + 14, { maxWidth: doc.internal.pageSize.width - 36 })
  }

  paginaFooter(doc)
  doc.save(`informe-mensual-${inf.periodo}.pdf`)
}

// ── Recibo digital de pago ────────────────────────────────────────────────────

export interface ReciboExport {
  numero_recibo: string
  concepto: string
  monto: number
  fecha_emision: string
  unidadNombre?: string | null
  destinatario_nombre?: string | null
  destinatario_email?: string | null
  metodo_pago?: string | null
  referencia_pago?: string | null
  notas?: string | null
}

export function exportarPDFRecibo(
  recibo: ReciboExport,
  moneda: string,
  proyectoNombre = 'Condominio'
): void {
  const doc = new jsPDF({ orientation: 'portrait' })
  const w = doc.internal.pageSize.width

  let y = headerBand(doc, proyectoNombre)
  y += 10

  // Número de recibo grande
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
  doc.text('RECIBO DE PAGO', 14, y)
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK)
  doc.text(recibo.numero_recibo, 14, y + 8)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120)
  doc.text(`Emitido: ${recibo.fecha_emision}`, w - 14, y + 8, { align: 'right' })
  doc.setTextColor(0)
  y += 18

  // Caja de monto (verde)
  doc.setFillColor(240, 253, 244)
  doc.setDrawColor(134, 239, 172)
  doc.roundedRect(14, y, w - 28, 26, 3, 3, 'FD')
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(22, 101, 52)
  doc.text('MONTO PAGADO', w / 2, y + 8, { align: 'center' })
  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 163, 74)
  doc.text(`${moneda} ${recibo.monto.toFixed(2)}`, w / 2, y + 20, { align: 'center' })
  doc.setTextColor(0)
  y += 34

  // Detalle del recibo
  const rows: [string, string][] = [
    ['Concepto', recibo.concepto],
    ['Unidad', recibo.unidadNombre ?? '—'],
    ['Destinatario', recibo.destinatario_nombre ?? '—'],
  ]
  if (recibo.metodo_pago) rows.push(['Método de pago', recibo.metodo_pago])
  if (recibo.referencia_pago) rows.push(['Referencia / N° transacción', recibo.referencia_pago])
  if (recibo.destinatario_email) rows.push(['Email', recibo.destinatario_email])
  if (recibo.notas) rows.push(['Notas', recibo.notas])

  autoTable(doc, {
    startY: y,
    body: rows,
    theme: 'plain',
    bodyStyles: { fontSize: 9.5, cellPadding: { top: 4, bottom: 4, left: 6, right: 6 } },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [100, 116, 139] as [number, number, number], cellWidth: 60 },
      1: { textColor: DARK },
    },
    margin: { left: 14, right: 14 },
  })

  const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16

  // Líneas de firma
  const lineY = afterTable + 16
  doc.setDrawColor(200); doc.setLineWidth(0.3)
  doc.line(14, lineY, 90, lineY)
  doc.line(w - 90, lineY, w - 14, lineY)
  doc.setFontSize(8); doc.setTextColor(140)
  doc.text('Firma del administrador', 52, lineY + 5, { align: 'center' })
  doc.text('Firma del residente', w - 52, lineY + 5, { align: 'center' })

  // Sello "PAGADO"
  doc.setGState(doc.GState({ opacity: 0.07 }))
  doc.setFontSize(54); doc.setFont('helvetica', 'bold'); doc.setTextColor(22, 163, 74)
  doc.text('PAGADO', w / 2, 160, { align: 'center', angle: 35 })
  doc.setGState(doc.GState({ opacity: 1 }))

  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(150)
  doc.text('Este recibo es comprobante de pago válido emitido por la administración del condominio.', 14, doc.internal.pageSize.height - 10)

  paginaFooter(doc)
  doc.save(`recibo-${recibo.numero_recibo}.pdf`)
}
