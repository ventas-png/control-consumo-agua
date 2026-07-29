import { dateLocalISO } from './format'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Registro, Empresa, RegistroCalidad } from '../types'
import { TIPOLOGIAS_CALIDAD } from '../components/calidad/constants'

export function generarReciboPDFBase64(registro: Registro, empresa: Empresa): string {
  const doc = new jsPDF()
  const total = registro.monto_calculado.toFixed(2)
  const fecha = new Date(registro.fecha).toLocaleDateString()
  const nombreEmpresa = empresa.nombre ?? 'Control de Consumo de Agua'

  doc.setFontSize(16)
  doc.text(nombreEmpresa, 14, 15)
  doc.setFontSize(12)
  doc.text('Recibo de Consumo de Agua Potable', 14, 22)
  doc.setFontSize(10)
  doc.text(`Cliente: ${registro.cliente_nombre}`, 14, 32)
  doc.text(`Fecha de Lectura: ${fecha}`, 14, 37)
  let yPos = 42
  if (registro.fecha_lectura_anterior) {
    const fechaAnt = new Date(registro.fecha_lectura_anterior).toLocaleDateString()
    doc.text(`Período de Servicio: ${fechaAnt} al ${fecha} (${registro.dias_servicio ?? '—'} días)`, 14, yPos)
    yPos += 5
  }
  doc.text(`Tipo de Cobro: ${registro.tipo_cobro}`, 14, yPos)

  const head = [['Concepto', 'Lectura/Tarifa', 'Detalle']]
  const body = [
    ['Lectura Anterior (m³)', String(registro.lectura_anterior), ''],
    ['Lectura Actual (m³)', String(registro.lectura_actual), ''],
    ['Consumo (m³)', registro.consumo.toFixed(2), ''],
    ['Tarifa Aplicada (Q/m³)', `Q${registro.tarifa_aplicada.toFixed(2)}`, ''],
    ...(registro.tarifa_exceso_aplicada && registro.tarifa_exceso_aplicada > 0
      ? [['Tarifa Exceso (Q/m³)', `Q${registro.tarifa_exceso_aplicada.toFixed(2)}`, '']]
      : []),
    ['Canon Fijo (Q)', `Q${registro.canon_aplicado.toFixed(2)}`, ''],
    ['Monto TOTAL a Pagar (Q)', '', `Q${total}`],
  ]

  autoTable(doc, {
    startY: yPos + 6,
    head,
    body,
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [14, 165, 233] },
  })

  if (registro.notas) {
    const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    doc.setFontSize(10)
    doc.text(`Notas: ${registro.notas}`, 14, finalY + 10)
  }

  const pdfDataUri = doc.output('datauristring')
  return pdfDataUri.split(',')[1]
}

export function exportarPDFGlobal(
  registros: Registro[],
  numeroContadorById?: Map<string, string>,
): void {
  const doc = new jsPDF()
  doc.text('Reporte de Lecturas', 14, 20)
  const numeroContadorDe = (r: Registro): string =>
    (r.contador_id ? numeroContadorById?.get(r.contador_id) : undefined) ?? '—'
  autoTable(doc, {
    startY: 30,
    head: [['Fecha', 'Cliente', '# Contador', 'Lect. Ant.', 'Lect. Act.', 'Consumo', 'Total (Q)', 'Estado']],
    body: registros.map(r => [
      new Date(r.fecha).toLocaleDateString(),
      r.cliente_nombre,
      numeroContadorDe(r),
      String(r.lectura_anterior),
      String(r.lectura_actual),
      r.consumo.toFixed(2),
      `Q${r.monto_calculado.toFixed(2)}`,
      r.estado,
    ]),
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [14, 165, 233] },
  })
  doc.save('reporte_agua.pdf')
}

