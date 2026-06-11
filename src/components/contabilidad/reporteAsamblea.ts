// Reporte ejecutivo para asamblea (PDF) — pendiente declarado de Fase 5.
// Un solo documento con resumen ejecutivo, estado de resultados, balance
// general y flujo de efectivo del periodo, generado desde los datos que los
// RPCs de EEFF ya cargaron en el tab. Mismo lenguaje visual que
// condominios/exportUtils (banda oscura, acento teal, footer paginado).
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from '../../lib/format'
import type { ResumenBalance, ResumenPyG } from '../../domain/eeff/calculos'
import type { FlujoEfectivoFila } from '../../types/eeff'

const DARK: [number, number, number] = [15, 23, 42]
const TEAL: [number, number, number] = [13, 148, 136]

export interface ReporteAsambleaInput {
  entidadNombre: string
  desde: string
  hasta: string
  monedaBase: string
  pyg: ResumenPyG
  balance: ResumenBalance
  flujo: FlujoEfectivoFila[]
}

export function generarReporteAsamblea(input: ReporteAsambleaInput): void {
  const { entidadNombre, desde, hasta, monedaBase, pyg, balance, flujo } = input
  const fmt = (n: number) => formatCurrency(n, monedaBase)
  const doc = new jsPDF()
  const w = doc.internal.pageSize.width

  // Banda superior
  doc.setFillColor(...DARK)
  doc.rect(0, 0, w, 13, 'F')
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
  doc.text(entidadNombre, 14, 9)
  doc.text(new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' }), w - 14, 9, { align: 'right' })
  doc.setTextColor(0)

  let y = 24
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text('Informe financiero para asamblea', 14, y)
  y += 6
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
  doc.text(`Periodo ${desde} a ${hasta} · cifras en ${monedaBase}, desde la contabilidad publicada`, 14, y)
  doc.setTextColor(0)
  y += 9

  // ── Resumen ejecutivo (KPIs) ──
  const efectivoFinal = flujo.reduce((s, f) => s + f.saldo_final, 0)
  const kpis: [string, string][] = [
    ['Ingresos del periodo', fmt(pyg.totalIngresos)],
    ['Gastos del periodo', fmt(pyg.totalGastos)],
    [pyg.resultado >= 0 ? 'Utilidad del periodo' : 'Pérdida del periodo', fmt(pyg.resultado)],
    ['Efectivo al cierre', fmt(efectivoFinal)],
  ]
  autoTable(doc, {
    startY: y,
    head: [['Resumen ejecutivo', '']],
    body: kpis,
    theme: 'grid',
    headStyles: { fillColor: TEAL, fontSize: 10 },
    bodyStyles: { fontSize: 10 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // ── Estado de resultados ──
  autoTable(doc, {
    startY: y,
    head: [['Estado de resultados', `Monto (${monedaBase})`]],
    body: [
      [{ content: 'INGRESOS', styles: { fontStyle: 'bold' as const } }, ''],
      ...pyg.ingresos.map((f) => [`  ${f.codigo} — ${f.nombre}`, fmt(f.monto)]),
      [{ content: 'Total ingresos', styles: { fontStyle: 'bold' as const } },
       { content: fmt(pyg.totalIngresos), styles: { fontStyle: 'bold' as const } }],
      [{ content: 'GASTOS', styles: { fontStyle: 'bold' as const } }, ''],
      ...pyg.gastos.map((f) => [`  ${f.codigo} — ${f.nombre}`, fmt(f.monto)]),
      [{ content: 'Total gastos', styles: { fontStyle: 'bold' as const } },
       { content: fmt(pyg.totalGastos), styles: { fontStyle: 'bold' as const } }],
      [{ content: pyg.resultado >= 0 ? 'UTILIDAD DEL PERIODO' : 'PÉRDIDA DEL PERIODO', styles: { fontStyle: 'bold' as const } },
       { content: fmt(pyg.resultado), styles: { fontStyle: 'bold' as const } }],
    ],
    theme: 'striped',
    headStyles: { fillColor: TEAL, fontSize: 10 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // ── Balance general ──
  const seccionBalance = (titulo: string, filas: ResumenBalance['activo'], total: number) => [
    [{ content: titulo, styles: { fontStyle: 'bold' as const } }, ''],
    ...filas.map((f) => [`  ${f.cuenta_id ? `${f.codigo} — ` : ''}${f.nombre}`, fmt(f.saldo)]),
    [{ content: `Total ${titulo.toLowerCase()}`, styles: { fontStyle: 'bold' as const } },
     { content: fmt(total), styles: { fontStyle: 'bold' as const } }],
  ]
  autoTable(doc, {
    startY: y,
    head: [[`Balance general al cierre de ${hasta}`, `Saldo (${monedaBase})`]],
    body: [
      ...seccionBalance('ACTIVO', balance.activo, balance.totalActivo),
      ...seccionBalance('PASIVO', balance.pasivo, balance.totalPasivo),
      ...seccionBalance('CAPITAL', balance.capital, balance.totalCapital),
    ],
    theme: 'striped',
    headStyles: { fillColor: TEAL, fontSize: 10 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
  doc.setFontSize(9)
  doc.setTextColor(...(balance.descuadre === 0 ? [13, 148, 136] : [220, 38, 38]) as [number, number, number])
  doc.text(
    balance.descuadre === 0
      ? `Balance cuadrado: Activo ${fmt(balance.totalActivo)} = Pasivo ${fmt(balance.totalPasivo)} + Capital ${fmt(balance.totalCapital)}`
      : `Atención: descuadre de ${fmt(balance.descuadre)}`,
    14, y,
  )
  doc.setTextColor(0)
  y += 8

  // ── Flujo de efectivo ──
  autoTable(doc, {
    startY: y,
    head: [['Cuenta de efectivo', 'Saldo inicial', 'Entradas', 'Salidas', 'Saldo final']],
    body: [
      ...flujo.map((f) => [`${f.codigo} — ${f.nombre}`, fmt(f.saldo_inicial), fmt(f.entradas), fmt(f.salidas), fmt(f.saldo_final)]),
      [
        { content: 'Total efectivo', styles: { fontStyle: 'bold' as const } },
        { content: fmt(flujo.reduce((s, f) => s + f.saldo_inicial, 0)), styles: { fontStyle: 'bold' as const } },
        { content: fmt(flujo.reduce((s, f) => s + f.entradas, 0)), styles: { fontStyle: 'bold' as const } },
        { content: fmt(flujo.reduce((s, f) => s + f.salidas, 0)), styles: { fontStyle: 'bold' as const } },
        { content: fmt(flujo.reduce((s, f) => s + f.saldo_final, 0)), styles: { fontStyle: 'bold' as const } },
      ],
    ],
    theme: 'striped',
    headStyles: { fillColor: TEAL, fontSize: 10 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  // Footer paginado
  const paginas = (doc.internal as unknown as { getNumberOfPages(): number }).getNumberOfPages()
  const h = doc.internal.pageSize.height
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5); doc.setTextColor(160)
    doc.text(`Página ${i} de ${paginas}`, w / 2, h - 6, { align: 'center' })
    doc.setTextColor(0)
  }

  doc.save(`informe-asamblea-${desde}-a-${hasta}.pdf`)
}
