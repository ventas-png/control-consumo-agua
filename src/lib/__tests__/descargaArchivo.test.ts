import { describe, it, expect } from 'vitest'
import { nombreArchivoExport } from '../descargaArchivo'

// plat:P35 — Nombre de archivo del export de datos (parte pura).

describe('nombreArchivoExport', () => {
  it('compone mis-datos-administratodo-YYYY-MM-DD.json en UTC', () => {
    expect(nombreArchivoExport(new Date('2026-06-04T10:00:00Z')))
      .toBe('mis-datos-administratodo-2026-06-04.json')
  })

  it('rellena con ceros mes y día', () => {
    expect(nombreArchivoExport(new Date('2026-01-09T23:59:59Z')))
      .toBe('mis-datos-administratodo-2026-01-09.json')
  })

  it('usa el componente de fecha UTC (no se corre por la hora local)', () => {
    // 2026-03-01T00:30:00Z es aún el 1 de marzo en UTC.
    expect(nombreArchivoExport(new Date('2026-03-01T00:30:00Z')))
      .toBe('mis-datos-administratodo-2026-03-01.json')
  })
})
