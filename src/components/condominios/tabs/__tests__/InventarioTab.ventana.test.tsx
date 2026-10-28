// Agregar y editar items del inventario en ventana (EditModal real): antes el
// formulario se desplegaba encima de la lista. La ubicación se elige del
// catálogo de áreas (20261114000000).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { AreaCondominio, ItemInventario } from '../../../../types'

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

const area = (o: Partial<AreaCondominio>): AreaCondominio => ({
  id: 'a?', company_id: 'co1', project_id: 'p1', nombre: '?', icono: '📍', orden: 0, activo: true,
  created_at: '2026-01-01T00:00:00Z', ...o,
})
const AZOTEA = area({ id: 'a-azotea', nombre: 'Azotea', icono: '🌇', orden: 1 })
const SOCIAL = area({ id: 'a-social', nombre: 'Área social', icono: '🎉', orden: 2 })
const BODEGA_VIEJA = area({ id: 'a-bodega', nombre: 'Bodega vieja', activo: false })
const AREAS = [AZOTEA, SOCIAL, BODEGA_VIEJA]

const item = (o: Partial<ItemInventario>) => ({
  company_id: 'co1', project_id: 'p1', created_at: '2026-10-10T00:00:00Z',
  categoria: 'mobiliario', estado: 'en_uso', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad',
  ...o,
}) as ItemInventario

const COJINES = item({
  id: 'iv1', nombre: 'Set de cojines exterior', cantidad: 4, cantidad_minima: 4, costo_unitario: 1632,
  area_id: 'a-azotea', ubicacion: 'Azotea', proveedor: 'Muebles del Lago', descripcion: 'Tipo cilindro',
})

const onRefresh = vi.fn()
const onIrATab = vi.fn()

function renderTab(o: { inventario?: ItemInventario[]; areas?: AreaCondominio[]; puedeConfigurarAreas?: boolean } = {}) {
  return render(
    <I18nProvider>
      <InventarioTab inventario={o.inventario ?? [COJINES]} areas={o.areas ?? AREAS} proyectoId="p1" companyId="co1" moneda="Q"
        canCreate canEdit canDelete puedeConfigurarAreas={o.puedeConfigurarAreas ?? true} onIrATab={onIrATab} onRefresh={onRefresh} />
    </I18nProvider>,
  )
}

const ubicacion = () => within(screen.getByRole('dialog')).getByLabelText('Ubicación') as HTMLSelectElement
const opciones = () => Array.from(ubicacion().options).map(o => o.textContent)

// jsdom dice navigator.language = 'en-US': se fija el español, que es lo que ve el staff.
beforeEach(() => {
  localStorage.setItem('at:locale', 'es')
  Object.values(mocks).forEach(m => m.mockClear())
  onRefresh.mockClear()
  onIrATab.mockClear()
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
    expect(ubicacion().value).toBe('a-azotea')
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

describe('InventarioTab — ubicación elegida del catálogo de áreas', () => {
  it('ofrece solo las áreas activas, en su orden, y guarda el área con su nombre como snapshot', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    expect(opciones()).toEqual(['— Sin área —', '🌇 Azotea', '🎉 Área social'])

    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Parrilla' } })
    fireEvent.change(ubicacion(), { target: { value: 'a-social' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0][1]).toMatchObject({ area_id: 'a-social', ubicacion: 'Área social' })
  })

  it('sin área: area_id y ubicacion van vacíos', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Parrilla' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0][1]).toMatchObject({ area_id: null, ubicacion: null })
  })

  it('la lista muestra el nombre vigente del área, no el snapshot', () => {
    renderTab({ inventario: [item({ id: 'iv2', nombre: 'Sombrilla', area_id: 'a-social', ubicacion: 'Area social (viejo)' })] })
    expect(screen.getAllByText('📍 Área social').length).toBeGreaterThan(0)
    expect(screen.queryByText('📍 Area social (viejo)')).toBeNull()
  })

  it('un item legado cuyo texto coincide con UNA área se propone vinculado', async () => {
    renderTab({ inventario: [item({ id: 'iv3', nombre: 'Mesa', area_id: null, ubicacion: 'area SOCIAL' })] })
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(ubicacion().value).toBe('a-social')

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.updateCondominioRow.mock.calls[0][2]).toMatchObject({ area_id: 'a-social', ubicacion: 'Área social' })
  })

  it('un item legado sin coincidencia conserva su texto hasta que se elija un área', async () => {
    renderTab({ inventario: [item({ id: 'iv4', nombre: 'Escalera', area_id: null, ubicacion: 'Azotea Planta baja' })] })
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(ubicacion().value).toBe('')
    expect(within(screen.getByRole('dialog')).getByText(/Antes: «Azotea Planta baja», sin vincular a un área/)).toBeTruthy()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.updateCondominioRow.mock.calls[0][2]).toMatchObject({ area_id: null, ubicacion: 'Azotea Planta baja' })
  })

  it('un item en un área ya inactiva la conserva al editar; «Sin área» la quita del todo', async () => {
    renderTab({ inventario: [item({ id: 'iv5', nombre: 'Carretilla', area_id: 'a-bodega', ubicacion: 'Bodega vieja' })] })
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(ubicacion().value).toBe('a-bodega')
    expect(opciones()).toContain('Bodega vieja (inactiva)')

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.updateCondominioRow.mock.calls[0][2]).toMatchObject({ area_id: 'a-bodega', ubicacion: 'Bodega vieja' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(ubicacion(), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(2))
    expect(mocks.updateCondominioRow.mock.calls[1][2]).toMatchObject({ area_id: null, ubicacion: null })
  })

  it('sin áreas activas lleva al tab Áreas (o dice dónde se crean, sin permiso para verlo)', () => {
    renderTab({ areas: [BODEGA_VIEJA] })
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crearlas en el tab Áreas' }))
    expect(onIrATab).toHaveBeenCalledWith('areas_config')
    cleanup()

    renderTab({ areas: [], puedeConfigurarAreas: false })
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar Item' }))
    expect(within(screen.getByRole('dialog')).getByText(/Se dan de alta en el tab Áreas\./)).toBeTruthy()
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Crearlas en el tab Áreas' })).toBeNull()
  })
})
