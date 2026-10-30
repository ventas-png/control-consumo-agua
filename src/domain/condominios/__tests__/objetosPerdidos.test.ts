import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AreaCondominio, ObjetoPerdido, PersonalCondominio } from '../../../types'
import type { FormObjeto } from '../objetosPerdidos'

const mocks = vi.hoisted(() => ({
  updateCondominioRowAfectando: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string; code?: string } | null })),
  uploadCondominiosMedia: vi.fn(async (..._args: unknown[]) => ({ data: null, error: null as string | null })),
  validateFileMagic: vi.fn(async (..._args: unknown[]) => ({ ok: true, detected: 'image/png' }) as { ok: true; detected: string } | { ok: false; reason: string }),
}))
vi.mock('../tabMutations', () => ({ updateCondominioRowAfectando: mocks.updateCondominioRowAfectando }))
vi.mock('../../shared/storage', () => ({ uploadCondominiosMedia: mocks.uploadCondominiosMedia }))
vi.mock('../../../lib/fileValidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/fileValidation')>()),
  validateFileMagic: mocks.validateFileMagic,
}))

const {
  entregarObjeto, fichaDeUsuario, formDesdeObjeto, fotosDe, hallazgoDe, nombreReceptorValido, payloadObjeto,
  personalElegible, validarFormObjeto,
} = await import('../objetosPerdidos')

const area = (o: Partial<AreaCondominio>): AreaCondominio => ({
  id: 'a?', company_id: 'co1', project_id: 'p1', nombre: '?', icono: '📍', orden: 0, activo: true, created_at: '', ...o,
})
const AREAS = [area({ id: 'a-piscina', nombre: ' Piscina ' }), area({ id: 'a-recepcion', nombre: 'Recepción' })]

const empleado = (o: Partial<PersonalCondominio>) => ({ id: 'pe?', company_id: 'co1', project_id: 'p1', nombre: '?', estado: 'activo', ...o }) as PersonalCondominio

const objeto = (o: Partial<ObjetoPerdido> = {}): ObjetoPerdido => ({
  id: 'o1', company_id: 'co1', project_id: 'p1', descripcion: 'Llaves', fecha_encontrado: '2026-10-28', estado: 'en_custodia', created_at: '', ...o,
})

const form = (o: Partial<FormObjeto> = {}): FormObjeto => ({
  descripcion: 'Llaves', fotos: [], area_encontrado_id: '', fecha_encontrado: '2026-10-28',
  encontrado_por_tipo: 'personal', encontrado_por_personal_id: 'pe-1', encontrado_por_nombre: '', encontrado_por_contacto: '',
  custodio_personal_id: '', area_almacenamiento_id: '', almacenamiento_detalle: '', notas: '', ...o,
})

beforeEach(() => { vi.clearAllMocks() })

describe('validarFormObjeto', () => {
  it('pide descripción, el empleado si fue personal y el nombre si fue un tercero', () => {
    expect(validarFormObjeto(form({ descripcion: '  ' }))).toBe('descripcion')
    expect(validarFormObjeto(form({ encontrado_por_personal_id: '' }))).toBe('encontrado_personal')
    expect(validarFormObjeto(form({ encontrado_por_tipo: 'tercero', encontrado_por_nombre: ' ' }))).toBe('encontrado_tercero')
    expect(validarFormObjeto(form({ encontrado_por_tipo: 'tercero', encontrado_por_personal_id: '', encontrado_por_nombre: 'Ana' }))).toBeNull()
    expect(validarFormObjeto(form())).toBeNull()
  })
})

describe('personal elegible y ficha propia', () => {
  const personal = [
    empleado({ id: 'b', nombre: 'Beto', user_id: 'u2' }),
    empleado({ id: 'a', nombre: 'Ana', user_id: 'u1' }),
    empleado({ id: 'x', nombre: 'Xavier', estado: 'inactivo', user_id: 'u3' }),
  ]
  it('sólo los activos, por nombre', () => {
    expect(personalElegible(personal).map(p => p.id)).toEqual(['a', 'b'])
  })
  it('la ficha activa del usuario, y ninguna si está inactiva o no hay usuario', () => {
    expect(fichaDeUsuario('u1', personal)?.id).toBe('a')
    expect(fichaDeUsuario('u3', personal)).toBeNull()
    expect(fichaDeUsuario('', personal)).toBeNull()
  })
})

