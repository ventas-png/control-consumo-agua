// Tests del HANDLER completo de delete-own-account (index.ts). Mismo harness que delete-company: Deno stubbeado, supabase-js (esm.sh) mockeado
// con el fake compartido de _shared/__tests__/fakeSupabase.ts, el SDK de Stripe mockeado; cors y rateLimit corren REALES.
//
// Cada compuerta se fija por su EFECTO: el status Y lo que se escribió (o no). `state.secuencia` fija el orden «Stripe → suspender → roles →
// perfil → auth → auditoría», que es lo que hace que un fallo a medias sea recuperable (una empresa suspendida con su propietario vivo lo
// reactiva el superadministrador; un propietario borrado con la empresa activa es una empresa sin principal).
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { emptyState, type FakeSupabaseState } from '../../_shared/__tests__/fakeSupabase.ts'
import { MSG_SIN_STRIPE, MSG_STRIPE_FALLO, MSG_SUPERADMIN, SUSPENSION_REASON } from '../validate.ts'

const h = vi.hoisted(() => ({
  env: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
    SUPABASE_ANON_KEY: 'anon-key',
    STRIPE_PLATFORM_SECRET_KEY: 'sk_test_x',
  } as Record<string, string | undefined>,
  state: null as unknown as FakeSupabaseState,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
  stripe: { cancels: [] as string[], cancelError: null as string | null },
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
const YO = 'a0000000-0000-4000-8000-00000000000a'
const EMPRESA = 'e1000000-0000-4000-8000-000000000001'

function request(opts: { body?: unknown; rawBody?: string; origin?: string | null; token?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'vitest', 'X-Forwarded-For': '203.0.113.9' }
  const origin = opts.origin === undefined ? ORIGEN : opts.origin
  if (origin) headers.Origin = origin
  const token = opts.token === undefined ? 'jwt-valido' : opts.token
  if (token) headers.Authorization = `Bearer ${token}`
  return h.served.handler!(new Request('https://edge.test/delete-own-account', {
    method: 'POST', headers, body: opts.rawBody ?? JSON.stringify(opts.body ?? { confirm: 'ELIMINAR' }),
  }))
}
const eliminar = () => request()
const previsualizar = () => request({ body: { dry_run: true } })

type Perfil = { id: string; role: string; company_id: string | null; full_name: string | null; cliente_id: string | null }
function soy(role: string, company_id: string | null = EMPRESA, extra: Partial<Perfil> = {}) {
  const perfil: Perfil = { id: YO, role, company_id, full_name: 'Yo Mismo', cliente_id: null, ...extra }
  h.state.readQueues.app_users = [{ data: perfil, error: null }]
  return perfil
}
/** Las OTRAS personas activas que el handler lee para un propietario (segunda lectura de app_users). */
function otros(rows: Array<{ id: string; role: string; activo?: boolean }>) {
  h.state.readQueues.app_users!.push({ data: rows.map((r) => ({ activo: true, ...r })), error: null })
}
function sinPerfil() { h.state.readQueues.app_users = [{ data: null, error: null }] }

const borrados = (tabla: string) => h.state.calls.filter((c) => c.table === tabla && c.op === 'delete')
const actualizaciones = (tabla: string) => h.state.calls.filter((c) => c.table === tabla && c.op === 'update')
const inserciones = (tabla: string) => h.state.calls.filter((c) => c.table === tabla && c.op === 'insert')
function nadaEscrito() {
  expect(h.state.calls).toEqual([])
  expect(h.state.authAdminDeletes).toEqual([])
  expect(h.stripe.cancels).toEqual([])
}
async function mensaje(r: Response): Promise<string> { return ((await r.json()) as { error: string }).error }

beforeEach(() => {
  Object.assign(h.state, emptyState())
  h.state.auth = { data: { user: { id: YO, app_metadata: { provider: 'email' } } }, error: null }
  h.state.rpcs.rate_limit_hit = { data: true, error: null }
  h.state.byTable.subscriptions = { data: [], error: null }
  h.stripe.cancels = []
  h.stripe.cancelError = null
  h.env.STRIPE_PLATFORM_SECRET_KEY = 'sk_test_x'
})

describe('delete-own-account · entrada', () => {
  it('sin JWT → 401; JWT inválido → 401; origen no permitido → 403; en todos, nada se escribe', async () => {
    soy('operator')
    expect((await request({ token: null })).status).toBe(401)
    h.state.auth = { data: { user: null }, error: { message: 'invalid' } }
    expect((await eliminar()).status).toBe(401)
    h.state.auth = { data: { user: { id: YO } }, error: null }
    expect((await request({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await request({ origin: null })).status).toBe(403)
    nadaEscrito()
  })

  it('cuerpo sin la palabra exacta, con otra palabra, en minúsculas, o que no es un objeto JSON → 400 y nada se escribe', async () => {
    soy('operator')
    for (const body of [{}, { confirm: 'eliminar' }, { confirm: 'SI' }, { user_id: YO }]) expect((await request({ body })).status).toBe(400)
    for (const rawBody of ['null', '[]', '7', '"ELIMINAR"', '{no es json']) expect((await request({ rawBody })).status).toBe(400)
    nadaEscrito()
  })

  it('el límite de tasa por usuario devuelve 429 antes de leer el perfil', async () => {
    soy('operator')
    h.state.rpcs.rate_limit_hit = { data: false, error: null }
    const r = await eliminar()
    expect(r.status).toBe(429)
    expect(h.state.rpcCalls[0]).toMatchObject({ fn: 'rate_limit_hit', args: { p_subject: YO, p_action: 'delete_own_account' } })
    nadaEscrito()
  })

  it('el rol sale de app_users (service_role), nunca de los claims del token: claims de superadministrador no frenan a un operador, y al revés', async () => {
    h.state.auth = { data: { user: { id: YO, app_metadata: { role: 'super_admin' }, user_metadata: { role: 'super_admin' } } }, error: null }
    soy('operator')
    expect((await eliminar()).status).toBe(200)
    expect(h.state.authAdminDeletes).toEqual([YO])

    Object.assign(h.state, emptyState())
    h.state.rpcs.rate_limit_hit = { data: true, error: null }
    h.state.auth = { data: { user: { id: YO, app_metadata: { role: 'operator' } } }, error: null }
    soy('super_admin')
    expect((await eliminar()).status).toBe(403)
    nadaEscrito()
  })
})

describe('delete-own-account · quién puede y qué pasa', () => {
  it('el superadministrador (ambas grafías) → 403 con el motivo; nada se escribe', async () => {
    for (const rol of ['super_admin', 'superadmin']) {
      soy(rol, null)
      const r = await eliminar()
      expect(r.status).toBe(403)
      expect(await mensaje(r)).toBe(MSG_SUPERADMIN)
    }
    nadaEscrito()
  })

  for (const rol of ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector', 'user']) {
    it(`${rol}: borra user_roles, el rol de ajustes y el perfil (en ese orden), después el acceso; la empresa NO se toca`, async () => {
      soy(rol)
      const r = await eliminar()
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ ok: true, empresa_suspendida: false })
      expect(h.state.secuencia).toEqual([
        'rpc:rate_limit_hit', 'delete:user_roles', 'delete:roles', 'delete:app_users', `auth.deleteUser:${YO}`,
        'insert:permission_audit_log', 'insert:security_logs',
      ])
      expect(actualizaciones('companies')).toHaveLength(0)
      expect(h.stripe.cancels).toEqual([])
    })
  }

  it('la cuenta de portal (cliente, sin empresa): se borra el perfil y el acceso; la fila de `clientes` (expediente de la empresa) NO se toca', async () => {
    soy('cliente', null, { cliente_id: 'c1000000-0000-4000-8000-000000000001' })
    const r = await eliminar()
    expect(r.status).toBe(200)
    expect(borrados('app_users')).toHaveLength(1)
    expect(h.state.authAdminDeletes).toEqual([YO])
    expect(h.state.calls.some((c) => c.table === 'clientes')).toBe(false)
    expect(actualizaciones('companies')).toHaveLength(0)
    expect(inserciones('permission_audit_log')[0]?.payload).toMatchObject({ action: 'user_deleted', details: { role: 'cliente', cliente_id: 'c1000000-0000-4000-8000-000000000001', self_service: true } })
  })

  it('un login SIN fila en app_users (huérfano) borra sólo el acceso y deja rastro en security_logs', async () => {
    sinPerfil()
    const r = await eliminar()
    expect(r.status).toBe(200)
    expect(h.state.secuencia).toEqual(['rpc:rate_limit_hit', `auth.deleteUser:${YO}`, 'insert:security_logs'])
    expect(inserciones('security_logs')[0]?.payload).toMatchObject({ user_id: YO, event_type: 'account_deleted', details: { had_profile: false }, ip_address: '203.0.113.9', user_agent: 'vitest' })
  })

  it('el propietario con OTRO propietario activo se borra y la empresa sigue activa', async () => {
    soy('company_owner'); otros([{ id: 'u-2', role: 'company_owner' }, { id: 'u-3', role: 'admin' }])
    const r = await eliminar()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, empresa_suspendida: false })
    expect(actualizaciones('companies')).toHaveLength(0)
    expect(h.state.authAdminDeletes).toEqual([YO])
    // La segunda lectura de app_users se acota a la empresa del llamador, a activos y sin él: lo fija el handler, no el fake
    expect(h.state.readQueues.app_users).toEqual([])
  })

  it('el ÚNICO propietario con más gente activa → 409 con el remedio; nada se escribe (tampoco en dry_run)', async () => {
    soy('company_owner'); otros([{ id: 'u-3', role: 'admin' }, { id: 'u-4', role: 'operator' }])
    const r = await eliminar()
    expect(r.status).toBe(409)
    expect(await mensaje(r)).toMatch(/único propietario.*2 personas más tienen acceso/)
    nadaEscrito()

    soy('company_owner'); otros([{ id: 'u-3', role: 'admin' }])
    const p = await previsualizar()
    expect(p.status).toBe(409)
    expect(await mensaje(p)).toMatch(/otra persona tiene acceso/)
    nadaEscrito()
  })

  it('el ÚNICO propietario y solo (o sólo con inactivos, superadministradores y clientes): la empresa se SUSPENDE antes de borrar su cuenta', async () => {
    soy('company_owner'); otros([{ id: 'u-3', role: 'admin', activo: false }, { id: 'u-7', role: 'super_admin' }, { id: 'u-9', role: 'cliente' }])
    const r = await eliminar()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, empresa_suspendida: true })
    expect(h.state.secuencia).toEqual([
      'rpc:rate_limit_hit', 'update:companies', 'delete:user_roles', 'delete:roles', 'delete:app_users', `auth.deleteUser:${YO}`,
      'insert:permission_audit_log', 'insert:security_logs',
    ])
    const susp = actualizaciones('companies')[0]!.payload as { activa: boolean; suspended_at: string; suspended_reason: string }
    expect(susp.activa).toBe(false)
    expect(susp.suspended_reason).toBe(SUSPENSION_REASON)
    expect(Number.isNaN(Date.parse(susp.suspended_at))).toBe(false)
    expect(inserciones('permission_audit_log')[0]?.payload).toMatchObject({ details: { company_suspended: true, self_service: true } })
    expect(h.stripe.cancels).toEqual([])
  })

  it('dry_run responde lo que pasaría y NO escribe nada: suspende_empresa true para el propietario solo, false para el staff', async () => {
    soy('company_owner'); otros([])
    const p1 = await previsualizar()
    expect(p1.status).toBe(200)
    expect(await p1.json()).toEqual({ ok: true, dry_run: true, suspende_empresa: true })
    nadaEscrito()

    soy('operator')
    const p2 = await previsualizar()
    expect(await p2.json()).toEqual({ ok: true, dry_run: true, suspende_empresa: false })
    nadaEscrito()

    sinPerfil()
    expect(await (await previsualizar()).json()).toEqual({ ok: true, dry_run: true, suspende_empresa: false })
    nadaEscrito()
  })
})

