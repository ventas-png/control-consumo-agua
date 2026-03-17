const PDFDocument = require('pdfkit');

/**
 * Generates the global report PDF stream (pipe to response).
 */
function generateReportePDF(registros, empresa) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const nombreEmpresa = empresa?.nombre || 'Control de Consumo de Agua';

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.fontSize(16).fillColor('#0ea5e9').text(nombreEmpresa, { align: 'center' });
  doc.fontSize(11).fillColor('#374151').text('Reporte de Lecturas de Agua', { align: 'center' });
  doc.fontSize(9).fillColor('#6b7280')
    .text(`Generado: ${new Date().toLocaleDateString('es-GT')}`, { align: 'center' });
  doc.moveDown(1);

  // ── Table ────────────────────────────────────────────────────────────────────
  const startX = 40;
  const colWidths = [65, 125, 60, 60, 55, 65, 65]; // total 495
  const headers = ['Fecha', 'Cliente', 'Lect. Ant.', 'Lect. Act.', 'Consumo', 'Total (Q)', 'Estado'];
  const rowHeight = 18;

  function drawRow(y, rowData, isHeader) {
    // Background
    doc.fillColor(isHeader ? '#0ea5e9' : (rowData._even ? '#f8fafc' : '#ffffff'));
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill();

    // Text
    doc.fillColor(isHeader ? '#ffffff' : '#0f172a').fontSize(isHeader ? 8.5 : 8);
    let x = startX + 4;
    rowData.cells.forEach((cell, i) => {
      doc.text(String(cell), x, y + (isHeader ? 5 : 5), {
        width: colWidths[i] - 6,
        lineBreak: false,
        ellipsis: true
      });
      x += colWidths[i];
    });
  }

  let y = doc.y;

  // Header row
  drawRow(y, { cells: headers }, true);
  y += rowHeight;

  // Data rows
  registros.forEach((r, idx) => {
    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      y = 40;
      drawRow(y, { cells: headers }, true);
      y += rowHeight;
    }
    const total = r.monto_calculado || 0;
    drawRow(y, {
      cells: [
        new Date(r.fecha).toLocaleDateString('es-GT'),
        r.cliente_nombre || '',
        parseFloat(r.lectura_anterior || 0).toFixed(1),
        parseFloat(r.lectura_actual || 0).toFixed(1),
        parseFloat(r.consumo || 0).toFixed(2),
        `Q${total.toFixed(2)}`,
        r.estado || 'pendiente'
      ],
      _even: idx % 2 === 0
    }, false);
    y += rowHeight;
  });

  // Border around table
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const tableHeight = (registros.length + 1) * rowHeight;
  doc.strokeColor('#e2e8f0').lineWidth(0.5);
  doc.rect(startX, doc.y - tableHeight, tableWidth, tableHeight).stroke();

  return doc;
}

/**
 * Generates a single receipt PDF and returns a Buffer.
 */
async function generateReciboPDF(registro, empresaNombre) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const total = (registro.monto_calculado || 0).toFixed(2);
    const fecha = new Date(registro.fecha).toLocaleDateString('es-GT');
    const nombre = empresaNombre || 'Control de Consumo de Agua';

    // Header
    doc.fontSize(18).fillColor('#0ea5e9').text(nombre, { align: 'center' });
    doc.fontSize(12).fillColor('#374151').text('RECIBO DE CONSUMO DE AGUA POTABLE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#6b7280').text(`Fecha: ${fecha}`, { align: 'center' });
    doc.moveDown(1.5);

    // Divider
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.8);

    // Client info
    doc.fontSize(12).fillColor('#0f172a').text(`Cliente: ${registro.cliente_nombre}`);
    doc.fontSize(10).fillColor('#6b7280').text(`Tipo de Cobro: ${registro.tipo_cobro}`);
    doc.moveDown(1);

    // Detail table
    const tableX = 80;
    const valX = 360;
    const rows = [
      ['Lectura Anterior (m³)', `${parseFloat(registro.lectura_anterior || 0).toFixed(2)}`],
      ['Lectura Actual (m³)', `${parseFloat(registro.lectura_actual || 0).toFixed(2)}`],
      ['Consumo (m³)', `${parseFloat(registro.consumo || 0).toFixed(2)}`],
      ['Tarifa Aplicada (Q/m³)', `Q${parseFloat(registro.tarifa_aplicada || 0).toFixed(2)}`],
      ['Canon Fijo (Q)', `Q${parseFloat(registro.canon_aplicado || 0).toFixed(2)}`],
    ];

    rows.forEach(([label, value]) => {
      const rowY = doc.y;
      doc.fontSize(10).fillColor('#6b7280').text(label, tableX, rowY);
      doc.fillColor('#0f172a').text(value, valX, rowY, { align: 'right', width: 120 });
      doc.moveDown(0.3);
      doc.strokeColor('#f1f5f9').lineWidth(0.5)
        .moveTo(tableX, doc.y).lineTo(valX + 120, doc.y).stroke();
      doc.moveDown(0.5);
    });

    doc.moveDown(0.5);
    doc.fillColor('#dcfce7').rect(tableX - 10, doc.y - 5, 460, 30).fill();
    doc.fontSize(14).fillColor('#166534')
      .text(`TOTAL A PAGAR: Q${total}`, tableX, doc.y - 2, { align: 'center', width: 440 });

    if (registro.notas) {
      doc.moveDown(2);
      doc.fontSize(10).fillColor('#6b7280').text(`Notas: ${registro.notas}`);
    }

    doc.end();
  });
}

module.exports = { generateReportePDF, generateReciboPDF };
