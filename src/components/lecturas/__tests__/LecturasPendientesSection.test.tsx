// La página de lecturas pendientes: lista lo que no se pudo leer en ruta con
// su motivo y evidencia, y desde ahí se retoma (una o todas) o se descarta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Cliente, Contador, Proyecto, Registro, Ruta, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  fetchLecturasOmitidas: vi.fn(),
  descartarLecturaOmitida: vi.fn(),
  openTextPrompt: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: (v: string | null) => (v ? `https://firmada/${v}` : null) }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn() }))
vi.mock('../../shared/PromptDialog', () => ({ openTextPrompt: h.openTextPrompt }))
vi.mock('../../../domain/agua/lecturasOmitidas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../domain/agua/lecturasOmitidas')>()),
  fetchLecturasOmitidas: h.fetchLecturasOmitidas,
  descartarLecturaOmitida: h.descartarLecturaOmitida,
}))

const { LecturasPendientesSection } = await import('../LecturasPendientesSection')
const { queryClient } = await import('../../../domain/queryClient')

const unidades = [
  { id: 'un-b', nombre: 'Casa 10', project_id: 'p1', activo: true, cliente_id: 'cl-1' },
  { id: 'un-a', nombre: 'Casa 2', project_id: 'p1', activo: true, cliente_id: null },
  { id: 'un-c', nombre: 'Bodega', project_id: 'p1', activo: true, cliente_id: null },
] as unknown as Unidad[]
const contadores = [
  { id: 'c-b', numero_serie: 'VSC3-282', unidad_id: 'un-b', tipo_agua: 'potable', activo: true },
  { id: 'c-a', numero_serie: 'VSC3-002', unidad_id: 'un-a', tipo_agua: 'potable', activo: true },
] as unknown as Contador[]
const clientes = [{ id: 'cl-1', nombre: 'Jackelin Aguja' }] as unknown as Cliente[]
const rutas = [{ id: 'r1', nombre: 'Lectura Mensual VSC' }] as unknown as Ruta[]
const proyectos = [{ id: 'p1', nombre: 'Villas' }] as unknown as Proyecto[]

const base = {
  company_id: 'co', project_id: 'p1', ruta_id: 'r1', detalle: null, foto_path: null, gps: null,
  omitida_por: 'u1', omitida_por_nombre: 'Lector Uno', estado: 'pendiente', registro_id: null,
  cerrada_at: null, cerrada_por: null, nota_cierre: null,
}
const pendientes = [
  { ...base, id: 'o-b', unidad_id: 'un-b', contador_id: 'c-b', motivo: 'acceso_obstruido', detalle: 'Carro encima',
    foto_path: 'p1/f.jpg', gps: { lat: 14.58, lng: -90.49 }, omitida_at: '2026-11-20T15:00:00Z' },
  { ...base, id: 'o-a', unidad_id: 'un-a', contador_id: 'c-a', motivo: 'propiedad_cerrada', omitida_at: '2026-11-24T15:00:00Z' },
  { ...base, id: 'o-c', unidad_id: 'un-c', contador_id: null, motivo: 'riesgo_seguridad', ruta_id: null, omitida_at: '2026-11-24T16:00:00Z' },
]

function montar(over: { canTomar?: boolean; canDescartar?: boolean; onRecorrer?: (r: Ruta) => void } = {}) {
  const onRecorrer = over.onRecorrer ?? vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <LecturasPendientesSection
        unidades={unidades} contadores={contadores} clientes={clientes} rutas={rutas}
        proyectos={proyectos} registros={[] as Registro[]} onRecorrer={onRecorrer}
        canTomar={over.canTomar ?? true} canDescartar={over.canDescartar ?? true}
      />
    </QueryClientProvider>,
  )
  return onRecorrer
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  h.fetchLecturasOmitidas.mockImplementation(async (estado: string) => ({
    data: estado === 'pendiente' ? pendientes : [], error: null,
  }))
})
afterEach(() => cleanup())

