// Sección seguridad (supabase/rls-acciones/seguridad.json): cada pestaña ofrece
// una acción sólo con el permiso que la base exige para ella.
//
//   · Eliminar exige canDelete (condominios.tab.<tab>.delete): editar no
//     basta, y sin editar sí se borra. Antes lo decidía canEdit y la base sólo
//     dejaba borrar a company_owner/admin.
//   · Control de accesos QR registra visitantes sólo con canCreate (antes lo
//     ignoraba: cualquiera que viera el tab registraba entradas y salidas).
//   · Publicar el informe mensual exige canCreate, como generarlo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  AlertaCondominio, ContactoEmergencia, InformeMensual, LocalComercial, ObjetoPerdido,
  RegistroResiduo, SolicitudConcierge, Unidad, Visitante, VisitaFrecuente,
} from '../../../../types'
import { eliminarExigeSuPermiso } from '../../../../test/eliminarExigeSuPermiso'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  upsertCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  validatedInsert: vi.fn(async () => ({ error: null, data: [] })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  upsertCondominioRow: mocks.upsertCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../lib/validatedInsert', () => ({ validatedInsert: mocks.validatedInsert }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../exportUtils', () => ({ exportarPDFInformeMensual: vi.fn() }))

const { I18nProvider } = await import('../../../../lib/i18n')
const { ObjetosTab } = await import('../ObjetosTab')
const { EmergenciasTab } = await import('../EmergenciasTab')
const { ResiduosTab } = await import('../ResiduosTab')
const { LocalesTab } = await import('../LocalesTab')
const { ConciergeTab } = await import('../ConciergeTab')
const { AlertasTab } = await import('../AlertasTab')
const { default: VisitasFrecuentesTab } = await import('../VisitasFrecuentesTab')
const { default: ControlAccesosQRTab } = await import('../ControlAccesosQRTab')
const { default: InformeMensualTab } = await import('../InformeMensualTab')

const conI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>)
const unidades = [{ id: 'un1', nombre: 'Casa 4', activo: true }] as unknown as Unidad[]
const base = { proyectoId: 'p1', companyId: 'co1', onRefresh: () => {} }
const como = <T,>(o: Record<string, unknown>) => o as unknown as T

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

eliminarExigeSuPermiso('Objetos perdidos', p => conI18n(
  <ObjetosTab {...base} userId="u1" canCreate {...p}
    objetos={[como<ObjetoPerdido>({ id: 'o1', descripcion: 'Llaves con llavero rojo', categoria: 'llaves', lugar_encontrado: 'Lobby', fecha_encontrado: '2026-10-10', estado: 'en_custodia', created_at: '2026-10-10T00:00:00Z' })]} />,
), /^(Eliminar|Delete)$/, mocks.deleteCondominioRow, 'objetos_perdidos', 'o1')

eliminarExigeSuPermiso('Emergencias', p => render(
  <EmergenciasTab {...base} canCreate {...p}
    contactos={[como<ContactoEmergencia>({ id: 'e1', nombre: 'Bomberos zona 10', tipo: 'bomberos', telefono: '122', activo: true, disponible_24h: true, orden: 1, created_at: '2026-10-10T00:00:00Z' })]} />,
), /^Eliminar Bomberos zona 10$/, mocks.deleteCondominioRow, 'contactos_emergencia', 'e1')

eliminarExigeSuPermiso('Residuos', p => render(
  <ResiduosTab {...base} userId="u1" canCreate {...p}
    residuos={[como<RegistroResiduo>({ id: 'rs1', fecha: '2026-10-10', tipo: 'reciclable', cantidad_kg: 12, estado: 'pendiente', created_at: '2026-10-10T00:00:00Z' })]} />,
), /^Eliminar registro$/, mocks.deleteCondominioRow, 'registros_residuos', 'rs1')

eliminarExigeSuPermiso('Locales comerciales', p => conI18n(
  <LocalesTab {...base} moneda="Q" canCreate {...p}
    locales={[como<LocalComercial>({ id: 'l1', numero: 'L-01', nombre_negocio: 'Farmacia', giro: 'comercio', estado: 'ocupado', created_at: '2026-10-10T00:00:00Z' })]} />,
), /^(Eliminar|Delete)$/, mocks.deleteCondominioRow, 'locales_comerciales', 'l1')

