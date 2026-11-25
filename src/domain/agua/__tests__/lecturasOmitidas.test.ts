import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
  compressImage: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: h.rpc,
    storage: { from: h.from },
  },
}))
vi.mock('../../../lib/imageCompress', () => ({ compressImage: h.compressImage }))

const { omitirLectura, subirFotoOmision, descartarLecturaOmitida, BUCKET_OMISIONES } = await import('../lecturasOmitidas')

beforeEach(() => {
  vi.clearAllMocks()
  h.from.mockReturnValue({ upload: h.upload, remove: h.remove })
})

describe('lecturasOmitidas — acceso a datos', () => {
  it('omitirLectura manda a la RPC lo capturado, sin empresa ni proyecto', async () => {
    h.rpc.mockResolvedValue({ data: [{ id: 'o1' }], error: null })
    const res = await omitirLectura({
      unidadId: 'u1', contadorIds: ['c1', 'c2'], rutaId: 'r1', motivo: 'acceso_obstruido',
      detalle: 'Carro encima', fotoPath: 'p1/f.jpg', gps: { lat: 1, lng: 2 },
    })
    expect(h.rpc).toHaveBeenCalledWith('omitir_lectura', {
      p_unidad_id: 'u1', p_contador_ids: ['c1', 'c2'], p_ruta_id: 'r1', p_motivo: 'acceso_obstruido',
      p_detalle: 'Carro encima', p_foto_path: 'p1/f.jpg', p_gps: { lat: 1, lng: 2 },
    })
    expect(res).toEqual({ data: [{ id: 'o1' }], error: null })
  })

  it('el rechazo del servidor llega como mensaje', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'No tiene acceso a este proyecto' } })
    const res = await omitirLectura({
      unidadId: 'u1', contadorIds: [], rutaId: null, motivo: 'otro', detalle: null, fotoPath: null, gps: null,
    })
    expect(res).toEqual({ data: null, error: 'No tiene acceso a este proyecto' })
  })

  it('la foto se comprime y se sube a la carpeta del proyecto', async () => {
    const comprimida = new Blob(['x'], { type: 'image/jpeg' })
    h.compressImage.mockResolvedValue(comprimida)
    h.upload.mockResolvedValue({ error: null })
    const res = await subirFotoOmision('proy-1', new File(['y'], 'foto.heic', { type: 'image/heic' }))
    expect(h.from).toHaveBeenCalledWith(BUCKET_OMISIONES)
    expect(res.error).toBeNull()
    expect(res.path).toMatch(/^proy-1\/[^/]+\.jpg$/)
    expect(h.upload).toHaveBeenCalledWith(res.path, comprimida, { contentType: 'image/jpeg' })
  })

  it('si no se puede comprimir, sube el original', async () => {
    h.compressImage.mockRejectedValue(new Error('formato'))
    h.upload.mockResolvedValue({ error: null })
    const original = new File(['y'], 'foto.png', { type: 'image/png' })
    const res = await subirFotoOmision('proy-1', original)
    expect(res.path).toMatch(/\.png$/)
    expect(h.upload.mock.calls[0][1]).toBe(original)
  })

  it('descartar manda id y nota', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null })
    expect(await descartarLecturaOmitida('o1', 'Contador retirado')).toEqual({ error: null })
    expect(h.rpc).toHaveBeenCalledWith('descartar_lectura_omitida', { p_id: 'o1', p_nota: 'Contador retirado' })
  })
})
