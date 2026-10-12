// Tests del HANDLER completo de delete-company. Mismo harness que
// create-charge/confirm-charge: Deno stubbeado, supabase-js remoto mockeado con
// el fake compartido, el SDK de Stripe (esm.sh) mockeado; cors corre REAL.
//
// Por qué existen: el handler estuvo roto desde 6db61ad1 (un ReferenceError
// fuera del try daba 500 a TODA petición) sin que ningún test lo viera, porque
// sólo se probaba la lógica pura. Un mutante que quitara `if (!gate.ok) return`
// o el orden «RPC primero, auth después» sobrevivía. Aquí cada compuerta se
// fija por su efecto: el status Y que no se escribió nada.
//
// Lo que la purga escribe (desligar superadministradores con company_id y
// project_id a NULL, borrar personas, auditoría, DELETE de companies) ya no lo
// escribe el edge: lo hace la RPC `purgar_empresa` en una transacción, y su
// contenido lo fija supabase/tests/purgar_empresa contra un Postgres real. Lo
// que le toca al edge, y se fija aquí, es: no escribir NADA por su cuenta,
// llamar a la RPC con los argumentos correctos, y borrar en auth SÓLO lo que la
// RPC devolvió y SÓLO después de que confirmó.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { emptyState, type FakeSupabaseState } from '../../_shared/__tests__/fakeSupabase.ts'

const h = vi.hoisted(() => ({
  env: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
    SUPABASE_ANON_KEY: 'anon-key',
    STRIPE_PLATFORM_SECRET_KEY: 'sk_test_x',
  } as Record<string, string | undefined>,
  state: null as unknown as FakeSupabaseState,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
  stripe: {
    cancels: [] as string[],
    /** Error que lanza subscriptions.cancel (null → éxito). */
    cancelError: null as string | null,
  },
}))

vi.mock('https://esm.sh/@supabase/supabase-js@2', async () => {
  const { makeCreateClient } = await import('../../_shared/__tests__/fakeSupabase.ts')
  return { createClient: (...args: unknown[]) => makeCreateClient(h.state)(...(args as [string, string, { global?: unknown }?])) }
})

vi.mock('https://esm.sh/stripe@17.4.0?target=deno', () => {
  class FakeStripe {
    subscriptions = {
      cancel: async (id: string) => {
        h.stripe.cancels.push(id)
        h.state.secuencia.push(`stripe.cancel:${id}`)
        if (h.stripe.cancelError) throw new Error(h.stripe.cancelError)
        return { id, status: 'canceled' }
      },
    }
  }
  return { default: FakeStripe }
})

