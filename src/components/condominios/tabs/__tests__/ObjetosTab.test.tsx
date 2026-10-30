// Objetos perdidos (20261119000000): el registro se hace en ventana; el área
// donde se encontró y la de almacenamiento se eligen del catálogo; quién lo
// encontró es un empleado (se propone el del usuario) o un tercero con nombre;
// el custodio se elige del personal; y la entrega al propietario pide el
// nombre de quien recibe y su firma, que se sube ANTES de marcarlo entregado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { AreaCondominio, ObjetoPerdido, PersonalCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  orden: [] as string[],
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRowAfectando: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  uploadCondominiosMedia: vi.fn(async (..._args: unknown[]) => ({ data: null, error: null as string | null })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  updateCondominioRowAfectando: mocks.updateCondominioRowAfectando,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/shared/storage', () => ({ uploadCondominiosMedia: mocks.uploadCondominiosMedia }))
vi.mock('../../../../lib/fileValidation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/fileValidation')>()),
  validateFileMagic: vi.fn(async () => ({ ok: true, detected: 'image/png' })),
}))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: ({ onChange, label }: { onChange: (v: string[]) => void; label: string }) => (
    <button type="button" onClick={() => onChange(['p1/objetos-perdidos/llaves.jpg'])}>Subir {label}</button>
  ),
}))
vi.mock('../../../shared/ImageGallery', () => ({ ImageGallery: ({ urls }: { urls: string[] }) => <div data-testid="galeria">{urls.join(',')}</div> }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: ({ alt }: { alt?: string }) => <img alt={alt} /> }))
vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: ({ onSave, saveLabel, saving }: { onSave: (f: File) => void; saveLabel: string; saving?: boolean }) => (
    <button type="button" disabled={saving} onClick={() => onSave(new File(['x'], 'firma.png', { type: 'image/png' }))}>{saveLabel}</button>
  ),
}))

const { I18nProvider } = await import('../../../../lib/i18n')
const { ObjetosTab } = await import('../ObjetosTab')

const area = (o: Partial<AreaCondominio>): AreaCondominio => ({
  id: 'a?', company_id: 'co1', project_id: 'p1', nombre: '?', icono: '📍', orden: 0, activo: true,
  created_at: '2026-01-01T00:00:00Z', ...o,
})
const PISCINA = area({ id: 'a-piscina', nombre: 'Piscina', icono: '🏊', orden: 1 })
const RECEPCION = area({ id: 'a-recepcion', nombre: 'Recepción', icono: '🛎️', orden: 2 })
const GARITA_VIEJA = area({ id: 'a-garita', nombre: 'Garita vieja', activo: false })
const AREAS = [PISCINA, RECEPCION, GARITA_VIEJA]

const empleado = (o: Partial<PersonalCondominio>) => ({
  id: 'pe?', company_id: 'co1', project_id: 'p1', nombre: '?', cargo: 'guardia', estado: 'activo',
  created_at: '2026-01-01T00:00:00Z', ...o,
}) as PersonalCondominio
const ANA = empleado({ id: 'pe-ana', nombre: 'Ana López', user_id: 'u1' })
const LUIS = empleado({ id: 'pe-luis', nombre: 'Luis Pérez', cargo: 'recepcionista' })
const BAJA = empleado({ id: 'pe-baja', nombre: 'Dado de baja', estado: 'inactivo' })

function objeto(o: Partial<ObjetoPerdido> = {}): ObjetoPerdido {
  return {
    id: 'o1', company_id: 'co1', project_id: 'p1', descripcion: 'Llaves con llavero rojo', fecha_encontrado: '2026-10-28',
    estado: 'en_custodia', area_encontrado_id: 'a-piscina', lugar_encontrado: 'Piscina',
    encontrado_por_tipo: 'personal', encontrado_por_personal_id: 'pe-luis', encontrado_por_nombre: 'Luis Pérez',
    custodio_personal_id: 'pe-ana', custodio_nombre: 'Ana López', area_almacenamiento_id: 'a-recepcion', almacenamiento_detalle: 'Gaveta 2',
    fotos: ['p1/objetos-perdidos/llaves.jpg'], created_at: '2026-10-28T10:00:00Z', ...o,
  }
}

const base = {
  objetos: [objeto()], areas: AREAS, personal: [ANA, LUIS, BAJA], proyectoId: 'p1', companyId: 'co1', userId: 'u1',
  canCreate: true, canEdit: true, canDelete: true, puedeConfigurarAreas: true, onIrATab: vi.fn(), onRefresh: vi.fn(),
}

function renderTab(props: Partial<Parameters<typeof ObjetosTab>[0]> = {}) {
  return render(<I18nProvider><ObjetosTab {...base} {...props} /></I18nProvider>)
}