export function generarPDFAnalisis(registro: RegistroCalidad, empresa: Empresa): void {
  const fuente = registro.fuentes_agua
  const tipo = fuente?.tipo_agua
  const tipologia = tipo ? TIPOLOGIAS_CALIDAD[tipo] : null
  const nombreEmpresa = empresa.nombre ?? 'Control de Consumo de Agua'
  const fecha = new Date(registro.fecha).toLocaleString('es-GT')

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(nombreEmpresa, 14, 15)
  doc.setFontSize(12)
  doc.text('Reporte de Calidad del Agua', 14, 22)
  doc.setFontSize(10)
  doc.text(`Fuente: ${fuente ? `${fuente.identificador} — ${fuente.nombre}` : ''}`, 14, 32)
  doc.text(`Tipología: ${tipologia ? tipologia.label : (tipo ?? '')}`, 14, 37)
  doc.text(`Fecha del análisis: ${fecha}`, 14, 42)
  doc.text(`Resultado global: ${registro.cumple_total ? 'CUMPLE' : 'NO CUMPLE'}`, 14, 47)
  let startY = 52
  if (registro.observaciones) {
    doc.text(`Observaciones: ${registro.observaciones}`, 14, 52)
    startY = 58
  }

  const body: string[][] = []
  if (tipologia) {
    tipologia.parametros.forEach(p => {
      const val = registro.parametros[p.key]
      const cumple = registro.cumplimiento[p.key]
      const rango =
        p.min === p.max && p.min === 0
          ? '= 0'
          : p.min > 0
          ? `${p.min} – ${p.max}`
          : `≤ ${p.max}`
      body.push([
        p.label,
        p.unidad || '—',
        val !== undefined ? String(val) : '—',
        rango,
        cumple === true ? 'CUMPLE' : cumple === false ? 'NO CUMPLE' : '—',
      ])
    })
  }

  autoTable(doc, {
    startY,
    head: [['Parámetro', 'Unidad', 'Valor', 'Rango permitido', 'Estado']],
    body,
    theme: 'striped',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [14, 165, 233] },
    didDrawCell: data => {
      if (data.section !== 'body') return
      const fila = body[data.row.index]
      if (!fila) return
      const estado = fila[4]
      if (estado === 'CUMPLE') {
        doc.setFillColor(220, 252, 231)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
      } else if (estado === 'NO CUMPLE') {
        doc.setFillColor(254, 226, 226)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
      }
    },
  })

  const nombreArchivo = `calidad_${fuente ? fuente.identificador.replace(/[^a-z0-9]/gi, '_') : 'analisis'}_${dateLocalISO(new Date(registro.fecha))}.pdf`
  doc.save(nombreArchivo)
}

export function exportarPDFCalidad(
  registros: RegistroCalidad[],
  empresa: Empresa
): void {
  if (!registros.length) return
  const doc = new jsPDF('l', 'mm', 'a4')
  doc.setFontSize(14)
  doc.text(
    `${empresa.nombre ?? 'Control de Consumo de Agua'} — Historial de Calidad del Agua`,
    14,
    15
  )
  doc.setFontSize(9)
  doc.text('Generado: ' + new Date().toLocaleString('es-GT'), 14, 21)

  const body = registros.map(r => {
    const fuente = r.fuentes_agua
    const tipo = fuente?.tipo_agua
    const tipologia = tipo ? TIPOLOGIAS_CALIDAD[tipo] : null
    return [
      new Date(r.fecha).toLocaleDateString('es-GT'),
      fuente ? fuente.identificador : '—',
      tipologia ? tipologia.label : (tipo ?? '—'),
      r.cumple_total ? 'CUMPLE' : 'NO CUMPLE',
      r.observaciones ?? '—',
    ]
  })

  autoTable(doc, {
    startY: 26,
    head: [['Fecha', 'Fuente', 'Tipología', 'Resultado', 'Observaciones']],
    body,
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [14, 165, 233] },
    didDrawCell: data => {
      if (data.section !== 'body') return
      const resultado = body[data.row.index]?.[3]
      if (resultado === 'CUMPLE') {
        doc.setFillColor(220, 252, 231)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
      } else if (resultado === 'NO CUMPLE') {
        doc.setFillColor(254, 226, 226)
        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F')
      }
    },
  })

  doc.save('historial_calidad_agua.pdf')
}
