// «Saltar unidad» en ruta: el lecturista no pudo leer la parada, deja motivo y
// foto, y la ruta sigue. La parada saltada cuenta como atendida en esta vuelta
// (una recarga no vuelve a ella) y queda en «Lecturas pendientes».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Cliente, Contador, Registro, Ruta, Tarifa, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  omitirLectura: vi.fn(),
  subirFotoOmision: vi.fn(),
  borrarFotoOmision: vi.fn(),
  registrarLectura: vi.fn(),
  markRutaCompletada: vi.fn(),
  completeRelevantOcurrencia: vi.fn(),
  confirm: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/PermissionsContext', () => ({
  usePermissionsContext: () => ({ canEdit: () => true, canDelete: () => true, canCreate: () => true }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: h.confirm }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../domain/agua/mutations', () => ({ registrarLectura: h.registrarLectura, uploadRegistroFoto: vi.fn() }))
vi.mock('../../../domain/rutas/mutations', () => ({
  completeRelevantOcurrencia: h.completeRelevantOcurrencia, markRutaCompletada: h.markRutaCompletada,
}))
vi.mock('../../../domain/agua/lecturasOmitidas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../domain/agua/lecturasOmitidas')>()),
  omitirLectura: h.omitirLectura,
  subirFotoOmision: h.subirFotoOmision,
  borrarFotoOmision: h.borrarFotoOmision,
}))
vi.mock('../../../lib/nativeGeo', () => ({ watchLocation: () => () => {} }))
vi.mock('../../../lib/platform', () => ({ isNative: () => false }))
vi.mock('../../../domain/agua/historialLecturas', () => ({ fetchHistorialLecturas: vi.fn(async () => []) }))

const { LecturasSection } = await import('../LecturasSection')
const { localStorageRutaEnCurso, iniciarRutaEnCurso, leerRutaEnCurso } = await import('../../../lib/rutaEnCurso')
const { rutaDePendientes } = await import('../../../lib/lecturasOmitidasReglas')

const tarifa = { id: 't-1', nombre: 'Residencial', precio_m3: 5, canon_fijo: 0, consumo_minimo: 0, activa: true } as unknown as Tarifa
const unidades = [
  { id: 'un-1', nombre: 'Casa 1', project_id: 'p1', activo: true, cliente_id: null },
  { id: 'un-2', nombre: 'Casa 2', project_id: 'p1', activo: true, cliente_id: null },
  { id: 'un-3', nombre: 'Casa 3', project_id: 'p1', activo: true, cliente_id: null },
] as unknown as Unidad[]
// Casa 1 tiene dos contadores; las demás, uno.
const contadores = [
  ['c-1a', 'un-1'], ['c-1b', 'un-1'], ['c-2', 'un-2'], ['c-3', 'un-3'],
].map(([id, unidad_id]) => ({
  id, numero_serie: id.toUpperCase(), unidad_id, tarifa_id: 't-1', project_id: 'p1',
  lectura_inicial: 100, activo: true, tipo_agua: 'potable',
})) as unknown as Contador[]

const rutaUnidades = {
  id: 'ruta-u', nombre: 'Casas', tipo_ruta: 'unidades', unidad_ids: ['un-1', 'un-2', 'un-3'],
  cliente_ids: [], contador_ids: [], completada: false, created_at: '2026-11-01',
} as unknown as Ruta

const store = localStorageRutaEnCurso()

function montar(ruta: Ruta) {
  return render(
    <LecturasSection
      clientes={[] as Cliente[]} unidades={unidades} contadores={contadores} registros={[] as Registro[]}
      tarifas={[tarifa]} onRegistroAdded={() => {}} rutaActiva={ruta}
    />,
  )
}

function abrirSalto() {
  fireEvent.click(screen.getAllByRole('button', { name: /Saltar unidad/ })[0])
  return screen.getByRole('dialog')
}

