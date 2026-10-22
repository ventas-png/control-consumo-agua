// Sección residentes (supabase/rls-acciones/residentes.json): Eliminar se
// ofrece y se ejecuta con canDelete (condominios.tab.<tab>.delete), lo mismo
// que exige la base. Editar no basta, y sin editar sí se borra. Antes lo
// decidía canEdit —o nada, en el Historial de residentes— y la base sólo
// dejaba borrar a company_owner/admin.
import { vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Unidad } from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/padronAutorizacion', () => ({ asignarTagVehiculo: vi.fn() }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => ({}) }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { MascotasTab } = await import('../MascotasTab')
const { VehiculosTab } = await import('../VehiculosTab')
const { OnboardingTab } = await import('../OnboardingTab')
const { EntregaUnidadTab } = await import('../EntregaUnidadTab')
const { AccesosResTab } = await import('../AccesosResTab')
const { HistorialResidentesTab } = await import('../HistorialResidentesTab')
const { default: ManualResidenteTab } = await import('../ManualResidenteTab')

const conI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>)
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
/** Una fila de prueba: sólo los campos que la pestaña lee. */
const fila = (o: Record<string, unknown>) => ({ created_at: '2026-10-10T00:00:00Z', unidad_id: 'un1', unidad_nombre: 'Casa 4', ...o }) as never
const borrar = mocks.deleteCondominioRow

// jsdom dice navigator.language = 'en-US': se fija el español, que es lo que ve el staff.
beforeEach(() => {
  localStorage.setItem('at:locale', 'es')
  Object.values(mocks).forEach(m => m.mockClear())
})
afterEach(cleanup)

eliminarExigeSuPermiso('Mascotas', p => conI18n(
  <MascotasTab {...base} unidades={unidades} canCreate {...p}
    mascotas={[fila({ id: 'ma1', nombre: 'Luna', especie: 'gato', estado: 'aprobada', activo: true })]} />,
), /^(Eliminar|Delete)$/, borrar, 'mascotas', 'ma1')

eliminarExigeSuPermiso('Vehículos', p => conI18n(
  <VehiculosTab {...base} unidades={unidades} canCreate {...p}
    vehiculos={[fila({ id: 've1', placa: 'P-111AAA', tipo: 'auto', marca: 'Toyota', estado: 'aprobada', activo: true })]} />,
), /^(Eliminar|Delete)$/, borrar, 'vehiculos_residentes', 've1')

eliminarExigeSuPermiso('Onboarding', p => render(
  <OnboardingTab {...base} unidades={unidades} canCreate {...p}
    onboardings={[fila({ id: 'on1', nombre_residente: 'Ana Pérez', tipo: 'propietario', estado: 'en_proceso', fecha_ingreso: '2026-10-01' })]} />,
), /^Eliminar onboarding de Ana Pérez$/, borrar, 'onboarding_residentes', 'on1')

eliminarExigeSuPermiso('Entrega de unidades', p => {
  render(<EntregaUnidadTab {...base} unidades={unidades} canCreate {...p}
    entregas={[fila({ id: 'en1', tipo: 'entrega', fecha: '2026-10-01', condicion_general: 'bueno', inventario_items: [] })]} />)
  fireEvent.click(screen.getByText('Casa 4', { selector: 'div' }))
}, /^Eliminar entrega$/, borrar, 'entrega_unidades', 'en1')

eliminarExigeSuPermiso('Accesos de residentes', p => render(
  <AccesosResTab {...base} unidades={unidades} canCreate {...p}
    accesos={[fila({ id: 'ac1', tipo: 'tarjeta', identificador: 'TJ-0042', titular: 'Ana', activo: true, fecha_emision: '2026-10-01' })]} />,
), /^Eliminar acceso TJ-0042$/, borrar, 'accesos_residentes', 'ac1')

eliminarExigeSuPermiso('Historial de residentes', p => render(
  <HistorialResidentesTab {...base} unidades={unidades} canCreate {...p}
    historial={[fila({ id: 'hi1', nombre_completo: 'Ana Pérez', tipo: 'propietario', estado: 'activo', fecha_desde: '2025-01-01' })]} />,
), /^Eliminar Ana Pérez$/, borrar, 'historial_residentes', 'hi1')

eliminarExigeSuPermiso('Manual del residente', p => render(
  <ManualResidenteTab {...base} canCreate {...p}
    articulos={[fila({ id: 'mr1', seccion: 'normas', titulo: 'Horario de mudanzas', contenido: '8 a 17 h', orden: 1, activo: true })]} />,
), /^Eliminar$/, borrar, 'manual_residente_cond', 'mr1')
