// Tests de la lógica pura de process-scheduled-reports (patrón I22: el módulo
// logic.ts no toca APIs de Deno, así que corre bajo vitest).
import { describe, it, expect } from 'vitest'
import {
  SOURCE_META,
  REGISTROS_REPORT_COLS,
  fetchAllChunks,
  serializeCsv,
  buildXlsx,
  crc32,
  colRef,
  zipStore,
  type ChunkResult,
} from '../logic'

// ─── SOURCE_META: el contrato de scoping por tabla ───────────────────────────

describe('SOURCE_META', () => {
  it('cubre las 7 tablas del CHECK constraint', () => {
    expect(Object.keys(SOURCE_META).sort()).toEqual([
      'conta_asientos', 'cuotas_condominio', 'fondo_reserva_condominio',
      'gastos_condominio', 'pagos', 'registros', 'tickets_mantenimiento',
    ])
  })

  it('pagos y registros se aíslan por proyecto (no tienen company_id)', () => {
    expect(SOURCE_META.pagos.scope).toBe('project')
    expect(SOURCE_META.registros.scope).toBe('project')
  })

  it('gastos_condominio y conta_asientos no filtran deleted_at (no existe la columna)', () => {
    expect(SOURCE_META.gastos_condominio.softDelete).toBe(false)
    expect(SOURCE_META.conta_asientos.softDelete).toBe(false)
  })

  it('registros jamás proyecta foto ni gps (base64 de ~15 MB por fila)', () => {
    expect(SOURCE_META.registros.cols).toBe(REGISTROS_REPORT_COLS)
    expect(REGISTROS_REPORT_COLS).not.toContain('foto')
    expect(REGISTROS_REPORT_COLS).not.toContain('gps')
    expect(REGISTROS_REPORT_COLS).toContain('consumo')
    expect(REGISTROS_REPORT_COLS).toContain('monto_calculado')
  })
})

// ─── fetchAllChunks ──────────────────────────────────────────────────────────

function fakeSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: Array<[number, number]> = []
  const fetchChunk = (from: number, to: number): Promise<ChunkResult> => {
    calls.push([from, to])
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
  }
  return { fetchChunk, calls }
}

describe('fetchAllChunks', () => {
  it('recorre varias páginas y trae todo', async () => {
    const { fetchChunk, calls } = fakeSource(25)
    const r = await fetchAllChunks(fetchChunk, { chunkSize: 10 })
    expect(r.rows).toHaveLength(25)
    expect(r.error).toBeNull()
    expect(r.truncated).toBe(false)
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('propaga el error con lo acumulado', async () => {
    let n = 0
    const r = await fetchAllChunks(() => {
      n++
      if (n === 2) return Promise.resolve({ data: null, error: { message: 'boom' } })
      return Promise.resolve({ data: Array.from({ length: 5 }, (_, i) => ({ id: i })), error: null })
    }, { chunkSize: 5 })
    expect(r.error).toBe('boom')
    expect(r.rows).toHaveLength(5)
  })

  it('corta en el techo y marca truncated', async () => {
    const r = await fetchAllChunks(
      (from, to) => Promise.resolve({
        data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })),
        error: null,
      }),
      { chunkSize: 10, ceiling: 25 },
    )
    expect(r.truncated).toBe(true)
    expect(r.rows).toHaveLength(30)
  })
})

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('serializeCsv', () => {
  it('BOM + headers + filas con escaping RFC 4180', () => {
    const csv = serializeCsv(
      [{ header: 'Nombre', accessor: 'n' }, { header: 'Nota, rara', accessor: 'x' }],
      [{ n: 'Juan "El Chino"', x: null }, { n: 'Ana', x: 42 }],
    )
    expect(csv.charCodeAt(0)).toBe(0xFEFF) // BOM
    const lines = csv.slice(1).split('\n')
    expect(lines[0]).toBe('Nombre,"Nota, rara"')
    expect(lines[1]).toBe('"Juan ""El Chino""",')
    expect(lines[2]).toBe('Ana,42')
  })
})

