// Evaluación de proveedores ligada al proveedor compartido, al contrato y a la orden.
//
// Lo que se fija: el proveedor se elige del CATÁLOGO (por id), el evaluador NO viaja (lo sella el servidor), editar
// solo cambia criterios y comentarios, y una evaluación baja se señala pero NO suspende a nadie. Las reglas de fondo
// (coherencia empresa/proyecto/proveedor, inmutabilidad, aislamiento) las prueba
// supabase/tests/compras_bloque_b/assert_contratos_compras.sql, sección 9.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../../../lib/supabase', () => ({ supabase: {}, warmUpSupabase: vi.fn() }))

const h = vi.hoisted(() => ({
  crear: vi.fn(),
  actualizar: vi.fn(),
  notify: vi.fn(),
  ordenes: [] as unknown[],
}))

vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: h.crear, updateCondominioRow: h.actualizar, deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: h.notify }))
vi.mock('../../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [
      { id: 'p1', company_id: 'c1', nombre: 'Aguas del Norte', nit: '1234567-8', pais: 'GT', codigo: 'PRV-00001', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0, autorizacion_vence: null },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/contratosCompras', () => ({
  useOrdenesProveedorProyectoQuery: () => ({ data: h.ordenes, isLoading: false }),
}))

import { EvaluacionProveedorTab } from '../EvaluacionProveedorTab'

const contratos = [
  { id: 'k1', company_id: 'c1', project_id: 'pr1', proveedor_id: 'p1', referencia: 'CT-01', proveedor_nombre: 'Aguas del Norte', servicio: 'otro', estado: 'activo', fecha_inicio: '2026-01-01', created_at: '2026-01-01' },
  { id: 'k9', company_id: 'c1', project_id: 'pr1', proveedor_id: 'p2', referencia: 'CT-09', proveedor_nombre: 'Otro', servicio: 'otro', estado: 'activo', fecha_inicio: '2026-01-01', created_at: '2026-01-01' },
] as never

const evalu = (over: Record<string, unknown> = {}) => ({
  id: 'e1', company_id: 'c1', project_id: 'pr1', nombre_proveedor: 'Aguas del Norte', proveedor_catalogo_id: 'p1',
  calificacion: 4, puntualidad: 4, calidad: 5, precio: 3, cumplimiento: 4, comunicacion: 5, comentarios: 'Buen servicio',
  evaluado_por: 'Ana Pérez', evaluado_por_id: 'u1', fecha: '2026-10-01', created_at: '2026-10-01T00:00:00Z', ...over,
})

const montar = (evaluaciones: unknown[] = [], canEdit = true) => {
  const onRefresh = vi.fn()
  render(<EvaluacionProveedorTab evaluaciones={evaluaciones as never} proveedores={contratos} proyectoId="pr1" companyId="c1" canCreate canEdit={canEdit} onRefresh={onRefresh} />)
  return onRefresh
}

beforeEach(() => { h.crear.mockResolvedValue({ error: null }); h.actualizar.mockResolvedValue({ error: null }); h.ordenes = [] })
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function elegirProveedor() {
  const caja = screen.getByPlaceholderText(/Buscar por nombre/)
  fireEvent.focus(caja)
  fireEvent.change(caja, { target: { value: 'PRV-00001' } })
  fireEvent.mouseDown(screen.getAllByRole('option')[0])
}