describe('Lecturas pendientes', () => {
  it('lista cada pendiente con unidad, cliente, contador, motivo, detalle y evidencia, en orden de unidad', async () => {
    montar()
    const filas = await screen.findAllByTestId('lectura-pendiente')
    expect(filas.map(f => within(f).getByText(/^(Casa|Bodega)/).textContent)).toEqual(['Bodega', 'Casa 2', 'Casa 10'])
    const casa10 = filas[2]
    expect(casa10.textContent).toContain('Jackelin Aguja')
    expect(casa10.textContent).toContain('VSC3-282 (potable)')
    expect(casa10.textContent).toContain('Contador obstruido')
    expect(casa10.textContent).toContain('“Carro encima”')
    expect(casa10.textContent).toContain('Ruta Lectura Mensual VSC')
    expect(within(casa10).getByRole('img', { name: 'Evidencia' }).getAttribute('src')).toBe('https://firmada/p1/f.jpg')
    expect(within(casa10).getByRole('link', { name: 'ubicación' }).getAttribute('href')).toContain('14.58,-90.49')
    expect(filas[0].textContent).toContain('Sin contador')
  })

  it('«Tomar lectura» arranca una ruta de un solo contador', async () => {
    const onRecorrer = montar()
    const filas = await screen.findAllByTestId('lectura-pendiente')
    fireEvent.click(within(filas[2]).getByRole('button', { name: /Tomar lectura/ }))
    expect(onRecorrer).toHaveBeenCalledWith(expect.objectContaining({
      tipo_ruta: 'contadores', contador_ids: ['c-b'], nombre: 'Pendiente: Casa 10',
    }))
    // Una unidad sin contador no se puede «tomar»: sólo descartar.
    expect(within(filas[0]).queryByRole('button', { name: /Tomar lectura/ })).toBeNull()
  })

  it('«Recorrer pendientes» lleva todas las que tienen contador, en orden de unidad', async () => {
    const onRecorrer = montar()
    fireEvent.click(await screen.findByRole('button', { name: /Recorrer pendientes \(2\)/ }))
    expect(onRecorrer).toHaveBeenCalledWith(expect.objectContaining({ contador_ids: ['c-a', 'c-b'] }))
  })

  it('descartar pide un motivo y vuelve a cargar la lista', async () => {
    h.openTextPrompt.mockResolvedValue('  Unidad deshabitada ')
    h.descartarLecturaOmitida.mockResolvedValue({ error: null })
    montar()
    const filas = await screen.findAllByTestId('lectura-pendiente')
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(h.descartarLecturaOmitida).toHaveBeenCalledWith('o-c', 'Unidad deshabitada'))
    await waitFor(() => expect(h.fetchLecturasOmitidas.mock.calls.filter(c => c[0] === 'pendiente').length).toBeGreaterThan(1))
  })

  it('sin permisos no ofrece acciones', async () => {
    montar({ canTomar: false, canDescartar: false })
    await screen.findAllByTestId('lectura-pendiente')
    expect(screen.queryByRole('button', { name: /Tomar lectura|Descartar|Recorrer/ })).toBeNull()
  })

  it('sin pendientes lo dice', async () => {
    h.fetchLecturasOmitidas.mockResolvedValue({ data: [], error: null })
    montar()
    expect(await screen.findByText('No hay lecturas pendientes')).toBeTruthy()
  })

  it('las resueltas muestran cuándo y con qué lectura', async () => {
    h.fetchLecturasOmitidas.mockImplementation(async (estado: string) => ({
      data: estado === 'resuelta'
        ? [{ ...pendientes[0], estado: 'resuelta', registro_id: 'reg-1', cerrada_at: '2026-11-25T10:00:00Z' }]
        : pendientes,
      error: null,
    }))
    render(
      <QueryClientProvider client={queryClient}>
        <LecturasPendientesSection
          unidades={unidades} contadores={contadores} clientes={clientes} rutas={rutas} proyectos={proyectos}
          registros={[{ id: 'reg-1', lectura_actual: 655 }] as unknown as Registro[]}
          onRecorrer={vi.fn()} canTomar canDescartar
        />
      </QueryClientProvider>,
    )
    await screen.findAllByTestId('lectura-pendiente')
    fireEvent.click(screen.getByRole('radio', { name: /Resueltas/ }))
    await waitFor(() => expect(screen.getByTestId('lectura-pendiente').textContent).toMatch(/Leída el .* · lectura 655/))
    expect(screen.queryByRole('button', { name: /Tomar lectura/ })).toBeNull()
  })
})
