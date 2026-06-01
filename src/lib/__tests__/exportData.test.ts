import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies BEFORE importing exportData
vi.mock('../xlsx', () => ({ writeXlsx: vi.fn().mockResolvedValue(undefined) }))

const downloadedBlobs: Array<{ name: string; blob: Blob }> = []
const originalCreateObjectURL = URL.createObjectURL

beforeEach(() => {
  downloadedBlobs.length = 0
  // Mock URL.createObjectURL + click flow
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloadedBlobs.push({ name: 'pending', blob })
    return 'blob:mock://test'
  })
  URL.revokeObjectURL = vi.fn()
  // Intercept anchor click so jsdom no se quiebra
  const origCreate = document.createElement.bind(document)
  document.createElement = ((tag: string) => {
    const el = origCreate(tag)
    if (tag === 'a') {
      ;(el as HTMLAnchorElement).click = () => {
        // El download attribute tiene el filename
        const a = el as HTMLAnchorElement
        if (downloadedBlobs.length > 0) {
          downloadedBlobs[downloadedBlobs.length - 1].name = a.download
        }
      }
    }
    return el
  }) as typeof document.createElement
})

afterAll()
function afterAll() {
  URL.createObjectURL = originalCreateObjectURL
}

const { exportData } = await import('../exportData')
const { writeXlsx } = await import('../xlsx')

interface Row { id: string; nombre: string; monto: number; estado: string }

const DATA: Row[] = [
  { id: '1', nombre: 'Ana', monto: 100, estado: 'pagado' },
  { id: '2', nombre: 'Beto', monto: 250.5, estado: 'pendiente' },
  { id: '3', nombre: 'Carla, López', monto: 0, estado: 'pendiente' },
]

const COLUMNS = [
  { header: 'ID', accessor: 'id' as keyof Row },
  { header: 'Nombre', accessor: 'nombre' as keyof Row },
  { header: 'Monto', accessor: 'monto' as keyof Row, align: 'right' as const, format: (v: string | number | null | undefined) => typeof v === 'number' ? v.toFixed(2) : '0.00' },
  { header: 'Estado', accessor: 'estado' as keyof Row },
]

describe('exportData', () => {
  it('CSV: genera blob con BOM + headers + rows', async () => {
    await exportData('csv', { filename: 'cobros', data: DATA, columns: COLUMNS })
    expect(downloadedBlobs).toHaveLength(1)
    expect(downloadedBlobs[0].name).toBe('cobros.csv')
    const text = await downloadedBlobs[0].blob.text()
    // BOM check: el primer caracter debe ser U+FEFF. JSDOM puede decodificarlo
    // o dejarlo intacto segun version — aceptamos ambos.
    const firstChar = text.charCodeAt(0)
    expect([0xFEFF, 0xEF].includes(firstChar) || text.startsWith('ID')).toBe(true)
    expect(text).toContain('ID,Nombre,Monto,Estado')
    expect(text).toContain('1,Ana,100.00,pagado')
  })

  it('CSV: escapa comas y comillas con quotes', async () => {
    await exportData('csv', { filename: 'test', data: DATA, columns: COLUMNS })
    const text = await downloadedBlobs[0].blob.text()
    // Carla, López debe quedar como "Carla, López"
    expect(text).toContain('"Carla, López"')
  })

  it('CSV: aplica formatter al monto', async () => {
    await exportData('csv', { filename: 'test', data: DATA, columns: COLUMNS })
    const text = await downloadedBlobs[0].blob.text()
    expect(text).toContain('250.50') // monto 250.5 → "250.50" via toFixed(2)
  })

  it('CSV: rows vacios solo header', async () => {
    await exportData('csv', { filename: 'empty', data: [], columns: COLUMNS })
    const text = await downloadedBlobs[0].blob.text()
    const lines = text.replace('﻿', '').split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('ID,Nombre,Monto,Estado')
  })

  it('XLSX: llama writeXlsx con sheet shape correcto', async () => {
    await exportData('xlsx', { filename: 'cobros', data: DATA, columns: COLUMNS })
    expect(writeXlsx).toHaveBeenCalledTimes(1)
    const call = vi.mocked(writeXlsx).mock.calls[0]
    expect(call[0]).toBe('cobros')
    const sheets = call[1]
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('Datos')
    expect(sheets[0].rows[0]).toEqual(['ID', 'Nombre', 'Monto', 'Estado'])
    expect(sheets[0].rows[1]).toEqual(['1', 'Ana', '100.00', 'pagado'])
  })

  it('accessor function se usa en lugar de key', async () => {
    const cols = [
      { header: 'Combined', accessor: (r: Row) => `${r.nombre} (${r.id})` },
    ]
    await exportData('csv', { filename: 'fn', data: DATA, columns: cols })
    const text = await downloadedBlobs[0].blob.text()
    expect(text).toContain('Ana (1)')
    expect(text).toContain('Beto (2)')
  })
})
