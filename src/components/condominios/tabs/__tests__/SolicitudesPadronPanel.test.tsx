// Cola de autorización de mascotas y vehículos en el panel admin
// (20261101000000). Reglas de la UI:
//   1. Solo lista lo que vino del portal (con cliente_id); lo que cargó el staff
//      no es una "solicitud".
//   2. Aprobar un vehículo lleva el TAG de ingreso a la RPC; rechazar exige
//      motivo (la RPC también lo exige).
//   3. Sin permiso de edición no hay botones de resolución.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import type { Mascota, Unidad, VehiculoResidente } from '../../../../types'

const h = vi.hoisted(() => ({
  prompt: vi.fn<(o: unknown) => Promise<Record<string, string> | null>>(),
  resolverMascota: vi.fn(async () => ({ error: null as string | null })),
  resolverVehiculo: vi.fn(async () => ({ error: null as string | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn() }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: h.prompt }))
vi.mock('../../../../domain/condominios/padronAutorizacion', () => ({
  resolverMascota: h.resolverMascota,
  resolverVehiculo: h.resolverVehiculo,
  asignarTagVehiculo: vi.fn(),
}))

const { SolicitudesMascotasPanel, SolicitudesVehiculosPanel } = await import('../SolicitudesPadronPanel')

const base = { company_id: 'c1', project_id: 'p1', unidad_id: 'u1', created_at: '2026-10-01T00:00:00Z' }
const unidades = [{ id: 'u1', nombre: 'Apto 1D' }] as unknown as Unidad[]

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('SolicitudesVehiculosPanel', () => {
  const vehiculos = [
    { ...base, id: 'v-p', placa: 'P-123ABC', tipo: 'auto', activo: false, estado: 'pendiente', cliente_id: 'cli-1', fecha_solicitud: '2026-10-15T10:00:00Z' },
    // Cargado por el staff: no es solicitud del portal.
    { ...base, id: 'v-s', placa: 'P-999ZZZ', tipo: 'auto', activo: true, estado: 'aprobada', cliente_id: null },
  ] satisfies VehiculoResidente[]

  it('lista solo lo enviado desde el portal', () => {
    render(<SolicitudesVehiculosPanel vehiculos={vehiculos} unidades={unidades} canEdit onRefresh={() => {}} />)
    expect(screen.getByText('P-123ABC')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(screen.queryByText('P-999ZZZ')).toBeNull()
  })

  it('aprobar lleva el TAG de ingreso a la RPC', async () => {
    const onRefresh = vi.fn()
    h.prompt.mockResolvedValueOnce({ tag_codigo: ' TG-0153 ', tag_tipo: 'rfid', comentario: '' })
    render(<SolicitudesVehiculosPanel vehiculos={vehiculos} unidades={unidades} canEdit onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /P-123ABC/ }))
    fireEvent.click(screen.getByRole('button', { name: /Autorizar y asignar TAG/ }))
    await act(async () => {})
    expect(h.resolverVehiculo).toHaveBeenCalledWith({ id: 'v-p', aprobar: true, comentario: null, tagCodigo: 'TG-0153', tagTipo: 'rfid' })
    expect(onRefresh).toHaveBeenCalled()
  })

  it('rechazar pide motivo; si se cancela no llama a la RPC', async () => {
    h.prompt.mockResolvedValueOnce(null)
    render(<SolicitudesVehiculosPanel vehiculos={vehiculos} unidades={unidades} canEdit onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /P-123ABC/ }))
    fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }))
    await act(async () => {})
    expect(h.resolverVehiculo).not.toHaveBeenCalled()

    h.prompt.mockResolvedValueOnce({ comentario: ' Placa no coincide con la tarjeta ' })
    fireEvent.click(screen.getByRole('button', { name: /Rechazar/ }))
    await act(async () => {})
    expect(h.resolverVehiculo).toHaveBeenCalledWith(expect.objectContaining({ id: 'v-p', aprobar: false, comentario: 'Placa no coincide con la tarjeta' }))
  })

  it('sin permiso de edición no ofrece resolver', () => {
    render(<SolicitudesVehiculosPanel vehiculos={vehiculos} unidades={unidades} canEdit={false} onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /P-123ABC/ }))
    expect(screen.queryByRole('button', { name: /Autorizar/ })).toBeNull()
  })
})

describe('SolicitudesMascotasPanel', () => {
  it('muestra vacunas y aprueba por RPC', async () => {
    const mascotas = [{
      ...base, id: 'm-p', nombre: 'Toby', especie: 'perro', activo: false, estado: 'pendiente', cliente_id: 'cli-1',
      vacunas: [{ tipo: 'Rabia (antirrábica)', fecha: '2026-01-10' }],
    }] satisfies Mascota[]
    h.prompt.mockResolvedValueOnce({ comentario: '' })
    render(<SolicitudesMascotasPanel mascotas={mascotas} unidades={unidades} canEdit onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Toby/ }))
    expect(screen.getByText('Rabia (antirrábica)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Autorizar/ }))
    await act(async () => {})
    expect(h.resolverMascota).toHaveBeenCalledWith('m-p', true, null)
  })
})