describe('payloadObjeto', () => {
  it('guarda el área con el snapshot de su nombre y no manda el nombre del empleado (lo pone el servidor)', () => {
    const p = payloadObjeto(form({
      descripcion: ' Llaves ', area_encontrado_id: 'a-piscina', area_almacenamiento_id: 'a-recepcion',
      almacenamiento_detalle: '  ', custodio_personal_id: 'pe-2', encontrado_por_contacto: 'no se manda',
    }), AREAS)
    expect(p).toMatchObject({
      descripcion: 'Llaves', area_encontrado_id: 'a-piscina', lugar_encontrado: 'Piscina',
      encontrado_por_tipo: 'personal', encontrado_por_personal_id: 'pe-1', encontrado_por_contacto: null,
      custodio_personal_id: 'pe-2', area_almacenamiento_id: 'a-recepcion', almacenamiento_detalle: null, notas: null,
    })
    expect(p).not.toHaveProperty('encontrado_por_nombre')
    expect(p).not.toHaveProperty('custodio_nombre')
  })

  it('un tercero va sin empleado, con su nombre y contacto', () => {
    expect(payloadObjeto(form({ encontrado_por_tipo: 'tercero', encontrado_por_nombre: ' María ', encontrado_por_contacto: ' 5555 ' }), AREAS))
      .toMatchObject({ encontrado_por_tipo: 'tercero', encontrado_por_personal_id: null, encontrado_por_nombre: 'María', encontrado_por_contacto: '5555' })
  })

  it('al editar, lo legado conserva su lugar escrito y quitar el custodio borra su nombre', () => {
    const previo = objeto({ lugar_encontrado: 'Junto al ascensor', custodio_personal_id: 'pe-2', custodio_nombre: 'Luis' })
    const p = payloadObjeto(form({ custodio_personal_id: '' }), AREAS, previo)
    expect(p).toMatchObject({ area_encontrado_id: null, lugar_encontrado: 'Junto al ascensor', custodio_personal_id: null, custodio_nombre: null })
    // Con el custodio igual, su nombre no se toca.
    expect(payloadObjeto(form({ custodio_personal_id: 'pe-2' }), AREAS, previo)).not.toHaveProperty('custodio_nombre')
  })
})

describe('lectura de un objeto', () => {
  it('formDesdeObjeto: lo legado sin «quién» abre como tercero vacío', () => {
    expect(formDesdeObjeto(objeto({ fotos: null, lugar_encontrado: 'Lobby' }))).toMatchObject({
      encontrado_por_tipo: 'tercero', encontrado_por_nombre: '', fotos: [], area_encontrado_id: '',
    })
    expect(formDesdeObjeto(objeto({ encontrado_por_tipo: 'personal', encontrado_por_personal_id: 'pe-1', encontrado_por_nombre: 'Ana' })))
      .toMatchObject({ encontrado_por_tipo: 'personal', encontrado_por_personal_id: 'pe-1', encontrado_por_nombre: '' })
  })

  it('hallazgoDe: null en lo legado; el tercero con su contacto', () => {
    expect(hallazgoDe(objeto())).toBeNull()
    expect(hallazgoDe(objeto({ encontrado_por_tipo: 'tercero', encontrado_por_nombre: ' María ', encontrado_por_contacto: ' ' })))
      .toEqual({ nombre: 'María', tercero: true, contacto: null })
    expect(hallazgoDe(objeto({ encontrado_por_tipo: 'personal', encontrado_por_nombre: 'Ana' })))
      .toEqual({ nombre: 'Ana', tercero: false, contacto: null })
  })

  it('fotosDe suma la foto única del esquema viejo sin repetirla', () => {
    expect(fotosDe(objeto({ foto_url: 'vieja.jpg', fotos: ['a.jpg'] }))).toEqual(['vieja.jpg', 'a.jpg'])
    expect(fotosDe(objeto({ foto_url: 'a.jpg', fotos: ['a.jpg'] }))).toEqual(['a.jpg'])
    expect(fotosDe(objeto())).toEqual([])
  })

  it('nombreReceptorValido pide nombre y apellido', () => {
    expect(nombreReceptorValido('Pedro')).toBe(false)
    expect(nombreReceptorValido('  Pedro   R ')).toBe(false)
    expect(nombreReceptorValido(' Pedro Ramírez ')).toBe(true)
  })
})

describe('entregarObjeto', () => {
  const firma = new File(['x'], 'firma.png', { type: 'image/png' })
  const datos = { recibe: ' Pedro Ramírez ', documento: ' ', fecha: '2026-10-30', firma }

  it('sube la firma bajo la carpeta del condominio y la manda con la entrega', async () => {
    expect(await entregarObjeto({ id: 'o1', project_id: 'p1' }, datos)).toEqual({ error: null })
    const path = mocks.uploadCondominiosMedia.mock.calls[0][0] as string
    expect(path.startsWith('p1/objetos-perdidos/firmas/')).toBe(true)
    expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledWith('objetos_perdidos', 'o1', {
      estado: 'reclamado', reclamado_por: 'Pedro Ramírez', entrega_documento: null, fecha_reclamo: '2026-10-30', firma_entrega_path: path,
    })
  })

  it('una firma que no es imagen o que no sube no llega a la fila', async () => {
    mocks.validateFileMagic.mockResolvedValueOnce({ ok: false, reason: 'No es una imagen' })
    expect(await entregarObjeto({ id: 'o1', project_id: 'p1' }, datos)).toEqual({ error: 'No es una imagen' })
    mocks.uploadCondominiosMedia.mockResolvedValueOnce({ data: null, error: 'Sin conexión' })
    expect(await entregarObjeto({ id: 'o1', project_id: 'p1' }, datos)).toEqual({ error: 'Sin conexión' })
    expect(mocks.updateCondominioRowAfectando).not.toHaveBeenCalled()
  })

  it('el rechazo del servidor (o la RLS que no toca la fila) vuelve como error', async () => {
    mocks.updateCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'OBJETO_ENTREGA_SIN_FIRMA', code: '23514' } })
    expect(await entregarObjeto({ id: 'o1', project_id: 'p1' }, datos)).toEqual({ error: 'OBJETO_ENTREGA_SIN_FIRMA' })
  })
})
