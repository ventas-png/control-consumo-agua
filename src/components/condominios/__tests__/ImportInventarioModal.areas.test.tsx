// Carga masiva de inventario: la columna `ubicacion` se vincula al área del
// catálogo con ese nombre (mismo criterio que el backfill 20261114000000).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { AreaCondominio } from '../../../types'

type Lote = Record<string, unknown>[]

const mocks = vi.hoisted(() => ({
  createInventarioItems: vi.fn(async (_rows: Lote) => ({ error: null as string | null })),
  onInsertBatch: null as null | ((batch: Lote) => Promise<unknown>),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../domain/condominios/mutations', () => ({ createInventarioItems: mocks.createInventarioItems }))
// El ImportModal genérico (archivo, vista previa, validación) tiene sus propias
// pruebas: aquí solo interesa lo que este modal inserta.
vi.mock('../../shared', () => ({
  ImportModal: (props: { onInsertBatch: (batch: Lote) => Promise<unknown> }) => {
    mocks.onInsertBatch = props.onInsertBatch
    return null
  },
}))

const { ImportInventarioModal } = await import('../ImportInventarioModal')

const area = (o: Partial<AreaCondominio>): AreaCondominio => ({
  id: 'a?', company_id: 'co1', project_id: 'p1', nombre: '?', icono: '📍', orden: 0, activo: true,
  created_at: '2026-01-01T00:00:00Z', ...o,
})

beforeEach(() => { mocks.createInventarioItems.mockClear(); mocks.onInsertBatch = null })
afterEach(cleanup)

describe('ImportInventarioModal — ubicación por área', () => {
  it('vincula la fila cuyo texto coincide con UNA área; lo demás queda como texto', async () => {
    render(<ImportInventarioModal proyectoId="p1" companyId="co1" onClose={() => {}} onImportado={() => {}}
      areas={[area({ id: 'a-social', nombre: 'Área social' }), area({ id: 'a-azotea', nombre: 'Azotea' })]} />)

    await mocks.onInsertBatch!([
      { nombre: 'Mesa', ubicacion: 'area social' },
      { nombre: 'Escalera', ubicacion: 'Azotea Planta baja' },
      { nombre: 'Taladro' },
    ])

    const [filas] = mocks.createInventarioItems.mock.calls[0]
    expect(filas).toEqual([
      { nombre: 'Mesa', area_id: 'a-social', ubicacion: 'Área social', project_id: 'p1', company_id: 'co1' },
      { nombre: 'Escalera', area_id: null, ubicacion: 'Azotea Planta baja', project_id: 'p1', company_id: 'co1' },
      { nombre: 'Taladro', area_id: null, ubicacion: undefined, project_id: 'p1', company_id: 'co1' },
    ])
  })
})
