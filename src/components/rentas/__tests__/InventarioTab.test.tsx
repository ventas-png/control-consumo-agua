// Inventario de Manejo de Rentas: fotos por artículo y carga continua.
// Lo que se fija: que las fotos suban a la carpeta <empresa>/<propiedad> del
// bucket propio, que viajen en el payload, que «Guardar y agregar otro» se quede
// en la misma propiedad y ambiente, y QUÉ se retira del bucket y CUÁNDO: sólo
// después de guardar o borrar la fila, y sólo lo que la fila ya no nombra.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ArticuloInventarioRenta, PropiedadRenta } from '../../../types'

const h = vi.hoisted(() => ({
  crear: vi.fn(async (_payload: unknown) => 'nuevo-id'),
  actualizar: vi.fn(async (_vars: unknown) => undefined),
  eliminar: vi.fn(async (_id: string) => undefined),
  retirar: vi.fn((_rutas: readonly string[]) => undefined),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  uploader: null as null | Record<string, unknown>,
  n: 0,
}))

vi.mock('../../../domain/rentas/mutations', () => ({
  useInventarioRentaMutations: () => ({
    crear: { isPending: false, mutateAsync: h.crear },
    actualizar: { isPending: false, mutateAsync: h.actualizar },
    eliminar: { isPending: false, mutateAsync: h.eliminar },
  }),
  retirarFotosInventario: h.retirar,
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: h.confirm }))
// El uploader real sube a Storage; aquí «subir» agrega una ruta como lo haría él.
vi.mock('../../shared/ImageUploader', () => ({
  MultiImageUploader: (p: { values: string[]; onChange: (v: string[]) => void; folder: string; alcance?: string }) => {
    h.uploader = p
    return (
      <div>
        {p.values.map(v => <button key={v} type="button" onClick={() => p.onChange(p.values.filter(x => x !== v))}>quitar {v}</button>)}
        <button type="button" onClick={() => p.onChange([...p.values, `${p.alcance}/${p.folder}/nueva-${++h.n}.jpg`])}>simular foto</button>
      </div>
    )
  },
}))
vi.mock('../../shared/ImageGallery', () => ({
  ImageGallery: ({ urls, bucket }: { urls: string[]; bucket?: string }) => <span>{urls.length} fotos en {bucket}</span>,
}))

const { default: InventarioTab } = await import('../tabs/InventarioTab')

const base = {
  company_id: 'c1', codigo: null, tipo_detalle: null, estado: 'activa', direccion: null, ciudad: null,
  propietario_nombre: null, propietario_telefono: null, propietario_email: null, habitaciones: null, banos: null,
  capacidad: null, area_m2: null, tarifa_base: null, comision_pct: null, notas: null, created_at: '', updated_at: '',
  tipo_renta: 'corto_plazo', project_id: null, unidad_id: null,
}
const propiedades = [
  { ...base, id: 'ind', nombre: 'Casa Lago' },
  { ...base, id: 'otra', nombre: 'Apto Zona 10' },
] as PropiedadRenta[]
const articulo = (id: string, extra: Partial<ArticuloInventarioRenta> = {}): ArticuloInventarioRenta => ({
  id, company_id: 'c1', propiedad_id: 'ind', nombre: 'Refrigeradora', categoria: 'electrodomestico', ambiente: 'Cocina',
  cantidad: 1, estado: 'bueno', valor_unitario: null, numero_serie: null, fecha_revision: null, notas: null,
  fotos: [], created_at: '', updated_at: '', ...extra,
})
const todos = { ver: true, crear: true, editar: true, eliminar: true }

function montar(inventario: ArticuloInventarioRenta[] = []) {
  return render(
    <InventarioTab propiedades={propiedades} inventario={inventario} companyId="c1" moneda="GTQ" hoy="2026-11-17" permisos={todos} />,
  )
}
const abrirAlta = () => fireEvent.click(screen.getAllByRole('button', { name: '+ Nuevo artículo' })[0])
const selectPropiedad = () => screen.getByLabelText('Propiedad *') as HTMLSelectElement
const escribir = (etiqueta: string, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })
/** Rutas retiradas del bucket en todas las llamadas (las vacías no cuentan). */
const retiradas = () => h.retirar.mock.calls.flatMap(([r]) => [...r])

beforeEach(() => { vi.clearAllMocks(); h.uploader = null; h.n = 0 })
afterEach(cleanup)

