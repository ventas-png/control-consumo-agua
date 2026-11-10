// Equipos con la visual y la funcionalidad de Suministros: cabecera con filtros,
// «Solo alertas de mantenimiento», carga masiva y alta; aviso de equipos que
// piden mantenimiento; tarjetas con unidades; ficha con foto y KPIs; y el
// formulario con cantidad y foto. La foto reutiliza la ventana de Suministros
// con su propio título y carpeta del bucket.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { EquipoComun } from '../../../../types'
import { hoyLocalISO } from '../../../../lib/format'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string } | null })),
  removeCondominiosMedia: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  onRefresh: vi.fn(),
  importProps: null as null | Record<string, unknown>,
  subidas: 0,
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) }, warmUpSupabase: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../domain/shared/storage', () => ({ removeCondominiosMedia: mocks.removeCondominiosMedia }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn(async () => null) }))
vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: ({ src, alt }: { src: string | null; alt?: string }) => (src ? <img src={src} alt={alt} /> : null),
}))
vi.mock('../../../shared/ImageUploader', () => ({
  ImageUploader: ({ value, onChange, folder }: { value: string | null; onChange: (p: string | null) => void; folder: string }) => (
    <div data-folder={folder}>
      {value
        ? <button type="button" onClick={() => onChange(null)}>Quitar foto</button>
        : <button type="button" onClick={() => onChange(`p1/${folder}/nueva-${++mocks.subidas}.jpg`)}>Subir foto</button>}
    </div>
  ),
}))
// La carga masiva genérica tiene sus propias pruebas: aquí basta ver que abre con el tenant.
vi.mock('../../ImportEquiposModal', () => ({
  ImportEquiposModal: (props: Record<string, unknown>) => { mocks.importProps = props; return <div role="dialog" aria-label="Carga masiva de equipos" /> },
}))

const EquiposComunesTab = (await import('../EquiposComunesTab')).default

const hoy = hoyLocalISO()
const enDias = (n: number) => {
  const [y, m, d] = hoy.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function equipo(over: Partial<EquipoComun> = {}): EquipoComun {
  return {
    id: 'e1', company_id: 'co1', project_id: 'p1', nombre: 'Bomba principal', categoria: 'bomba', cantidad: 1,
    marca: 'Pedrollo', modelo: 'CP 200', serial: 'SN-001', ubicacion: 'Cuarto de máquinas',
    fecha_compra: '2025-01-15', valor_compra: 12000, vida_util_anios: 10, estado: 'operativo', foto_url: null,
    ultimo_mantenimiento: null, proximo_mantenimiento: enDias(10), notas: null, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}
const BOMBA = equipo()
const HIDRO = equipo({ id: 'e2', nombre: 'Hidrolavadora', categoria: 'herramienta', cantidad: 3, marca: 'Kärcher', modelo: 'K5', serial: null, ubicacion: 'Bodega', valor_compra: 3500, vida_util_anios: null, proximo_mantenimiento: null })
const PULIDORA = equipo({ id: 'e3', nombre: 'Pulidora vieja', categoria: 'limpieza', estado: 'baja', proximo_mantenimiento: '2020-01-01' })

function renderTab(props: Partial<Parameters<typeof EquiposComunesTab>[0]> = {}) {
  return render(
    <EquiposComunesTab equipos={[BOMBA, HIDRO, PULIDORA]} proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit onRefresh={mocks.onRefresh} {...props} />,
  )
}
const abrir = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))
const ficha = (titulo: string) => screen.getByRole('dialog', { name: titulo })
const ventanaFoto = () => screen.getByRole('dialog', { name: 'Foto del equipo' })

beforeEach(() => {
  Object.values(mocks).forEach(m => { if (typeof m === 'object' && m && 'mockClear' in m) (m as { mockClear: () => void }).mockClear() })
  mocks.importProps = null
  mocks.subidas = 0
})
afterEach(cleanup)

