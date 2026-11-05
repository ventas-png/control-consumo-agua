// Préstamos de equipo: la ficha del préstamo abre en ventana emergente (EditModal real, pantalla completa en el
// teléfono) al pulsar su fila, con todos los datos y las acciones; en la fila queda sólo la acción del día a día
// (Entregar / Recibir). El formulario de alta también va en ventana (antes se desplegaba entre los KPIs y la tabla).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PrestamoEquipo, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  entregarPrestamos: vi.fn(async () => ({ data: { cancelados: 0 }, error: null })),
  recibirPrestamos: vi.fn(async () => ({ data: { monto_reposicion: 0 }, error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  openPromptDialog: vi.fn(async (): Promise<Record<string, string> | null> => null),
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow, deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/prestamosEquipo', () => ({
  entregarPrestamos: mocks.entregarPrestamos, recibirPrestamos: mocks.recibirPrestamos,
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))

const { PrestamoEquiposTab } = await import('../PrestamoEquiposTab')

const como = <T,>(o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-01T00:00:00Z', ...o }) as unknown as T
const PRESTADO = como<PrestamoEquipo>({
  id: 'pe1', unidad_id: 'un1', unidad_nombre: 'Casa 4', inventario_id: 'inv1', equipo_nombre: 'Sillas plegables', cantidad: 10,
  fecha_prestamo: '2026-10-20', hora_prestamo: '09:30:00', estado: 'prestado', deposito: 200, deposito_pagado: true,
  costo_reposicion_unitario: 120, entregado_por: 'Luis', observaciones: 'Dos con rayones',
})
const CERRADO = como<PrestamoEquipo>({
  id: 'pe2', unidad_id: 'un1', unidad_nombre: 'Casa 4', inventario_id: null, equipo_nombre: 'Toldo', cantidad: 2, cantidad_devuelta: 1,
  fecha_prestamo: '2026-09-01', fecha_devolucion: '2026-09-03', estado: 'perdido', deposito_pagado: false,
  monto_reposicion: 350, cuota_reposicion_id: 'cu1', recibido_por: 'Ana', observaciones_devolucion: 'Faltó uno',
})
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]

function montar(p: Partial<Parameters<typeof PrestamoEquiposTab>[0]> = {}) {
  return render(
    <PrestamoEquiposTab prestamos={[PRESTADO, CERRADO]} unidades={unidades} moneda="Q" proyectoId="p1" companyId="co1"
      canCreate canEdit canDelete onRefresh={mocks.onRefresh} {...p} />,
  )
}
const abrir = (nombre = 'Sillas plegables') => fireEvent.click(screen.getByText(nombre))
const ficha = (nombre = 'Sillas plegables') => screen.getByRole('dialog', { name: nombre })
const pie = (nombre?: string) => ficha(nombre).querySelector('.at-modal-footer') as HTMLElement

beforeEach(() => { Object.values(mocks).forEach(m => typeof m === 'function' && 'mockClear' in m && m.mockClear()) })
afterEach(cleanup)

describe('PrestamoEquiposTab — la ficha abre en ventana', () => {
  it('sin pulsar nada sólo hay tabla; la fila lleva Recibir y no Eliminar', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Eliminar préstamo' })).toBeNull()
    expect(within(screen.getByRole('table')).getByRole('button', { name: '✓ Recibir' })).toBeTruthy()
  })

  it('pulsar la fila abre la ficha (pantalla completa en el teléfono) con los datos y las acciones en el pie', () => {
    montar()
    abrir()
    const v = ficha()
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('Prestado')).toBeTruthy()
    expect(within(v).getByText('🏠 Casa 4')).toBeTruthy()
    expect(within(v).getByText('2026-10-20 09:30')).toBeTruthy()
    expect(within(v).getByText('Q 200.00 · pagado')).toBeTruthy()
    expect(within(v).getByText('Q 120.00')).toBeTruthy()
    expect(within(v).getByText('Luis')).toBeTruthy()
    expect(within(v).getByText('Dos con rayones')).toBeTruthy()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '🗑️ Eliminar', '✓ Recibir'])
  })

  it('un préstamo cerrado muestra devueltos, faltantes, reposición con su cargo y quién recibió', () => {
    montar()
    abrir('Toldo')
    const v = ficha('Toldo')
    expect(within(v).getByText('Perdido')).toBeTruthy()
    expect(within(v).getByText('(sin inventario)')).toBeTruthy()
    expect(within(v).getByText('1 / 2')).toBeTruthy()
    expect(within(v).getByText('Faltantes').nextSibling?.textContent).toBe('1')
    expect(within(v).getByText('Q 350.00 · cargo generado a la unidad')).toBeTruthy()
    expect(within(v).getByText('Ana')).toBeTruthy()
    expect(within(v).getByText('Faltó uno')).toBeTruthy()
    expect(within(pie('Toldo')).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar', '🗑️ Eliminar'])
  })

  it('Cerrar y Escape cierran la ficha; Recibir desde el pie abre el diálogo de recepción', async () => {
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: '✓ Recibir' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Recibir Sillas plegables' })))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Eliminar desde el pie confirma, borra la fila y cierra la ficha', async () => {
    montar()
    abrir()
    fireEvent.click(within(pie()).getByRole('button', { name: 'Eliminar préstamo' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('prestamos_equipo', 'pe1'))
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('la acción rápida de la fila no abre la ficha', async () => {
    montar()
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: '✓ Recibir' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('+ Registrar Préstamo abre el formulario en ventana y Cancelar lo cierra', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar Préstamo' }))
    const v = screen.getByRole('dialog', { name: 'Nuevo préstamo' })
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByLabelText('Unidad *')).toBeTruthy()
    expect(within(v).getByRole('button', { name: 'Guardar' })).toBeTruthy()
    fireEvent.click(within(v).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sin permisos el pie sólo lleva Cerrar', () => {
    montar({ canEdit: false, canDelete: false, canCreate: false })
    abrir()
    expect(within(pie()).getAllByRole('button').map(b => b.textContent)).toEqual(['Cerrar'])
  })
})
