// País de procedencia del huésped en la pestaña STR de Condominios: el mismo
// dato (`reservas_str.huesped_pais`, ISO alfa-2) que captura Manejo de Rentas.
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ReservaSTR } from '../../../../types'

const m = vi.hoisted(() => ({
  crear: vi.fn(async (_t: string, _p: Record<string, unknown>) => ({ data: { id: 'n1' }, error: null })),
  actualizar: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null })),
  notify: vi.fn(),
}))
vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  createCondominioRowReturning: m.crear,
  updateCondominioRow: m.actualizar,
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowsByIds: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchHuespedesByReservas: vi.fn(async () => []),
  fetchVisitantesActivosByReservas: vi.fn(async () => []),
}))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => ({}) }))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null, MultiImageUploader: () => null }))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(async () => ({ isConfirmed: true })), notify: m.notify }))
vi.mock('../ImportarReservasSTRModal', () => ({ ImportarReservasSTRModal: () => null }))

const { STRTab } = await import('../STRTab')

const reserva = (o: Partial<ReservaSTR>) => ({
  id: 'r1', company_id: 'co1', project_id: 'p1', unidad_id: null, huesped_nombre: 'John Smith', huesped_email: null, huesped_telefono: null,
  fecha_entrada: '2027-03-01', fecha_salida: '2027-03-04', num_adultos: 2, num_ninos: 0, num_bebes: 0, plataforma: 'airbnb',
  estado: 'confirmada', mascotas: false, created_at: '2026-10-10T00:00:00Z', ...o,
}) as ReservaSTR

const montar = (reservas: ReservaSTR[] = []) => render(
  <STRTab reservasSTR={reservas} unidades={[]} proyectoId="p1" companyId="co1" moneda="Q" canCreate canEdit canDelete onRefresh={() => {}} />,
)
const pais = () => screen.getByLabelText('País de procedencia') as HTMLInputElement

beforeEach(() => { Object.values(m).forEach(f => f.mockClear()) })
afterEach(cleanup)

describe('STR · país de procedencia', () => {
  it('la tarjeta muestra bandera y país sólo cuando la reserva lo tiene', () => {
    montar([reserva({ huesped_pais: 'US' }), reserva({ id: 'r2', huesped_nombre: 'Ana Pérez', huesped_pais: null })])
    expect(screen.getByText('🇺🇸 Estados Unidos')).toBeTruthy()
    expect(screen.getAllByText(/Estados Unidos/)).toHaveLength(1)
  })

  it('una reserva nueva guarda el código del país elegido en el buscador', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Nueva Reserva/ }))
    fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Eva Ruiz' } })
    const fechas = document.querySelectorAll('input[type="date"]')
    fireEvent.change(fechas[1], { target: { value: '2027-04-01' } })
    fireEvent.change(fechas[2], { target: { value: '2027-04-03' } })
    fireEvent.focus(pais())
    fireEvent.change(pais(), { target: { value: 'guat' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /Guatemala/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(1))
    expect(m.crear.mock.calls[0][0]).toBe('reservas_str')
    expect(m.crear.mock.calls[0][1]).toMatchObject({ huesped_nombre: 'Eva Ruiz', huesped_pais: 'GT' })
  })

  it('editar carga el país guardado; quitarlo lo guarda vacío', async () => {
    montar([reserva({ huesped_pais: 'US' })])
    fireEvent.click(screen.getByRole('button', { name: 'Editar la reserva de John Smith' }))
    expect(pais().value).toBe('🇺🇸 Estados Unidos')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar país' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(m.actualizar).toHaveBeenCalledTimes(1))
    expect(m.actualizar.mock.calls[0][2]).toMatchObject({ huesped_pais: null })
  })

  it('sin tocar el país, una reserva nueva lo manda vacío', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /Nueva Reserva/ }))
    fireEvent.change(screen.getByPlaceholderText('Nombre completo'), { target: { value: 'Eva Ruiz' } })
    const fechas = document.querySelectorAll('input[type="date"]')
    fireEvent.change(fechas[1], { target: { value: '2027-04-01' } })
    fireEvent.change(fechas[2], { target: { value: '2027-04-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(m.crear).toHaveBeenCalledTimes(1))
    expect(m.crear.mock.calls[0][1]).toMatchObject({ huesped_pais: null })
  })
})