describe('delete-own-account · Stripe (sólo cuando la empresa se suspende)', () => {
  const SUB = [{ id: 's1', stripe_subscription_id: 'sub_123', status: 'active' }]

  it('con suscripción viva: se cancela en Stripe ANTES de suspender y de borrar', async () => {
    soy('company_owner'); otros([])
    h.state.byTable.subscriptions = { data: SUB, error: null }
    const r = await eliminar()
    expect(r.status).toBe(200)
    expect(h.state.secuencia.slice(0, 3)).toEqual(['rpc:rate_limit_hit', 'stripe.cancel:sub_123', 'update:companies'])
    expect(h.state.authAdminDeletes).toEqual([YO])
  })

  it('sin STRIPE_PLATFORM_SECRET_KEY → 503 con la salida (cancelar desde el portal de facturación) y nada se escribe', async () => {
    soy('company_owner'); otros([])
    h.state.byTable.subscriptions = { data: SUB, error: null }
    h.env.STRIPE_PLATFORM_SECRET_KEY = undefined
    const r = await eliminar()
    expect(r.status).toBe(503)
    expect(await mensaje(r)).toBe(MSG_SIN_STRIPE)
    nadaEscrito()
  })

  it('Stripe falla de verdad → 502 y nada se escribe; «ya cancelada» es benigno y se sigue', async () => {
    soy('company_owner'); otros([])
    h.state.byTable.subscriptions = { data: SUB, error: null }
    h.stripe.cancelError = 'card_declined'
    const r = await eliminar()
    expect(r.status).toBe(502)
    expect(await mensaje(r)).toBe(MSG_STRIPE_FALLO)
    expect(h.state.calls).toEqual([])
    expect(h.state.authAdminDeletes).toEqual([])

    Object.assign(h.state, emptyState())
    h.state.auth = { data: { user: { id: YO } }, error: null }
    h.state.rpcs.rate_limit_hit = { data: true, error: null }
    soy('company_owner'); otros([])
    h.state.byTable.subscriptions = { data: SUB, error: null }
    h.stripe.cancelError = 'No such subscription: sub_123'
    expect((await eliminar()).status).toBe(200)
    expect(actualizaciones('companies')).toHaveLength(1)
  })

  it('el staff no toca Stripe aunque la empresa tenga suscripción viva', async () => {
    soy('admin')
    h.state.byTable.subscriptions = { data: SUB, error: null }
    expect((await eliminar()).status).toBe(200)
    expect(h.stripe.cancels).toEqual([])
    expect(actualizaciones('companies')).toHaveLength(0)
  })
})