// ─── XLSX: CRC32, colRef y estructura ZIP ────────────────────────────────────

describe('crc32', () => {
  it('vector conocido: "123456789" → 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926)
  })
})

describe('colRef', () => {
  it('A1-notation: 0→A, 25→Z, 26→AA, 27→AB, 701→ZZ, 702→AAA', () => {
    expect(colRef(0)).toBe('A')
    expect(colRef(25)).toBe('Z')
    expect(colRef(26)).toBe('AA')
    expect(colRef(27)).toBe('AB')
    expect(colRef(701)).toBe('ZZ')
    expect(colRef(702)).toBe('AAA')
  })
})

/** Parser mínimo de ZIP STORE: recorre local file headers y extrae entradas. */
function parseStoreZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Map<string, Uint8Array>()
  let p = 0
  const dec = new TextDecoder()
  while (dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true)
    const crc = dv.getUint32(p + 14, true)
    const size = dv.getUint32(p + 18, true)
    const nameLen = dv.getUint16(p + 26, true)
    const extraLen = dv.getUint16(p + 28, true)
    const name = dec.decode(bytes.slice(p + 30, p + 30 + nameLen))
    const data = bytes.slice(p + 30 + nameLen + extraLen, p + 30 + nameLen + extraLen + size)
    expect(method).toBe(0)          // STORE
    expect(crc32(data)).toBe(crc)   // integridad
    out.set(name, data)
    p += 30 + nameLen + extraLen + size
  }
  return out
}

describe('zipStore / buildXlsx', () => {
  it('el ZIP tiene firma local, EOCD y CRCs válidos', () => {
    const zip = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hola') }])
    const dv = new DataView(zip.buffer)
    expect(dv.getUint32(0, true)).toBe(0x04034b50)                     // local header
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50)       // EOCD
    expect(dv.getUint16(zip.length - 22 + 10, true)).toBe(1)           // total entries
    const entries = parseStoreZip(zip)
    expect(new TextDecoder().decode(entries.get('a.txt'))).toBe('hola')
  })

  it('buildXlsx produce el paquete OOXML mínimo con los datos', () => {
    const xlsx = buildXlsx(
      [{ header: 'Cliente', accessor: 'nombre' }, { header: 'Monto', accessor: 'monto' }],
      [
        { nombre: 'Juan & Cía <SA>', monto: 150.5 },
        { nombre: 'Ana', monto: null },
      ],
    )
    const entries = parseStoreZip(xlsx)
    expect([...entries.keys()].sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ])
    const sheet = new TextDecoder().decode(entries.get('xl/worksheets/sheet1.xml'))
    // Headers como inline strings en la fila 1
    expect(sheet).toContain('<row r="1">')
    expect(sheet).toContain('<t xml:space="preserve">Cliente</t>')
    // Texto escapado para XML
    expect(sheet).toContain('Juan &amp; Cía &lt;SA&gt;')
    // Número como celda numérica
    expect(sheet).toContain('<c r="B2" t="n"><v>150.5</v></c>')
    // null → celda omitida (no hay B3)
    expect(sheet).not.toContain('<c r="B3"')
    // El workbook declara la hoja
    const wb = new TextDecoder().decode(entries.get('xl/workbook.xml'))
    expect(wb).toContain('<sheet name="Reporte" sheetId="1"')
  })

  it('celdas boolean y object se serializan como texto', () => {
    const xlsx = buildXlsx(
      [{ header: 'V', accessor: 'v' }],
      [{ v: true }, { v: { a: 1 } }],
    )
    const sheet = new TextDecoder().decode(parseStoreZip(xlsx).get('xl/worksheets/sheet1.xml'))
    expect(sheet).toContain('<t xml:space="preserve">true</t>')
    expect(sheet).toContain('{&quot;a&quot;:1}')
  })
})
