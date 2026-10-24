// Contra incendio: deja la vista dividida (lista de 300px + panel) por una
// tabla que en el teléfono se lee como tarjetas; la nueva inspección y el
// detalle van en ventana (pantalla completa en el teléfono). Los vencimientos
// y los problemas se cuentan por equipo con su inspección más reciente: un
// extintor ya recargado deja de salir «vencido» por su registro viejo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { ControlSistemaIncendio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
  legado: [] as unknown[],
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: vi.fn(),
  deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
// La empresa de servicio sale del catálogo compartido (consultas de react-query, aquí fijas).
vi.mock('../../../../domain/cxp/queries', () => ({
  useProveedoresQuery: () => ({
    data: [
      { id: 'prov1', company_id: 'co1', nombre: 'Aguas GT', nit: '1234567-8', rfc: null, pais: 'GT', codigo: 'PRV-00001', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
      { id: 'prov2', company_id: 'co1', nombre: 'Jardines El Roble', nit: '7654321-0', rfc: null, pais: 'GT', codigo: 'PRV-00002', estado: 'autorizado', alcance: 'empresa', activo: true, dias_credito: 0 },
    ],
    isLoading: false,
  }),
}))
vi.mock('../../../../domain/proveedores/queries', () => ({
  useAsignacionesQuery: () => ({ data: [], isLoading: false }),
  useOperacionesLegadoQuery: () => ({ data: mocks.legado, isLoading: false }),
}))
vi.mock('../../../../domain/proveedores/mutations', () => ({
  useVincularOperacionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const { default: ControlSistemaIncendioTab } = await import('../ControlSistemaIncendioTab')

function inspeccion(over: Partial<ControlSistemaIncendio>): ControlSistemaIncendio {
  return {
    id: 'x', company_id: 'co1', project_id: 'p1', fecha: '2026-10-01', tipo_sistema: 'extintor', identificador: 'EXT-001',
    ubicacion: 'Lobby', tipo_inspeccion: 'revision_visual', resultado: 'aprobado', fecha_vencimiento: null,
    empresa_servicio: null, tecnico: null, costo: null, proxima_inspeccion: null, observaciones: null,
    created_at: '2026-10-01T10:00:00Z',
    ...over,
  }
}

const registros = [
  // EXT-001: vencido en 2025, recargado en 2026 → ya no está vencido.
  inspeccion({ id: 'a1', fecha: '2025-01-10', tipo_inspeccion: 'recarga', fecha_vencimiento: '2025-12-31', created_at: '2025-01-10T10:00:00Z' }),
  inspeccion({ id: 'a2', fecha: '2026-01-05', tipo_inspeccion: 'recarga', fecha_vencimiento: '2099-01-05', empresa_servicio: 'Extintores GT',
    costo: 1250.5, created_at: '2026-01-05T10:00:00Z' }),
  // EXT-002: sigue vencido.
  inspeccion({ id: 'b1', identificador: 'EXT-002', ubicacion: 'Sótano 1', fecha: '2025-03-01', fecha_vencimiento: '2025-09-01', created_at: '2025-03-01T10:00:00Z' }),
  // ALM-05: estuvo fuera de servicio y ya se reparó.
  inspeccion({ id: 'c1', tipo_sistema: 'alarma', identificador: 'ALM-05', ubicacion: 'Piso 3', fecha: '2026-09-01', resultado: 'fuera_servicio',
    observaciones: 'Sirena sin sonido.', created_at: '2026-09-01T10:00:00Z' }),
  inspeccion({ id: 'c2', tipo_sistema: 'alarma', identificador: 'ALM-05', ubicacion: 'Piso 3', fecha: '2026-10-02', tipo_inspeccion: 'prueba_funcional',
    created_at: '2026-10-02T10:00:00Z' }),
]

function props(over: Partial<Parameters<typeof ControlSistemaIncendioTab>[0]> = {}): Parameters<typeof ControlSistemaIncendioTab>[0] {
  return { registros, proyectoId: 'p1', companyId: 'co1', moneda: 'Q', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Contra incendio — nueva inspección en ventana', () => {
  it('abre a pantalla completa, propone tipo y ubicación de un equipo ya registrado y registra', async () => {
    const onRefresh = vi.fn()
    render(<ControlSistemaIncendioTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva inspección' }))
    const ventana = screen.getByRole('dialog', { name: '🧯 Nueva inspección contra incendios' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Identificador *'), { target: { value: 'ALM-05' } })
    expect((screen.getByLabelText('Ubicación *') as HTMLInputElement).value).toBe('Piso 3')
    expect((screen.getByLabelText('Tipo de sistema') as HTMLSelectElement).value).toBe('alarma')

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_sistema_incendio', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', identificador: 'ALM-05', ubicacion: 'Piso 3', tipo_sistema: 'alarma',
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🧯 Nueva inspección contra incendios' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('la ubicación escrita a mano no se pisa al elegir un equipo', () => {
    render(<ControlSistemaIncendioTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva inspección' }))
    fireEvent.change(screen.getByLabelText('Ubicación *'), { target: { value: 'Terraza' } })
    fireEvent.change(screen.getByLabelText('Identificador *'), { target: { value: 'EXT-001' } })
    expect((screen.getByLabelText('Ubicación *') as HTMLInputElement).value).toBe('Terraza')
  })

  it('sin identificador avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<ControlSistemaIncendioTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva inspección' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Identificador *'), { target: { value: 'GAB-01' } })
    fireEvent.change(screen.getByLabelText('Ubicación *'), { target: { value: 'Piso 2' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Identificador *') as HTMLInputElement).value).toBe('GAB-01')
  })

  it('sin permiso de crear no hay botón', () => {
    render(<ControlSistemaIncendioTab {...props({ canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nueva inspección' })).toBeNull()
  })
})

describe('Contra incendio — estado por equipo, lista y detalle', () => {
  it('«Atención requerida» sólo muestra los equipos cuya inspección vigente venció', () => {
    render(<ControlSistemaIncendioTab {...props()} />)
    const avisos = screen.getAllByRole('button', { name: /— vencido|— vence pronto/ })
    expect(avisos.map(a => a.textContent)).toEqual(['⚠ EXT-002 · Sótano 1 — vencido (2025-09-01)'])
  })

  it('el resumen cuenta equipos con su estado vigente y filtra al tocarlo', () => {
    const { container } = render(<ControlSistemaIncendioTab {...props()} />)
    const extintores = screen.getByRole('button', { name: /🧯 Extintor/ })
    expect(extintores.textContent).toContain('2 equipos')
    // ALM-05 ya se reparó: no cuenta como problema.
    expect(screen.getByRole('button', { name: /🔔 Alarma/ }).textContent).toBe('🔔 Alarma1 equipo')
    fireEvent.click(extintores)
    expect(extintores.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('la lista se lee como tarjetas; sólo la inspección vigente se marca vencida', () => {
    const { container } = render(<ControlSistemaIncendioTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Equipo', 'Ubicación', 'Fecha', 'Inspección', 'Vence', 'Resultado', null])
    expect(within(tabla).getAllByText(/· vencido$/).map(e => e.textContent)).toEqual(['2025-09-01 · vencido'])
  })

  it('«Ver» abre el detalle con el historial del equipo; una inspección superada lo dice', () => {
    render(<ControlSistemaIncendioTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver inspección de EXT-001 del 2026-01-05' }))
    const detalle = screen.getByRole('dialog', { name: '🧯 EXT-001' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Q 1,250.50')).toBeTruthy()
    expect(within(detalle).getByText('Historial del equipo (2)')).toBeTruthy()
    expect(within(detalle).queryByText(/Hay una inspección más reciente/)).toBeNull()

    fireEvent.click(within(detalle).getByRole('button', { name: /^2025-01-10 · Recarga/ }))
    const viejo = screen.getByRole('dialog', { name: '🧯 EXT-001' })
    expect(within(viejo).getByText(/Hay una inspección más reciente/)).toBeTruthy()
    // El vencimiento de 2025 ya no cuenta: no se marca vencido.
    expect(within(viejo).getByText('2025-12-31')).toBeTruthy()
  })

  it('tocar la fila abre el detalle con las observaciones', () => {
    const { container } = render(<ControlSistemaIncendioTab {...props()} />)
    const fila = within(container.querySelector('tbody')!).getAllByText('ALM-05', { exact: false })
      .map(e => e.closest('tr')!)
      .find(tr => tr.textContent?.includes('2026-09-01'))!
    fireEvent.click(fila)
    expect(within(screen.getByRole('dialog', { name: '🔔 ALM-05' })).getByText('Sirena sin sonido.')).toBeTruthy()
  })
})
