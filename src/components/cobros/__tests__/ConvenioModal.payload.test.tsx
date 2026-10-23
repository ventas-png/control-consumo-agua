// «Crear convenio» manda la empresa de la sesión y el proyecto de los cargos.
//
// `convenios_pago.company_id` no tiene default ni trigger, y la policy
// convenios_pago_insert exige company_id = get_my_company_id(): un payload sin
// company_id da NULL en el WITH CHECK y la base rechaza el convenio a todos
// salvo a super_admin. Aquí se prueba el payload que llega a `createConvenio`
// (mockeado) desde la acción masiva de CobrosSection y desde la ventana sola.
//
// También: cambiar el estado de un convenio que la base no tocó (cero filas)
// avisa del error en vez de decir «Estado actualizado».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, Cliente, ConvenioPago, UserSession } from '../../../types'

const h = vi.hoisted(() => ({
  createConvenio: vi.fn(),
  setConvenioEstado: vi.fn(),
  marcarRegistrosMora: vi.fn(),
  fetchPagosYConvenios: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => {
  const cadena: unknown = new Proxy(function () {} as unknown as object, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      return () => cadena
    },
    apply: () => cadena,
  })
  return { supabase: { from: () => cadena, rpc: () => cadena }, db: { from: () => cadena, rpc: () => cadena } }
})
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
vi.mock('../../../domain/cobros/queries', () => ({
  fetchPagosYConvenios: h.fetchPagosYConvenios,
  esCobroDeCargoAdicional: (p: { cargo_adicional_id?: string | null }) => p.cargo_adicional_id != null,
}))
vi.mock('../../../domain/cobros/mutations', () => ({
  createPago: vi.fn(),
  createConvenio: h.createConvenio,
  verifyPago: vi.fn(),
  rejectPago: vi.fn(),
  setConvenioEstado: h.setConvenioEstado,
}))
vi.mock('../../../domain/agua/mutations', () => ({
  registrarPagoRegistro: vi.fn(),
  marcarRegistrosMora: h.marcarRegistrosMora,
}))
vi.mock('../../shared/Dialog', () => ({
  notify: h.notify,
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

const { ConvenioModal } = await import('../ConvenioModal')
const { CobrosSection } = await import('../CobrosSection')
const { SessionProvider } = await import('../../shared/SessionContext')
const { PermissionsProvider } = await import('../../shared/PermissionsContext')

const clientes = [{ id: 'cli-1', nombre: 'Ana', codigo: 'CL-001' }] as unknown as Cliente[]
const currentUser = { user_id: 'u1', company_id: 'emp-1', role: 'admin', name: 'Admin' } as unknown as UserSession

function registro(id: string, over: Partial<Registro> = {}): Registro {
  return {
    id, cliente_id: 'cli-1', cliente_nombre: 'Ana', project_id: 'proj-1', fecha: '2026-08-01',
    lectura_anterior: 0, lectura_actual: 10, consumo: 10,
    tarifa_aplicada: 25, canon_aplicado: 20, monto_calculado: 100,
    monto_pagado: 0, estado: 'pendiente', mes: 'Agosto 2026',
    ...over,
  } as unknown as Registro
}

async function renderSection(registros: Registro[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <SessionProvider value={currentUser}>
          <PermissionsProvider>
            <CobrosSection registros={registros} clientes={clientes} moneda="Q" onEstadoUpdated={vi.fn()} />
          </PermissionsProvider>
        </SessionProvider>
      </QueryClientProvider>,
    )
  })
}

function renderModal(registros: Registro[], companyId: string | undefined) {
  render(
    <ConvenioModal
      registros={registros} clientes={clientes} moneda="Q" currentUserId="u1"
      companyId={companyId} onClose={vi.fn()} onSuccess={vi.fn()}
    />,
  )
}

async function crearConvenio() {
  const dialog = screen.getByRole('dialog', { name: '🤝 Crear Convenio de Pago' })
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Crear Convenio/ })) })
}