describe('delete-own-account · fallos a medias', () => {
  it('si el perfil no se puede borrar → 500 y el acceso NO se toca', async () => {
    soy('operator')
    h.state.writes.app_users = { data: null, error: { message: 'FK bloquea' } }
    const r = await eliminar()
    expect(r.status).toBe(500)
    expect(await mensaje(r)).toMatch(/No se pudo eliminar tu perfil/)
    expect(h.state.authAdminDeletes).toEqual([])
    expect(inserciones('permission_audit_log')).toHaveLength(0)
  })

  it('si la empresa no se puede suspender → 500 y ni el perfil ni el acceso se tocan', async () => {
    soy('company_owner'); otros([])
    h.state.writes.companies = { data: null, error: { message: 'RLS' } }
    const r = await eliminar()
    expect(r.status).toBe(500)
    expect(await mensaje(r)).toMatch(/No se pudo suspender tu empresa/)
    expect(borrados('app_users')).toHaveLength(0)
    expect(h.state.authAdminDeletes).toEqual([])
  })

  it('si auth falla tras borrar el perfil → 500 que lo dice; si auth responde «no existe» → 200 (idempotente)', async () => {
    soy('operator')
    h.state.authAdminResults[YO] = { data: null, error: { message: 'boom', status: 500 } }
    const r = await eliminar()
    expect(r.status).toBe(500)
    expect(await mensaje(r)).toMatch(/perfil se eliminó, pero no se pudo eliminar el acceso/)

    Object.assign(h.state, emptyState())
    h.state.auth = { data: { user: { id: YO } }, error: null }
    h.state.rpcs.rate_limit_hit = { data: true, error: null }
    soy('operator')
    h.state.authAdminResults[YO] = { data: null, error: { message: 'User not found', status: 404 } }
    expect((await eliminar()).status).toBe(200)
    expect(inserciones('security_logs')).toHaveLength(1)
  })

  it('si no se puede leer el perfil o el resto de la empresa → 500 sin escribir', async () => {
    h.state.readQueues.app_users = [{ data: null, error: { message: 'db caída' } }]
    expect((await eliminar()).status).toBe(500)
    nadaEscrito()

    soy('company_owner')
    h.state.readQueues.app_users!.push({ data: null, error: { message: 'db caída' } })
    expect((await eliminar()).status).toBe(500)
    nadaEscrito()
  })
})