beforeAll(async () => {
  h.state = emptyState()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => h.env[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

const ORIGEN = 'https://administratodo.com'
const ACTOR = 'a0000000-0000-4000-8000-00000000000a'
const EMPRESA = 'e1000000-0000-4000-8000-000000000001'
const NOMBRE = 'Residencial Purga'
const DIA = 24 * 60 * 60 * 1000

function request(opts: {
  body?: unknown
  rawBody?: string
  origin?: string | null
  token?: string | null
  method?: string
} = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const origin = opts.origin === undefined ? ORIGEN : opts.origin
  if (origin) headers.Origin = origin
  const token = opts.token === undefined ? 'jwt-del-actor' : opts.token
  if (token) headers.Authorization = `Bearer ${token}`
  const method = opts.method ?? 'POST'
  return h.served.handler!(
    new Request('https://edge.test/delete-company', {
      method,
      headers,
      body: method === 'OPTIONS' ? undefined : (opts.rawBody ?? JSON.stringify(opts.body ?? { company_id: EMPRESA, confirm_name: NOMBRE })),
    }),
  )
}

/** Resultado de `purgar_empresa` al confirmar. */
const PURGA_OK = {
  company_id: EMPRESA,
  nombre: NOMBRE,
  logo_url: 'logos/x.png',
  usuarios_auth: ['a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000c1'],
  personas: 1,
  cuentas_cliente: 1,
  clientes: 2,
  proyectos: 2,
  unidades: 1,
  superadmins_desligados: 1,
}

/** Fixture base: super_admin sin empresa purgando una empresa elegible, sin Stripe. */
function fixture(state: FakeSupabaseState, overrides: {
  caller?: Record<string, unknown> | null
  company?: Record<string, unknown> | null
  subs?: unknown[]
  purga?: unknown
} = {}) {
  state.auth = { data: { user: { id: ACTOR } }, error: null }
  state.byTable.app_users = {
    data: overrides.caller === null ? null : { role: 'super_admin', company_id: null, ...overrides.caller },
    error: null,
  }
  state.byTable.companies = {
    data: overrides.company === null ? null : {
      id: EMPRESA, nombre: NOMBRE, activa: false,
      suspended_at: new Date(Date.now() - 120 * DIA).toISOString(), logo_url: 'logos/x.png',
      ...overrides.company,
    },
    error: null,
  }
  state.byTable.subscriptions = { data: overrides.subs ?? [], error: null }
  state.rpcs.purgar_empresa = overrides.purga ?? { data: PURGA_OK, error: null }
}

const rpcsPurga = () => h.state.rpcCalls.filter((c) => c.fn === 'purgar_empresa')

/** Nada con efecto: ni escrituras directas, ni RPC, ni auth, ni storage, ni Stripe. */
function expectSinEfectos() {
  expect(h.state.calls).toEqual([])
  expect(rpcsPurga()).toEqual([])
  expect(h.state.authAdminDeletes).toEqual([])
  expect(h.state.storageRemoves).toEqual([])
  expect(h.stripe.cancels).toEqual([])
}

beforeEach(() => {
  h.state = emptyState()
  h.stripe.cancels = []
  h.stripe.cancelError = null
  h.env.STRIPE_PLATFORM_SECRET_KEY = 'sk_test_x'
  h.env.DELETE_COMPANY_GRACE_DAYS = undefined
})

describe('delete-company · origen (el ReferenceError de 6db61ad1)', () => {
  it('OPTIONS → 200 (preflight)', async () => {
    const res = await request({ method: 'OPTIONS' })
    expect(res.status).toBe(200)
  })

  it('origen permitido + todo válido → responde 200 (antes: 500 a toda petición)', async () => {
    fixture(h.state)
    const res = await request()
    expect(res.status).toBe(200)
  })

  it('origen no permitido → 403 sin efectos', async () => {
    fixture(h.state)
    const res = await request({ origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed' })
    expectSinEfectos()
  })

  it('sin Origin → 403 sin efectos', async () => {
    fixture(h.state)
    expect((await request({ origin: null })).status).toBe(403)
    expectSinEfectos()
  })

  it('un preview de Vercel NO entra sin ALLOW_VERCEL_PREVIEW_ORIGINS=true (producción)', async () => {
    fixture(h.state)
    const res = await request({ origin: 'https://control-consumo-agua-abc123-prestadora-de-servicios-projects.vercel.app' })
    expect(res.status).toBe(403)
    expectSinEfectos()
  })
})

describe('delete-company · quién llama', () => {
  it('sin Authorization → 401 sin efectos', async () => {
    fixture(h.state)
    expect((await request({ token: null })).status).toBe(401)
    expectSinEfectos()
  })

  it.each(['company_owner', 'admin', 'cliente', 'operador'])('rol %s → 403 sin efectos', async (role) => {
    fixture(h.state, { caller: { role } })
    const res = await request()
    expect(res.status).toBe(403)
    expectSinEfectos()
  })

  it('sin perfil en app_users → 403 sin efectos', async () => {
    fixture(h.state, { caller: null })
    expect((await request()).status).toBe(403)
    expectSinEfectos()
  })

  it('error al leer el perfil → 500 sin efectos (no se trata como «no es superadmin» ni como «sí»)', async () => {
    fixture(h.state)
    h.state.byTable.app_users = { data: null, error: { message: 'boom' } }
    expect((await request()).status).toBe(500)
    expectSinEfectos()
  })

  it('super_admin colgado de la propia empresa → 400 sin efectos', async () => {
    fixture(h.state, { caller: { company_id: EMPRESA } })
    const res = await request()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/pertenece tu propia cuenta/)
    expectSinEfectos()
  })

  it('«superadmin» (grafía histórica) también pasa', async () => {
    fixture(h.state, { caller: { role: 'superadmin' } })
    expect((await request()).status).toBe(200)
  })
})

describe('delete-company · cuerpo mal formado → 400, no 500', () => {
  // El mensaje se fija además del status: sin él, un handler que se saltara
  // la validación también daría 400 —lo daría la compuerta del nombre, más
  // tarde y después de leer la empresa— y el test no lo distinguiría.
  it.each([
    ['JSON roto', '{"company_id": ', /objeto JSON/],
    ['null', 'null', /objeto JSON/],
    ['un arreglo', JSON.stringify([EMPRESA, NOMBRE]), /objeto JSON/],
    ['company_id numérico', JSON.stringify({ company_id: 123, confirm_name: NOMBRE }), /company_id debe ser texto/],
    ['confirm_name numérico', JSON.stringify({ company_id: EMPRESA, confirm_name: 7 }), /confirm_name debe ser texto/],
    ['company_id que no es UUID', JSON.stringify({ company_id: 'x', confirm_name: NOMBRE }), /no es un identificador válido/],
    ['sin confirm_name', JSON.stringify({ company_id: EMPRESA }), /Faltan company_id o confirm_name/],
  ])('%s → 400 sin efectos', async (_desc, rawBody, mensaje) => {
    fixture(h.state)
    // Si el cuerpo no vale, ni siquiera se busca la empresa.
    h.state.byTable.companies = { data: null, error: { message: 'no debía leerse' } }
    const res = await request({ rawBody })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(mensaje)
    expectSinEfectos()
  })
})

describe('delete-company · compuertas de la empresa: 0 escrituras', () => {
  it('empresa inexistente → 404', async () => {
    fixture(h.state, { company: null })
    expect((await request()).status).toBe(404)
    expectSinEfectos()
  })

  it('error al leer la empresa → 500', async () => {
    fixture(h.state)
    h.state.byTable.companies = { data: null, error: { message: 'boom' } }
    expect((await request()).status).toBe(500)
    expectSinEfectos()
  })

  it('nombre de confirmación erróneo → 400', async () => {
    fixture(h.state)
    const res = await request({ body: { company_id: EMPRESA, confirm_name: 'residencial purga' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no coincide/)
    expectSinEfectos()
  })

  it('empresa activa → 409', async () => {
    fixture(h.state, { company: { activa: true } })
    const res = await request()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/suspendida antes/)
    expectSinEfectos()
  })

  it('empresa en gracia (suspendida hace 10 días) → 409', async () => {
    fixture(h.state, { company: { suspended_at: new Date(Date.now() - 10 * DIA).toISOString() } })
    const res = await request()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/al menos 90 días/)
    expectSinEfectos()
  })

  it('suspendida sin suspended_at → 409', async () => {
    fixture(h.state, { company: { suspended_at: null } })
    expect((await request()).status).toBe(409)
    expectSinEfectos()
  })

  it('DELETE_COMPANY_GRACE_DAYS negativo NO abre la compuerta (cae a 90)', async () => {
    h.env.DELETE_COMPANY_GRACE_DAYS = '-5'
    fixture(h.state, { company: { suspended_at: new Date(Date.now() - 10 * DIA).toISOString() } })
    expect((await request()).status).toBe(409)
    expectSinEfectos()
  })
})

describe('delete-company · la purga es UNA llamada transaccional', () => {
  it('llama a purgar_empresa con la empresa, el actor del JWT, el nombre y la gracia; sin escrituras propias', async () => {
    fixture(h.state)
    const res = await request()
    expect(res.status).toBe(200)

    expect(rpcsPurga()).toEqual([{
      fn: 'purgar_empresa',
      args: {
        p_company_id: EMPRESA,
        p_actor_id: ACTOR,
        p_confirm_name: NOMBRE,
        p_grace_days: 90,
        p_stripe_subscription_id: null,
      },
    }])
    // Ni el UPDATE del superadministrador, ni los DELETE de personas, ni el
    // INSERT de auditoría, ni el DELETE de companies: todo eso es de la RPC.
    expect(h.state.calls).toEqual([])
  })

  it('la gracia configurada llega a la RPC', async () => {
    h.env.DELETE_COMPANY_GRACE_DAYS = '30'
    fixture(h.state, { company: { suspended_at: new Date(Date.now() - 40 * DIA).toISOString() } })
    expect((await request()).status).toBe(200)
    expect(rpcsPurga()[0].args).toMatchObject({ p_grace_days: 30 })
  })

  it('auth.admin.deleteUser SÓLO para lo que devolvió la RPC y SÓLO después de ella', async () => {
    fixture(h.state)
    await request()
    expect(h.state.authAdminDeletes).toEqual(PURGA_OK.usuarios_auth)
    expect(h.state.secuencia).toEqual([
      'rpc:purgar_empresa',
      'auth.deleteUser:a0000000-0000-4000-8000-0000000000a1',
      'auth.deleteUser:a0000000-0000-4000-8000-0000000000c1',
      'storage.remove:company-logos',
    ])
  })

  it('respuesta: conteos de la RPC y sin identidades pendientes', async () => {
    fixture(h.state)
    const body = await (await request()).json()
    expect(body).toEqual({
      ok: true,
      deleted: {
        company_id: EMPRESA, nombre: NOMBRE, usuarios: 1, cuentas_cliente: 1, clientes: 2,
        proyectos: 2, unidades: 1, superadmins_desligados: 1,
      },
      auth_pendientes: [],
    })
  })

  it('el logo se borra con la ruta que devolvió la RPC; si falla, la purga sigue en 200', async () => {
    fixture(h.state)
    h.state.storageResult = { data: null, error: { message: 'storage caído' } }
    const res = await request()
    expect(res.status).toBe(200)
    expect(h.state.storageRemoves).toEqual([{ bucket: 'company-logos', paths: ['logos/x.png'] }])
  })
})

describe('delete-company · si la purga falla, no se borra NADA (ni en auth)', () => {
  it('falla el DELETE final de companies (FK) → 409, cero deleteUser, cero storage', async () => {
    fixture(h.state, {
      purga: {
        data: null,
        error: {
          code: '23503',
          message: 'update or delete on table "companies" violates foreign key constraint "rutas_company_id_fkey" on table "rutas"',
        },
      },
    })
    const res = await request()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('rutas_company_id_fkey')
    expect(body.error).toContain('No se borró nada')
    expect(h.state.authAdminDeletes).toEqual([])
    expect(h.state.storageRemoves).toEqual([])
    expect(h.state.calls).toEqual([])
  })

  it('un guard de inmutabilidad (23514) → 409 con su mensaje, cero deleteUser', async () => {
    fixture(h.state, {
      purga: { data: null, error: { code: '23514', message: 'BITACORA_INMUTABLE: pasarela_eventos sólo admite inserciones.' } },
    })
    const res = await request()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('BITACORA_INMUTABLE')
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it.each([
    ['PURGA_EN_GRACIA', '55000', 409],
    ['PURGA_EMPRESA_ACTIVA', '55000', 409],
    ['PURGA_RETENCION', '55000', 409],
    ['PURGA_NOMBRE_NO_COINCIDE', '22023', 400],
    ['PURGA_SOLO_SUPERADMIN', '42501', 403],
    ['PURGA_EMPRESA_NO_ENCONTRADA', 'P0002', 404],
  ])('la RPC rechaza con %s (carrera: alguien cambió la empresa) → %s → %i, cero deleteUser', async (prefijo, code, status) => {
    fixture(h.state, { purga: { data: null, error: { code, message: `${prefijo}: detalle.` } } })
    expect((await request()).status).toBe(status)
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('error desconocido → 500 genérico, cero deleteUser', async () => {
    fixture(h.state, { purga: { data: null, error: { code: 'XX000', message: 'algo' } } })
    expect((await request()).status).toBe(500)
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('respuesta de la RPC sin usuarios_auth → 500 que lo dice; no se adivina a quién borrar', async () => {
    fixture(h.state, { purga: { data: { company_id: EMPRESA, nombre: NOMBRE }, error: null } })
    const res = await request()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/audit_log/)
    expect(h.state.authAdminDeletes).toEqual([])
  })
})

describe('delete-company · auth después del COMMIT', () => {
  it('un deleteUser que falla → 200 con auth_pendientes y aviso; los demás se borran igual', async () => {
    fixture(h.state)
    h.state.authAdminResults[PURGA_OK.usuarios_auth[0]] = { data: null, error: { status: 500, message: 'gotrue caído' } }
    const res = await request()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.auth_pendientes).toEqual([PURGA_OK.usuarios_auth[0]])
    expect(body.aviso).toMatch(/1 acceso/)
    expect(h.state.authAdminDeletes).toEqual(PURGA_OK.usuarios_auth)
  })

  it('un deleteUser que LANZA (red caída) también queda pendiente: 200, no el 500 del catch general', async () => {
    fixture(h.state)
    // Thenable que rechaza al adoptarse: un Promise.reject creado aquí sería un
    // rechazo «no manejado» antes de que el handler llegara a esperarlo.
    h.state.authAdminResults[PURGA_OK.usuarios_auth[1]] = { then: (_ok: unknown, rechazar: (e: Error) => void) => rechazar(new Error('red caída')) }
    const res = await request()
    expect(res.status).toBe(200)
    expect((await res.json()).auth_pendientes).toEqual([PURGA_OK.usuarios_auth[1]])
  })

  it('el borrado del logo que LANZA no convierte la purga confirmada en 500', async () => {
    fixture(h.state)
    h.state.storageResult = { then: (_ok: unknown, rechazar: (e: Error) => void) => rechazar(new Error('storage caído')) }
    expect((await request()).status).toBe(200)
  })

  it('una identidad que ya no existe (404) no queda pendiente', async () => {
    fixture(h.state)
    h.state.authAdminResults[PURGA_OK.usuarios_auth[1]] = { data: null, error: { status: 404, code: 'user_not_found', message: 'User not found' } }
    const body = await (await request()).json()
    expect(body.auth_pendientes).toEqual([])
    expect(body.aviso).toBeUndefined()
  })
})

describe('delete-company · Stripe: ensayo, cancelación, purga', () => {
  const SUB = [{ id: 's1', stripe_subscription_id: 'sub_123', status: 'active' }]
  const ENSAYO_OK = { data: null, error: { code: 'P0001', message: 'PURGA_ENSAYO_OK: la purga se completaría.' } }

  it('con suscripción viva: ensayo → cancelar → purga → auth, en ese orden', async () => {
    fixture(h.state, { subs: SUB })
    h.state.rpcQueues.purgar_empresa = [ENSAYO_OK, { data: PURGA_OK, error: null }]
    const res = await request()
    expect(res.status).toBe(200)
    expect(h.state.secuencia).toEqual([
      'rpc:purgar_empresa',
      'stripe.cancel:sub_123',
      'rpc:purgar_empresa',
      'auth.deleteUser:a0000000-0000-4000-8000-0000000000a1',
      'auth.deleteUser:a0000000-0000-4000-8000-0000000000c1',
      'storage.remove:company-logos',
    ])
    const [ensayo, purga] = rpcsPurga()
    expect(ensayo.args).toMatchObject({ p_ensayo: true, p_stripe_subscription_id: 'sub_123' })
    expect(purga.args).toMatchObject({ p_stripe_subscription_id: 'sub_123' })
    expect(purga.args).not.toHaveProperty('p_ensayo')
  })

  it('el ensayo falla (guard de inmutabilidad) → 409 y Stripe NO se toca', async () => {
    fixture(h.state, { subs: SUB })
    h.state.rpcQueues.purgar_empresa = [
      { data: null, error: { code: '23514', message: 'BITACORA_INMUTABLE: pasarela_eventos sólo admite inserciones.' } },
    ]
    const res = await request()
    expect(res.status).toBe(409)
    expect(h.stripe.cancels).toEqual([])
    expect(rpcsPurga()).toHaveLength(1)
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('el ensayo choca con la retención → 409 con el motivo y Stripe NO se toca', async () => {
    fixture(h.state, { subs: SUB })
    h.state.rpcQueues.purgar_empresa = [
      { data: null, error: { code: '55000', message: 'PURGA_RETENCION: la empresa tiene historia que se conserva: anticipos (2). Queda suspendida; no se purgó nada.' } },
    ]
    const res = await request()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('anticipos (2)')
    expect(h.stripe.cancels).toEqual([])
    expect(rpcsPurga()).toHaveLength(1)
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('un ensayo que «confirma» (no se revirtió) → 500 y Stripe NO se toca', async () => {
    fixture(h.state, { subs: SUB })
    h.state.rpcQueues.purgar_empresa = [{ data: PURGA_OK, error: null }]
    expect((await request()).status).toBe(500)
    expect(h.stripe.cancels).toEqual([])
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('sin STRIPE_PLATFORM_SECRET_KEY → 503 sin efectos', async () => {
    h.env.STRIPE_PLATFORM_SECRET_KEY = undefined
    fixture(h.state, { subs: SUB })
    expect((await request()).status).toBe(503)
    expectSinEfectos()
  })

  it('error al leer la suscripción → 500 sin efectos (no se arriesga un cobro huérfano)', async () => {
    fixture(h.state)
    h.state.byTable.subscriptions = { data: null, error: { message: 'boom' } }
    expect((await request()).status).toBe(500)
    expectSinEfectos()
  })

  it('Stripe falla de verdad → 502 y la purga NO corre', async () => {
    fixture(h.state, { subs: SUB })
    h.state.rpcQueues.purgar_empresa = [ENSAYO_OK, { data: PURGA_OK, error: null }]
    h.stripe.cancelError = 'rate_limit exceeded'
    expect((await request()).status).toBe(502)
    expect(rpcsPurga()).toHaveLength(1) // sólo el ensayo
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('suscripción ya cancelada en Stripe → la purga sigue', async () => {
    fixture(h.state, { subs: SUB })
    h.state.rpcQueues.purgar_empresa = [ENSAYO_OK, { data: PURGA_OK, error: null }]
    h.stripe.cancelError = 'No such subscription: sub_123'
    expect((await request()).status).toBe(200)
    expect(rpcsPurga()).toHaveLength(2)
  })
})
