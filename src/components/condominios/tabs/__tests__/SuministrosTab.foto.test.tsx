// Suministros: la ficha lleva una foto del insumo, que se agrega, cambia o quita
// en una ventana emergente. Lo delicado es el bucket: una fila guardada nunca
// debe apuntar a un archivo ya borrado, y lo que se sube y no se confirma no
// debe quedar huérfano.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { SuministroCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  removeCondominiosMedia: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
  subidas: 0,
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) }, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../domain/shared/storage', () => ({ removeCondominiosMedia: mocks.removeCondominiosMedia }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({
  useOperacionesLegadoQuery: () => ({ data: [], isLoading: false }),
  useAsignacionesQuery: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../../domain/proveedores/mutations', () => ({
  useVincularOperacionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
// La imagen firmada y la subida real (compresión, bytes mágicos, Storage) tienen
// sus propias pruebas; aquí sólo importa qué ruta elige la persona.
vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: ({ src, alt }: { src: string | null; alt?: string }) => (src ? <img src={src} alt={alt} /> : null),
}))
vi.mock('../../../shared/ImageUploader', () => ({
  ImageUploader: ({ value, onChange, borrarAlQuitar }: { value: string | null; onChange: (p: string | null) => void; borrarAlQuitar?: boolean }) => (
    <div data-borrar-al-quitar={String(borrarAlQuitar)}>
      {value && <img src={value} alt="vista previa" />}
      {value
        ? <button type="button" onClick={() => onChange(null)}>Quitar foto</button>
        : <button type="button" onClick={() => onChange(`p1/suministros/nueva-${++mocks.subidas}.jpg`)}>Subir foto</button>}
    </div>
  ),
}))

const SuministrosTab = (await import('../SuministrosTab')).default

const FOTO = 'p1/suministros/alcohol.jpg'

function alcohol(over: Partial<SuministroCondominio> = {}): SuministroCondominio {
  return {
    id: 's1', company_id: 'co1', project_id: 'p1', nombre: 'Alcohol Etílico al 70%', categoria: 'limpieza',
    unidad_medida: 'litro', stock_actual: 1, stock_minimo: 1, ubicacion: 'Bodega', proveedor: null,
    proveedor_id: null, costo_unitario: 6, rendimiento: null, rendimiento_unidad: null, foto_url: null, notas: null,
    activo: true, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof SuministrosTab>[0]> = {}) {
  return render(
    <SuministrosTab suministros={[alcohol()]} movimientos={[]} proveedores={[]}
      proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} {...props} />,
  )
}

const abrirDetalle = () => fireEvent.click(screen.getByRole('button', { name: 'Alcohol Etílico al 70%' }))
const ventana = () => screen.getByRole('dialog', { name: 'Foto del insumo' })
const enVentana = (nombre: string | RegExp) => fireEvent.click(within(ventana()).getByRole('button', { name: nombre }))
/** Confirma la ventana del formulario; cierra tras la promesa de `onGuardar`. */
async function usarFoto() {
  enVentana(/Usar esta foto/)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}
const borradas = () => (mocks.removeCondominiosMedia.mock.calls as unknown as [string[]][]).flatMap(c => c[0])

beforeEach(() => {
  mocks.createCondominioRow.mockClear(); mocks.updateCondominioRow.mockClear(); mocks.removeCondominiosMedia.mockClear()
  mocks.notify.mockClear(); mocks.onRefresh.mockClear()
  mocks.updateCondominioRow.mockImplementation(async () => ({ error: null }))
  mocks.subidas = 0
})
afterEach(cleanup)

