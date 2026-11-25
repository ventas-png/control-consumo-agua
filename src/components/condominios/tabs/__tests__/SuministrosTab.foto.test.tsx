// Suministros: la ficha lleva VARIAS fotos del insumo (hasta 6, 20261216000300),
// que se agregan o quitan en una ventana emergente. La foto única de antes
// (`foto_url`, legado) se sigue viendo y, al guardar, pasa a `fotos`. Lo
// delicado es el bucket: una fila guardada nunca debe apuntar a un archivo ya
// borrado, y lo que se sube y no se confirma no debe quedar huérfano.
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
// sus propias pruebas; aquí sólo importa qué rutas elige la persona.
vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: ({ src, alt }: { src: string | null; alt?: string }) => (src ? <img src={src} alt={alt} /> : null),
}))
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: ({ values, onChange, folder, maxFiles, borrarAlQuitar }: {
    values: string[]; onChange: (p: string[]) => void; folder: string; maxFiles?: number; borrarAlQuitar?: boolean
  }) => (
    <div data-borrar-al-quitar={String(borrarAlQuitar)} data-folder={folder} data-max={maxFiles}>
      {values.map(v => <button key={v} type="button" onClick={() => onChange(values.filter(x => x !== v))}>Quitar {v}</button>)}
      <button type="button" onClick={() => onChange([...values, `p1/${folder}/nueva-${++mocks.subidas}.jpg`])}>Subir foto</button>
    </div>
  ),
}))

const SuministrosTab = (await import('../SuministrosTab')).default

const VIEJA = 'p1/suministros/alcohol.jpg'
const F1 = 'p1/suministros/frente.jpg'
const F2 = 'p1/suministros/etiqueta.jpg'

