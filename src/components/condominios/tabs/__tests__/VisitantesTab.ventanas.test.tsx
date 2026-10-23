// Visitantes: el registro de entrada, la renta corta, la mudanza, el detalle y
// la salida pasan de ventanas hechas a mano a la ventana común (pantalla
// completa en el teléfono, Esc, no se cierran mientras guardan). Además: un
// toque fuera ya no descarta el registro a medio capturar, el detalle lee el
// registro vigente, si la novedad de salida falla la salida no se reescribe al
// reintentar, y lo que acompaña a una entrada o salida avisa si falla.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import type { HuespedSTR, ReservaSTR, Unidad, Visitante } from '../../../../types'

type Err = { message: string } | null

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  updateCondominioRow: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  updateCondominioRowsByIds: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  validatedInsert: vi.fn(async (..._a: unknown[]) => ({ data: [{ id: 'vNuevo' }] as unknown[] | null, error: null as Err })),
  validatedInsertMany: vi.fn(async (..._a: unknown[]) => ({ error: null as Err })),
  fetchHuespedesByReservas: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => [] }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  updateCondominioRowsByIds: mocks.updateCondominioRowsByIds,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({ fetchHuespedesByReservas: mocks.fetchHuespedesByReservas }))
vi.mock('../../../../lib/validatedInsert', () => ({ validatedInsert: mocks.validatedInsert, validatedInsertMany: mocks.validatedInsertMany }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn() }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null, ImageUploader: () => null }))

const { VisitantesTab } = await import('../VisitantesTab')

const unidades = [{ id: 'u1', nombre: 'Apto. 2A', activo: true }] as unknown as Unidad[]

function visitante(over: Partial<Visitante>): Visitante {
  return {
    id: 'v1', company_id: 'co1', project_id: 'p1', unidad_id: 'u1', unidad_nombre: 'Apto. 2A', nombre: 'Marta López',
    identificacion: '1234', placa_vehiculo: null, motivo: 'Social', notas: null, hora_entrada: '2026-10-23T15:00:00Z',
    hora_salida: null, created_at: '2026-10-23T15:00:00Z',
    ...over,
  } as Visitante
}

function props(over: Partial<Parameters<typeof VisitantesTab>[0]> = {}): Parameters<typeof VisitantesTab>[0] {
  return {
    visitantes: [], unidades, reservasSTR: [], solicitudesMudanza: [], proyectoId: 'p1', companyId: 'co1', userId: 'usr-1',
    canCreate: true, onRefresh: vi.fn(), ...over,
  }
}

function esperar<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0))
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRowsByIds.mockResolvedValue({ error: null })
  mocks.validatedInsert.mockResolvedValue({ data: [{ id: 'vNuevo' }], error: null })
  mocks.fetchHuespedesByReservas.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

// Primero: React avisa de las claves una sola vez por componente, así que esta
// prueba tiene que ver la primera lista que se dibuja.
describe('Visitantes — la lista', () => {
  it('no se queja de claves repetidas', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<VisitantesTab {...props({ visitantes: [visitante({}), visitante({ id: 'v3', nombre: 'Pedro Gil' })] })} />)
    expect(error.mock.calls.some(c => String(c[0]).includes('unique "key"'))).toBe(false)
    error.mockRestore()
  })
})

