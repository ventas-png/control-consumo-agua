// Tests del HANDLER completo de confirm-charge (P2: camino de dinero sin tests
// de handler). Mismo harness que create-charge: Deno stubbeado, supabase-js
// remoto mockeado con el fake compartido, payfacs mockeados; cors corre REAL.
//
// Foco: ownership del payment_request, idempotencia, y que la conciliación sea
// UNA llamada a `pasarela_registrar_estado` (20261011000000), que deduplica,
// sólo deja avanzar el estado y concilia con `conciliar_pago_externo`. Lo que el edge hacía antes —el
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
  stripe: vi.fn(async (_id: string, _clave: string) => ({ ok: true, estado: 'pendiente', referencia: 'pi_1' }) as Record<string, unknown>),
}))

vi.mock('https://esm.sh/@supabase/supabase-js@2', async () => {
  const { makeCreateClient } = await import('../../_shared/__tests__/fakeSupabase.ts')
  return { createClient: (...args: unknown[]) => makeCreateClient(h.state)(...(args as [string, string, { global?: unknown }?])) }
})

vi.mock('../../_shared/sentry.ts', () => ({ captureEdgeException: async () => undefined }))
vi.mock('../../_shared/secretsCrypto.ts', () => ({
  decryptJson: async (x: unknown) => x,
  decryptSecret: async (x: string | null) => (x ? `claro:${x}` : null),
}))
vi.mock('../../_shared/payments/stripeConsulta.ts', () => ({ consultarPaymentIntentStripe: h.stripe }))
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
  state.rpcs.pasarela_registrar_estado = overrides.conciliar ?? {
    data: { ok: true, ya_conciliado: false, pago_id: 'pago-1', liquidado: true, saldo_restante: 0 },
    error: null,
  }
}

const rpcsConciliar = (state: FakeSupabaseState) =>
  state.rpcCalls.filter((c) => c.fn === 'pasarela_registrar_estado')

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
  it('aprobado → llama a pasarela_registrar_estado con el id, lo informado y el origen', async () => {
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
    expect(llamadas[0].args).toEqual({
      p_payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', p_estado: 'aprobado', p_origen: 'consulta',
    })
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

  it('provider NO aprobado → lo registra por la RPC (que no retrocede el estado) y el edge no escribe', async () => {
    fixture(h.state, { conciliar: { data: { ok: true, estado: 'pending', accion: 'sin_cambio' }, error: null } })
    h.consulta = { ok: true, estado: 'pendiente' }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, estado: 'pendiente', conciliado: false, estado_solicitud: 'pending' })
    expect(rpcsConciliar(h.state)[0].args).toMatchObject({ p_estado: 'pendiente' })
    expect(callsDe(h.state.calls, 'payment_requests', 'update').length).toBe(0)
  })

  it('rechazado: tampoco escribe `failed` por su cuenta (antes pisaba una acreditación simultánea)', async () => {
    fixture(h.state, { conciliar: { data: { ok: true, estado: 'failed', accion: 'marcado_fallido' }, error: null } })
    h.consulta = { ok: true, estado: 'rechazado' }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, estado: 'rechazado', conciliado: false, estado_solicitud: 'failed' })
    expect(callsDe(h.state.calls, 'payment_requests', 'update').length).toBe(0)
  })

  it('solicitud reembolsada: estado final, no pregunta al proveedor ni concilia', async () => {
    fixture(h.state, { pr: { estado: 'refunded' } })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(await res.json()).toMatchObject({ ok: true, estado: 'reembolsado', conciliado: false })
    expect(rpcsConciliar(h.state).length).toBe(0)
  })
})

describe('confirm-charge · cobro sobre una cuota anulada o eliminada (20261015000000)', () => {
  it('la RPC retiene el cobro: responde aprobado SIN conciliar y en revisión', async () => {
    fixture(h.state, {
      conciliar: {
        data: { ok: true, duplicado: false, estado: 'pending_verification', accion: 'cobro_sobre_documento_anulado', conciliado: false, en_revision: true, reembolsado: false, incidencia_id: 'inc-1' },
        error: null,
      },
    })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, estado: 'aprobado', conciliado: false, en_revision: true, estado_solicitud: 'pending_verification' })
    expect(body.pago_id).toBeUndefined()
    expect(callsDe(h.state.calls, 'pagos', 'insert').length).toBe(0)
  })

  it('cuota ELIMINADA: igual pregunta al proveedor y registra lo que informa (antes respondía 404 y la confirmación se perdía)', async () => {
    fixture(h.state, {
      cuota: { deleted_at: '2026-09-30T00:00:00Z' },
      conciliar: {
        data: { ok: true, estado: 'pending_verification', accion: 'cobro_sobre_documento_anulado', conciliado: false, en_revision: true, reembolsado: false, incidencia_id: 'inc-2' },
        error: null,
      },
    })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ conciliado: false, en_revision: true })
    expect(rpcsConciliar(h.state)).toHaveLength(1)
  })
})

