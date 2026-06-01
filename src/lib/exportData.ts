// ============================================================================
// exportData — F4.5.2: helper unificado XLSX / CSV / PDF para tablas
// ============================================================================
// Reusa libs ya en el bundle:
//   - exceljs (via lib/xlsx.ts) para XLSX
//   - jspdf + jspdf-autotable para PDF (lazy dynamic import)
//   - vanilla TextEncoder + Blob para CSV (sin lib)
//
// Diseño:
//   - Input genérico: Array<Record<string, value>> + column metadata
//   - Cada formato comparte la misma definicion de columnas (header, key,
//     opcional formatter)
//   - Cada export dispara download del navegador via Blob URL — sin upload
//     intermedio. El usuario decide donde guardar.
//
// No reemplaza al exportUtils.ts especifico de condominios (carta de cobro,
// estado de cuenta) que sigue siendo el indicado para PDFs con layout
// custom. exportData es para tablas planas.

import { writeXlsx } from './xlsx'

export type ExportFormat = 'xlsx' | 'csv' | 'pdf'

export interface ExportColumn<T> {
  /** Etiqueta visible en el header de cada fila */
  header: string
  /** Key del objeto T o funcion que extrae el valor */
  accessor: keyof T | ((row: T) => string | number | null | undefined)
  /** Formatter opcional aplicado al valor extraido (ej: formato monetario) */
  format?: (v: string | number | null | undefined, row: T) => string | number
  /** Alineacion para PDF (default left) */
  align?: 'left' | 'right' | 'center'
}

export interface ExportOptions<T> {
  /** Nombre del archivo sin extension (la funcion la agrega) */
  filename: string
  data: T[]
  columns: ExportColumn<T>[]
  /** Titulo del documento, usado solo en PDF */
  title?: string
  /** Subtitulo del documento, usado solo en PDF */
  subtitle?: string
}

export async function exportData<T>(format: ExportFormat, opts: ExportOptions<T>): Promise<void> {
  const rows = opts.data.map(row => opts.columns.map(c => extract(c, row)))
  const headers = opts.columns.map(c => c.header)

  switch (format) {
    case 'csv':
      downloadCsv(opts.filename, headers, rows)
      return
    case 'xlsx':
      await writeXlsx(opts.filename, [{ name: 'Datos', rows: [headers, ...rows] }])
      return
    case 'pdf':
      await downloadPdf(opts, headers, rows)
      return
  }
}

function extract<T>(col: ExportColumn<T>, row: T): string | number {
  const raw = typeof col.accessor === 'function' ? col.accessor(row) : (row as Record<string, unknown>)[col.accessor as string] as string | number | null | undefined
  const value = col.format ? col.format(raw, row) : raw
  if (value === null || value === undefined) return ''
  return value
}

// ───── CSV ─────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(r => r.map(escapeCsvCell).join(',')),
  ]
  // BOM UTF-8 para que Excel detecte encoding correctamente con acentos.
  const BOM = '﻿'
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, `${filename}.csv`)
}

function escapeCsvCell(v: string | number): string {
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ───── PDF ─────────────────────────────────────────────────────────────────

async function downloadPdf<T>(opts: ExportOptions<T>, headers: string[], rows: (string | number)[][]): Promise<void> {
  // Lazy: jspdf + autoTable son ~420KB. Solo se importan cuando el user
  // realmente exporta PDF.
  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = (autoTableModule as { default: (doc: unknown, opts: unknown) => unknown }).default

  const landscape = headers.length > 6
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait' })

  let y = 14
  if (opts.title) {
    doc.setFontSize(15)
    doc.setFont('helvetica', 'bold')
    doc.text(opts.title, 14, y)
    y += 7
  }
  if (opts.subtitle) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100)
    doc.text(opts.subtitle, 14, y)
    doc.setTextColor(0)
    y += 6
  }

  const colStyles: Record<number, { halign: 'left' | 'right' | 'center' }> = {}
  opts.columns.forEach((c, i) => {
    if (c.align) colStyles[i] = { halign: c.align }
  })

  autoTable(doc, {
    startY: y,
    head: [headers],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: colStyles,
    margin: { left: 14, right: 14 },
  })

  doc.save(`${opts.filename}.pdf`)
}

// ───── Common ──────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
