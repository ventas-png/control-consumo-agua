// Inventario del condominio: cada item lleva una foto (columna foto_url, que
// existía sin usarse desde 20260420000004), con la misma ventana que Suministros
// y Equipos. Lo delicado es el bucket: una fila guardada nunca debe apuntar a un
// archivo ya borrado, y lo que se sube y no se guarda no debe quedar huérfano.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ItemInventario } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (_tabla: string, _payload: Record<string, unknown>) => ({ error: null })),
  updateCondominioRow: vi.fn(async (_tabla: string, _id: string, _payload: Record<string, unknown>) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  removeCondominiosMedia: vi.fn(async (_paths: string[]) => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
  subidas: 0,
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/shared/storage', () => ({ removeCondominiosMedia: mocks.removeCondominiosMedia }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../ImportInventarioModal', () => ({ ImportInventarioModal: () => null }))
// La imagen firmada y la subida real (compresión, bytes mágicos, Storage) tienen
// sus propias pruebas; aquí sólo importa qué ruta elige la persona.
vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: ({ src, alt }: { src: string | null; alt?: string }) => (src ? <img src={src} alt={alt} /> : null),
}))
vi.mock('../../../shared/ImageUploader', () => ({
  ImageUploader: ({ value, onChange, folder, borrarAlQuitar }: { value: string | null; onChange: (p: string | null) => void; folder: string; borrarAlQuitar?: boolean }) => (
    <div data-borrar-al-quitar={String(borrarAlQuitar)} data-folder={folder}>
      {value
        ? <button type="button" onClick={() => onChange(null)}>Quitar foto</button>
        : <button type="button" onClick={() => onChange(`p1/${folder}/nueva-${++mocks.subidas}.jpg`)}>Subir foto</button>}
    </div>
  ),
}))

const { I18nProvider } = await import('../../../../lib/i18n')
const { InventarioTab } = await import('../InventarioTab')

const FOTO = 'p1/inventario/adaptador.jpg'
const item = (o: Partial<ItemInventario> = {}) => ({
  id: 'iv1', company_id: 'co1', project_id: 'p1', created_at: '2026-10-10T00:00:00Z',
  nombre: 'Adaptador de gas', categoria: 'otro', estado: 'disponible', cantidad: 1, cantidad_minima: 0,
  unidad_medida: 'unidad', costo_unitario: 485, foto_url: null, ...o,
}) as ItemInventario

function renderTab(o: { inventario?: ItemInventario[]; canEdit?: boolean } = {}) {
  const canEdit = o.canEdit ?? true
  return render(
    <I18nProvider>
      <InventarioTab inventario={o.inventario ?? [item()]} areas={[]} proyectoId="p1" companyId="co1" moneda="Q"
        canCreate={canEdit} canEdit={canEdit} canDelete={canEdit} puedeConfigurarAreas={false} onIrATab={vi.fn()} onRefresh={mocks.onRefresh} />
    </I18nProvider>,
  )
}

const ficha = () => screen.getByRole('dialog', { name: /Adaptador de gas$/ })
const abrirFicha = () => fireEvent.click(screen.getByText('Adaptador de gas'))
const formulario = () => screen.getByRole('dialog', { name: /^(Nuevo|Editar) Item$/ })
const ventana = () => screen.getByRole('dialog', { name: 'Foto del item' })
const enVentana = (nombre: string | RegExp) => fireEvent.click(within(ventana()).getByRole('button', { name: nombre }))
async function usarFoto() {
  enVentana(/Usar esta foto/)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Foto del item' })).toBeNull())
}
const borradas = () => mocks.removeCondominiosMedia.mock.calls.flatMap(c => c[0])

beforeEach(() => {
  localStorage.setItem('at:locale', 'es')
  for (const m of [mocks.createCondominioRow, mocks.updateCondominioRow, mocks.deleteCondominioRow, mocks.removeCondominiosMedia, mocks.notify, mocks.onRefresh]) m.mockClear()
  mocks.updateCondominioRow.mockImplementation(async () => ({ error: null }))
  mocks.subidas = 0
})
afterEach(cleanup)

