// Sección operaciones (supabase/rls-acciones/operaciones.json): Eliminar se
// ofrece y se ejecuta con canDelete (condominios.tab.<tab>.delete), lo mismo
// que exige la base. Editar no basta, y sin editar sí se borra. Antes lo
// decidía canEdit y la base sólo dejaba borrar a company_owner/admin.
// Contratos de proveedores, que vive en components/proveedores, se prueba en
// proveedoresUI.test.tsx con la misma regla.
import { vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
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
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: () => null, useSignedUrls: () => ({}) }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../../../domain/cxp/queries', () => ({ useProveedoresQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/queries', () => ({ useAsignacionesQuery: () => ({ data: [], isLoading: false }) }))
vi.mock('../../../../domain/proveedores/contratosCompras', () => ({ useOrdenesProveedorProyectoQuery: () => ({ data: [], isLoading: false }) }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { InventarioTab } = await import('../InventarioTab')
const { PrestamoEquiposTab } = await import('../PrestamoEquiposTab')
const { GarantiasEquipoTab } = await import('../GarantiasEquipoTab')
const { EvaluacionProveedorTab } = await import('../EvaluacionProveedorTab')
const { default: ProyectosCondominioTab } = await import('../ProyectosCondominioTab')
const { ObrasTab } = await import('../ObrasTab')
const { BitacoraManto } = await import('../BitacoraManto')

const conI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>)
const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
/** Una fila de prueba: sólo los campos que la pestaña lee. */
const fila = (o: Record<string, unknown>) => ({ company_id: 'co1', project_id: 'p1', created_at: '2026-10-10T00:00:00Z', ...o }) as never
const borrar = mocks.deleteCondominioRow

// jsdom dice navigator.language = 'en-US': se fija el español, que es lo que ve el staff.
beforeEach(() => {
  localStorage.setItem('at:locale', 'es')
  Object.values(mocks).forEach(m => m.mockClear())
})
afterEach(cleanup)

eliminarExigeSuPermiso('Inventario', p => conI18n(
  <InventarioTab {...base} moneda="Q" areas={[]} puedeConfigurarAreas={false} onIrATab={() => {}} canCreate {...p}
    inventario={[fila({ id: 'iv1', nombre: 'Escalera', categoria: 'herramienta', estado: 'disponible', cantidad: 1, cantidad_minima: 0, unidad_medida: 'unidad' })]} />,
), /^(Eliminar|Delete)$/, borrar, 'inventario_condominio', 'iv1')

eliminarExigeSuPermiso('Préstamos de equipo', p => render(
  <PrestamoEquiposTab {...base} unidades={[]} canCreate {...p}
    prestamos={[fila({ id: 'pe1', equipo_nombre: 'Taladro', cantidad: 1, fecha_prestamo: '2026-10-01', estado: 'prestado', deposito_pagado: false })]} />,
), /^Eliminar préstamo$/, borrar, 'prestamos_equipo', 'pe1')

eliminarExigeSuPermiso('Garantías', p => conI18n(
  <GarantiasEquipoTab {...base} moneda="Q" canCreate {...p}
    garantias={[fila({ id: 'ga1', equipo: 'Bomba de agua', estado: 'vigente', fecha_vencimiento: '2099-01-01' })]} />,
), /^(Eliminar|Delete)$/, borrar, 'garantias_equipo', 'ga1')

eliminarExigeSuPermiso('Evaluación de proveedores', p => render(
  <EvaluacionProveedorTab {...base} proveedores={[]} canCreate {...p}
    evaluaciones={[fila({ id: 'ev1', nombre_proveedor: 'Aguas del Norte', calificacion: 4, puntualidad: 4, calidad: 5, precio: 3, cumplimiento: 4, comunicacion: 5, evaluado_por: 'Ana', fecha: '2026-10-01' })]} />,
), /^Eliminar evaluación$/, borrar, 'evaluaciones_proveedor', 'ev1')

eliminarExigeSuPermiso('Proyectos', p => {
  render(<ProyectosCondominioTab {...base} moneda="Q" canCreate {...p}
    proyectos={[fila({ id: 'pc1', nombre: 'Pintar fachada', categoria: 'mejora', estado: 'en_progreso', porcentaje_avance: 40 })]} />)
  fireEvent.click(screen.getByText('Pintar fachada'))
}, /^Eliminar Pintar fachada$/, borrar, 'proyectos_condominio', 'pc1')

eliminarExigeSuPermiso('Obras', p => render(
  <ObrasTab {...base} moneda="Q" canCreate {...p}
    obras={[fila({ id: 'ob1', titulo: 'Techo del salón', estado: 'en_ejecucion', progreso: 30 })]} />,
), /^Eliminar Techo del salón$/, borrar, 'obras_mejoras', 'ob1')

eliminarExigeSuPermiso('Bitácora de mantenimiento', p => render(
  <BitacoraManto {...base} canCreate {...p}
    registros={[fila({ id: 'bm1', fecha: '2026-10-05', turno: 'mañana', responsable: 'Luis', tareas: [], firmado: false })]} />,
), /^Eliminar registro del 2026-10-05$/, borrar, 'bitacora_manto', 'bm1')