describe('EquiposComunesTab — cabecera y lista como Suministros', () => {
  it('título, filtros, «Solo alertas», Masiva y Nuevo; el aviso cuenta sólo los que piden mantenimiento (los de baja no)', () => {
    renderTab()
    expect(screen.getByText('Equipos')).toBeTruthy()
    expect(screen.getByLabelText('Categoría')).toBeTruthy()
    expect(screen.getByLabelText('Estado')).toBeTruthy()
    expect(screen.getByText('Solo alertas de mantenimiento (1)')).toBeTruthy()
    expect(screen.getByText('⚠️ 1 equipo requiere mantenimiento')).toBeTruthy()
    expect(screen.getByRole('button', { name: '⬆ Masiva' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Nuevo' })).toBeTruthy()
    // tarjetas: unidades a la derecha, chip de estado y manto próximo
    expect(screen.getByText('×3')).toBeTruthy()
    expect(screen.getByText('⏳ Manto en 10 días')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: 'Pulidora vieja' })).getByText('De baja')).toBeTruthy()
  })

  it('«Solo alertas» deja sólo los que piden mantenimiento y oculta el aviso; los filtros de categoría y estado acotan', () => {
    renderTab()
    fireEvent.click(screen.getByLabelText(/Solo alertas de mantenimiento/))
    expect(screen.getByRole('button', { name: 'Bomba principal' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hidrolavadora' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pulidora vieja' })).toBeNull()
    expect(screen.queryByText(/requiere mantenimiento/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Solo alertas de mantenimiento/))

    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'herramienta' } })
    expect(screen.getByRole('button', { name: 'Hidrolavadora' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bomba principal' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'baja' } })
    expect(screen.getByRole('button', { name: 'Pulidora vieja' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Bomba|Hidrolavadora|Pulidora/ })).toHaveLength(1)
  })

  it('⬆ Masiva abre la carga masiva con el tenant; sin permiso de alta no hay Masiva ni Nuevo', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '⬆ Masiva' }))
    expect(screen.getByRole('dialog', { name: 'Carga masiva de equipos' })).toBeTruthy()
    expect(mocks.importProps).toMatchObject({ proyectoId: 'p1', companyId: 'co1' })
    cleanup()
    renderTab({ canCreate: false })
    expect(screen.queryByRole('button', { name: '⬆ Masiva' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Nuevo' })).toBeNull()
  })
})

