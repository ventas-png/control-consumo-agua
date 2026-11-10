// Carga masiva de equipos: validación por fila (defectos, catálogos, fechas) y el
// lote que llega a la base con el tenant del proyecto.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

type Lote = Record<string, unknown>[]

const mocks = vi.hoisted(() => ({
  createEquiposComunes: vi.fn(async (_rows: Lote) => ({ error: null as string | null })),
  onInsertBatch: null as null | ((batch: Lote) => Promise<{ ok: number; error?: string }>),
  props: null as null | Record<string, unknown>,
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/condominios/mutations', () => ({ createEquiposComunes: mocks.createEquiposComunes }))
// El ImportModal genérico (archivo, vista previa, validación) tiene sus propias
// pruebas: aquí solo interesa lo que este modal valida e inserta.
vi.mock('../../shared', () => ({
  ImportModal: (props: Record<string, unknown> & { onInsertBatch: (batch: Lote) => Promise<{ ok: number; error?: string }> }) => {
    mocks.onInsertBatch = props.onInsertBatch
    mocks.props = props
    return null
  },
}))

const { ImportEquiposModal, validateEquipoRow } = await import('../ImportEquiposModal')

beforeEach(() => { mocks.createEquiposComunes.mockClear(); mocks.onInsertBatch = null; mocks.props = null })
afterEach(cleanup)

describe('validateEquipoRow', () => {
  it('con solo el nombre aplica los defectos: otro, 1 unidad, operativo', () => {
    const r = validateEquipoRow({ nombre: ' Hidrolavadora ' })
    expect(r).toMatchObject({ ok: true, data: { nombre: 'Hidrolavadora', categoria: 'otro', cantidad: 1, estado: 'operativo' } })
  })

  it('lee categoría y estado sin distinguir mayúsculas, números y fechas AAAA-MM-DD; lo vacío no viaja', () => {
    const r = validateEquipoRow({
      nombre: 'Bomba principal', categoria: 'BOMBA', cantidad: '2', marca: 'Pedrollo', modelo: 'CP 200', serial: '',
      ubicacion: 'Cuarto de máquinas', fecha_compra: '2025-01-15', valor_compra: '12000', vida_util_anios: '10',
      estado: 'Mantenimiento', ultimo_mantenimiento: new Date(Date.UTC(2026, 5, 1)), proximo_mantenimiento: '2026-12-01', notas: 'Revisar presostato',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toEqual({
      nombre: 'Bomba principal', categoria: 'bomba', cantidad: 2, marca: 'Pedrollo', modelo: 'CP 200', serial: undefined,
      ubicacion: 'Cuarto de máquinas', fecha_compra: '2025-01-15', valor_compra: 12000, vida_util_anios: 10,
      estado: 'mantenimiento', ultimo_mantenimiento: '2026-06-01', proximo_mantenimiento: '2026-12-01', notas: 'Revisar presostato',
    })
  })

  it('rechaza nombre vacío, categoría o estado fuera del catálogo, cantidad no entera o negativa y fechas mal escritas', () => {
    const r = validateEquipoRow({ nombre: '', categoria: 'mueble', cantidad: '1.5', estado: 'roto', valor_compra: '-1', vida_util_anios: '0', fecha_compra: '15/01/2025' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual(expect.arrayContaining([
      'nombre es obligatorio',
      expect.stringMatching(/^categoria inválida: "mueble"/),
      'cantidad debe ser un entero ≥ 0',
      expect.stringMatching(/^estado inválido: "roto"/),
      'valor_compra debe ser un número ≥ 0',
      'vida_util_anios debe ser un entero > 0',
      'fecha_compra debe ser una fecha AAAA-MM-DD',
    ]))
    expect(validateEquipoRow({ nombre: 'X', cantidad: '-2' }).ok).toBe(false)
    expect(validateEquipoRow({ nombre: 'X', cantidad: '0' })).toMatchObject({ ok: true, data: { cantidad: 0 } })
  })
})

describe('ImportEquiposModal', () => {
  it('el lote llega a equipos_comunes con company_id y project_id del proyecto; el error vuelve con ok 0', async () => {
    render(<ImportEquiposModal proyectoId="p1" companyId="co1" onClose={() => {}} onImportado={() => {}} />)
    expect(mocks.props).toMatchObject({ entityLabel: 'equipo', entityLabelPlural: 'equipos', sheetName: 'Equipos', templateFilename: 'plantilla_equipos' })

    const r = await mocks.onInsertBatch!([{ nombre: 'Hidrolavadora', categoria: 'herramienta', cantidad: 2, estado: 'operativo' }])
    expect(r).toEqual({ ok: 1 })
    expect(mocks.createEquiposComunes).toHaveBeenCalledWith([
      { nombre: 'Hidrolavadora', categoria: 'herramienta', cantidad: 2, estado: 'operativo', project_id: 'p1', company_id: 'co1' },
    ])

    mocks.createEquiposComunes.mockResolvedValueOnce({ error: 'permiso denegado' })
    expect(await mocks.onInsertBatch!([{ nombre: 'Pulidora' }])).toEqual({ ok: 0, error: 'permiso denegado' })
  })
})