describe('confirm-charge · la respuesta sigue el estado persistido (20261016000000)', () => {
  it('dos consultas seguidas de un cobro retenido: las dos en revisión (la 2.ª es un duplicado)', async () => {
    const respuestas = [
      { ok: true, duplicado: false, accion: 'cobro_retenido_ya_registrado', estado: 'pending_verification', conciliado: false, en_revision: true, reembolsado: false },
      { ok: true, duplicado: true, accion: 'duplicado', estado: 'pending_verification', conciliado: false, en_revision: true, reembolsado: false },
    ]
    for (const data of respuestas) {
      fixture(h.state, { pr: { estado: 'pending_verification' }, conciliar: { data, error: null } })
      const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, conciliado: false, en_revision: true })
      expect(body).not.toHaveProperty('saldo_restante')
      expect(body).not.toHaveProperty('pago_id')
    }
  })

  it('reembolso total previo: la aprobación atrasada responde reembolsado, sin pago ni saldo', async () => {
    fixture(h.state, {
      pr: { estado: 'failed' },
      conciliar: { data: { ok: true, accion: 'ignorado_reembolsado', estado: 'refunded', conciliado: false, en_revision: false, reembolsado: true }, error: null },
    })
    const body = await (await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')).json()
    expect(body).toEqual({ ok: true, estado: 'reembolsado', conciliado: false, estado_solicitud: 'refunded' })
  })

  it('accion «duplicado» sin conciliación persistida: no se presenta como pagado', async () => {
    fixture(h.state, {
      conciliar: { data: { ok: true, duplicado: true, accion: 'duplicado', estado: 'failed', conciliado: false, en_revision: false, reembolsado: false }, error: null },
    })
    const body = await (await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')).json()
    expect(body).toMatchObject({ ok: true, estado: 'pendiente', conciliado: false })
  })

  it('conciliado sin saldo informado: no inventa saldo 0', async () => {
    fixture(h.state, {
      conciliar: { data: { ok: true, estado: 'succeeded', conciliado: true, pago_id: 'pago-9', liquidado: false }, error: null },
    })
    const body = await (await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')).json()
    expect(body).toMatchObject({ ok: true, estado: 'aprobado', conciliado: true, pago_id: 'pago-9', saldo_restante: null })
  })
})

describe('confirm-charge · Stripe se consulta por su PaymentIntent (E8, 20261019000000)', () => {
  it('consulta el PaymentIntent con la clave de la empresa y registra lo que informa Stripe', async () => {
    fixture(h.state, {
      pr: { provider: 'stripe', provider_ref: null, stripe_payment_intent: 'pi_1' },
      conciliar: { data: { ok: true, accion: 'marcado_fallido', estado: 'failed', conciliado: false }, error: null },
    })
    h.state.byTable.company_payment_secrets = { data: { stripe_secret_key: 'cifrada' }, error: null }
    h.stripe.mockResolvedValueOnce({ ok: true, estado: 'rechazado', referencia: 'pi_1' })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(h.stripe).toHaveBeenCalledWith('pi_1', 'claro:cifrada')
    expect(rpcsConciliar(h.state)[0].args).toMatchObject({ p_estado: 'rechazado', p_origen: 'consulta' })
  })

  it('sin clave de Stripe configurada no consulta ni registra nada', async () => {
    fixture(h.state, { pr: { provider: 'stripe', provider_ref: null, stripe_payment_intent: 'pi_2' } })
    h.state.byTable.company_payment_secrets = { data: null, error: null }
    h.stripe.mockClear()
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(409)
    expect(h.stripe).not.toHaveBeenCalled()
    expect(rpcsConciliar(h.state)).toHaveLength(0)
  })
})

describe('confirm-charge · cargo adicional (20261011000000)', () => {
  it('concilia el cobro en línea de un cargo por la misma RPC', async () => {
    fixture(h.state, { pr: { cuota_id: null, cargo_adicional_id: 'ca1' } })
    h.state.byTable.cargos_adicionales_unidad = { data: { project_id: 'pj1' }, error: null }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, estado: 'aprobado', conciliado: true, liquidado: true })
    expect(rpcsConciliar(h.state).length).toBe(1)
  })

  it('404 si el cargo no existe', async () => {
    fixture(h.state, { pr: { cuota_id: null, cargo_adicional_id: 'ca1' } })
    h.state.byTable.cargos_adicionales_unidad = { data: null, error: null }
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(404)
  })

  it('400 si la solicitud apunta a dos ítems', async () => {
    fixture(h.state, { pr: { cargo_adicional_id: 'ca1' } })
    const res = await post({ payment_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' }, 'user-jwt')
    expect(res.status).toBe(400)
  })
})