eliminarExigeSuPermiso('Concierge', p => render(
  <ConciergeTab {...base} moneda="Q" unidades={unidades} canCreate {...p}
    solicitudes={[como<SolicitudConcierge>({ id: 'c1', tipo: 'limpieza', descripcion: 'Limpieza profunda', fecha_solicitud: '2026-10-10', estado: 'pendiente', created_at: '2026-10-10T00:00:00Z' })]} />,
), /^Eliminar Limpieza profunda$/, mocks.deleteCondominioRow, 'solicitudes_concierge', 'c1')

eliminarExigeSuPermiso('Alertas', p => conI18n(
  <AlertasTab {...base} polizas={[]} contratos={[]} inspecciones={[]} llaves={[]} canCreate {...p}
    alertas={[como<AlertaCondominio>({ id: 'a1', tipo: 'aviso', titulo: 'Revisar extintores', fecha_alerta: '2026-10-30', estado: 'activa', created_at: '2026-10-10T00:00:00Z' })]} />,
), /^(Eliminar|Delete)$/, mocks.deleteCondominioRow, 'alertas_condominio', 'a1')

eliminarExigeSuPermiso('Visitas frecuentes', p => render(
  <VisitasFrecuentesTab {...base} unidades={unidades} canCreate {...p}
    visitas={[como<VisitaFrecuente>({ id: 'v1', unidad_id: 'un1', nombre: 'Ana Pérez', relacion: 'familiar', activo: true, dias_semana: [], created_at: '2026-10-10T00:00:00Z' })]} />,
), /^Eliminar Ana Pérez$/, mocks.deleteCondominioRow, 'visitas_frecuentes', 'v1')

describe('Control de accesos QR — registrar exige canCreate', () => {
  const dentro = como<Visitante>({
    id: 'q1', unidad_id: 'un1', unidad_nombre: 'Casa 4', nombre: 'Luis QR', qr_token: 'TOK123',
    valido_hasta: '2099-12-31', hora_entrada: '2026-10-20T10:00:00Z', hora_salida: null, created_at: '2026-10-20T09:00:00Z',
  })
  const montar = (canCreate: boolean) => render(
    <ControlAccesosQRTab {...base} unidades={unidades} visitantes={[dentro]} canCreate={canCreate} />,
  )
  const irAPreautorizados = () => fireEvent.click(screen.getByRole('button', { name: /Pre-autorizados \(1\)/ }))

  it('sin canCreate no se ofrece «Registrar salida»', () => {
    montar(false)
    irAPreautorizados()
    expect(screen.getByText('Luis QR')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Registrar salida' })).toBeNull()
  })

  it('con canCreate, «Registrar salida» marca la hora de salida', async () => {
    montar(true)
    irAPreautorizados()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('visitantes', 'q1', expect.objectContaining({ hora_salida: expect.any(String) })))
  })
})

describe('Informe mensual — publicar exige canCreate', () => {
  const informe = como<InformeMensual>({
    id: 'im1', periodo: '2026-09', estado: 'borrador', total_cuotas: 10, cuotas_pagadas: 8, cuotas_morosas: 2,
    total_recaudado: 8000, total_gastos: 5000, num_tickets: 3, tickets_resueltos: 2, num_visitantes: 40, num_incidentes: 0,
    created_at: '2026-10-01T00:00:00Z',
  })
  const montar = (canCreate: boolean) => render(
    <InformeMensualTab {...base} moneda="Q" autorNombre="Admin" cuotas={[]} gastos={[]} tickets={[]} visitantes={[]} incidentes={[]}
      informes={[informe]} canCreate={canCreate} />,
  )
  const abrir = () => {
    const fila = screen.queryAllByRole('button').find(b => (b.textContent ?? '').includes('2026-09'))
      ?? screen.getAllByText(/2026-09/)[0]
    fireEvent.click(fila)
  }

  it('sin canCreate no hay «Publicar informe»', () => {
    montar(false)
    abrir()
    expect(screen.queryByRole('button', { name: /Publicar informe/ })).toBeNull()
  })

  it('con canCreate se ofrece «Publicar informe»', () => {
    montar(true)
    abrir()
    expect(within(document.body).getByRole('button', { name: /Publicar informe/ })).toBeTruthy()
  })
})