function elegirMotivoYFoto() {
  fireEvent.click(screen.getByLabelText(/Contador obstruido/))
  fireEvent.change(screen.getByLabelText('Foto de evidencia'), {
    target: { files: [new File(['jpg'], 'carro.jpg', { type: 'image/jpeg' })] },
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  h.confirm.mockResolvedValue({ isConfirmed: false })
  h.subirFotoOmision.mockResolvedValue({ path: 'p1/evidencia.jpg', error: null })
  h.omitirLectura.mockResolvedValue({ data: [], error: null })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => cleanup())

describe('Nueva Lectura — saltar una parada de la ruta', () => {
  it('pide motivo y foto antes de saltar', async () => {
    iniciarRutaEnCurso(store, 'ruta-u', 'user-1', Date.now())
    montar(rutaUnidades)
    await screen.findByText(/Unidad 1 de 3/)
    abrirSalto()
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Elija el motivo por el que no se pudo leer.')
    fireEvent.click(screen.getByLabelText(/Contador obstruido/))
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    expect(screen.getByRole('alert').textContent).toMatch(/foto/)
    expect(h.omitirLectura).not.toHaveBeenCalled()
  })

  it('guarda la omisión de los contadores de la unidad y pasa a la siguiente parada', async () => {
    iniciarRutaEnCurso(store, 'ruta-u', 'user-1', Date.now())
    montar(rutaUnidades)
    await screen.findByText(/Unidad 1 de 3/)
    expect(abrirSalto().textContent).toContain('Contadores C-1A, C-1B')
    elegirMotivoYFoto()
    fireEvent.change(screen.getByLabelText('Detalle'), { target: { value: 'Pick-up sobre la caja' } })
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))

    expect(await screen.findByText(/Unidad 2 de 3/)).toBeTruthy()
    expect(h.subirFotoOmision).toHaveBeenCalledWith('p1', expect.any(File))
    expect(h.omitirLectura).toHaveBeenCalledWith({
      unidadId: 'un-1', contadorIds: ['c-1a', 'c-1b'], rutaId: 'ruta-u',
      motivo: 'acceso_obstruido', detalle: 'Pick-up sobre la caja', fotoPath: 'p1/evidencia.jpg', gps: null,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    // Atendidos en esta vuelta: una recarga no vuelve a Casa 1.
    expect(leerRutaEnCurso(store, Date.now())).toMatchObject({ index: 1, leidos: ['c-1a', 'c-1b'] })
  })

  it('sólo salta los contadores de la unidad que faltan por leer', async () => {
    iniciarRutaEnCurso(store, 'ruta-u', 'user-1', Date.now())
    h.registrarLectura.mockResolvedValue({ data: { id: 'reg', consumo: 5, monto_calculado: 25, estado: 'pendiente', fecha: '2026-11-25' }, error: null })
    // «Sí, registrar» el otro contador pendiente de la unidad… y entonces no se puede.
    h.confirm.mockResolvedValueOnce({ isConfirmed: false }).mockResolvedValueOnce({ isConfirmed: true })
    montar(rutaUnidades)
    await screen.findByText(/Unidad 1 de 3/)
    fireEvent.change(screen.getByLabelText('Seleccionar Contador'), { target: { value: 'c-1a' } })
    fireEvent.change(screen.getByLabelText('Lectura Actual'), { target: { value: '110' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar y Avanzar/ }))
    await waitFor(() => expect((screen.getByLabelText('Seleccionar Contador') as HTMLSelectElement).value).toBe('c-1b'))

    expect(abrirSalto().textContent).toContain('Contador C-1B')
    elegirMotivoYFoto()
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    await screen.findByText(/Unidad 2 de 3/)
    expect(h.omitirLectura).toHaveBeenCalledWith(expect.objectContaining({ unidadId: 'un-1', contadorIds: ['c-1b'] }))
  })

  it('si el servidor la rechaza, no avanza y borra la foto subida', async () => {
    iniciarRutaEnCurso(store, 'ruta-u', 'user-1', Date.now())
    h.omitirLectura.mockResolvedValue({ data: null, error: 'No tiene acceso a este proyecto' })
    montar(rutaUnidades)
    await screen.findByText(/Unidad 1 de 3/)
    abrirSalto()
    elegirMotivoYFoto()
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    await waitFor(() => expect(h.borrarFotoOmision).toHaveBeenCalledWith('p1/evidencia.jpg'))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'No tiene acceso a este proyecto' }))
    expect(screen.getByText(/Unidad 1 de 3/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('sin señal no intenta guardar: avisa y se queda en la parada', async () => {
    iniciarRutaEnCurso(store, 'ruta-u', 'user-1', Date.now())
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    montar(rutaUnidades)
    await screen.findByText(/Unidad 1 de 3/)
    abrirSalto()
    elegirMotivoYFoto()
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sin conexión' })))
    expect(h.subirFotoOmision).not.toHaveBeenCalled()
    expect(h.omitirLectura).not.toHaveBeenCalled()
  })

  it('saltar la última parada cierra la ruta', async () => {
    iniciarRutaEnCurso(store, 'ruta-u', 'user-1', Date.now())
    montar({ ...rutaUnidades, unidad_ids: ['un-2'] } as Ruta)
    await screen.findByText(/Unidad 1 de 1/)
    abrirSalto()
    elegirMotivoYFoto()
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    await waitFor(() => expect(h.markRutaCompletada).toHaveBeenCalledWith('ruta-u'))
    expect(leerRutaEnCurso(store, Date.now())).toBeNull()
  })

  it('una ruta de pendientes no se marca en la base y sus omisiones van sin ruta', async () => {
    const ruta = rutaDePendientes([{ contador_id: 'c-2' }], 'Pendientes')!
    iniciarRutaEnCurso(store, ruta.id, 'user-1', Date.now(), ruta)
    montar(ruta)
    await screen.findByText(/Unidad 1 de 1/)
    abrirSalto()
    elegirMotivoYFoto()
    fireEvent.click(screen.getByRole('button', { name: /Saltar y continuar/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pendientes recorridas' })))
    expect(h.omitirLectura).toHaveBeenCalledWith(expect.objectContaining({ contadorIds: ['c-2'], rutaId: null }))
    expect(h.markRutaCompletada).not.toHaveBeenCalled()
    expect(h.completeRelevantOcurrencia).not.toHaveBeenCalled()
  })

  it('fuera de ruta no hay «Saltar unidad»', async () => {
    render(
      <LecturasSection
        clientes={[] as Cliente[]} unidades={unidades} contadores={contadores} registros={[] as Registro[]}
        tarifas={[tarifa]} onRegistroAdded={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Seleccionar Unidad'), { target: { value: 'un-2' } })
    fireEvent.change(screen.getByLabelText('Seleccionar Contador'), { target: { value: 'c-2' } })
    expect(screen.queryByRole('button', { name: /Saltar unidad/ })).toBeNull()
  })
})
