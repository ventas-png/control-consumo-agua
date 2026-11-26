// Portal de Condominios: lo que la empresa o el proyecto tiene apagado no se le
// ofrece al residente.
//   · una unidad de un proyecto sin Condominios (o de una empresa que no lo
//     contrata) no entra al portal de Condominios;
//   · Asambleas y Transparencia sólo aparecen si el plan de la empresa del
//     condominio las incluye, y entonces se ven sin «mejore su plan».
// Las pestañas se sustituyen por marcadores: aquí sólo se mira la barra y qué
// se monta, no el contenido de cada pestaña.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  marcador: (nombre: string) => function Marcador() { return <div data-testid={`tab-${nombre}`} /> },
  unidades: [] as Array<Record<string, unknown>>,
  proyectos: [] as Array<Record<string, unknown>>,
  plan: {} as Record<string, string[]>,
  planPedido: vi.fn(),
  datosPedidos: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: {}, db: {}, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn() }))
vi.mock('../../layout/NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('../../perfil/EliminarCuenta', () => ({ EliminarCuenta: () => null }))
vi.mock('../../shared/BrandLogo', () => ({ BrandLogo: () => null }))
vi.mock('../../../domain/portal/mutations', () => ({ confirmarPagoCuota: vi.fn() }))
vi.mock('../../../domain/portal/queries', () => ({
  fetchPortalUnidadesResidente: async () => h.unidades,
  fetchPortalPaymentConfig: async () => null,
  fetchPortalRecargoTarjeta: async () => [],
  marcarAnunciosLeidos: async () => undefined,
  fetchPortalFuncionesPlan: async (companyIds: string[], funciones: string[]) => {
    h.planPedido(companyIds, funciones)
    return h.plan
  },
  fetchCondominiosPortalData: async (projectIds: string[], unidadIds: string[]) => {
    h.datosPedidos(projectIds, unidadIds)
    return {
      projData: h.proyectos.filter(p => projectIds.includes(p.id as string)),
      amenidadesData: [], cuotasData: [], reservasData: [], bloqueosData: [], prestamosData: [],
      ticketsData: [], anunciosData: [], visitantesData: [], visitasFrecuentesData: [], mensajesData: [],
      solicitudesRentaData: [], paquetesData: [], correspondenciaData: [], comunicadosData: [],
      pestanasData: [],
    }
  },
}))

vi.mock('../../condominios/tabs/PortalMiUnidadTab', () => ({ PortalMiUnidadTab: h.marcador('mi_unidad') }))
vi.mock('../../condominios/tabs/PortalReservasTab', () => ({ PortalReservasTab: h.marcador('reservas') }))
vi.mock('../../condominios/tabs/PortalMiCuentaTab', () => ({ PortalMiCuentaTab: h.marcador('cuenta') }))
vi.mock('../PortalCargosSaldoFavor', () => ({ PortalCargosSaldoFavor: () => null }))
vi.mock('../../condominios/tabs/PortalMisTicketsTab', () => ({ PortalMisTicketsTab: h.marcador('tickets') }))
vi.mock('../../condominios/tabs/PortalVisitantesTab', () => ({ PortalVisitantesTab: h.marcador('visitantes') }))
vi.mock('../../condominios/tabs/PortalAnunciosTab', () => ({ PortalAnunciosTab: h.marcador('anuncios') }))
vi.mock('../../condominios/tabs/PortalRentasTab', () => ({ PortalRentasTab: h.marcador('rentas') }))
vi.mock('../../condominios/tabs/PortalMudanzaTab', () => ({ PortalMudanzaTab: h.marcador('mudanza') }))
vi.mock('../../condominios/tabs/PortalMascotasTab', () => ({ PortalMascotasTab: h.marcador('mascotas') }))
vi.mock('../../condominios/tabs/PortalVehiculosTab', () => ({ PortalVehiculosTab: h.marcador('vehiculos') }))
vi.mock('../../condominios/tabs/PortalPaquetesTab', () => ({ PortalPaquetesTab: h.marcador('paquetes') }))
vi.mock('../../condominios/tabs/PortalCorrespondenciaTab', () => ({ PortalCorrespondenciaTab: h.marcador('correspondencia') }))
vi.mock('../../condominios/tabs/PortalAsambleasTab', () => ({ PortalAsambleasTab: h.marcador('asambleas') }))
vi.mock('../../condominios/tabs/PortalTransparenciaTab', () => ({ PortalTransparenciaTab: h.marcador('transparencia') }))

import { CondominiosClientPortal } from '../CondominiosClientPortal'
import type { UserSession } from '../../../types'

const usuario = {
  user_id: 'user-1', email: 'res@example.com', name: 'Residente', role: 'cliente',
  cliente_id: 'cli-1', login_time: '2026-11-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z',
} as UserSession

const unidad = (id: string, project_id: string, condominios: boolean, rol = 'propietario') =>
  ({ id, nombre: id.toUpperCase(), project_id, activo: true, rol, servicio_agua: true, servicio_condominios: condominios })

beforeEach(() => {
  h.unidades = [unidad('casa-a', 'p-condo', true)]
  h.proyectos = [{ id: 'p-condo', company_id: 'emp-1', moneda_condominios: 'Q', moneda: 'Q' }]
  h.plan = { 'emp-1': [] }
  h.planPedido.mockClear(); h.datosPedidos.mockClear()
})
afterEach(cleanup)

const pestanas = async () => {
  await screen.findByRole('button', { name: /Mi Unidad/ })
  return screen.getAllByRole('button').map(b => b.textContent ?? '')
}

describe('CondominiosClientPortal — módulos y plan', () => {
  it('sin Asambleas ni Transparencia en el plan: no aparecen las pestañas', async () => {
    render(<CondominiosClientPortal currentUser={usuario} onLogout={() => {}} />)
    const nombres = await pestanas()
    expect(nombres.some(n => n.includes('Asambleas'))).toBe(false)
    expect(nombres.some(n => n.includes('Transparencia'))).toBe(false)
    expect(nombres.some(n => n.includes('Reservas'))).toBe(true)
    // Se pregunta el plan de la empresa del condominio, no el del residente.
    expect(h.planPedido).toHaveBeenCalledWith(['emp-1'], ['asambleas_digitales', 'transparencia_financiera'])
    expect(screen.queryByText(/plan/i)).toBeNull()
  })

  it('con la función en el plan: la pestaña aparece y se abre sin «mejore su plan»', async () => {
    h.plan = { 'emp-1': ['asambleas_digitales'] }
    render(<CondominiosClientPortal currentUser={usuario} onLogout={() => {}} />)
    const nombres = await pestanas()
    expect(nombres.some(n => n.includes('Transparencia'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Asambleas/ }))
    expect(await screen.findByTestId('tab-asambleas')).toBeTruthy()
    expect(screen.queryByText(/Mejor|Upgrade|plan/i)).toBeNull()
  })

  it('una unidad de un proyecto sin Condominios no entra al portal', async () => {
    h.unidades = [unidad('casa-a', 'p-condo', true), unidad('lote-b', 'p-agua', false)]
    h.proyectos = [...h.proyectos, { id: 'p-agua', company_id: 'emp-1', moneda_condominios: null, moneda: 'Q' }]
    render(<CondominiosClientPortal currentUser={usuario} onLogout={() => {}} />)
    await pestanas()
    expect(h.datosPedidos).toHaveBeenCalledWith(['p-condo'], ['casa-a'])
    // Con una sola unidad no hay selector: la del proyecto de sólo Agua no se ofrece.
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/LOTE-B/)).toBeNull()
  })

  it('si ninguna unidad opera en Condominios, muestra «Sin unidades asociadas»', async () => {
    h.unidades = [unidad('lote-b', 'p-agua', false)]
    render(<CondominiosClientPortal currentUser={usuario} onLogout={() => {}} />)
    expect(await screen.findByText('Sin unidades asociadas')).toBeTruthy()
    expect(h.datosPedidos).not.toHaveBeenCalled()
  })

  it('el inquilino no ve Asambleas aunque el plan la incluya', async () => {
    h.unidades = [unidad('casa-a', 'p-condo', true, 'arrendatario')]
    h.plan = { 'emp-1': ['asambleas_digitales', 'transparencia_financiera'] }
    render(<CondominiosClientPortal currentUser={usuario} onLogout={() => {}} />)
    const nombres = await pestanas()
    expect(nombres.some(n => n.includes('Asambleas'))).toBe(false)
    expect(nombres.some(n => n.includes('Transparencia'))).toBe(false)
  })
})
