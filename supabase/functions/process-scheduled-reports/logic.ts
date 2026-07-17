// Lógica pura de process-scheduled-reports (patrón I22: testeable bajo vitest,
// sin APIs de Deno). El handler (index.ts) solo orquesta I/O.
//
// Contiene:
//   · SOURCE_META    — metadata por tabla fuente de la whitelist (C4): cómo se
//                      aísla el tenant, si tiene soft delete y qué columnas
//                      proyectar. La verdad equivalente del frontend vive en
//                      src/domain/empresa/reportes.ts — mantener en espejo.
//   · fetchAllChunks — paginación server-side por ventanas (espejo del helper
//                      src/lib/fetchAllRows del frontend): el SELECT único
//                      anterior quedaba a merced del tope silencioso de
//                      PostgREST (~1000 filas) y el reporte salía incompleto.
//   · serializeCsv   — CSV RFC 4180 + BOM (movido intacto desde index.ts).
//   · buildXlsx      — XLSX real SIN dependencias: un .xlsx es un ZIP de XML;
//                      se escribe el ZIP en modo STORE (sin compresión) con
//                      CRC32 propio y SpreadsheetML mínimo (inline strings).
//                      Esto desbloquea el formato que el MVP dejó parqueado
//                      "por libs Deno pesadas" — sin agregar ninguna.

// ─── Metadata de las tablas fuente (whitelist C4) ───────────────────────────

export interface SourceMeta {
  label: string
  /** Aislamiento de tenant: columna company_id directa, o vía project_id ∈ proyectos de la empresa. */
  scope: 'company' | 'project'
  /** true si la tabla tiene deleted_at (F2.7/lote 2) y hay que filtrar soft-deleted. */
  softDelete: boolean
  /** Proyección. `registros` jamás con '*': excluye foto (base64 ~15 MB/fila) y gps. */
  cols: string
}

export const REGISTROS_REPORT_COLS =
  'id, cliente_id, cliente_nombre, contador_id, project_id, fecha, mes, ' +
  'lectura_anterior, lectura_actual, consumo, tipo_cobro, tarifa_aplicada, ' +
  'tarifa_exceso_aplicada, canon_aplicado, monto_calculado, iva_tasa, iva_monto, ' +
  'monto_con_iva, total_a_pagar, estado, monto_pagado, fecha_pago, ' +
  'fecha_vencimiento, mora_monto, dias_servicio, notas, created_at'

export const SOURCE_META: Record<string, SourceMeta> = {
  cuotas_condominio:        { label: 'Cuotas de condominio',       scope: 'company', softDelete: true,  cols: '*' },
  // pagos NO tiene company_id — el filtro fijo por esa columna rompía estos
  // reportes desde el día uno (error de columna inexistente).
  pagos:                    { label: 'Pagos',                      scope: 'project', softDelete: true,  cols: '*' },
  tickets_mantenimiento:    { label: 'Tickets de mantenimiento',   scope: 'company', softDelete: true,  cols: '*' },
  // gastos_condominio NO estaba en F2.7: no tiene deleted_at (mismo bug).
  gastos_condominio:        { label: 'Gastos',                     scope: 'company', softDelete: false, cols: '*' },
  fondo_reserva_condominio: { label: 'Fondo de reserva',           scope: 'company', softDelete: true,  cols: '*' },
  registros:                { label: 'Lecturas / recibos de agua', scope: 'project', softDelete: true,  cols: REGISTROS_REPORT_COLS },
  conta_asientos:           { label: 'Asientos contables',         scope: 'company', softDelete: false, cols: '*' },
}

// ─── Paginación por chunks (fin del tope silencioso de ~1000 filas) ─────────

export interface ChunkResult {
  data: Array<Record<string, unknown>> | null
  error: { message: string } | null
}

export interface FetchAllChunksResult {
  rows: Array<Record<string, unknown>>
  error: string | null
  /** true si se cortó por el techo de seguridad (resultado INCOMPLETO). */
  truncated: boolean
}

export const CHUNK_SIZE = 1000
export const HARD_CEILING = 100_000

/**
 * Trae TODAS las filas paginando con range(from, to). El caller debe encadenar
 * un `.order()` ESTABLE (id) en fetchChunk — sin orden total, las ventanas
 * pueden saltar o duplicar filas.
 */
export async function fetchAllChunks(
  fetchChunk: (from: number, to: number) => PromiseLike<ChunkResult>,
  opts: { chunkSize?: number; ceiling?: number } = {},
): Promise<FetchAllChunksResult> {
  const chunk = Math.max(1, Math.floor(opts.chunkSize ?? CHUNK_SIZE))
  const ceiling = opts.ceiling ?? HARD_CEILING
  const all: Array<Record<string, unknown>> = []
  let from = 0
  for (;;) {
    const { data, error } = await fetchChunk(from, from + chunk - 1)
    if (error) return { rows: all, error: error.message, truncated: false }
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < chunk) return { rows: all, error: null, truncated: false }
    if (all.length >= ceiling) return { rows: all, error: null, truncated: true }
    from += chunk
  }
}