function alcohol(over: Partial<SuministroCondominio> = {}): SuministroCondominio {
  return {
    id: 's1', company_id: 'co1', project_id: 'p1', nombre: 'Alcohol Etílico al 70%', categoria: 'limpieza',
    unidad_medida: 'litro', stock_actual: 1, stock_minimo: 1, ubicacion: 'Bodega', proveedor: null,
    proveedor_id: null, costo_unitario: 6, rendimiento: null, rendimiento_unidad: null, foto_url: null, fotos: [], notas: null,
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
const ventana = () => screen.getByRole('dialog', { name: 'Fotos del insumo' })
const enVentana = (nombre: string | RegExp) => fireEvent.click(within(ventana()).getByRole('button', { name: nombre }))
const sinVentana = () => expect(screen.queryByRole('dialog', { name: 'Fotos del insumo' })).toBeNull()
/** Confirma la ventana abierta desde el formulario (el formulario sigue abierto debajo). */
async function usarFotos() {
  enVentana(/Usar estas fotos/)
  await waitFor(sinVentana)
}
const borradas = () => (mocks.removeCondominiosMedia.mock.calls as unknown as [string[]][]).flatMap(c => c[0])
const patch = () => (mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>])[2]

beforeEach(() => {
  mocks.createCondominioRow.mockClear(); mocks.updateCondominioRow.mockClear(); mocks.removeCondominiosMedia.mockClear()
  mocks.notify.mockClear(); mocks.onRefresh.mockClear()
  mocks.updateCondominioRow.mockImplementation(async () => ({ error: null }))
  mocks.subidas = 0
})
afterEach(cleanup)

describe('SuministrosTab — fotos desde la ficha', () => {
  it('sin fotos, quien edita agrega varias en una ventana y se guardan juntas en la fila', async () => {
    renderTab()
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar fotos de Alcohol Etílico al 70%' }))
    expect(within(ventana()).getByText('Alcohol Etílico al 70%')).toBeTruthy()
    const uploader = within(ventana()).getByText('Subir foto').parentElement!
    // Quitar en la ventana no borra del bucket: la fila todavía apunta a la foto.
    expect(uploader.getAttribute('data-borrar-al-quitar')).toBe('false')
    expect(uploader.getAttribute('data-folder')).toBe('suministros')
    expect(uploader.getAttribute('data-max')).toBe('6')

    enVentana('Subir foto')
    enVentana('Subir foto')
    enVentana(/Guardar fotos/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', {
      fotos: ['p1/suministros/nueva-1.jpg', 'p1/suministros/nueva-2.jpg'], foto_url: null,
    }))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    expect(mocks.onRefresh).toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Fotos guardadas' }))
    await waitFor(sinVentana)
    expect(screen.getByRole('dialog', { name: /Alcohol Etílico al 70%/ })).toBeTruthy()
  })

  it('la ficha muestra la primera foto y cuántas más hay', () => {
    renderTab({ suministros: [alcohol({ fotos: [F1, F2] })] })
    abrirDetalle()
    const boton = screen.getByRole('button', { name: 'Ver fotos de Alcohol Etílico al 70% (2)' })
    expect(boton.querySelector('img')?.getAttribute('src')).toBe(F1)
    expect(boton.textContent).toContain('+1')
  })

  it('la foto única de antes (foto_url) se ve con las nuevas y, al guardar, pasa a fotos y foto_url queda en null', async () => {
    renderTab({ suministros: [alcohol({ foto_url: VIEJA, fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: 'Ver fotos de Alcohol Etílico al 70% (2)' }))
    expect(within(ventana()).getByRole('button', { name: `Quitar ${VIEJA}` })).toBeTruthy()
    enVentana('Subir foto')
    enVentana(/Guardar fotos/)
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', {
      fotos: [VIEJA, F1, 'p1/suministros/nueva-1.jpg'], foto_url: null,
    }))
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('quitar fotos las borra DESPUÉS de actualizar la fila; lo subido y descartado en la ventana, también', async () => {
    renderTab({ suministros: [alcohol({ foto_url: VIEJA, fotos: [F1, F2] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Ver fotos de Alcohol/ }))
    enVentana(`Quitar ${VIEJA}`)
    enVentana(`Quitar ${F2}`)
    enVentana('Subir foto')                                 // nueva-1, descartada
    enVentana('Quitar p1/suministros/nueva-1.jpg')
    expect(within(ventana()).getByText(/Las 2 fotos quitadas se borran al pulsar «Guardar fotos»/)).toBeTruthy()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    enVentana(/Guardar fotos/)

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('suministros_condominio', 's1', { fotos: [F1], foto_url: null }))
    await waitFor(() => expect(borradas().sort()).toEqual([F2, VIEJA, 'p1/suministros/nueva-1.jpg'].sort()))
    expect(Math.min(...mocks.removeCondominiosMedia.mock.invocationCallOrder)).toBeGreaterThan(mocks.updateCondominioRow.mock.invocationCallOrder[0])
  })

  it('cancelar no toca la fila y sólo borra lo que se subió en la ventana', () => {
    renderTab({ suministros: [alcohol({ fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Ver fotos de Alcohol/ }))
    enVentana(`Quitar ${F1}`)
    enVentana('Subir foto')
    enVentana('Cancelar')
    sinVentana()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(borradas()).toEqual(['p1/suministros/nueva-1.jpg'])
  })

  it('si la fila no se actualiza, la ventana sigue abierta y no se borra nada', async () => {
    mocks.updateCondominioRow.mockImplementation(async () => ({ error: { message: 'sin permiso' } }))
    renderTab({ suministros: [alcohol({ fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Ver fotos de Alcohol/ }))
    enVentana(`Quitar ${F1}`)
    enVentana('Subir foto')
    enVentana(/Guardar fotos/)
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(ventana()).toBeTruthy()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
    expect(mocks.onRefresh).not.toHaveBeenCalled()
  })

  it('sin permiso de edición sólo se ven las fotos; sin fotos no hay nada que abrir', () => {
    const { unmount } = renderTab({ canEdit: false, suministros: [alcohol({ foto_url: VIEJA, fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Ver fotos de Alcohol/ }))
    expect(within(ventana()).getByRole('button', { name: 'Ver foto 1 de 2' })).toBeTruthy()
    expect(within(ventana()).queryByRole('button', { name: /Guardar fotos|Quitar|Subir foto/ })).toBeNull()
    enVentana('Cerrar')
    sinVentana()
    unmount()

    renderTab({ canEdit: false })
    abrirDetalle()
    expect(screen.queryByRole('button', { name: /fotos de Alcohol/ })).toBeNull()
  })
})

describe('SuministrosTab — fotos en el formulario', () => {
  it('editar: las fotos elegidas viajan con «Guardar cambios» y las quitadas se borran después', async () => {
    renderTab({ suministros: [alcohol({ foto_url: VIEJA, fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cambiar fotos/ }))
    enVentana(`Quitar ${VIEJA}`)
    enVentana('Subir foto')
    await usarFotos()

    expect(screen.getByText('Se guardan con la ficha')).toBeTruthy()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(patch()).toMatchObject({ fotos: [F1, 'p1/suministros/nueva-1.jpg'], foto_url: null })
    expect(borradas()).toEqual([VIEJA])
    expect(Math.min(...mocks.removeCondominiosMedia.mock.invocationCallOrder)).toBeGreaterThan(mocks.updateCondominioRow.mock.invocationCallOrder[0])
  })

  it('editar sin tocar las fotos las conserva (la legada pasa a fotos) y no borra nada', async () => {
    renderTab({ suministros: [alcohol({ foto_url: VIEJA })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    expect(screen.queryByText('Se guardan con la ficha')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    expect(patch()).toMatchObject({ fotos: [VIEJA], foto_url: null })
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('salir de la edición sin cambiar las fotos nunca borra las guardadas', () => {
    renderTab({ suministros: [alcohol({ fotos: [F1] }), alcohol({ id: 's2', nombre: 'Escoba' })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    // Escape cierra el formulario; otro Escape, la ficha. Luego se abre otro insumo.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Escoba' }))
    expect(screen.getByRole('dialog', { name: /Escoba/ })).toBeTruthy()
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('cancelar la ficha conserva las fotos guardadas y borra las que quedaron pendientes', async () => {
    renderTab({ suministros: [alcohol({ fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cambiar fotos/ }))
    enVentana(`Quitar ${F1}`)
    enVentana('Subir foto')
    await usarFotos()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(borradas()).toEqual(['p1/suministros/nueva-1.jpg'])
  })

  it('cambiar otra vez las fotos pendientes borra las pendientes descartadas, nunca las guardadas', async () => {
    renderTab({ suministros: [alcohol({ fotos: [F1] })] })
    abrirDetalle()
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: /Cambiar fotos/ }))
    enVentana('Subir foto')                                  // nueva-1
    await usarFotos()
    fireEvent.click(screen.getByRole('button', { name: /Cambiar fotos/ }))
    enVentana('Quitar p1/suministros/nueva-1.jpg')
    enVentana(`Quitar ${F1}`)
    enVentana('Subir foto')                                  // nueva-2
    await usarFotos()
    expect(borradas()).toEqual(['p1/suministros/nueva-1.jpg'])
  })

  it('nuevo: las fotos se crean con la fila', async () => {
    renderTab({ suministros: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cloro' } })
    fireEvent.click(screen.getByRole('button', { name: /Agregar fotos/ }))
    expect(within(ventana()).getByText('Cloro')).toBeTruthy()
    enVentana('Subir foto')
    enVentana('Subir foto')
    await usarFotos()
    expect(screen.getAllByRole('img', { name: /Foto \d de Cloro/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /^✅ Guardar$/ }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const fila = (mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(fila).toMatchObject({ nombre: 'Cloro', fotos: ['p1/suministros/nueva-1.jpg', 'p1/suministros/nueva-2.jpg'], foto_url: null })
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('nuevo sin fotos guarda la lista vacía', async () => {
    renderTab({ suministros: [] })
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cloro' } })
    fireEvent.click(screen.getByRole('button', { name: /^✅ Guardar$/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const fila = (mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(fila).toMatchObject({ fotos: [], foto_url: null })
  })
})
