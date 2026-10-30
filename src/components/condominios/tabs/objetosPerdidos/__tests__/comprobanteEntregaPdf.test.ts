import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ObjetoPerdido } from '../../../../../types'

const mocks = vi.hoisted(() => ({ downloadMedia: vi.fn(async (..._args: unknown[]) => null as Blob | null) }))
vi.mock('../../../../../lib/supabase', () => ({ supabase: { storage: { from: () => ({}) } }, db: {} }))
vi.mock('../../../../../domain/shared/storage', () => ({ downloadMedia: mocks.downloadMedia }))

const { lineasComprobanteEntrega, generarComprobanteEntregaPdf } = await import('../comprobanteEntregaPdf')
const { nombrePdfEntrega, tieneComprobante } = await import('../../../../../domain/condominios/objetosPerdidos')

const entregado: ObjetoPerdido = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001', company_id: 'co1', project_id: 'p1', descripcion: 'Llaves con llavero rojo',
  fecha_encontrado: '2026-10-28', estado: 'reclamado', encontrado_por_tipo: 'tercero', encontrado_por_nombre: 'María Gómez',
  encontrado_por_contacto: 'Casa 12', custodio_nombre: 'Ana López', fotos: ['p1/objetos-perdidos/a.jpg', 'p1/objetos-perdidos/b.jpg'],
  reclamado_por: 'Pedro Ramírez', entrega_documento: '1234 56789 0101', fecha_reclamo: '2026-10-30',
  firma_entrega_path: 'p1/objetos-perdidos/firmas/1-a-firma.png', entregado_en: '2026-10-30T16:05:00Z', entregado_por_nombre: 'Admin Uno',
  notas: 'Llavero con logo del gimnasio', created_at: '2026-10-28T10:00:00Z',
}
const datos = { objeto: entregado, lugar: 'Piscina', almacen: 'Recepción · Gaveta 2', proyectoNombre: 'Condominio 21B+' }

beforeEach(() => { mocks.downloadMedia.mockClear() })

describe('lineasComprobanteEntrega', () => {
  it('el objeto: qué es, cuándo y dónde se encontró, quién (tercero con contacto), custodio, almacenamiento y notas', () => {
    const l = lineasComprobanteEntrega(datos)
    expect(l.titulo).toBe('COMPROBANTE DE ENTREGA DE OBJETO PERDIDO')
    expect(l.folio).toBe('Registro A1B2C3D4')
    expect(l.objeto).toEqual([
      ['Objeto', 'Llaves con llavero rojo'],
      ['Encontrado el', '28 de octubre de 2026'],
      ['Dónde', 'Piscina'],
      ['Encontrado por', 'María Gómez (tercero) · Casa 12'],
      ['Custodio', 'Ana López'],
      ['Almacenado en', 'Recepción · Gaveta 2'],
      ['Notas', 'Llavero con logo del gimnasio'],
    ])
  })

  it('la entrega: quién recibió, documento, fecha y hora de servidor y quién entregó; la declaración y el pie de firma lo nombran', () => {
    const l = lineasComprobanteEntrega(datos)
    expect(l.entrega.map(([k]) => k)).toEqual(['Recibió', 'Documento', 'Fecha y hora', 'Entregó'])
    expect(l.entrega[0][1]).toBe('Pedro Ramírez')
    expect(l.entrega[2][1]).toMatch(/30\/10\/2026/)
    expect(l.entrega[3][1]).toBe('Admin Uno')
    expect(l.declaracion).toBe('Yo, Pedro Ramírez, declaro haber recibido el objeto descrito en este comprobante.')
    expect(l.firma).toMatch(/^Firma de recibido: Pedro Ramírez · 30\/10\/2026/)
  })

  it('sin documento ni datos opcionales, no inventa filas y marca lo que falta', () => {
    const l = lineasComprobanteEntrega({ objeto: { ...entregado, entrega_documento: null, notas: null, encontrado_por_tipo: null, custodio_nombre: null, entregado_por_nombre: null }, lugar: '', almacen: '' })
    expect(l.entrega.map(([k]) => k)).toEqual(['Recibió', 'Fecha y hora', 'Entregó'])
    expect(l.objeto.find(([k]) => k === 'Notas')).toBeUndefined()
    expect(Object.fromEntries(l.objeto)).toMatchObject({ 'Dónde': '—', 'Encontrado por': '—', Custodio: '—', 'Almacenado en': '—' })
  })
})

describe('generarComprobanteEntregaPdf', () => {
  it('pide al bucket hasta tres fotos y la firma, y devuelve un PDF aunque alguna no cargue', async () => {
    const blob = await generarComprobanteEntregaPdf(datos)
    expect(mocks.downloadMedia.mock.calls.map(c => c[1])).toEqual([
      'p1/objetos-perdidos/a.jpg', 'p1/objetos-perdidos/b.jpg', 'p1/objetos-perdidos/firmas/1-a-firma.png',
    ])
    expect(mocks.downloadMedia.mock.calls.every(c => c[0] === 'condominios-media')).toBe(true)
    expect(blob.size).toBeGreaterThan(0)
    expect((await blob.slice(0, 5).text())).toBe('%PDF-')
  })
})

describe('comprobante en el dominio', () => {
  it('sólo las entregas firmadas tienen comprobante', () => {
    expect(tieneComprobante(entregado)).toBe(true)
    expect(tieneComprobante({ ...entregado, firma_entrega_path: null })).toBe(false)
    expect(tieneComprobante({ ...entregado, estado: 'en_custodia' })).toBe(false)
  })
  it('nombre del archivo sin acentos ni signos', () => {
    expect(nombrePdfEntrega(entregado)).toBe('Entrega-Llaves_con_llavero_rojo-2026-10-30.pdf')
    expect(nombrePdfEntrega({ descripcion: 'Celular (Ñandú)', fecha_reclamo: null, entregado_en: '2026-10-31T01:00:00Z' })).toBe('Entrega-Celular_Nandu_-2026-10-31.pdf')
  })
})
