// Personas del grupo de una reserva enlazada: qué se borra, qué se actualiza y
// qué se crea en huespedes_str, y que quien ya ingresó no se toca.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  crear: vi.fn(async (..._a: unknown[]) => ({ error: null as { message: string } | null })),
  actualizar: vi.fn(async (..._a: unknown[]) => ({ error: null as { message: string } | null })),
  borrar: vi.fn(async (..._a: unknown[]) => ({ error: null as { message: string } | null })),
  leer: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
}))
vi.mock('../../condominios/tabMutations', () => ({ createCondominioRow: h.crear, updateCondominioRow: h.actualizar, deleteCondominioRowsByIds: h.borrar }))
vi.mock('../../condominios/tabQueries', () => ({ fetchHuespedesByReservas: h.leer }))

const { cargarGrupo, guardarGrupo, personaVacia } = await import('../grupo')
const persona = (extra: object) => ({ ...personaVacia(), ...extra })

beforeEach(() => { vi.clearAllMocks() })

describe('guardarGrupo', () => {
  it('borra las quitadas, actualiza las que siguen y crea las nuevas; quien ya ingresó no se toca', async () => {
    const antes = [persona({ id: 'a', nombre: 'Ana' }), persona({ id: 'b', nombre: 'Beto' }), persona({ id: 'v', nombre: 'Vera', visitante_id: 'x' })]
    const ahora = [persona({ id: 'a', nombre: ' Ana María ', identificacion: ' 123 ' }), persona({ id: 'v', nombre: 'Vera', visitante_id: 'x' }),
      persona({ nombre: 'Niño', es_menor: true, fecha_nacimiento: '2020-01-01' }), persona({ nombre: '   ' })]
    await guardarGrupo('res1', antes, ahora)
    expect(h.borrar).toHaveBeenCalledWith('huespedes_str', ['b'])
    expect(h.actualizar).toHaveBeenCalledTimes(1)
    expect(h.actualizar).toHaveBeenCalledWith('huespedes_str', 'a', expect.objectContaining({ nombre: 'Ana María', identificacion: '123', fecha_nacimiento: null }))
    expect(h.crear).toHaveBeenCalledWith('huespedes_str', [expect.objectContaining({ reserva_str_id: 'res1', nombre: 'Niño', es_menor: true, fecha_nacimiento: '2020-01-01' })])
  })
  it('si la base rechaza un paso, lanza', async () => {
    h.crear.mockResolvedValueOnce({ error: { message: 'sin permiso' } })
    await expect(guardarGrupo('res1', [], [persona({ nombre: 'Ana' })])).rejects.toThrow('sin permiso')
  })
})

describe('cargarGrupo', () => {
  it('trae las personas de la reserva en la forma del formulario', async () => {
    h.leer.mockResolvedValueOnce([{ id: 'a', nombre: 'Ana', identificacion: null, es_menor: false, fecha_nacimiento: null, foto_url: null, foto_documento_url: 'd.jpg', visitante_id: null }])
    expect(await cargarGrupo('res1')).toEqual([{ id: 'a', nombre: 'Ana', identificacion: '', es_menor: false, fecha_nacimiento: '', foto_url: null, foto_documento_url: 'd.jpg', visitante_id: null }])
    expect(h.leer).toHaveBeenCalledWith(['res1'])
  })
})
