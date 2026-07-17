// Tests del HANDLER completo de confirm-charge (P2: camino de dinero sin tests
// de handler). Mismo harness que create-charge: Deno stubbeado, supabase-js
// remoto mockeado con el fake compartido, payfacs mockeados; cors y reconcile
// (planPagoCuota / facturaTransicionaAPagada) corren REALES.
//
// Foco: ownership del payment_request, idempotencia (estado succeeded y pago
// existente por provider_ref), y la conciliación de CUOTA — inserta el pago,
// liquida (o no) según el plan REAL de reconcile.ts y sella payment_requests.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { emptyState, type FakeSupabaseState, type FakeWriteCall } from '../../_shared/__tests__/fakeSupabase.ts'

const h = vi.hoisted(() => ({
  env: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
    SUPABASE_ANON_KEY: 'anon-key',
  } as Record<string, string>,
  state: null as unknown as FakeSupabaseState,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
  consulta: { ok: true, estado: 'aprobado', referencia: 'ref-1' } as Record<string, unknown>,
}))

vi.mock('https://esm.sh/@supabase/supabase-js@2', async () => {
  const { makeCreateClient } = await import('../../_shared/__tests__/fakeSupabase.ts')
  return { createClient: (...args: unknown[]) => makeCreateClient(h.state)(...(args as [string, string, { global?: unknown }?])) }
})

vi.mock('../../_shared/sentry.ts', () => ({ captureEdgeException: async () => undefined }))
vi.mock('../../_shared/secretsCrypto.ts', () => ({ decryptJson: async (x: unknown) => x }))
vi.mock('../../_shared/payments/index.ts', () => ({
  resolverConfigPagoEfectiva: () => ({ proveedorPago: 'sandbox', moneda: 'GTQ', ambiente: 'sandbox', desdeLocacion: false }),
  normalizarAmbientePago: (x: unknown) => (x === 'prod' ? 'prod' : 'sandbox'),
  credencialesEfectivasDeAmbiente: () => null,
  getPaymentProvider: () => ({ nombre: 'sandbox', consultarEstado: async () => h.consulta }),
}))

