// Agregar y editar items del inventario en ventana (EditModal real): antes el
// formulario se desplegaba encima de la lista.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ItemInventario } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (_tabla: string, _payload: Record<string, unknown>) => ({ error: null })),
  updateCondominioRow: vi.fn(async (_tabla: string, _id: string, _payload: Record<string, unknown>) => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../ImportInventarioModal', () => ({ ImportInventarioModal: () => null }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { InventarioTab } = await import('../InventarioTab')

const COJINES = {
  id: 'iv1', company_id: 'co1', project_id: 'p1', created_at: '2026-10-10T00:00:00Z',
  nombre: 'Set de cojines exterior', categoria: 'mobiliario', estado: 'en_uso',
  cantidad: 4, cantidad_minima: 4, unidad_medida: 'unidad', costo_unitario: 1632,
  ubicacion: 'Azotea Planta baja', proveedor: 'Muebles del Lago', descripcion: 'Tipo cilindro',
} as unknown as ItemInventario

const onRefresh = vi.fn()

function renderTab() {
  return render(
    <I18nProvider>
      <InventarioTab inventario={[COJINES]} proyectoId="p1" companyId="co1" moneda="Q"
        canCreate canEdit canDelete onRefresh={onRefresh} />
    </I18nProvider>,
  )
}

// jsdom dice navigator.language = 'en-US': se fija el español, que es lo que ve el staff.
beforeEach(() => {
  localStorage.setItem('at:locale', 'es')
  Object.values(mocks).forEach(m => m.mockClear())
  onRefresh.mockClear()
})
afterEach(cleanup)

describe('InventarioTab — ventana', () => {
  it('«Agregar Item» abre el formulario en ventana (pantalla completa en el teléfono) y crea el item', async () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))

    const dialog = screen.getByRole('dialog', { name: 'Nuevo Item' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Nombre *'), { target: { value: 'Escalera' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0]
    expect(tabla).toBe('inventario_condominio')
    expect(payload).toMatchObject({ nombre: 'Escalera', company_id: 'co1', project_id: 'p1' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el lápiz abre «Editar Item» en ventana con los datos del item y actualiza', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    const dialog = screen.getByRole('dialog', { name: 'Editar Item' })
    expect((within(dialog).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Set de cojines exterior')
    expect((within(dialog).getByLabelText('Ubicación') as HTMLInputElement).value).toBe('Azotea Planta baja')
    expect((within(dialog).getByLabelText('Proveedor') as HTMLInputElement).value).toBe('Muebles del Lago')

    fireEvent.change(within(dialog).getByLabelText('Cantidad'), { target: { value: '6' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, payload] = mocks.updateCondominioRow.mock.calls[0]
    expect(tabla).toBe('inventario_condominio')
    expect(id).toBe('iv1')
    expect(payload).toMatchObject({ cantidad: 6, nombre: 'Set de cojines exterior' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin nombre avisa y no guarda; la ventana sigue abierta', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agregar' }))

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Nuevo Item' })).toBeTruthy()
  })

  it('Cancelar cierra sin perder lo escrito en un item nuevo; una edición cancelada no se cuela en el nuevo', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Taladro' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    expect((screen.getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Taladro')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Editar Item' })).getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    expect((within(screen.getByRole('dialog', { name: 'Nuevo Item' })).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('')
  })
})
