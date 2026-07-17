// Tests del HANDLER completo de create-charge (P2: los edges del camino de
// dinero no tenían test de handler, solo de helpers puros). Se stubbea `Deno`
// (env + serve, capturando el handler), se mockea el import remoto de
// supabase-js con el fake de _shared/__tests__/fakeSupabase.ts y se mockea la
// capa de payfacs — el resto (cors, reconcile) corre REAL.
//
// Foco: la rama CUOTA — auth por rol de residente (regla "ocultar del otro" de
// cuotas diferenciadas), pagador real en el payment_request, guards de estado/
// saldo, y el sello de ambiente (#592: un pagador NO fuerza sandbox/prod).
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { emptyState, type FakeSupabaseState, type FakeWriteCall } from '../../_shared/__tests__/fakeSupabase.ts'

const h = vi.hoisted(() => ({
  env: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
    SUPABASE_ANON_KEY: 'anon-key',
    APP_URL: 'https://app.test',
  } as Record<string, string>,
  state: null as unknown as FakeSupabaseState,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
  cobro: { ok: true, estado: 'pendiente', referencia: 'ref-1', redirectUrl: 'https://pay.test/x' } as Record<string, unknown>,
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
  normalizarMonedaISO: () => 'GTQ',
  credencialesEfectivasDeAmbiente: () => null,
  getPaymentProvider: () => ({ nombre: 'sandbox', crearCobro: async () => h.cobro }),
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
    new Request('https://edge.test/create-charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )
}

/** Fixture base: cuota emitida de Q100 en la unidad u1 (dueño 'duenio'). */
function fixtureCuota(state: FakeSupabaseState, overrides: {
  cuota?: Record<string, unknown>
  caller?: { company_id?: string | null; cliente_id?: string | null }
  residente?: { tipo: string } | null
  pagosPrevios?: Array<{ monto: number }>
  empresa?: Record<string, unknown>
} = {}) {
  state.auth = { data: { user: { id: 'user-1' } }, error: null }
  state.byTable.app_users = { data: { company_id: null, cliente_id: 'inq1', ...overrides.caller }, error: null }
  state.byTable.cuotas_condominio = {
    data: {
      company_id: 'co1', project_id: 'pj1', unidad_id: 'u1', rol_responsable: null,
      concepto: 'mantenimiento', periodo: '2026-07', monto: 100, total_a_pagar: 100,
      cuota_estado: 'emitida', deleted_at: null,
      ...overrides.cuota,
    },
    error: null,
  }
  state.byTable.unidades = { data: { cliente_id: 'duenio' }, error: null }
  state.byTable.unidad_residentes = { data: overrides.residente ?? null, error: null }
  state.byTable.pagos = { data: overrides.pagosPrevios ?? [], error: null }
  // pago_sandbox_demo: true — el fixture representa un tenant DEMO: el gate
  // anti-sandbox (auditoría C1) rechaza cobros sandbox sin este flag.
  state.byTable.companies = { data: { id: 'co1', proveedor_pago: 'sandbox', default_currency: 'GTQ', ambiente_pago: 'sandbox', pago_sandbox_demo: true, ...overrides.empresa }, error: null }
  state.byTable.projects = { data: { proveedor_pago: null, moneda: 'Q', ambiente_pago: null }, error: null }
  state.byTable.payfac_secrets = { data: [], error: null }
  state.byTable.clientes = { data: { nombre: 'Inquilino Uno', email: 'i@x.com', telefono: null, nit: null }, error: null }
  state.writes.payment_requests = { data: { id: 'pr-1' }, error: null }
}

const insertDe = (calls: FakeWriteCall[], table: string) =>
  calls.find((c) => c.table === table && c.op === 'insert')?.payload as Record<string, unknown> | undefined

beforeEach(() => {
  const fresh = emptyState()
  h.state.byTable = fresh.byTable
  h.state.writes = fresh.writes
  h.state.calls = fresh.calls
  h.state.auth = fresh.auth
  h.state.rpcs = fresh.rpcs
  h.state.rpcCalls = fresh.rpcCalls
})

describe('create-charge · auth básica', () => {
  it('401 sin Authorization', async () => {
    const res = await post({ cuota_id: 'c1' })
    expect(res.status).toBe(401)
  })

  it('403 usuario sin company_id ni cliente_id', async () => {
    fixtureCuota(h.state, { caller: { company_id: null, cliente_id: null } })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(403)
  })
})

describe('create-charge · cuota — autorización por rol (cuotas diferenciadas)', () => {
  it('403 si el caller no es residente de la unidad', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'ajeno' }, residente: null })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/No autorizado/)
  })

  it('403 regla "ocultar del otro": inquilino no paga cuota del propietario', async () => {
    fixtureCuota(h.state, {
      cuota: { rol_responsable: 'propietario' },
      caller: { cliente_id: 'inq1' },
      residente: { tipo: 'arrendatario' },
    })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(403)
  })

  it('200 inquilino paga SU cuota (rol arrendatario) y el payment_request lleva SU cliente_id', async () => {
    fixtureCuota(h.state, {
      cuota: { rol_responsable: 'arrendatario' },
      caller: { cliente_id: 'inq1' },
      residente: { tipo: 'arrendatario' },
    })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.payment_request_id).toBe('pr-1')
    const pr = insertDe(h.state.calls, 'payment_requests')!
    expect(pr.cliente_id).toBe('inq1') // pagador REAL, no el dueño de la unidad
    expect(pr.cuota_id).toBe('c1')
    expect(pr.monto).toBe(100)
  })

  it('200 dueño legacy (unidades.cliente_id) sin fila en unidad_residentes', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, residente: null })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(insertDe(h.state.calls, 'payment_requests')!.cliente_id).toBe('duenio')
  })

  it('staff de OTRA empresa → 403; de la empresa dueña → 200 con el dueño como pagador', async () => {
    fixtureCuota(h.state, { caller: { company_id: 'otra', cliente_id: null } })
    expect((await post({ cuota_id: 'c1' }, 'user-jwt')).status).toBe(403)

    fixtureCuota(h.state, { caller: { company_id: 'co1', cliente_id: null } })
    const ok = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(ok.status).toBe(200)
    expect(insertDe(h.state.calls, 'payment_requests')!.cliente_id).toBe('duenio')
  })
})