describe('InventarioTab — foto desde la ficha', () => {
  it('sin foto, quien edita la agrega en una ventana: sube a <proyecto>/inventario y se guarda en la fila', async () => {
    renderTab()
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Agregar foto: Adaptador de gas' }))
    const uploader = within(ventana()).getByText('Subir foto').parentElement!
    expect(uploader.getAttribute('data-folder')).toBe('inventario')
    // Quitar en la ventana no borra del bucket: la fila todavía apunta a la foto.
    expect(uploader.getAttribute('data-borrar-al-quitar')).toBe('false')

    enVentana('Subir foto')
    enVentana(/Guardar foto/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('inventario_condominio', 'iv1', { foto_url: 'p1/inventario/nueva-1.jpg' }))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Foto guardada' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Foto del item' })).toBeNull())
    expect(ficha()).toBeTruthy()
  })

  it('al reemplazarla, la anterior se borra DESPUÉS de actualizar la fila', async () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    expect(ficha().querySelector('img')?.getAttribute('src')).toBe(FOTO)
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Ver foto: Adaptador de gas' }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    enVentana(/Guardar foto/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('inventario_condominio', 'iv1', { foto_url: 'p1/inventario/nueva-1.jpg' }))
    await waitFor(() => expect(borradas()).toEqual([FOTO]))
    expect(Math.min(...mocks.removeCondominiosMedia.mock.invocationCallOrder)).toBeGreaterThan(mocks.updateCondominioRow.mock.invocationCallOrder[0])
  })

  it('si la fila no se actualiza, no se borra la foto guardada', async () => {
    mocks.updateCondominioRow.mockImplementation(async () => ({ error: { message: 'sin permiso' } }))
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Ver foto: Adaptador de gas' }))
    enVentana('Quitar foto')
    enVentana(/Guardar foto/)
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'sin permiso' })))
    expect(borradas()).not.toContain(FOTO)
    expect(ventana()).toBeTruthy()
  })

  it('sin permiso de edición: con foto sólo se ve en grande; sin foto no hay nada que abrir', () => {
    renderTab({ inventario: [item({ foto_url: FOTO })], canEdit: false })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Ver foto: Adaptador de gas' }))
    expect(within(ventana()).queryByText('Quitar foto')).toBeNull()
    expect(within(ventana()).getByRole('img', { name: 'Foto de Adaptador de gas' })).toBeTruthy()
    cleanup()
    renderTab({ canEdit: false })
    abrirFicha()
    expect(within(ficha()).queryByRole('button', { name: /foto/i })).toBeNull()
  })

  it('la lista muestra la miniatura del item en lugar del ícono de la categoría', () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    const fila = screen.getByText('Adaptador de gas').parentElement!
    expect(fila.querySelector('img')?.getAttribute('src')).toBe(FOTO)
    expect(fila.textContent).not.toContain('📋')
  })

  it('eliminar el item borra su foto después de borrar la fila', async () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(borradas()).toEqual([FOTO]))
    expect(Math.min(...mocks.removeCondominiosMedia.mock.invocationCallOrder)).toBeGreaterThan(mocks.deleteCondominioRow.mock.invocationCallOrder[0])
  })
})

describe('InventarioTab — foto en el formulario', () => {
  it('nuevo: la foto elegida se crea con la fila', async () => {
    renderTab({ inventario: [] })
    fireEvent.click(screen.getByRole('button', { name: /Agregar Item/ }))
    fireEvent.change(within(formulario()).getByLabelText('Nombre *'), { target: { value: 'Horno de pizza' } })
    fireEvent.click(within(formulario()).getByRole('button', { name: /Agregar foto/ }))
    enVentana('Subir foto')
    await usarFoto()
    expect(within(formulario()).getByText('Se guarda con el item')).toBeTruthy()
    fireEvent.click(within(formulario()).getByRole('button', { name: 'Agregar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('inventario_condominio', expect.objectContaining({ nombre: 'Horno de pizza', foto_url: 'p1/inventario/nueva-1.jpg' })))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('nuevo sin foto guarda null', async () => {
    renderTab({ inventario: [] })
    fireEvent.click(screen.getByRole('button', { name: /Agregar Item/ }))
    fireEvent.change(within(formulario()).getByLabelText('Nombre *'), { target: { value: 'Horno de pizza' } })
    fireEvent.click(within(formulario()).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('inventario_condominio', expect.objectContaining({ foto_url: null })))
  })

  it('editar: la foto nueva viaja con «Actualizar» y la anterior se borra después', async () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(formulario()).getByRole('button', { name: /Cambiar foto/ }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    await usarFoto()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    fireEvent.click(within(formulario()).getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('inventario_condominio', 'iv1', expect.objectContaining({ foto_url: 'p1/inventario/nueva-1.jpg' })))
    await waitFor(() => expect(borradas()).toEqual([FOTO]))
    expect(Math.min(...mocks.removeCondominiosMedia.mock.invocationCallOrder)).toBeGreaterThan(mocks.updateCondominioRow.mock.invocationCallOrder[0])
  })

  it('editar sin tocar la foto la conserva y no borra nada', async () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(formulario()).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('inventario_condominio', 'iv1', expect.objectContaining({ foto_url: FOTO })))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('cancelar una edición borra la foto pendiente, nunca la guardada', async () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Editar' }))
    fireEvent.click(within(formulario()).getByRole('button', { name: /Cambiar foto/ }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    await usarFoto()
    fireEvent.click(within(formulario()).getByRole('button', { name: 'Cancelar' }))
    expect(borradas()).toEqual(['p1/inventario/nueva-1.jpg'])
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('cancelar un item nuevo conserva su foto con lo escrito; salir de la pestaña la borra', async () => {
    const { unmount } = renderTab({ inventario: [] })
    fireEvent.click(screen.getByRole('button', { name: /Agregar Item/ }))
    fireEvent.click(within(formulario()).getByRole('button', { name: /Agregar foto/ }))
    enVentana('Subir foto')
    await usarFoto()
    fireEvent.click(within(formulario()).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Agregar Item/ }))
    expect(within(formulario()).getByRole('img', { name: /Foto de/ }).getAttribute('src')).toBe('p1/inventario/nueva-1.jpg')
    unmount()
    expect(borradas()).toEqual(['p1/inventario/nueva-1.jpg'])
  })

  it('elegir otra foto pendiente borra la pendiente anterior, nunca la guardada', async () => {
    renderTab({ inventario: [item({ foto_url: FOTO })] })
    abrirFicha()
    fireEvent.click(within(ficha()).getByRole('button', { name: 'Editar' }))
    for (let n = 0; n < 2; n++) {
      fireEvent.click(within(formulario()).getByRole('button', { name: /Cambiar foto/ }))
      enVentana('Quitar foto')
      enVentana('Subir foto')
      await usarFoto()
    }
    expect(borradas()).toEqual(['p1/inventario/nueva-1.jpg'])
  })
})