describe('EquiposComunesTab — ficha con foto y unidades', () => {
  it('la ficha trae KPIs (unidades, próximo mantenimiento, valor), datos y el botón de foto', () => {
    renderTab()
    abrir('Hidrolavadora')
    const v = ficha('🔧 Hidrolavadora')
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(v).getByText('Unidades')).toBeTruthy()
    expect(within(v).getByText('×3').parentElement?.textContent).toContain('Unidades')
    expect(within(v).getByText('Valor total').parentElement?.textContent).toContain('Q 10500.00')
    expect(within(v).getByText('3500.00').parentElement?.textContent).toContain('Valor compra (Q)')
    expect(within(v).getByText('🔧 Herramienta')).toBeTruthy()
    expect(within(v).getByRole('button', { name: 'Agregar foto de Hidrolavadora' })).toBeTruthy()
  })

  it('agregar la foto desde la ficha la guarda en el acto en la carpeta «equipos» y refresca', async () => {
    renderTab()
    abrir('Hidrolavadora')
    fireEvent.click(within(ficha('🔧 Hidrolavadora')).getByRole('button', { name: 'Agregar foto de Hidrolavadora' }))
    const vf = ventanaFoto()
    expect(within(vf).getByText('Hidrolavadora')).toBeTruthy()
    expect(vf.querySelector('[data-folder]')?.getAttribute('data-folder')).toBe('equipos')
    fireEvent.click(within(vf).getByRole('button', { name: 'Subir foto' }))
    fireEvent.click(within(vf).getByRole('button', { name: /Guardar foto/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('equipos_comunes', 'e2', { foto_url: 'p1/equipos/nueva-1.jpg' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Foto del equipo' })).toBeNull())
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Foto guardada' }))
    expect(mocks.onRefresh).toHaveBeenCalled()
    expect(ficha('🔧 Hidrolavadora')).toBeTruthy()
  })

  it('sin permiso de edición y sin foto no hay botón de foto; con foto se puede ver', () => {
    renderTab({ canEdit: false })
    abrir('Hidrolavadora')
    expect(within(ficha('🔧 Hidrolavadora')).queryByRole('button', { name: /foto/ })).toBeNull()
    cleanup()
    renderTab({ canEdit: false, equipos: [equipo({ ...HIDRO, foto_url: 'p1/equipos/hidro.jpg' })] })
    abrir('Hidrolavadora')
    fireEvent.click(within(ficha('🔧 Hidrolavadora')).getByRole('button', { name: 'Ver foto de Hidrolavadora' }))
    expect(within(ventanaFoto()).getByRole('img')).toBeTruthy()
    expect(within(ventanaFoto()).getByRole('button', { name: 'Cerrar' })).toBeTruthy()
  })
})

describe('EquiposComunesTab — el formulario lleva cantidad y foto', () => {
  it('Nuevo guarda la cantidad como entero y la foto elegida; una cantidad inválida no se manda', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    const v = ficha('Nuevo equipo')
    expect((within(v).getByLabelText('Cantidad') as HTMLInputElement).value).toBe('1')
    fireEvent.change(within(v).getByLabelText('Nombre *'), { target: { value: 'Pulidora de pisos' } })
    fireEvent.change(within(v).getByLabelText('Categoría'), { target: { value: 'limpieza' } })
    fireEvent.change(within(v).getByLabelText('Cantidad'), { target: { value: '-1' } })
    fireEvent.click(within(v).getByRole('button', { name: /Guardar equipo/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.change(within(v).getByLabelText('Cantidad'), { target: { value: '2' } })
    fireEvent.click(within(v).getByRole('button', { name: /Agregar foto/ }))
    const vf = ventanaFoto()
    fireEvent.click(within(vf).getByRole('button', { name: 'Subir foto' }))
    fireEvent.click(within(vf).getByRole('button', { name: /Usar esta foto/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Foto del equipo' })).toBeNull())
    expect(within(v).getByText('Se guarda con la ficha')).toBeTruthy()
    fireEvent.click(within(v).getByRole('button', { name: /Guardar equipo/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, fila] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('equipos_comunes')
    expect(fila).toMatchObject({ company_id: 'co1', project_id: 'p1', nombre: 'Pulidora de pisos', categoria: 'limpieza', cantidad: 2, foto_url: 'p1/equipos/nueva-1.jpg' })
    expect(mocks.removeCondominiosMedia).not.toHaveBeenCalled()
  })

  it('cancelar el alta con una foto recién subida la borra del bucket (nadie la referencia)', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo' }))
    const v = ficha('Nuevo equipo')
    fireEvent.click(within(v).getByRole('button', { name: /Agregar foto/ }))
    fireEvent.click(within(ventanaFoto()).getByRole('button', { name: 'Subir foto' }))
    fireEvent.click(within(ventanaFoto()).getByRole('button', { name: /Usar esta foto/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Foto del equipo' })).toBeNull())
    fireEvent.click(within(v).getByRole('button', { name: 'Cancelar' }))
    expect(mocks.removeCondominiosMedia).toHaveBeenCalledWith(['p1/equipos/nueva-1.jpg'])
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('Editar muestra la cantidad guardada y la manda en el parche', async () => {
    renderTab()
    abrir('Hidrolavadora')
    fireEvent.click(within(ficha('🔧 Hidrolavadora')).getByRole('button', { name: '✏️ Editar' }))
    const v = ficha('Editar equipo')
    expect((within(v).getByLabelText('Cantidad') as HTMLInputElement).value).toBe('3')
    fireEvent.change(within(v).getByLabelText('Cantidad'), { target: { value: '4' } })
    fireEvent.click(within(v).getByRole('button', { name: /Guardar cambios/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(id).toBe('e2')
    expect(patch).toMatchObject({ cantidad: 4, nombre: 'Hidrolavadora' })
  })
})