// ─── CSV (RFC 4180 + BOM UTF-8; movido intacto desde index.ts) ──────────────

export interface ReportColumn {
  header: string
  accessor: string
}

export function serializeCsv(
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
): string {
  const headerLine = columns.map(c => escapeCsv(c.header)).join(',')
  const dataLines = rows.map(row =>
    columns.map(c => {
      const v = row[c.accessor]
      if (v === null || v === undefined) return ''
      if (typeof v === 'object') return escapeCsv(JSON.stringify(v))
      return escapeCsv(String(v))
    }).join(',')
  )
  // BOM UTF-8 para que Excel detecte encoding con acentos.
  return '﻿' + [headerLine, ...dataLines].join('\n')
}

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ─── XLSX sin dependencias ───────────────────────────────────────────────────
// Un .xlsx es un paquete ZIP con 5 partes XML mínimas. Se escribe el ZIP en
// modo STORE (método 0, sin compresión): evita cualquier lib de deflate y los
// lectores (Excel/LibreOffice/Sheets) lo abren igual. El peso extra no importa:
// el archivo va a Storage y se entrega por signed URL.

/** Construye un .xlsx de una hoja ("Reporte") con headers + filas. */
export function buildXlsx(
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
): Uint8Array {
  const sheet = buildSheetXml(columns, rows)
  const files: Array<{ name: string; text: string }> = [
    {
      name: '[Content_Types].xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Reporte" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]
  const enc = new TextEncoder()
  return zipStore(files.map(f => ({ name: f.name, data: enc.encode(f.text) })))
}

function buildSheetXml(columns: ReportColumn[], rows: Array<Record<string, unknown>>): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
  ]
  // Fila 1: headers como inline strings.
  parts.push(`<row r="1">${columns.map((c, i) => strCell(colRef(i) + '1', c.header)).join('')}</row>`)
  rows.forEach((row, ri) => {
    const r = ri + 2
    const cells = columns.map((c, i) => {
      const ref = colRef(i) + r
      const v = row[c.accessor]
      if (v === null || v === undefined) return ''
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" t="n"><v>${v}</v></c>`
      if (typeof v === 'boolean') return strCell(ref, v ? 'true' : 'false')
      if (typeof v === 'object') return strCell(ref, JSON.stringify(v))
      return strCell(ref, String(v))
    }).join('')
    parts.push(`<row r="${r}">${cells}</row>`)
  })
  parts.push('</sheetData></worksheet>')
  return parts.join('')
}

function strCell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // Caracteres de control inválidos en XML 1.0 (excepto tab/LF/CR).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
}

/** Referencia de columna A1: 0→A, 25→Z, 26→AA… */
export function colRef(idx: number): string {
  let n = idx
  let s = ''
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
    if (n < 0) return s
  }
}

// ─── ZIP en modo STORE (método 0) ────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// Fecha DOS fija (2026-01-01 00:00) — determinista; a los lectores no les importa.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
const DOS_TIME = 0

/** Empaqueta archivos en un ZIP sin compresión (STORE). Nombres ASCII. */
export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)       // local file header signature
    lv.setUint16(4, 20, true)               // version needed
    lv.setUint16(6, 0, true)                // flags
    lv.setUint16(8, 0, true)                // method: STORE
    lv.setUint16(10, DOS_TIME, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, f.data.length, true)   // compressed size (= sin comprimir)
    lv.setUint32(22, f.data.length, true)   // uncompressed size
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)               // extra len
    local.set(name, 30)
    chunks.push(local, f.data)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)       // central directory signature
    cv.setUint16(4, 20, true)               // version made by
    cv.setUint16(6, 20, true)               // version needed
    cv.setUint16(8, 0, true)                // flags
    cv.setUint16(10, 0, true)               // method
    cv.setUint16(12, DOS_TIME, true)
    cv.setUint16(14, DOS_DATE, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    // extra/comment/disk/attrs internos y externos: 0
    cv.setUint32(42, offset, true)          // offset del local header
    cd.set(name, 46)
    central.push(cd)

    offset += local.length + f.data.length
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)         // end of central directory
  ev.setUint16(8, files.length, true)       // entries (este disco)
  ev.setUint16(10, files.length, true)      // entries (total)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)            // offset del central directory
  const total = offset + cdSize + 22
  const out = new Uint8Array(total)
  let p = 0
  for (const c of [...chunks, ...central, eocd]) { out.set(c, p); p += c.length }
  return out
}
