// Sección finanzas (supabase/rls-acciones/finanzas.json): cada pestaña ofrece
// una acción sólo con el permiso que la base exige para ella.
//
//   · Eliminar exige canDelete (condominios.tab.<tab>.delete): editar no
//     basta, y sin editar sí se borra. Antes lo decidía canEdit —o nada, en
//     Cuotas, Tarifas y Fondo de reserva— y la base sólo dejaba borrar a
//     company_owner/admin. En Cuotas y Fondo de reserva el borrado es una baja
//     lógica (softDelete).
//   · «Cerrar definitivamente» un año exige canEdit, y Envío masivo registra
//     sus envíos sólo con canCreate: antes no pedían ningún permiso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type {
  AvisoCobro, CajaChica, CampanaCobro, CierreAnual, CierreMensual, CuotaCondominio, FondoReserva, MovimientoCaja,
  PlanPagoCond, PlantillaCuota, PlantillaMensajeCond, Proforma, TarifaCondominio, Unidad,
} from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  softDelete: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: vi.fn(async () => ({ data: null, error: null })),
  updateCondominioRow: mocks.updateCondominioRow,
  updateCondominioRowsByIds: vi.fn(async () => ({ error: null })),
  upsertCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: mocks.deleteCondominioRow,
  marcarCuotasMorosas: vi.fn(async () => ({ error: null })),
  cerrarCicloCuotas: vi.fn(async () => ({ data: null, error: null })),
}))
vi.mock('../../../../lib/softDelete', () => ({ softDelete: mocks.softDelete }))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  countRecibosByProyecto: vi.fn(async () => 0),
  fetchCuotasPlanPago: vi.fn(async () => []),
}))
vi.mock('../../../../domain/condominios/queries', () => ({ useCuotasPorProyectoConEstadoQuery: () => ({ data: [] }) }))
vi.mock('../../../../domain/facturacion/mutations', () => ({ useReglasMoraConfigQuery: () => ({ data: [] }) }))
vi.mock('../../../../domain/condominios/mutations', () => {
  const mutacion = () => ({ mutateAsync: vi.fn(), isPending: false })
  return { useEmitirCuotaMutation: mutacion, usePagarCuotaMutation: mutacion, useAnularCuotaMutation: mutacion }
})
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [] }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [] }) }))
vi.mock('../../../proveedores/OperacionesLegadoPanel', () => ({ OperacionesLegadoPanel: () => null }))
vi.mock('../../../proveedores/ProveedorSelector', () => ({ ProveedorSelector: () => null }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../../exportUtils', () => ({ exportarPDFTabla: vi.fn(), exportarExcel: vi.fn(), exportarPDFRecibo: vi.fn() }))

const { AvisosCobroTab } = await import('../AvisosCobroTab')
const { default: CampanasCobroTab } = await import('../CampanasCobroTab')
const { CierresMensualesTab } = await import('../CierresMensualesTab')
const { CuotasTab } = await import('../CuotasTab')
const { FondoReservaTab } = await import('../FondoReservaTab')
const { CajaChicaTab } = await import('../CajaChicaTab')
const { PlanPagoCondTab } = await import('../PlanPagoCondTab')
const { default: PlantillasCuotaTab } = await import('../PlantillasCuotaTab')
const { PresupuestoTab } = await import('../PresupuestoTab')
const { default: ProformasTab } = await import('../ProformasTab')
const { TarifasTab } = await import('../TarifasTab')
const { default: CierreAnualTab } = await import('../CierreAnualTab')
const { default: EnvioMasivoTab } = await import('../EnvioMasivoTab')

const conQuery = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const base = { proyectoId: 'p1', companyId: 'co1', moneda: 'Q', onRefresh: () => {} }
const como = <T,>(o: Record<string, unknown>) => o as unknown as T
const creado = { created_at: '2026-10-10T00:00:00Z' }

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

eliminarExigeSuPermiso('Avisos de cobro', p => render(
  <AvisosCobroTab {...base} unidades={unidades} canCreate {...p}
    avisos={[como<AvisoCobro>({ id: 'av1', unidad_id: 'un1', tipo: 'recordatorio', estado: 'emitido', fecha_emision: '2026-10-01', detalle: [], monto_total: 100, ...creado })]} />,
), /^Eliminar aviso de Casa 4$/, mocks.deleteCondominioRow, 'avisos_cobro', 'av1')

eliminarExigeSuPermiso('Campañas de cobro', p => {
  render(<CampanasCobroTab {...base} unidades={unidades} cuotas={[]} autorNombre="Admin" canCreate {...p}
    campanas={[como<CampanaCobro>({ id: 'ca1', nombre: 'Campaña octubre', canal: 'whatsapp', estado: 'borrador', destinatarios: 'morosos', mensaje: 'Hola', ...creado })]} />)
  fireEvent.click(screen.getByText('Campaña octubre'))
}, /Eliminar$/, mocks.deleteCondominioRow, 'campanas_cobro', 'ca1')

eliminarExigeSuPermiso('Cierres mensuales', p => render(
  <CierresMensualesTab {...base} cuotas={[]} gastos={[]} canCreate {...p}
    cierres={[como<CierreMensual>({ id: 'ci1', periodo: '2026-09', estado: 'abierto', total_cuotas_emitidas: 0, total_cuotas_cobradas: 0, total_gastos: 0, saldo: 0, saldo_periodo: 0, ...creado })]} />,
), /^Eliminar cierre$/, mocks.deleteCondominioRow, 'cierres_mensuales', 'ci1')

eliminarExigeSuPermiso('Cuotas (baja lógica)', p => conQuery(
  <CuotasTab {...base} unidades={unidades} proyectos={[]} canCreate {...p}
    cuotas={[como<CuotaCondominio>({ id: 'cu1', unidad_id: 'un1', unidad_nombre: 'Casa 4', concepto: 'Mantenimiento', periodo: '2026-10', monto: 100, estado: 'pendiente', fecha_vencimiento: '2099-10-10', ...creado })]} />,
), /^Eliminar$/, mocks.softDelete, 'cuotas_condominio', { id: 'cu1' })

eliminarExigeSuPermiso('Fondo de reserva (baja lógica)', p => render(
  <FondoReservaTab {...base} canCreate {...p}
    movimientos={[como<FondoReserva>({ id: 'fr1', tipo: 'aporte', estado: 'aprobado', concepto: 'Aporte inicial', monto: 500, fecha: '2026-10-01', ...creado })]} />,
), /^Eliminar Aporte inicial$/, mocks.softDelete, 'fondo_reserva_condominio', { id: 'fr1' })

eliminarExigeSuPermiso('Caja chica (movimientos)', p => {
  render(<CajaChicaTab {...base} canCreate {...p}
    cajas={[como<CajaChica>({ id: 'cj1', fecha_apertura: '2026-10-01', monto_inicial: 1000, responsable: 'Ana Pérez', estado: 'abierta', ...creado })]}
    movimientos={[como<MovimientoCaja>({ id: 'm1', caja_id: 'cj1', tipo: 'egreso', concepto: 'Papelería', monto: 150, fecha: '2026-10-05', ...creado })]} />)
  fireEvent.click(screen.getByRole('button', { name: /^Ana Pérez/ }))
}, /^Eliminar movimiento Papelería$/, mocks.deleteCondominioRow, 'movimientos_caja', 'm1')

eliminarExigeSuPermiso('Planes de pago', p => render(
  <PlanPagoCondTab {...base} unidades={unidades} canCreate {...p}
    planes={[como<PlanPagoCond>({ id: 'pp1', unidad_id: 'un1', concepto: 'Deuda 2025', monto_total: 1200, num_cuotas: 12, monto_cuota: 100, fecha_inicio: '2026-01-01', estado: 'activo', ...creado })]} />,
), /^Eliminar plan Deuda 2025$/, mocks.deleteCondominioRow, 'planes_pago_condominio', 'pp1')

eliminarExigeSuPermiso('Plantillas de cuota', p => render(
  <PlantillasCuotaTab {...base} unidades={unidades} canCreate {...p}
    plantillas={[como<PlantillaCuota>({ id: 'pc1', nombre: 'Mantenimiento mensual', concepto: 'mantenimiento', monto: 100, dia_vencimiento: 5, periodicidad: 'mensual', aplica_a: 'todas', activa: true, rubros: [], ...creado })]} />,
), /^Eliminar Mantenimiento mensual$/, mocks.deleteCondominioRow, 'plantillas_cuota', 'pc1')

eliminarExigeSuPermiso('Presupuesto', p => render(
  <PresupuestoTab {...base} gastos={[]} canCreate {...p}
    presupuestos={[como<Record<string, unknown>>({ id: 'pr1', categoria: 'mantenimiento', anio: new Date().getFullYear(), monto_presupuestado: 1000, ...creado })] as never} />,
), /^Eliminar presupuesto de Mantenimiento$/, mocks.deleteCondominioRow, 'presupuesto_condominio', 'pr1')

eliminarExigeSuPermiso('Proformas', p => {
  conQuery(<ProformasTab {...base} proveedores={[]} canCreate {...p}
    proformas={[como<Proforma>({ id: 'pf1', concepto: 'Pintura de fachada', proveedor: 'Pinturas SA', monto: 900, estado: 'borrador', fecha: '2026-10-01', items: [], ...creado })]} />)
  fireEvent.click(screen.getByText('Pintura de fachada'))
}, /^Eliminar Pintura de fachada$/, mocks.deleteCondominioRow, 'proformas_condominio', 'pf1')

eliminarExigeSuPermiso('Tarifas', p => render(
  <TarifasTab {...base} canCreate {...p}
    tarifas={[como<TarifaCondominio>({ id: 'ta1', concepto: 'Cuota de mantenimiento', monto: 100, periodicidad: 'mensual', tipo_unidad: 'casa', activo: true, vigente_desde: '2026-01-01', ...creado })]} />,
), /^Eliminar Cuota de mantenimiento$/, mocks.deleteCondominioRow, 'tarifas_condominio', 'ta1')

describe('Cierre anual — cerrar definitivamente exige canEdit', () => {
  const borrador = como<CierreAnual>({
    id: 'ca1', anio: 2025, estado: 'borrador', total_ingresos: 1000, total_egresos: 500, saldo: 500,
    total_cuotas_generadas: 10, total_cuotas_cobradas: 8, tasa_recaudacion: 80, unidades_morosas: 1, monto_mora_total: 100, ...creado,
  })
  const montar = (canEdit: boolean) => {
    render(<CierreAnualTab {...base} cuotas={[]} gastos={[]} autorNombre="Admin" cierres={[borrador]} canCreate={false} canEdit={canEdit} />)
    fireEvent.click(screen.getAllByText(/2025/)[0])
  }
  it('sin canEdit no se ofrece', () => {
    montar(false)
    expect(screen.queryByRole('button', { name: /Cerrar definitivamente/ })).toBeNull()
  })
  it('con canEdit cierra el año', async () => {
    montar(true)
    fireEvent.click(screen.getByRole('button', { name: /Cerrar definitivamente/ }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('cierres_anuales', 'ca1', expect.objectContaining({ estado: 'cerrado' })))
  })
})

describe('Envío masivo — registrar el envío exige canCreate', () => {
  const plantilla = como<PlantillaMensajeCond>({ id: 'pm1', nombre: 'Aviso general', canal: 'whatsapp', categoria: 'general', cuerpo: 'Hola {{unidad}}', activa: true, ...creado })
  const montar = (canCreate: boolean) => {
    render(<EnvioMasivoTab {...base} plantillas={[plantilla]} cuotas={[]} unidades={unidades} reservas={[]} proyectoNombre="Torre A" canCreate={canCreate} />)
    fireEvent.click(screen.getByText('Aviso general'))
    fireEvent.click(screen.getByText(/Ver vista previa/))
  }
  it('sin canCreate la vista previa no ofrece enviar', () => {
    montar(false)
    expect(screen.queryByRole('button', { name: /Enviar a/ })).toBeNull()
  })
  it('con canCreate registra el envío', async () => {
    montar(true)
    fireEvent.click(screen.getByRole('button', { name: /Enviar a 1 unidades/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('notificaciones_enviadas', expect.any(Array)))
  })
})