beforeAll(async () => {
  h.state = emptyState()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => h.env[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

function post(body: Record<string, unknown>, token?: string): Promise<Response> {
  return h.served.handler!(
    new Request('https://edge.test/confirm-charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )
}

/** Fixture base: solicitud pending de Q100 sobre la cuota c1 del cliente inq1. */
function fixture(state: FakeSupabaseState, overrides: {
  pr?: Record<string, unknown>
  caller?: { company_id?: string | null; cliente_id?: string | null }
  cuota?: Record<string, unknown>
  pagoExistente?: { id: string } | null
} = {}) {
  state.auth = { data: { user: { id: 'user-1' } }, error: null }
  state.byTable.app_users = { data: { company_id: null, cliente_id: 'inq1', ...overrides.caller }, error: null }
  state.byTable.payment_requests = {
    data: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', cliente_id: 'inq1', cuota_id: 'c1', registro_id: null, company_id: 'co1',
      monto: 100, provider: 'sandbox', ambiente: 'sandbox', estado: 'pending', provider_ref: 'ref-1',
      ...overrides.pr,
    },
    error: null,
  }
  state.byTable.cuotas_condominio = {
    data: { project_id: 'pj1', monto: 100, total_a_pagar: 100, deleted_at: null, ...overrides.cuota },
    error: null,
  }
  // `pagos` se lee DOS veces: (1) lista de abonos previos, (2) chequeo de
  // idempotencia por provider_ref (maybeSingle) — cola en ese orden.
  state.readQueues.pagos = [
    { data: [], error: null },
    { data: overrides.pagoExistente ?? null, error: null },
  ]
  state.byTable.companies = { data: { proveedor_pago: 'sandbox', default_currency: 'GTQ' }, error: null }
  state.byTable.projects = { data: { proveedor_pago: null }, error: null }
  state.byTable.payfac_secrets = { data: [], error: null }
  state.writes.pagos = { data: { id: 'pago-1' }, error: null }
}

const callsDe = (calls: FakeWriteCall[], table: string, op: FakeWriteCall['op']) =>
  calls.filter((c) => c.table === table && c.op === op)

beforeEach(() => {
  const fresh = emptyState()
  h.state.byTable = fresh.byTable
  h.state.writes = fresh.writes
  h.state.calls = fresh.calls
  h.state.auth = fresh.auth
  h.state.rpcs = fresh.rpcs
  h.state.rpcCalls = fresh.rpcCalls
  h.consulta = { ok: true, estado: 'aprobado', referencia: 'ref-1' }
})

describe('confirm-charge · auth y ownership', () => {
  it('401 sin Authorization', async () => {
    expect((await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' })).status).toBe(401)
  })

  it('400 sin payment_request_id', async () => {
    fixture(h.state)
    expect((await post({}, 'user-jwt')).status).toBe(400)
  })

  it('403 si el residente no es el dueño de la solicitud', async () => {
    fixture(h.state, { caller: { cliente_id: 'otro' } })
    expect((await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')).status).toBe(403)
  })
})

describe('confirm-charge · rate limit (auditoría S6)', () => {
  it('429 cuando rate_limit_hit devuelve false para el usuario', async () => {
    fixture(h.state)
    h.state.rpcs.rate_limit_hit = { data: false, error: null }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(429)
  })

  it('service_role (cron de reconciliación) está exento del límite', async () => {
    fixture(h.state)
    h.state.rpcs.rate_limit_hit = { data: false, error: null }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'srk-secret')
    expect(res.status).toBe(200)
    expect(h.state.rpcCalls.some((c) => c.fn === 'rate_limit_hit')).toBe(false)
  })
})

describe('confirm-charge · idempotencia', () => {
  it('solicitud ya succeeded → already, sin tocar nada', async () => {
    fixture(h.state, { pr: { estado: 'succeeded' } })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, already: true })
    expect(h.state.calls.length).toBe(0)
  })

  it('pago ya registrado con el mismo provider_ref → already, sin insert duplicado', async () => {
    fixture(h.state, { pagoExistente: { id: 'pago-previo' } })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, already: true })
    expect(callsDe(h.state.calls, 'pagos', 'insert').length).toBe(0)
    // Solo sella la solicitud como succeeded.
    expect(callsDe(h.state.calls, 'payment_requests', 'update').length).toBe(1)
  })
})

describe('confirm-charge · conciliación de cuota', () => {
  it('aprobado + pago total → inserta pago, liquida la cuota y sella la solicitud', async () => {
    fixture(h.state)
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, estado: 'aprobado', conciliado: true, liquidado: true, saldo_restante: 0 })

    const pago = callsDe(h.state.calls, 'pagos', 'insert')[0].payload as Record<string, unknown>
    // metodo 'sandbox': el provider mockeado es el simulado — el sello C1
    // garantiza que un pago demo nunca se confunde con tarjeta real.
    expect(pago).toMatchObject({ cliente_id: 'inq1', cuota_id: 'c1', monto: 100, tipo_aplicacion: 'pago_total', referencia: 'ref-1', metodo: 'sandbox' })

    const cuotaUpd = callsDe(h.state.calls, 'cuotas_condominio', 'update')[0].payload as Record<string, unknown>
    expect(cuotaUpd).toMatchObject({ cuota_estado: 'pagada', estado: 'pagado', pago_id: 'pago-1' })

    expect(callsDe(h.state.calls, 'payment_requests', 'update')[0].payload).toMatchObject({ estado: 'succeeded' })
  })

  it('aprobado + abono parcial → NO liquida la cuota (sin update de cuota)', async () => {
    fixture(h.state, { pr: { monto: 40 } })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    const body = await res.json()
    expect(body).toMatchObject({ conciliado: true, liquidado: false, saldo_restante: 60 })
    expect((callsDe(h.state.calls, 'pagos', 'insert')[0].payload as Record<string, unknown>).tipo_aplicacion).toBe('abono')
    expect(callsDe(h.state.calls, 'cuotas_condominio', 'update').length).toBe(0)
  })

  it('provider NO aprobado → refleja estado sin conciliar', async () => {
    fixture(h.state)
    h.consulta = { ok: true, estado: 'pendiente' }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, estado: 'pendiente', conciliado: false })
    expect(callsDe(h.state.calls, 'pagos', 'insert').length).toBe(0)
    expect(callsDe(h.state.calls, 'payment_requests', 'update')[0].payload).toMatchObject({ estado: 'pending' })
  })
})