describe('Evaluación de proveedores', () => {
  it('avisa que quedas como evaluador y que una evaluación baja NO suspende al proveedor', () => {
    montar()
    fireEvent.click(screen.getByText('+ Evaluar'))
    const aviso = screen.getByTestId('eval-aviso').textContent ?? ''
    expect(aviso).toMatch(/Quedas registrado como evaluador/)
    expect(aviso).toMatch(/no suspende/)
  })

  it('sin elegir un proveedor del catálogo no se guarda y no se llama al servidor', () => {
    montar()
    fireEvent.click(screen.getByText('+ Evaluar'))
    fireEvent.click(screen.getByText('Guardar evaluación'))
    expect(h.notify.mock.calls[0][0].text).toMatch(/proveedor del catálogo/)
    expect(h.crear).not.toHaveBeenCalled()
  })

  it('guarda con el proveedor del catálogo, su contrato y su orden; el evaluador NO viaja', async () => {
    h.ordenes = [{ id: 'o1', numero: 'OC-000001', concepto: 'Material', estado: 'emitida' }]
    const onRefresh = montar()
    fireEvent.click(screen.getByText('+ Evaluar'))
    await elegirProveedor()
    const contratoSel = screen.getByText('Contrato (opcional)').parentElement!.querySelector('select')!
    expect(within(contratoSel).queryByText(/CT-09/)).toBeNull()      // solo los contratos de ESE proveedor
    fireEvent.change(contratoSel, { target: { value: 'k1' } })
    const ordenSel = screen.getByText('Orden de compra (opcional)').parentElement!.querySelector('select')!
    fireEvent.change(ordenSel, { target: { value: 'o1' } })
    fireEvent.click(screen.getByText('Guardar evaluación'))
    await waitFor(() => expect(h.crear).toHaveBeenCalled())
    const [tabla, fila] = h.crear.mock.calls[0]
    expect(tabla).toBe('evaluaciones_proveedor')
    expect(fila).toMatchObject({
      company_id: 'c1', project_id: 'pr1', proveedor_catalogo_id: 'p1', contrato_id: 'k1', orden_compra_id: 'o1',
      calificacion: 5, cumplimiento: 5, comunicacion: 5,
    })
    expect(fila).not.toHaveProperty('evaluado_por')
    expect(fila).not.toHaveProperty('evaluado_por_id')
    expect(fila).not.toHaveProperty('nombre_proveedor')
    expect(onRefresh).toHaveBeenCalled()
  })

  it('un rechazo del servidor (p. ej. el contrato no es de ese proveedor) se muestra tal cual', async () => {
    h.crear.mockResolvedValue({ error: { message: 'EVALUACION_PROVEEDOR_CONTRATO: el contrato es de otro proveedor que el evaluado.' } })
    montar()
    fireEvent.click(screen.getByText('+ Evaluar'))
    await elegirProveedor()
    fireEvent.click(screen.getByText('Guardar evaluación'))
    await waitFor(() => expect(h.notify).toHaveBeenCalled())
    expect(h.notify.mock.calls[0][0].text).toMatch(/EVALUACION_PROVEEDOR_CONTRATO/)
  })

  it('editar solo manda criterios y comentarios: proveedor, contrato, orden, evaluador y fecha no se tocan', async () => {
    montar([evalu()])
    fireEvent.click(screen.getByText('✏️'))
    expect((screen.getByText('Contrato (opcional)').parentElement!.querySelector('select') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Guardar evaluación'))
    await waitFor(() => expect(h.actualizar).toHaveBeenCalled())
    const [tabla, id, cambios] = h.actualizar.mock.calls[0]
    expect([tabla, id]).toEqual(['evaluaciones_proveedor', 'e1'])
    expect(Object.keys(cambios).sort()).toEqual(['calidad', 'calificacion', 'comentarios', 'comunicacion', 'cumplimiento', 'precio', 'puntualidad'])
  })

  it('una evaluación baja se señala, pero no hay ninguna acción de suspender', () => {
    montar([evalu({ calificacion: 1 })])
    expect(screen.getByTestId('eval-baja-e1').textContent).toMatch(/no suspende al proveedor/)
    expect(screen.queryByText(/Suspender/i)).toBeNull()
  })

  it('la lista muestra quién evaluó y los criterios nuevos; el nombre sale del catálogo', () => {
    montar([evalu({ nombre_proveedor: 'Nombre viejo en texto libre' })])
    expect(screen.getByText('Aguas del Norte')).toBeTruthy()
    expect(screen.queryByText('Nombre viejo en texto libre')).toBeNull()
    expect(screen.getByText(/Ana Pérez/)).toBeTruthy()
    expect(screen.getByText(/Cumplimiento: 4\/5/)).toBeTruthy()
    expect(screen.getByText(/Comunicación: 5\/5/)).toBeTruthy()
  })

  it('sin permiso de edición no ofrece editar ni borrar', () => {
    montar([evalu()], false)
    expect(screen.queryByText('✏️')).toBeNull()
  })
})
