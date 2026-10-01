// Suministros y proformas con el proveedor del catálogo compartido (Bloque B).
// Las reglas de fondo (proveedor suspendido, ajeno, coherencia proforma→orden)
// las prueban los SQL de supabase/tests/compras_bloque_b contra una base real;
// aquí se fija lo que la persona ve y hace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const m = vi.hoisted(() => ({
  vincular: vi.fn(),
  notify: vi.fn(),
  legado: [] as unknown[],
}))

vi.mock('../../../domain/proveedores/queries', () => ({
  useOperacionesLegadoQuery: () => ({ data: m.legado, isLoading: false }),
  useAsignacionesQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../domain/proveedores/mutations', () => ({
  useVincularOperacionMutation: () => ({ mutateAsync: m.vincular, isPending: false }),
}))
vi.mock('../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [
      { id: 'p1', company_id: 'c1', nombre: 'Ferretería Norte', nit: '1111111-1', rfc: null, pais: 'GT', codigo: 'PRV-00001', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
      { id: 'p2', company_id: 'c1', nombre: 'Ferretería  norte', nit: '2222222-2', rfc: null, pais: 'GT', codigo: 'PRV-00002', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
      { id: 'p3', company_id: 'c1', nombre: 'Servicios Sur', nit: '3333333-3', rfc: null, pais: 'GT', codigo: 'PRV-00003', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: m.notify }))

import { OperacionesLegadoPanel } from '../../proveedores/OperacionesLegadoPanel'
import { makeValidateRow } from '../ImportSuministrosModal'

beforeEach(() => {
  m.vincular.mockReset().mockResolvedValue(null)
  m.notify.mockReset()
  m.legado = [
    { tabla: 'suministros_condominio', registro_id: 's1', project_id: 'pr1', texto: 'Servicios Sur', clasificacion: 'inequivoca',
      candidatos: [{ id: 'p3', codigo: 'PRV-00003', nombre: 'Servicios Sur', estado: 'autorizado' }] },
    { tabla: 'suministros_condominio', registro_id: 's2', project_id: 'pr1', texto: 'Ferretería norte', clasificacion: 'ambigua',
      candidatos: [
        { id: 'p1', codigo: 'PRV-00001', nombre: 'Ferretería Norte', estado: 'autorizado' },
        { id: 'p2', codigo: 'PRV-00002', nombre: 'Ferretería  norte', estado: 'autorizado' }] },
    { tabla: 'proformas_condominio', registro_id: 'f1', project_id: 'pr1', texto: 'Otra', clasificacion: 'sin_coincidencia', candidatos: [] },
    { tabla: 'suministros_condominio', registro_id: 's9', project_id: 'otro', texto: 'De otro proyecto', clasificacion: 'sin_coincidencia', candidatos: [] },
  ]
})
afterEach(cleanup)

describe('OperacionesLegadoPanel', () => {
  it('lista solo los registros de su tabla y proyecto, sin vincular nada por sí solo', () => {
    render(<OperacionesLegadoPanel companyId="c1" tabla="suministros_condominio" projectId="pr1" canEdit />)
    expect(screen.getByText(/Registros con proveedor solo en texto \(2\)/)).toBeTruthy()
    expect(screen.getByText('«Servicios Sur»')).toBeTruthy()
    expect(screen.queryByText('«Otra»')).toBeNull()               // es de proformas
    expect(screen.queryByText('«De otro proyecto»')).toBeNull()   // es de otro proyecto
    expect(m.vincular).not.toHaveBeenCalled()
  })

  it('una coincidencia inequívoca es solo una SUGERENCIA: vincula cuando la persona pulsa', async () => {
    render(<OperacionesLegadoPanel companyId="c1" tabla="suministros_condominio" projectId="pr1" canEdit />)
    expect(screen.getByText('Coincidencia sugerida')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Vincular')[0])
    await waitFor(() => expect(m.vincular).toHaveBeenCalledWith({ tabla: 'suministros_condominio', registroId: 's1', proveedorId: 'p3' }))
  })

  it('una coincidencia ambigua NO se resuelve sola: exige elegir', async () => {
    render(<OperacionesLegadoPanel companyId="c1" tabla="suministros_condominio" projectId="pr1" canEdit />)
    expect(screen.getByText('Varias coincidencias')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Vincular')[1])
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(m.vincular).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Proveedor del catálogo para Ferretería norte'), { target: { value: 'p2' } })
    fireEvent.click(screen.getAllByText('Vincular')[1])
    await waitFor(() => expect(m.vincular).toHaveBeenCalledWith({ tabla: 'suministros_condominio', registroId: 's2', proveedorId: 'p2' }))
  })

  it('sin permiso de edición solo informa', () => {
    render(<OperacionesLegadoPanel companyId="c1" tabla="suministros_condominio" projectId="pr1" canEdit={false} />)
    expect(screen.queryByText('Vincular')).toBeNull()
  })

  it('no aparece si no hay históricos', () => {
    m.legado = []
    const { container } = render(<OperacionesLegadoPanel companyId="c1" tabla="suministros_condominio" projectId="pr1" canEdit />)
    expect(container.textContent).toBe('')
  })
})

describe('carga masiva de suministros con proveedor del catálogo', () => {
  const fila = (proveedor: string) => ({ nombre: 'Cloro', categoria: 'limpieza', unidad_medida: 'litro', stock_actual: 1, stock_minimo: 0, proveedor })
  const validar = makeValidateRow([
    { id: 'p1', nombre: 'Ferretería Norte' }, { id: 'p2', nombre: 'ferretería norte' }, { id: 'p3', nombre: 'Servicios Sur' },
  ])

  it('un nombre único del catálogo liga la fila por id', () => {
    const r = validar(fila('servicios sur'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatchObject({ proveedor: 'Servicios Sur', proveedor_id: 'p3' })
  })

  it('un nombre repetido en el catálogo es ambiguo y se rechaza (no se adivina)', () => {
    const r = validar(fila('Ferretería Norte'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/ambiguo/)
  })

  it('un proveedor fuera del catálogo habilitado se rechaza', () => {
    const r = validar(fila('Inventado S.A.'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/no habilitado/)
  })

  it('sin proveedor la fila es válida y no lleva vínculo', () => {
    const r = validar(fila(''))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.proveedor_id).toBeUndefined()
  })
})