describe('create-charge · cuota — guards de estado y saldo', () => {
  it('409 cuota no emitida/vencida', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, cuota: { cuota_estado: 'pendiente' } })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(409)
  })

  it('409 cuota ya saldada por abonos previos', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, pagosPrevios: [{ monto: 60 }, { monto: 40 }] })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(409)
  })

  it('abono parcial: monto pedido se acota al saldo', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, pagosPrevios: [{ monto: 70 }] })
    const res = await post({ cuota_id: 'c1', monto: 999 }, 'user-jwt')
    expect(res.status).toBe(200)
    expect(insertDe(h.state.calls, 'payment_requests')!.monto).toBe(30)
  })
})

describe('create-charge · rate limit (auditoría S6)', () => {
  it('429 cuando rate_limit_hit devuelve false para el usuario', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' } })
    h.state.rpcs.rate_limit_hit = { data: false, error: null }
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(h.state.rpcCalls.some((c) => c.fn === 'rate_limit_hit')).toBe(true)
  })

  it('service_role (interna, ej. cron) está exento del límite', async () => {
    fixtureCuota(h.state, {})
    h.state.rpcs.rate_limit_hit = { data: false, error: null }
    const res = await post({ cuota_id: 'c1' }, 'srk-secret')
    expect(res.status).toBe(200)
    expect(h.state.rpcCalls.some((c) => c.fn === 'rate_limit_hit')).toBe(false)
  })

  it('fail-open: si el contador falla (data null), la solicitud pasa', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' } })
    h.state.rpcs.rate_limit_hit = { data: null, error: { message: 'db down' } }
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(200)
  })
})

describe('create-charge · sello de ambiente (#592)', () => {
  it('un pagador NO puede forzar el ambiente por body: manda el del tenant', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' } })
    const res = await post({ cuota_id: 'c1', ambiente: 'prod' }, 'user-jwt')
    expect(res.status).toBe(200)
    // config.ambiente del tenant (mock) = 'sandbox'; el override solo aplica a service_role.
    expect(insertDe(h.state.calls, 'payment_requests')!.ambiente).toBe('sandbox')
  })

  it('service_role SÍ puede sobreescribir el ambiente (llamada interna)', async () => {
    fixtureCuota(h.state, {})
    const res = await post({ cuota_id: 'c1', ambiente: 'prod' }, 'srk-secret')
    expect(res.status).toBe(200)
    expect(insertDe(h.state.calls, 'payment_requests')!.ambiente).toBe('prod')
  })
})

describe('create-charge · gate anti-sandbox (auditoría C1)', () => {
  it('403 si el payfac efectivo es sandbox (el default de toda empresa) sin flag de demo', async () => {
    // Escenario del hallazgo: tenant productivo que nunca configuró payfac —
    // antes el residente podía "pagar" (aprobación simulada) y liquidar deuda real.
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, empresa: { pago_sandbox_demo: false } })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/proveedor de pagos/)
    expect(insertDe(h.state.calls, 'payment_requests')).toBeUndefined()
  })

  it('403 también cuando el flag viene null (columna aún sin backfill)', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, empresa: { pago_sandbox_demo: null } })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(403)
  })

  it('200 con el flag explícito de demo (tenant de demostración)', async () => {
    fixtureCuota(h.state, { caller: { cliente_id: 'duenio' }, empresa: { pago_sandbox_demo: true } })
    const res = await post({ cuota_id: 'c1' }, 'user-jwt')
    expect(res.status).toBe(200)
  })

  it('service_role (interna) NO pasa por el gate: puede cobrar sandbox sin flag', async () => {
    fixtureCuota(h.state, { empresa: { pago_sandbox_demo: false } })
    const res = await post({ cuota_id: 'c1' }, 'srk-secret')
    expect(res.status).toBe(200)
  })
})