const abrirRegistro = () => {
  fireEvent.click(screen.getByRole('button', { name: '+ Registrar Objeto' }))
  return screen.getByRole('dialog', { name: 'Registrar objeto encontrado' })
}
const campo = (dialog: HTMLElement, label: string | RegExp) => within(dialog).getByLabelText(label) as HTMLInputElement | HTMLSelectElement

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('at:locale', 'es')
  mocks.orden.length = 0
  mocks.uploadCondominiosMedia.mockImplementation(async () => { mocks.orden.push('subir'); return { data: null, error: null } })
  mocks.updateCondominioRowAfectando.mockImplementation(async () => { mocks.orden.push('entregar'); return { error: null } })
})
afterEach(cleanup)

describe('ObjetosTab — registro en ventana', () => {
  it('abre en ventana a pantalla completa en el teléfono y propone al usuario como quien lo encontró y custodio', () => {
    renderTab()
    const dialog = abrirRegistro()
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByRole('radio', { name: /Personal del condominio/ }).getAttribute('aria-checked')).toBe('true')
    expect(campo(dialog, 'Empleado *').value).toBe('pe-ana')
    expect(campo(dialog, 'Custodio (quién lo guarda)').value).toBe('pe-ana')
    expect(within(dialog).getByText('Con tu usuario. Cámbialo si lo guarda otra persona.')).toBeTruthy()
    // Sólo el personal activo; el inactivo no se ofrece.
    const opciones = [...(campo(dialog, 'Empleado *') as HTMLSelectElement).options].map(o => o.textContent)
    expect(opciones.some(o => o?.startsWith('Ana López') && o.endsWith('(tú)'))).toBe(true)
    expect(opciones.some(o => o?.includes('Dado de baja'))).toBe(false)
  })

  it('las áreas salen del catálogo (sólo las activas) y se guarda el id con el nombre como snapshot', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    const dialog = abrirRegistro()
    const areasOfrecidas = [...(campo(dialog, 'Área donde se encontró') as HTMLSelectElement).options].map(o => o.value)
    expect(areasOfrecidas).toEqual(['', 'a-piscina', 'a-recepcion'])

    fireEvent.change(campo(dialog, 'Descripción *'), { target: { value: '  Celular Samsung negro ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Subir Fotos del objeto' }))
    fireEvent.change(campo(dialog, 'Área donde se encontró'), { target: { value: 'a-piscina' } })
    fireEvent.change(campo(dialog, 'Empleado *'), { target: { value: 'pe-luis' } })
    fireEvent.change(campo(dialog, 'Área donde se almacena'), { target: { value: 'a-recepcion' } })
    fireEvent.change(campo(dialog, 'Ubicación exacta'), { target: { value: 'Gaveta 2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as [string, Record<string, unknown>]
    expect(tabla).toBe('objetos_perdidos')
    expect(payload).toMatchObject({
      company_id: 'co1', project_id: 'p1', estado: 'en_custodia', registrado_por: 'u1',
      descripcion: 'Celular Samsung negro', fotos: ['p1/objetos-perdidos/llaves.jpg'],
      area_encontrado_id: 'a-piscina', lugar_encontrado: 'Piscina',
      encontrado_por_tipo: 'personal', encontrado_por_personal_id: 'pe-luis', encontrado_por_contacto: null,
      custodio_personal_id: 'pe-ana', area_almacenamiento_id: 'a-recepcion', almacenamiento_detalle: 'Gaveta 2',
    })
    // El nombre del empleado lo pone el servidor desde la ficha.
    expect(payload).not.toHaveProperty('encontrado_por_nombre')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('un tercero exige su nombre; se guarda con su contacto y sin empleado', async () => {
    renderTab()
    const dialog = abrirRegistro()
    fireEvent.change(campo(dialog, 'Descripción *'), { target: { value: 'Cartera café' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: /Un tercero/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Escribe el nombre de quien lo encontró.' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.change(campo(dialog, 'Nombre de quien lo encontró *'), { target: { value: ' María Gómez ' } })
    fireEvent.change(campo(dialog, 'Contacto'), { target: { value: 'Casa 12' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0][1]).toMatchObject({
      encontrado_por_tipo: 'tercero', encontrado_por_personal_id: null, encontrado_por_nombre: 'María Gómez', encontrado_por_contacto: 'Casa 12',
    })
  })

  it('sin personal activo arranca en «tercero»; sin áreas activas ofrece ir al tab Áreas', () => {
    const onIrATab = vi.fn()
    renderTab({ personal: [], areas: [GARITA_VIEJA], onIrATab })
    const dialog = abrirRegistro()
    expect(within(dialog).getByRole('radio', { name: /Un tercero/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crearlas en el tab Áreas' }))
    expect(onIrATab).toHaveBeenCalledWith('areas_config')
  })

  it('editar un registro legado conserva su lugar escrito a mano mientras no se elija un área', async () => {
    const legado = objeto({
      id: 'o9', area_encontrado_id: null, lugar_encontrado: 'Junto al ascensor', encontrado_por_tipo: null, encontrado_por_personal_id: null,
      encontrado_por_nombre: null, custodio_personal_id: null, custodio_nombre: null, area_almacenamiento_id: null, almacenamiento_detalle: null, fotos: [],
    })
    renderTab({ objetos: [legado] })
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar objeto' })
    expect(within(dialog).getByText('Lugar anotado antes: «Junto al ascensor». Elige el área para vincularlo.')).toBeTruthy()
    fireEvent.change(campo(dialog, 'Nombre de quien lo encontró *'), { target: { value: 'Conserje' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [, id, payload] = mocks.updateCondominioRow.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(id).toBe('o9')
    expect(payload).toMatchObject({ area_encontrado_id: null, lugar_encontrado: 'Junto al ascensor' })
    // Editar no cambia el estado ni quién lo registró.
    expect(payload).not.toHaveProperty('estado')
    expect(payload).not.toHaveProperty('registrado_por')
  })
})

describe('ObjetosTab — entrega al propietario con firma', () => {
  it('pide nombre completo de quien recibe; sube la firma y DESPUÉS lo marca entregado', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: 'Entregar Llaves con llavero rojo al propietario' }))
    const dialog = screen.getByRole('dialog', { name: 'Entregar al propietario' })
    expect(within(dialog).getByText('👤 Ana López · 📦 Recepción · Gaveta 2')).toBeTruthy()

    fireEvent.change(campo(dialog, 'Nombre de quien recibe *'), { target: { value: 'Pedro' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar entrega' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.uploadCondominiosMedia).not.toHaveBeenCalled()

    fireEvent.change(campo(dialog, 'Nombre de quien recibe *'), { target: { value: ' Pedro Ramírez ' } })
    fireEvent.change(campo(dialog, 'Documento de identificación'), { target: { value: '1234 56789 0101' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar entrega' }))

    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledTimes(1))
    expect(mocks.orden).toEqual(['subir', 'entregar'])
    const [path, , opciones] = mocks.uploadCondominiosMedia.mock.calls[0] as [string, File, Record<string, unknown>]
    expect(path).toMatch(/^p1\/objetos-perdidos\/firmas\/\d+-[a-z0-9]+-firma\.png$/)
    expect(opciones).toMatchObject({ contentType: 'image/png', upsert: false })
    expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledWith('objetos_perdidos', 'o1', {
      estado: 'reclamado', reclamado_por: 'Pedro Ramírez', entrega_documento: '1234 56789 0101',
      fecha_reclamo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), firma_entrega_path: path,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('si la firma no sube, no se marca entregado y se avisa', async () => {
    mocks.uploadCondominiosMedia.mockResolvedValueOnce({ data: null, error: 'Sin conexión' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Entregar Llaves con llavero rojo al propietario' }))
    const dialog = screen.getByRole('dialog', { name: 'Entregar al propietario' })
    fireEvent.change(campo(dialog, 'Nombre de quien recibe *'), { target: { value: 'Pedro Ramírez' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar entrega' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect(mocks.updateCondominioRowAfectando).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Entregar al propietario' })).toBeTruthy()
  })

  it('un objeto entregado muestra quién recibió, quién entregó y la firma; ya no se entrega ni se edita', () => {
    const entregado = objeto({
      estado: 'reclamado', reclamado_por: 'Pedro Ramírez', entrega_documento: '1234', fecha_reclamo: '2026-10-30',
      firma_entrega_path: 'p1/objetos-perdidos/firmas/1-a-firma.png', entregado_en: '2026-10-30T16:05:00Z',
      entregado_por: 'u1', entregado_por_nombre: 'Admin Uno',
    })
    renderTab({ objetos: [entregado] })
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'reclamado' } })
    expect(screen.queryByRole('button', { name: /al propietario/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ver Llaves con llavero rojo' }))
    const dialog = screen.getByRole('dialog', { name: 'Llaves con llavero rojo' })
    expect(within(dialog).getByText('Pedro Ramírez')).toBeTruthy()
    expect(within(dialog).getByText('Admin Uno')).toBeTruthy()
    expect(within(dialog).getByText('Luis Pérez')).toBeTruthy()
    expect(within(dialog).getByRole('img', { name: 'Firma de recibido' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '✍ Entregar' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('sin permiso de edición no se ofrece entregar', () => {
    renderTab({ canEdit: false })
    expect(screen.queryByRole('button', { name: /al propietario/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver Llaves con llavero rojo' }))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '✍ Entregar' })).toBeNull()
  })
})
