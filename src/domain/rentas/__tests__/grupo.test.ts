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
const sb = vi.hoisted(() => ({ filas: [] as unknown[], consulta: [] as string[] }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: (t: string) => ({ select: () => ({ eq: (_c: string, v: string) => ({ order: async () => { sb.consulta.push(`${t}:${v}`); return { data: sb.filas, error: null } } }) }) }) },
}))
const retirar = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ error: null })))
vi.mock('../../shared/storage', () => ({ removeMedia: retirar }))

const { cargarGrupo, fotosDe, guardarGrupo, personaVacia, retirarFotosHuespedes } = await import('../grupo')
const STR = { id: 'res1', origen: 'condominio' as const }
const IND = { id: 'res2', origen: 'rentas' as const }
const PROP = { id: 'prop1', company_id: 'c1' }
const persona = (extra: object) => ({ ...personaVacia(), ...extra })

beforeEach(() => { vi.clearAllMocks() })

describe('guardarGrupo', () => {
  it('borra las quitadas, actualiza las que siguen y crea las nuevas; quien ya ingresó no se toca', async () => {
    const antes = [persona({ id: 'a', nombre: 'Ana' }), persona({ id: 'b', nombre: 'Beto' }), persona({ id: 'v', nombre: 'Vera', visitante_id: 'x' })]
    const ahora = [persona({ id: 'a', nombre: ' Ana María ', identificacion: ' 123 ' }), persona({ id: 'v', nombre: 'Vera', visitante_id: 'x' }),
      persona({ nombre: 'Niño', es_menor: true, fecha_nacimiento: '2020-01-01' }), persona({ nombre: '   ' })]
    await guardarGrupo(STR, PROP, antes, ahora)
    expect(h.borrar).toHaveBeenCalledWith('huespedes_str', ['b'])
    expect(h.actualizar).toHaveBeenCalledTimes(1)
    expect(h.actualizar).toHaveBeenCalledWith('huespedes_str', 'a', expect.objectContaining({ nombre: 'Ana María', identificacion: '123', fecha_nacimiento: null }))
    expect(h.crear).toHaveBeenCalledWith('huespedes_str', [expect.objectContaining({ reserva_str_id: 'res1', nombre: 'Niño', es_menor: true, fecha_nacimiento: '2020-01-01' })])
  })
  it('si la base rechaza un paso, lanza', async () => {
    h.crear.mockResolvedValueOnce({ error: { message: 'sin permiso' } })
    await expect(guardarGrupo(STR, PROP, [], [persona({ nombre: 'Ana' })])).rejects.toThrow('sin permiso')
  })
})

describe('cargarGrupo', () => {
  it('trae las personas de la reserva en la forma del formulario', async () => {
    h.leer.mockResolvedValueOnce([{ id: 'a', nombre: 'Ana', identificacion: null, es_menor: false, fecha_nacimiento: null, foto_url: null, foto_documento_url: 'd.jpg', visitante_id: null }])
    expect(await cargarGrupo(STR)).toEqual([{ id: 'a', nombre: 'Ana', identificacion: '', es_menor: false, fecha_nacimiento: '', foto_url: null, foto_documento_url: 'd.jpg', visitante_id: null }])
    expect(h.leer).toHaveBeenCalledWith(['res1'])
  })
})

describe('propiedad independiente: rentas_huespedes', () => {
  it('guarda en rentas_huespedes, anclada a la reserva, la propiedad y la empresa', async () => {
    await guardarGrupo(IND, PROP, [persona({ id: 'a', nombre: 'Ana' })], [persona({ nombre: 'Beto', foto_url: 'c1/prop1/b.jpg' })])
    expect(h.borrar).toHaveBeenCalledWith('rentas_huespedes', ['a'])
    expect(h.crear).toHaveBeenCalledWith('rentas_huespedes', [expect.objectContaining({ reserva_id: 'res2', propiedad_id: 'prop1', company_id: 'c1', nombre: 'Beto', foto_url: 'c1/prop1/b.jpg' })])
    expect((h.crear.mock.calls[0][1] as object[])[0]).not.toHaveProperty('reserva_str_id')
  })
  it('carga desde rentas_huespedes', async () => {
    sb.filas = [{ id: 'a', nombre: 'Ana', identificacion: '9', es_menor: false, fecha_nacimiento: null, foto_url: null, foto_documento_url: null }]
    expect(await cargarGrupo(IND)).toEqual([expect.objectContaining({ id: 'a', nombre: 'Ana', identificacion: '9', visitante_id: null })])
    expect(sb.consulta).toEqual(['rentas_huespedes:res2'])
    expect(h.leer).not.toHaveBeenCalled()
  })
})

describe('fotos', () => {
  it('fotosDe junta las del principal y las del grupo, sin vacíos', () => {
    expect(fotosDe({ foto_url: 'a.jpg', foto_documento_url: null }, [persona({ foto_documento_url: 'b.jpg' }), persona({})])).toEqual(['a.jpg', 'b.jpg'])
  })
  it('retirarFotosHuespedes borra del bucket de Rentas; sin rutas no llama', () => {
    retirarFotosHuespedes([])
    expect(retirar).not.toHaveBeenCalled()
    retirarFotosHuespedes(['c1/p/x.jpg'])
    expect(retirar).toHaveBeenCalledWith('rentas-huespedes', ['c1/p/x.jpg'])
  })
})