describe('SuministrosTab — foto desde la ficha', () => {
  it('sin foto, quien edita la agrega en una ventana y se guarda en la fila', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar foto de Alcohol Etílico al 70%' }))
    expect(within(ventana()).getByText('Alcohol Etílico al 70%')).toBeTruthy()
    // Quitar en la ventana no borra del bucket: la fila todavía apunta a la foto.
    expect(within(ventana()).getByText('Subir foto').parentElement?.getAttribute('data-borrar-al-quitar')).toBe('false')

    enVentana('Subir foto')
    enVentana(/Guardar foto/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', { foto_url: 'p1/suministros/nueva-1.jpg' }))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Foto guardada' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('al reemplazarla, la anterior se borra después de actualizar la fila, y lo subido y descartado en la ventana también', async () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Alcohol Etílico al 70%' }))
    enVentana('Quitar foto')
    enVentana('Subir foto')   // nueva-1, descartada
    enVentana('Quitar foto')
    enVentana('Subir foto')   // nueva-2, la elegida
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    enVentana(/Guardar foto/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', { foto_url: 'p1/suministros/nueva-2.jpg' }))
    await waitFor(() => expect(borradas().sort()).toEqual([FOTO, 'p1/suministros/nueva-1.jpg']))
    const update = mocks.updateCondominioRow.mock.invocationCallOrder[0]
    expect(Math.min(...mocks.removeCondominiosMedia.mock.invocationCallOrder)).toBeGreaterThan(update)
  })

  it('quitarla deja la fila en null y borra el archivo', async () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Alcohol Etílico al 70%' }))
    enVentana('Quitar foto')
    expect(within(ventana()).getByText(/La foto actual se quita al pulsar «Guardar foto»/)).toBeTruthy()
    enVentana(/Guardar foto/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', { foto_url: null }))
    await waitFor(() => expect(borradas()).toEqual([FOTO]))
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Foto quitada' }))
  })

  it('cancelar no toca la fila y sólo borra lo que se subió en la ventana', () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Alcohol Etílico al 70%' }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    enVentana('Cancelar')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(borradas()).toEqual(['p1/suministros/nueva-1.jpg'])
  })

  it('si la fila no se actualiza, la ventana sigue abierta y no se borra nada', async () => {
    mocks.updateCondominioRow.mockImplementation(async () => ({ error: { message: 'sin permiso' } }))
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Alcohol Etílico al 70%' }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    enVentana(/Guardar foto/)

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(ventana()).toBeTruthy()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })

  it('sin permiso de edición sólo se ve la foto en grande; sin foto no hay nada que abrir', () => {
    const { unmount } = renderTab({ canEdit: false, suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Alcohol Etílico al 70%' }))
    expect(within(ventana()).getByRole('img', { name: 'Foto de Alcohol Etílico al 70%' }).getAttribute('src')).toBe(FOTO)
    expect(within(ventana()).queryByRole('button', { name: /Guardar foto|Quitar foto|Subir foto/ })).toBeNull()
    enVentana('Cerrar')
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()

    renderTab({ canEdit: false })
    abrirDetalle()
    expect(screen.queryByRole('button', { name: /foto de Alcohol/ })).toBeNull()
  })
})

describe('SuministrosTab — foto en el formulario', () => {
  it('editar: la foto elegida viaja con «Guardar cambios» y la anterior se borra después', async () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cambiar foto/ }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    await usarFoto()

    expect(screen.getByText('Se guarda con la ficha')).toBeTruthy()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const patch = (mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]
    expect(patch).toMatchObject({ foto_url: 'p1/suministros/nueva-1.jpg' })
    expect(borradas()).toEqual([FOTO])
  })

  it('editar sin tocar la foto la conserva y no borra nada', async () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    expect(screen.queryByText('Se guarda con la ficha')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const patch = (mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]
    expect(patch).toMatchObject({ foto_url: FOTO })
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('salir de la edición sin cambiar la foto nunca borra la guardada', () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO }), alcohol({ id: 's2', nombre: 'Escoba', foto_url: null })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Escoba' }))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('cancelar la ficha conserva la foto guardada y borra la que quedó pendiente', async () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cambiar foto/ }))
    enVentana('Quitar foto')
    enVentana('Subir foto')
    await usarFoto()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(borradas()).toEqual(['p1/suministros/nueva-1.jpg'])
  })

  it('elegir otra foto pendiente borra la pendiente anterior, nunca la guardada', async () => {
    renderTab({ suministros: [alcohol({ foto_url: FOTO })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: /Cambiar foto/ }))
      enVentana('Quitar foto')
      enVentana('Subir foto')
      await usarFoto()
    }
    expect(borradas()).toEqual(['p1/suministros/nueva-1.jpg'])
  })

  it('nuevo: la foto se crea con la fila', async () => {
    renderTab({ suministros: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cloro' } })
    fireEvent.click(screen.getByRole('button', { name: /Agregar foto/ }))
    expect(within(ventana()).getByText('Cloro')).toBeTruthy()
    enVentana('Subir foto')
    await usarFoto()
    fireEvent.click(screen.getByRole('button', { name: /^✅ Guardar$/ }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const fila = (mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(fila).toMatchObject({ nombre: 'Cloro', foto_url: 'p1/suministros/nueva-1.jpg' })
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('nuevo sin foto guarda null', async () => {
    renderTab({ suministros: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cloro' } })
    fireEvent.click(screen.getByRole('button', { name: /^✅ Guardar$/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const fila = (mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(fila).toMatchObject({ foto_url: null })
  })
})
