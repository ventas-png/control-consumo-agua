// Dominio de la evidencia de housekeeping. Lo que se vigila:
//   · borrar pasa por las RPC y un error del servidor se devuelve tal cual (no se da por hecho);
//   · una respuesta que no confirma el borrado del servicio (no es un número) es ERROR;
//   · si falla la limpieza de archivos el borrado sigue siendo válido (queda «pendiente»);
//   · el cliente NUNCA intenta borrar objetos de Storage (no tiene permiso, a propósito);
//   · una foto ya depurada no pide limpieza (no hay archivo).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()
const remove = vi.fn()
const insertFoto = vi.fn()
const download = vi.fn()

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    storage: { from: () => ({ remove: (...a: unknown[]) => remove(...a), download: (...a: unknown[]) => download(...a) }) },
    from: () => ({ insert: () => ({ select: () => ({ single: () => insertFoto() }) }) }),
  },
}))
vi.mock('../../../lib/imageCompress', () => ({ compressImage: async () => new Blob(['x'], { type: 'image/jpeg' }) }))
vi.mock('../../../lib/fileValidation', () => ({
  validateFileMagic: async () => ({ ok: true, detected: 'image/jpeg' }),
  buildUploadPath: (folder: string, name: string) => `${folder}/${name}`,
}))
const uploadMedia = vi.fn()
vi.mock('../../shared/storage', () => ({ uploadMedia: (...a: unknown[]) => uploadMedia(...a) }))

import {
  cupoDisponible, MAX_FOTOS_POR_FASE, eliminarFotoServicio, eliminarServicioConEvidencias,
  pedirLimpiezaArchivos, subirFotoServicio, descargarFotoServicio,
} from '../housekeepingEvidencias'
import type { FotoHousekeeping } from '../../../types'

const foto = (path: string | null): FotoHousekeeping => ({ id: 'f1', servicio_id: 's1', fase: 'ingreso', path, created_at: '2026-10-10' })

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); remove.mockReset(); insertFoto.mockReset(); uploadMedia.mockReset(); download.mockReset() })

describe('cupoDisponible', () => {
  it('deja pasar todo si cabe', () => expect(cupoDisponible(0, 5)).toBe(5))
  it('recorta al tope por fase', () => expect(cupoDisponible(18, 5)).toBe(2))
  it('no devuelve negativos con la fase llena', () => expect(cupoDisponible(MAX_FOTOS_POR_FASE, 3)).toBe(0))
  it('el tope es 20', () => expect(MAX_FOTOS_POR_FASE).toBe(20))
})

describe('pedirLimpiezaArchivos', () => {
  it('ok solo si la función responde success: true', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null })
    expect(await pedirLimpiezaArchivos()).toBe('ok')
    expect(invoke).toHaveBeenCalledWith('housekeeping-limpieza', { body: {} })
  })
  it.each([
    ['error de red', { data: null, error: { message: 'x' } }],
    ['success: false (hubo errores de Storage)', { data: { success: false }, error: null }],
    ['respuesta vacía', { data: null, error: null }],
  ])('%s → pendiente', async (_n, resp) => {
    invoke.mockResolvedValue(resp)
    expect(await pedirLimpiezaArchivos()).toBe('pendiente')
  })
  it('si la invocación LANZA no escapa: pendiente', async () => {
    invoke.mockRejectedValue(new Error('network'))
    expect(await pedirLimpiezaArchivos()).toBe('pendiente')
  })
})

