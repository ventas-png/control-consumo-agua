// Una ruta de lecturas a medias sobrevive a una recarga de la app: se retoma en
// la parada donde iba, descontando las lecturas ya guardadas, en vez de volver
// a «Unidad 1 de N».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Cliente, Contador, Registro, Ruta, Tarifa, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  registrarLectura: vi.fn(),
  markRutaCompletada: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/PermissionsContext', () => ({
  usePermissionsContext: () => ({ canEdit: () => true, canDelete: () => true, canCreate: () => true }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: h.confirm }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../domain/agua/mutations', () => ({ registrarLectura: h.registrarLectura, uploadRegistroFoto: vi.fn() }))
vi.mock('../../../domain/rutas/mutations', () => ({ completeRelevantOcurrencia: vi.fn(), markRutaCompletada: h.markRutaCompletada }))
vi.mock('../../../lib/nativeGeo', () => ({ watchLocation: () => () => {} }))
vi.mock('../../../lib/platform', () => ({ isNative: () => false }))
vi.mock('../../../domain/agua/historialLecturas', () => ({ fetchHistorialLecturas: vi.fn(async () => []) }))

const { LecturasSection } = await import('../LecturasSection')
const { localStorageRutaEnCurso, iniciarRutaEnCurso, leerRutaEnCurso } = await import('../../../lib/rutaEnCurso')

// Como en el caso real: UNA unidad con varios contadores y la ruta va por contadores.
const unidad = { id: 'un-1', nombre: 'DAPH', project_id: 'p1', activo: true, cliente_id: null } as unknown as Unidad
const tarifa = { id: 't-1', nombre: 'Edificio 21B-T', precio_m3: 5, canon_fijo: 0, consumo_minimo: 0, activa: true } as unknown as Tarifa
const contadores = ['c-1', 'c-2', 'c-3'].map((id, i) => ({
  id, numero_serie: `21B-00${i + 1}`, unidad_id: 'un-1', tarifa_id: 't-1', project_id: 'p1',
  lectura_inicial: 100, activo: true, tipo_agua: 'potable',
})) as unknown as Contador[]
const ruta = {
  id: 'ruta-1', nombre: 'Lectura Mensual 21B', tipo_ruta: 'contadores',
  cliente_ids: [], unidad_ids: [], contador_ids: ['c-1', 'c-2', 'c-3'],
  completada: false, created_at: '2026-11-01',
} as unknown as Ruta

const store = localStorageRutaEnCurso()

function montar() {
  return render(
    <LecturasSection
      clientes={[] as Cliente[]} unidades={[unidad]} contadores={contadores} registros={[] as Registro[]}
      tarifas={[tarifa]} onRegistroAdded={() => {}} rutaActiva={ruta}
    />,
  )
}
const contadorElegido = () => (screen.getByLabelText('Seleccionar Contador') as HTMLSelectElement).value

async function guardarLectura(valor: string) {
  fireEvent.change(screen.getByLabelText('Lectura Actual'), { target: { value: valor } })
  fireEvent.click(screen.getByRole('button', { name: /Guardar y Avanzar/ }))
}

beforeEach(() => {
  localStorage.clear()
  h.registrarLectura.mockReset()
  h.registrarLectura.mockResolvedValue({ data: { id: 'reg', consumo: 5, monto_calculado: 25, estado: 'pendiente', fecha: '2026-11-24' }, error: null })
  h.markRutaCompletada.mockReset()
  h.confirm.mockReset()
  // «No, gracias» al WhatsApp y «No, siguiente parada» a los contadores pendientes.
  h.confirm.mockResolvedValue({ isConfirmed: false })
  iniciarRutaEnCurso(store, 'ruta-1', 'user-1', Date.now())
})
afterEach(() => cleanup())

describe('Nueva Lectura — ruta en curso', () => {
  it('arranca en la parada 1 con su contador ya seleccionado', async () => {
    montar()
    expect(await screen.findByText(/Unidad 1 de 3/)).toBeTruthy()
    await waitFor(() => expect(contadorElegido()).toBe('c-1'))
  })

  it('tras guardar avanza, y al recargar retoma en la parada siguiente', async () => {
    const primera = montar()
    await waitFor(() => expect(contadorElegido()).toBe('c-1'))
    await guardarLectura('110')
    expect(await screen.findByText(/Unidad 2 de 3/)).toBeTruthy()
    await waitFor(() => expect(contadorElegido()).toBe('c-2'))
    expect(leerRutaEnCurso(store, Date.now())).toMatchObject({ index: 1, leidos: ['c-1'] })

    // «Recarga»: el componente se desmonta y vuelve a montarse desde cero.
    primera.unmount()
    montar()
    expect(await screen.findByText(/Unidad 2 de 3/)).toBeTruthy()
    await waitFor(() => expect(contadorElegido()).toBe('c-2'))
  })

  it('si la recarga cae con la lectura ya guardada pero sin avanzar, no la repite', async () => {
    // Nunca responde el diálogo de WhatsApp: la app «se recarga» con él abierto.
    h.confirm.mockReturnValue(new Promise(() => {}))
    const primera = montar()
    await waitFor(() => expect(contadorElegido()).toBe('c-1'))
    await guardarLectura('110')
    await waitFor(() => expect(leerRutaEnCurso(store, Date.now())?.leidos).toEqual(['c-1']))
    expect(leerRutaEnCurso(store, Date.now())?.index).toBe(0)

    primera.unmount()
    montar()
    expect(await screen.findByText(/Unidad 2 de 3/)).toBeTruthy()
    await waitFor(() => expect(contadorElegido()).toBe('c-2'))
  })

  it('una lectura encolada sin conexión también avanza la ruta', async () => {
    h.registrarLectura.mockResolvedValue({ data: null, error: 'TypeError: Failed to fetch' })
    montar()
    await waitFor(() => expect(contadorElegido()).toBe('c-1'))
    await guardarLectura('110')
    expect(await screen.findByText(/Unidad 2 de 3/)).toBeTruthy()
    expect(screen.getByText(/1 lectura sin sincronizar/)).toBeTruthy()
  })

  it('«Detener Ruta» olvida el progreso; completarla también', async () => {
    const primera = montar()
    await waitFor(() => expect(contadorElegido()).toBe('c-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Detener Ruta' }))
    expect(leerRutaEnCurso(store, Date.now())).toBeNull()
    primera.unmount()

    iniciarRutaEnCurso(store, 'ruta-1', 'user-1', Date.now())
    montar()
    for (const [i, v] of ['110', '120', '130'].entries()) {
      await screen.findByText(new RegExp(`Unidad ${i + 1} de 3`))
      await waitFor(() => expect(contadorElegido()).toBe(`c-${i + 1}`))
      await guardarLectura(v)
    }
    await waitFor(() => expect(h.markRutaCompletada).toHaveBeenCalledWith('ruta-1'))
    expect(leerRutaEnCurso(store, Date.now())).toBeNull()
  })
})
