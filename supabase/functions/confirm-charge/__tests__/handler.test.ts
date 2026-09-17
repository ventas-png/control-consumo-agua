// Tests del HANDLER completo de confirm-charge (P2: camino de dinero sin tests
// de handler). Mismo harness que create-charge: Deno stubbeado, supabase-js
// remoto mockeado con el fake compartido, payfacs mockeados; cors corre REAL.
//
// Foco: ownership del payment_request, idempotencia, y que la conciliación sea
// UNA llamada a `conciliar_pago_externo`. Lo que el edge hacía antes —el
// `SELECT` de idempotencia, el INSERT del pago, el UPDATE del ítem y el cierre
// de la solicitud, cada uno en su transacción— vive ahora dentro de esa RPC
// (migración 20260911042839), así que aquí se comprueba lo que le toca al
// edge: que pregunte al proveedor, que llame a la RPC con el id de la
// solicitud y NADA más, y que no escriba por su cuenta en `pagos`, en el ítem
// ni en `payment_requests`.
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
  conciliar?: { data?: unknown; error?: { message: string } | null }
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
  // Del ítem, el edge sólo necesita ya el `project_id` (override del payfac
  // por locación): los montos los lee la RPC de la fila bloqueada.
  state.byTable.cuotas_condominio = {
    data: { project_id: 'pj1', deleted_at: null, ...overrides.cuota },
    error: null,
  }
  state.byTable.companies = { data: { proveedor_pago: 'sandbox', default_currency: 'GTQ' }, error: null }
  state.byTable.projects = { data: { proveedor_pago: null }, error: null }
  state.byTable.payfac_secrets = { data: [], error: null }
  state.rpcs.conciliar_pago_externo = overrides.conciliar ?? {
    data: { ok: true, ya_conciliado: false, pago_id: 'pago-1', liquidado: true, saldo_restante: 0 },
    error: null,
  }
}

const rpcsConciliar = (state: FakeSupabaseState) =>
  state.rpcCalls.filter((c) => c.fn === 'conciliar_pago_externo')

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

  it('la RPC contesta ya_conciliado → already, y el edge no escribe nada por su cuenta', async () => {
    // Este es el caso del cron reintentando lo que el retorno del portal ya
    // concilió. Antes lo resolvía un `SELECT` en el edge, que dos
    // confirmaciones simultáneas pasaban las dos; ahora lo resuelve la RPC con
    // la solicitud bloqueada, y el edge se limita a reflejar la respuesta.
    fixture(h.state, {
      conciliar: {
        data: { ok: true, ya_conciliado: true, pago_id: 'pago-previo', liquidado: true, saldo_restante: 0 },
        error: null,
      },
    })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, already: true, pago_id: 'pago-previo' })
    expect(callsDe(h.state.calls, 'pagos', 'insert').length).toBe(0)
    expect(callsDe(h.state.calls, 'payment_requests', 'update').length).toBe(0)
  })
})

describe('confirm-charge · la conciliación es UNA llamada transaccional', () => {
  it('aprobado → llama a conciliar_pago_externo con SÓLO el id de la solicitud', async () => {
    fixture(h.state)
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, estado: 'aprobado', conciliado: true, liquidado: true, saldo_restante: 0, pago_id: 'pago-1',
    })

    const llamadas = rpcsConciliar(h.state)
    expect(llamadas.length).toBe(1)
    // El id, y nada más: el monto, el ítem, el método y la referencia los lee
    // la RPC de la fila bloqueada, así que el edge no puede equivocarse ni
    // mentir sobre ellos.
    expect(llamadas[0].args).toEqual({ p_payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' })
  })

  it('el edge ya no inserta pagos, ni toca el ítem, ni sella la solicitud', async () => {
    fixture(h.state)
    await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(callsDe(h.state.calls, 'pagos', 'insert').length).toBe(0)
    expect(callsDe(h.state.calls, 'cuotas_condominio', 'update').length).toBe(0)
    expect(callsDe(h.state.calls, 'registros', 'update').length).toBe(0)
    expect(callsDe(h.state.calls, 'payment_requests', 'update').length).toBe(0)
  })

  it('abono parcial: el saldo que informa es el que devuelve la RPC, no uno calculado aquí', async () => {
    fixture(h.state, {
      pr: { monto: 40 },
      conciliar: {
        data: { ok: true, ya_conciliado: false, pago_id: 'pago-1', liquidado: false, saldo_restante: 60 },
        error: null,
      },
    })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ conciliado: true, liquidado: false, saldo_restante: 60 })
  })

  it('si la RPC falla, revirtió entera: 500 y nada escrito', async () => {
    fixture(h.state, { conciliar: { data: null, error: { message: 'recibo no encontrado' } } })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, estado: 'error' })
    expect(callsDe(h.state.calls, 'payment_requests', 'update').length).toBe(0)
  })

  it('provider NO aprobado → refleja estado sin conciliar', async () => {
    fixture(h.state)
    h.consulta = { ok: true, estado: 'pendiente' }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, estado: 'pendiente', conciliado: false })
    expect(rpcsConciliar(h.state).length).toBe(0)
    expect(callsDe(h.state.calls, 'payment_requests', 'update')[0].payload).toMatchObject({ estado: 'pending' })
  })
})
