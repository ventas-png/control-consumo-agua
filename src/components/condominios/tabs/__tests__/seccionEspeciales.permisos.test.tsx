// Casos especiales (supabase/rls-acciones/especiales.json): Eliminar se ofrece
// y se ejecuta con canDelete (condominios.tab.<tab>.delete), lo mismo que exige
// la base. Editar no basta, y sin editar sí se borra. Antes Arrendamientos y
// Paquetería ofrecían Eliminar a quien sólo veía la pestaña, Renta corta,
// Gastos y Reglas de mora lo decidían con canEdit, y la base sólo dejaba
// borrar a company_owner/admin. Pausar una regla de mora es editarla.
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowsByIds: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  deleteCondominioRowsByIds: mocks.deleteCondominioRowsByIds,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchHuespedesByReservas: vi.fn(async () => []),
  fetchVisitantesActivosByReservas: vi.fn(async () => []),
}))
vi.mock('../../../../domain/presupuesto/queries', () => ({ usePartidaEstadoQuery: () => ({ data: undefined }) }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/compras/queries', () => ({ useDuplicadoProbableQuery: () => ({ data: undefined }) }))
vi.mock('../../../../domain/shared/storage', () => ({ uploadCondominiosMedia: vi.fn() }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => ({}) }))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null, MultiImageUploader: () => null }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { ArrendamientosTab } = await import('../ArrendamientosTab')
const { STRTab } = await import('../STRTab')
const { ContabilidadTab } = await import('../ContabilidadTab')
const { default: ReglasMoraTab } = await import('../ReglasMoraTab')
const { PaqueteriaTab } = await import('../PaqueteriaTab')
const { PaqueteriaSalientesTab } = await import('../PaqueteriaSalientesTab')

const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
/** Una fila de prueba: sólo los campos que la pestaña lee. */
const fila = (o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-10T00:00:00Z', ...o }) as never
const borrar = mocks.deleteCondominioRow

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

eliminarExigeSuPermiso('Arrendamientos', p => render(
  <ArrendamientosTab {...base} moneda="Q" canCreate {...p} unidades={[]}
    contratos={[fila({ id: 'ca1', arrendatario_nombre: 'Lucía Pérez', unidad_id: 'u1', unidad_nombre: 'A-101',
      monto_renta: 3500, dia_pago: 5, fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', estado: 'activo' })]} />,
), /^Eliminar Lucía Pérez$/, borrar, 'contratos_arrendamiento', 'ca1')

eliminarExigeSuPermiso('Renta corta', p => render(
  <STRTab {...base} moneda="Q" canCreate {...p} unidades={[]}
    reservasSTR={[fila({ id: 'rs1', huesped_nombre: 'Marta Ruiz', unidad_id: 'u1', unidad_nombre: 'A-101',
      fecha_entrada: '2026-11-01', fecha_salida: '2026-11-03', num_adultos: 2, num_ninos: 0, num_bebes: 0,
      plataforma: 'directo', estado: 'confirmada', mascotas: false })]} />,
), /^Eliminar la reserva de Marta Ruiz$/, borrar, 'reservas_str', 'rs1')

eliminarExigeSuPermiso('Gastos', p => render(
  <ContabilidadTab {...base} moneda="Q" canCreate {...p}
    gastos={[fila({ id: 'g1', concepto: 'Jardinería', categoria: 'otros', monto: 500, fecha: '2026-10-01', estado: 'pendiente' })]} />,
), /^Eliminar Jardinería$/, borrar, 'gastos_condominio', 'g1')

const regla = fila({ id: 'rm1', nombre: 'Recargo 5 %', dias_vencimiento: 30, tipo: 'porcentaje', valor: 5,
  aplicar_sobre: 'saldo', periodo_gracia: 0, activa: true })

eliminarExigeSuPermiso('Reglas de mora', p => render(
  <ReglasMoraTab {...base} moneda="Q" canCreate {...p} reglas={[regla]} />,
), /^Eliminar Recargo 5 %$/, borrar, 'reglas_mora_config', 'rm1')

describe('Reglas de mora — Pausar exige canEdit', () => {
  it('sólo consulta: no hay Pausar', () => {
    render(<ReglasMoraTab {...base} moneda="Q" canCreate={false} canEdit={false} canDelete={false} reglas={[regla]} />)
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull()
  })
  it('con editar: Pausar actualiza la regla', async () => {
    render(<ReglasMoraTab {...base} moneda="Q" canCreate={false} canEdit canDelete={false} reglas={[regla]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('reglas_mora_config', 'rm1', { activa: false }))
  })
})

// Eliminar vive en el detalle del paquete: se abre antes de buscarlo, así la
// prueba sin permiso no pasa sola por no haber abierto la ventana.
eliminarExigeSuPermiso('Paquetería', p => {
  render(
    <PaqueteriaTab {...base} userId="u1" canCreate {...p} puedeVerCorrespondencia={false} unidades={[]} correspondencia={[]}
      paquetes={[fila({ id: 'pq1', clase: 'paquete', direccion: 'entrante', tipo: 'paquete', descripcion: 'Caja de Amazon',
        estado: 'pendiente', unidad_id: 'u1', unidad_nombre: 'A-101', hora_recepcion: '2026-10-10T10:00:00Z' })]} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ver Caja de Amazon' }))
  expect(screen.getByRole('dialog', { name: /Caja de Amazon/ })).toBeTruthy()
}, /^Eliminar Caja de Amazon$/, borrar, 'paquetes_recibidos', 'pq1')

eliminarExigeSuPermiso('Paquetería — salientes', p => {
  render(
    <PaqueteriaSalientesTab {...base} userId="u1" canCreate {...p} unidades={[]}
      paquetes={[fila({ id: 'ps1', clase: 'paquete', direccion: 'saliente_tercero', tipo: 'paquete', descripcion: 'Llaves del depósito',
        estado: 'pendiente', unidad_id: 'u1', unidad_nombre: 'A-101', autorizado_nombre: 'Juan', codigo_retiro: 'ABC123',
        hora_recepcion: '2026-10-10T10:00:00Z' })]} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Ver Llaves del depósito' }))
  expect(screen.getByRole('dialog', { name: /Llaves del depósito/ })).toBeTruthy()
}, /^Eliminar Llaves del depósito$/, borrar, 'paquetes_recibidos', 'ps1')