describe('Visitantes — registrar la entrada en ventana', () => {
  it('a pantalla completa; un toque fuera no la cierra; mientras guarda tampoco Esc', async () => {
    const onRefresh = vi.fn()
    render(<VisitantesTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar visita' }))
    const ventana = screen.getByRole('dialog', { name: 'Registrar visitante' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Nombre completo *'), { target: { value: 'Juan Pérez' } })
    fireEvent.change(screen.getByLabelText('Unidad a visitar *'), { target: { value: 'u1' } })
    // Un toque en el fondo descartaba todo lo capturado; ya no cierra.
    fireEvent.click(ventana)
    expect((screen.getByLabelText('Nombre completo *') as HTMLInputElement).value).toBe('Juan Pérez')

    const guardado = esperar<{ data: unknown[]; error: null }>()
    mocks.validatedInsert.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar entrada/ }))
    await waitFor(() => expect(mocks.validatedInsert).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: 'Registrar visitante' })).toBeTruthy()

    await act(async () => { guardado.resolver({ data: [{ id: 'vNuevo' }], error: null }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('si no se vincula al huésped pre-registrado, la entrada queda y lo avisa', async () => {
    const reserva = { id: 'r1', unidad_id: 'u1', unidad_nombre: 'Apto. 2A', estado: 'confirmada', fecha_entrada: '2026-10-20', fecha_salida: '2026-10-28',
      huesped_nombre: 'Familia Ruiz', plataforma: 'airbnb', num_adultos: 2, num_ninos: 0 } as unknown as ReservaSTR
    const huesped: HuespedSTR = { id: 'h1', reserva_str_id: 'r1', nombre: 'Ana Ruiz', identificacion: '999', es_menor: false, created_at: '' }
    mocks.fetchHuespedesByReservas.mockResolvedValue([huesped])
    render(<VisitantesTab {...props({ reservasSTR: [reserva] })} />)

    fireEvent.click(screen.getByRole('button', { name: '🏠 Renta corta' }))
    const str = screen.getByRole('dialog', { name: '🏠 Registrar ingreso STR' })
    expect(str.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.click(await within(str).findByRole('button', { name: 'Registrar ingreso' }))
    const ventana = screen.getByRole('dialog', { name: 'Registrar visitante' })
    expect((screen.getByLabelText('Nombre completo *') as HTMLInputElement).value).toBe('Ana Ruiz')

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'permiso denegado' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar entrada/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', title: 'Entrada registrada con pendientes',
      text: expect.stringContaining('no se vinculó al huésped pre-registrado (permiso denegado)'),
    })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('huespedes_str', 'h1', { visitante_id: 'vNuevo' })
  })
})

describe('Visitantes — salida y detalle', () => {
  it('si la novedad de salida falla, la ventana sigue y reintentar no reescribe la salida', async () => {
    const onRefresh = vi.fn()
    render(<VisitantesTab {...props({ onRefresh, visitantes: [visitante({})] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida de Marta López' }))
    const ventana = screen.getByRole('dialog', { name: 'Registrar salida' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.click(within(ventana).getByRole('button', { name: /Con novedad/ }))
    fireEvent.change(screen.getByLabelText('Comentarios / descripción *'), { target: { value: 'Rayó el portón' } })

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'sin red' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar salida y novedad/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error al registrar novedad', text: 'La salida quedó registrada, pero la novedad no: sin red',
    })))
    expect(onRefresh).toHaveBeenCalled()
    expect((screen.getByLabelText('Comentarios / descripción *') as HTMLTextAreaElement).value).toBe('Rayó el portón')
    const [, , primera] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, { hora_salida: string }]

    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar salida y novedad/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // La hora de salida se escribió una sola vez; la novedad, dos (la segunda guardó).
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)
    expect(mocks.createCondominioRow).toHaveBeenCalledTimes(2)
    expect((mocks.createCondominioRow.mock.calls[1] as unknown as [string, { descripcion: string }])[1].descripcion)
      .toContain(`Salida: ${new Date(primera.hora_salida).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
  })

  it('si la salida de los acompañantes falla, lo avisa', async () => {
    render(<VisitantesTab {...props({ visitantes: [visitante({}), visitante({ id: 'v2', nombre: 'Leo López', visitante_principal_id: 'v1' })] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida de Marta López' }))
    const ventana = screen.getByRole('dialog', { name: 'Registrar salida' })
    fireEvent.click(within(ventana).getByRole('button', { name: /Sin novedad/ }))
    mocks.updateCondominioRowsByIds.mockResolvedValueOnce({ error: { message: 'sin red' } })
    fireEvent.click(within(ventana).getByRole('button', { name: '✓ Confirmar salida' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', text: 'Los acompañantes siguen en premisas: sin red',
    })))
    expect(mocks.updateCondominioRowsByIds).toHaveBeenCalledWith('visitantes', ['v2'], expect.anything())
  })

  it('tocar la tarjeta abre el detalle, que se actualiza al registrarse la salida', () => {
    const { rerender, container } = render(<VisitantesTab {...props({ visitantes: [visitante({})] })} />)
    fireEvent.click(within(container).getByText('Marta López'))
    const detalle = screen.getByRole('dialog', { name: 'Marta López' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('🟢 En premisas')).toBeTruthy()
    expect(within(detalle).getByRole('button', { name: 'Registrar salida' })).toBeTruthy()

    rerender(<VisitantesTab {...props({ visitantes: [visitante({ hora_salida: '2026-10-23T17:00:00Z' })] })} />)
    expect(within(screen.getByRole('dialog', { name: 'Marta López' })).getByText('Ya salió')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Registrar salida' })).toBeNull()
  })
})