describe('eliminarFotoServicio', () => {
  it('llama a la RPC con el id y, si todo sale bien, pide limpiar', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    invoke.mockResolvedValue({ data: { success: true }, error: null })
    expect(await eliminarFotoServicio(foto('p/s/a.jpg'))).toEqual({ error: null, limpieza: 'ok' })
    expect(rpc).toHaveBeenCalledWith('hk_eliminar_foto', { p_foto_id: 'f1' })
  })
  it('un rechazo del servidor (sin permiso, inexistente, cero filas) se devuelve y NO se pide limpieza', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'No tienes autorización para eliminar esta foto' } })
    const r = await eliminarFotoServicio(foto('p/s/a.jpg'))
    expect(r.error).toBe('No tienes autorización para eliminar esta foto')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('si la limpieza falla, el borrado sigue siendo válido: queda «pendiente»', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    invoke.mockResolvedValue({ data: null, error: { message: 'edge down' } })
    expect(await eliminarFotoServicio(foto('p/s/a.jpg'))).toEqual({ error: null, limpieza: 'pendiente' })
  })
  it('una foto ya depurada (sin path) no pide limpieza: no hay archivo', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await eliminarFotoServicio(foto(null))).toEqual({ error: null, limpieza: 'ok' })
    expect(invoke).not.toHaveBeenCalled()
  })
  it('NUNCA intenta borrar objetos de Storage desde el cliente', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    invoke.mockResolvedValue({ data: { success: true }, error: null })
    await eliminarFotoServicio(foto('p/s/a.jpg'))
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('eliminarServicioConEvidencias', () => {
  it('devuelve cuántos archivos quedaron encolados y pide limpiar', async () => {
    rpc.mockResolvedValue({ data: 3, error: null })
    invoke.mockResolvedValue({ data: { success: true }, error: null })
    expect(await eliminarServicioConEvidencias('s1')).toEqual({ error: null, fotosEncoladas: 3, limpieza: 'ok' })
    expect(rpc).toHaveBeenCalledWith('hk_eliminar_servicio', { p_servicio_id: 's1' })
  })
  it('sin archivos (0) no invoca la limpieza', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    expect(await eliminarServicioConEvidencias('s1')).toEqual({ error: null, fotosEncoladas: 0, limpieza: 'ok' })
    expect(invoke).not.toHaveBeenCalled()
  })
  it.each([
    ['null (la RPC no confirmó nada)', null],
    ['undefined', undefined],
    ['una cadena', '3'],
    ['un objeto', {}],
  ])('una respuesta %s NO se da por borrado: es error', async (_n, data) => {
    rpc.mockResolvedValue({ data, error: null })
    const r = await eliminarServicioConEvidencias('s1')
    expect(r.error).toMatch(/no se pudo confirmar/i)
    expect(invoke).not.toHaveBeenCalled()
  })
  it('un rechazo del servidor (no es admin, servicio inexistente) llega tal cual', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Servicio inexistente' } })
    expect((await eliminarServicioConEvidencias('s1')).error).toBe('Servicio inexistente')
  })
  it('si la limpieza falla, el servicio ya está eliminado: «pendiente», sin error', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    invoke.mockResolvedValue({ data: { success: false }, error: null })
    expect(await eliminarServicioConEvidencias('s1')).toEqual({ error: null, fotosEncoladas: 2, limpieza: 'pendiente' })
  })
  it('NUNCA intenta borrar objetos de Storage desde el cliente', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    invoke.mockResolvedValue({ data: { success: true }, error: null })
    await eliminarServicioConEvidencias('s1')
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('subirFotoServicio', () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' })
  it('sube bajo <proyecto>/<servicio>/ y registra la fila', async () => {
    uploadMedia.mockResolvedValue({ data: { path: 'ok' }, error: null })
    insertFoto.mockResolvedValue({ data: { id: 'n1' }, error: null })
    const r = await subirFotoServicio({ projectId: 'proy', servicioId: 'serv', fase: 'cierre', file })
    expect(r.error).toBeNull()
    expect(uploadMedia.mock.calls[0][1]).toMatch(/^proy\/serv\//)
  })
  it('si el registro de la fila falla NO intenta borrar el objeto (lo retira el barrido de huérfanos)', async () => {
    uploadMedia.mockResolvedValue({ data: { path: 'ok' }, error: null })
    insertFoto.mockResolvedValue({ data: null, error: { message: 'Máximo 20 fotos por fase' } })
    const r = await subirFotoServicio({ projectId: 'proy', servicioId: 'serv', fase: 'cierre', file })
    expect(r.error).toBe('Máximo 20 fotos por fase')
    expect(remove).not.toHaveBeenCalled()
  })
  it('si la subida falla no registra ninguna fila', async () => {
    uploadMedia.mockResolvedValue({ data: null, error: 'bucket lleno' })
    const r = await subirFotoServicio({ projectId: 'proy', servicioId: 'serv', fase: 'cierre', file })
    expect(r.error).toBe('bucket lleno')
    expect(insertFoto).not.toHaveBeenCalled()
  })
})

describe('descargarFotoServicio', () => {
  it('devuelve el blob o null si Storage falla', async () => {
    const b = new Blob(['x'])
    download.mockResolvedValueOnce({ data: b, error: null })
    expect(await descargarFotoServicio('p/s/a.jpg')).toBe(b)
    download.mockResolvedValueOnce({ data: null, error: { message: 'no existe' } })
    expect(await descargarFotoServicio('p/s/a.jpg')).toBeNull()
  })
})
