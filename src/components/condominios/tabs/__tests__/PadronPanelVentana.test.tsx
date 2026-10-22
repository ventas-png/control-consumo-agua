// Panel de condominios · Mascotas y Vehículos: el alta y la edición abren en
// ventana (EditModal) sobre la lista, en vez de desplegarse arriba de ella.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { Mascota, Unidad, VehiculoResidente } from '../../../../types'

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
vi.mock('../../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn() }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null }))
vi.mock('../../../../domain/condominios/padronAutorizacion', () => ({ asignarTagVehiculo: vi.fn() }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
}))

const { MascotasTab } = await import('../MascotasTab')
const { VehiculosTab } = await import('../VehiculosTab')
const { I18nProvider } = await import('../../../../lib/i18n')

const unidades = [{ id: 'u1', nombre: 'Apto 1D', activo: true }] as unknown as Unidad[]
const base = { company_id: 'c1', project_id: 'p1', unidad_id: 'u1', unidad_nombre: 'Apto 1D', created_at: '2026-10-01T00:00:00Z', estado: 'aprobada' as const, activo: true }

// jsdom dice navigator.language = 'en-US': se fija el español, que es lo que ve el staff.
beforeEach(() => localStorage.setItem('at:locale', 'es'))
afterEach(cleanup)

describe('MascotasTab (panel) — formulario en ventana', () => {
  it('el alta abre en ventana sobre la lista y Cancelar la cierra', () => {
    const mascotas = [{ ...base, id: 'm1', nombre: 'Luna', especie: 'gato' }] as Mascota[]
    render(<I18nProvider><MascotasTab mascotas={mascotas} unidades={unidades} proyectoId="p1" companyId="c1" canCreate canEdit onRefresh={() => {}} /></I18nProvider>)

    fireEvent.click(screen.getByRole('button', { name: '+ Registrar mascota' }))
    const ventana = screen.getByRole('dialog', { name: 'Registrar mascota' })
    expect(within(ventana).getByLabelText('Nombre *')).toBeTruthy()
    // La lista sigue montada detrás.
    expect(screen.getByText('Luna')).toBeTruthy()

    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('VehiculosTab (panel) — formulario en ventana', () => {
  it('Editar abre la ventana con los datos del vehículo', () => {
    const vehiculos = [{ ...base, id: 'v1', placa: 'P-111AAA', tipo: 'auto', marca: 'Toyota' }] as VehiculoResidente[]
    render(<I18nProvider><VehiculosTab vehiculos={vehiculos} unidades={unidades} proyectoId="p1" companyId="c1" canCreate canEdit onRefresh={() => {}} /></I18nProvider>)

    fireEvent.click(screen.getAllByRole('button', { name: /Editar/ })[0])
    const ventana = within(screen.getByRole('dialog', { name: 'Editar vehículo' }))
    expect((ventana.getByLabelText('Placa *') as HTMLInputElement).value).toBe('P-111AAA')
    expect((ventana.getByLabelText('Marca') as HTMLInputElement).value).toBe('Toyota')
  })
})