describe('fotos del artículo', () => {
  it('sin propiedad no hay dónde subir; con ella, el uploader va al bucket propio bajo <empresa>/<propiedad>', () => {
    montar()
    abrirAlta()
    expect(screen.queryByRole('button', { name: 'simular foto' })).toBeNull()
    expect(screen.getByText(/Elige la propiedad para fotografiar/)).toBeTruthy()
    fireEvent.change(selectPropiedad(), { target: { value: 'ind' } })
    expect(h.uploader).toMatchObject({
      bucket: 'rentas-inventario', alcance: 'c1', folder: 'ind', capture: true, borrarAlQuitar: false, maxFiles: 6,
    })
  })

  it('con fotos, la propiedad queda fija (las fotos viven en su carpeta) y viajan en el payload', async () => {
    montar()
    abrirAlta()
    fireEvent.change(selectPropiedad(), { target: { value: 'ind' } })
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    expect(selectPropiedad().disabled).toBe(true)
    escribir('Artículo *', 'Sofá')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear.mock.calls[0][0]).toMatchObject({ company_id: 'c1', propiedad_id: 'ind', nombre: 'Sofá', fotos: ['c1/ind/nueva-1.jpg'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(retiradas()).toEqual([])
  })

  it('cancelar un alta retira lo que se subió, también lo que ya se había quitado', async () => {
    montar()
    abrirAlta()
    fireEvent.change(selectPropiedad(), { target: { value: 'ind' } })
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    fireEvent.click(screen.getByRole('button', { name: 'quitar c1/ind/nueva-1.jpg' }))
    expect(selectPropiedad().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(retiradas().sort()).toEqual(['c1/ind/nueva-1.jpg', 'c1/ind/nueva-2.jpg'])
    expect(h.crear).not.toHaveBeenCalled()
  })

  it('editar: quitar una foto la retira DESPUÉS de guardar la fila, nunca antes', async () => {
    const orden: string[] = []
    h.actualizar.mockImplementationOnce(async () => { orden.push('fila') })
    h.retirar.mockImplementation((r: readonly string[]) => { if (r.length) orden.push(`retirar ${r.join(',')}`) })
    montar([articulo('a1', { fotos: ['c1/ind/a.jpg', 'c1/ind/b.jpg'] })])
    expect(screen.getByText('2 fotos en rentas-inventario')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Refrigeradora' }))
    expect(selectPropiedad().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Guardar y agregar otro' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'quitar c1/ind/a.jpg' }))
    expect(orden).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(orden).toEqual(['fila', 'retirar c1/ind/a.jpg']))
    expect(h.actualizar.mock.calls[0][0]).toMatchObject({ id: 'a1', patch: { fotos: ['c1/ind/b.jpg'] } })
  })

  it('si guardar falla, no se retira nada y el formulario sigue abierto', async () => {
    h.crear.mockRejectedValueOnce(new Error('sin red'))
    montar()
    abrirAlta()
    fireEvent.change(selectPropiedad(), { target: { value: 'ind' } })
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    escribir('Artículo *', 'Sofá')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se pudo guardar' })))
    expect(retiradas()).toEqual([])
    expect(screen.getByRole('button', { name: 'quitar c1/ind/nueva-1.jpg' })).toBeTruthy()
  })

  it('eliminar un artículo retira sus fotos después de borrar la fila', async () => {
    const orden: string[] = []
    h.eliminar.mockImplementationOnce(async () => { orden.push('fila') })
    h.retirar.mockImplementation((r: readonly string[]) => { orden.push(`retirar ${r.join(',')}`) })
    montar([articulo('a1', { fotos: ['c1/ind/a.jpg'] })])
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Refrigeradora' }))
    await waitFor(() => expect(orden).toEqual(['fila', 'retirar c1/ind/a.jpg']))
  })
})

describe('carga continua: «Guardar y agregar otro»', () => {
  it('guarda, se queda en la misma propiedad, ambiente y categoría, y limpia lo propio del artículo', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('Propiedad'), { target: { value: 'ind' } })
    abrirAlta()
    expect(selectPropiedad().value).toBe('ind')
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    escribir('Artículo *', 'Sofá')
    escribir('Ambiente', 'Sala')
    escribir('Categoría', 'decoracion')
    escribir('Cantidad *', '2')
    escribir('Número de serie', 'SN-1')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y agregar otro' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(1))
    expect(h.crear.mock.calls[0][0]).toMatchObject({
      propiedad_id: 'ind', nombre: 'Sofá', ambiente: 'Sala', categoria: 'decoracion', cantidad: 2, numero_serie: 'SN-1', fotos: ['c1/ind/nueva-1.jpg'],
    })

    // El modal sigue abierto, listo para el siguiente.
    await waitFor(() => expect(within(screen.getByRole('status')).getByText(/1 artículo agregado a Casa Lago/)).toBeTruthy())
    expect(screen.getByRole('status').textContent).toContain('Sofá')
    expect(selectPropiedad().value).toBe('ind')
    expect(selectPropiedad().disabled).toBe(false)
    expect((screen.getByLabelText('Ambiente') as HTMLInputElement).value).toBe('Sala')
    expect((screen.getByLabelText('Categoría') as HTMLSelectElement).value).toBe('decoracion')
    expect((screen.getByLabelText('Artículo *') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Cantidad *') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('Número de serie') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: /quitar/ })).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('Artículo *'))
    expect(screen.getByRole('button', { name: 'Terminar' })).toBeTruthy()
    // Las fotos del que se guardó no son de esta sesión: no se retiran.
    expect(retiradas()).toEqual([])

    // El segundo, con «Guardar», cierra.
    escribir('Artículo *', 'Mesa de centro')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(h.crear).toHaveBeenCalledTimes(2))
    expect(h.crear.mock.calls[1][0]).toMatchObject({ propiedad_id: 'ind', nombre: 'Mesa de centro', ambiente: 'Sala', fotos: [] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.notify).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'success', title: '2 artículos registrados' }))
    expect(retiradas()).toEqual([])
  })

  it('«Terminar» después de agregar no retira las fotos de lo ya guardado, sólo las del artículo a medias', async () => {
    montar()
    abrirAlta()
    fireEvent.change(selectPropiedad(), { target: { value: 'ind' } })
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    escribir('Artículo *', 'Sofá')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y agregar otro' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Terminar' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'simular foto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(retiradas()).toEqual(['c1/ind/nueva-2.jpg'])
  })
})