beforeEach(() => {
  cleanup()
  Object.values(h).forEach(fn => fn.mockReset())
  h.createConvenio.mockResolvedValue({ error: null })
  h.marcarRegistrosMora.mockResolvedValue({ error: null })
  h.fetchPagosYConvenios.mockResolvedValue({ pagos: [], convenios: [] })
})
afterEach(cleanup)

describe('Crear convenio — payload', () => {
  it('desde la acción masiva manda la empresa de la sesión y el proyecto de los cargos', async () => {
    await renderSection([registro('r1'), registro('r2', { monto_pagado: 40 })])
    for (const id of ['r1', 'r2']) {
      const fila = document.querySelector(`tr[data-registro-id="${id}"]`) as HTMLTableRowElement
      await act(async () => { fireEvent.click(within(fila).getByRole('checkbox')) })
    }
    const toolbar = screen.getByRole('toolbar', { name: /2 cargos seleccionados/ })
    await act(async () => { fireEvent.click(within(toolbar).getByRole('button', { name: /Crear convenio/ })) })
    await crearConvenio()

    expect(h.createConvenio).toHaveBeenCalledTimes(1)
    expect(h.createConvenio.mock.calls[0][0]).toMatchObject({
      company_id: 'emp-1',
      project_id: 'proj-1',
      cliente_id: 'cli-1',
      monto_total: 160,
      registro_ids: ['r1', 'r2'],
      estado: 'activo',
      created_by: 'u1',
    })
    await waitFor(() => expect(h.marcarRegistrosMora).toHaveBeenCalledWith(['r1', 'r2']))
  })

  it('cargos de proyectos distintos: project_id null, company_id igual se manda', async () => {
    renderModal([registro('r1'), registro('r2', { project_id: 'proj-2' })], 'emp-1')
    await crearConvenio()
    expect(h.createConvenio.mock.calls[0][0]).toMatchObject({ company_id: 'emp-1', project_id: null })
  })

  it('cargos sin proyecto: project_id null', async () => {
    renderModal([registro('r1', { project_id: null })], 'emp-1')
    await crearConvenio()
    expect(h.createConvenio.mock.calls[0][0]).toMatchObject({ company_id: 'emp-1', project_id: null })
  })

  it('sin empresa en la sesión no intenta el INSERT (la RLS lo rechazaría) y lo dice', async () => {
    renderModal([registro('r1')], undefined)
    await crearConvenio()
    expect(h.createConvenio).not.toHaveBeenCalled()
    expect(h.marcarRegistrosMora).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })
})

describe('Convenios — cambiar estado', () => {
  const convenio = {
    id: 'cv1', cliente_id: 'cli-1', numero_convenio: 'CONV-1', monto_total: 300, monto_pagado: 0,
    fecha_inicio: '2026-08-01', estado: 'activo', registro_ids: ['r1'], cuotas: null, created_at: '2026-08-01',
  } as unknown as ConvenioPago

  async function completar() {
    h.fetchPagosYConvenios.mockResolvedValue({ pagos: [], convenios: [convenio] })
    await renderSection([])
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Convenios/ })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Completar/ })) })
  }

  it('si la base no cambió la fila, avisa del error y no dice «Estado actualizado»', async () => {
    h.setConvenioEstado.mockResolvedValue({ error: 'El servidor no aplicó el cambio' })
    await completar()
    expect(h.setConvenioEstado).toHaveBeenCalledWith('cv1', 'completado')
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'El servidor no aplicó el cambio' }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Estado actualizado' }))
  })

  it('si la base la cambió, confirma y recarga', async () => {
    h.setConvenioEstado.mockResolvedValue({ error: null })
    await completar()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Estado actualizado' }))
    expect(h.fetchPagosYConvenios).toHaveBeenCalledTimes(2)
  })
})
