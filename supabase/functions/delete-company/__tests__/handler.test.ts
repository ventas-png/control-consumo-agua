// HANDLER de delete-company (index.ts, con supabase-js y el SDK de Stripe simulados). La lógica pura (gates, partición de usuarios, snapshot) ya la cubre
// logic.test.ts; aquí se fija el CABLEADO que ninguna prueba pura ve:
//   · el superadministrador que cuelga de la empresa se DESLIGA con un único UPDATE que limpia company_id Y project_id. El trigger trg_validar_proyecto_app_users
//     (migración 20261026000700) rechaza una persona con proyecto y sin empresa, así que sin project_id: null ese UPDATE falla en la base de datos y el
//     superadministrador queda colgando de la empresa que se va a borrar (V8-09 X01: quitar project_id: null sobrevivía a vitest);
//   · la compuerta de origen: index.ts llamaba a getAllowedOrigins(), que _shared/cors.ts no exporta (ni se importaba): en Deno era un ReferenceError fuera del
//     try, es decir, TODA petición que no fuera OPTIONS terminaba en 500 sin llegar a la purga. Montar el manejador lo destapó.
// Doble mínimo y local (no el compartido fakeSupabaseDosClientes.ts): este manejador lee app_users TRES veces con el cliente de servicio (rol del llamador, conteo
// y lista de usuarios), usa .not() y head:true, y el doble compartido devuelve una única lectura por tabla.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

interface Escritura { table: string; op: 'insert' | 'update' | 'delete'; payload: unknown; filtros: Array<[string, ...unknown[]]> }

const h = vi.hoisted(() => ({
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
  st: {
    user: null as Record<string, unknown> | null,
    rolLlamador: null as string | null,
    empresa: null as Record<string, unknown> | null,
    usuarios: [] as Array<{ id: string; role: string; full_name: string | null }>,
    writes: [] as Escritura[],
    deleteUser: [] as string[],
    stripeCancel: [] as string[],
  },
}))

function estadoInicial() {
  return { user: null, rolLlamador: null, empresa: null, usuarios: [], writes: [], deleteUser: [], stripeCancel: [] }
}

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => {
  // Lectura del cliente de servicio según tabla y forma de la consulta: el rol del llamador es `.select('role')`; el conteo, `{ head: true }`.
  function lectura(table: string, cols: string, opts: { head?: boolean } | undefined) {
    if (opts?.head) return { data: null, count: 0, error: null }
    if (table === 'app_users' && cols === 'role') return { data: h.st.rolLlamador ? { role: h.st.rolLlamador } : null, error: h.st.rolLlamador ? null : { message: 'PGRST116' } }
    if (table === 'app_users') return { data: h.st.usuarios, error: null }
    if (table === 'companies') return { data: h.st.empresa, error: h.st.empresa ? null : { message: 'PGRST116' } }
    return { data: null, error: null }  // subscriptions: sin suscripción viva
  }
  function builder(table: string) {
    let op: 'read' | Escritura['op'] = 'read'
    let cols = ''
    let opts: { head?: boolean } | undefined
    const filtros: Escritura['filtros'] = []
    const resolver = () => (op === 'read' ? lectura(table, cols, opts) : { data: null, error: null })
    const b: Record<string, unknown> = {}
    b.select = (c?: string, o?: { head?: boolean }) => { if (op === 'read') { cols = c ?? ''; opts = o } return b }
    for (const m of ['eq', 'neq', 'in', 'not', 'is']) b[m] = (...a: unknown[]) => { filtros.push([m, ...a]); return b }
    b.insert = (payload: unknown) => { op = 'insert'; h.st.writes.push({ table, op, payload, filtros }); return b }
    b.update = (payload: unknown) => { op = 'update'; h.st.writes.push({ table, op, payload, filtros }); return b }
    b.delete = () => { op = 'delete'; h.st.writes.push({ table, op, payload: null, filtros }); return b }
    b.single = () => Promise.resolve(resolver())
    b.maybeSingle = () => Promise.resolve(resolver())
    ;(b as { then: unknown }).then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko)
    return b
  }
  return {
    createClient: (_url: string, _key: string, o?: { global?: unknown }) => o?.global
      ? { auth: { getUser: async () => ({ data: { user: h.st.user }, error: h.st.user ? null : { message: 'invalid' } }) } }
      : {
          from: builder,
          auth: { admin: { deleteUser: async (id: string) => { h.st.deleteUser.push(id); return { error: null } } } },
          storage: { from: () => ({ remove: async () => ({ error: null }) }) },
        },
  }
})

vi.mock('https://esm.sh/stripe@17.4.0?target=deno', () => ({
  default: class { subscriptions = { cancel: async (id: string) => { h.st.stripeCancel.push(id) } } },
}))

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

const DIA_MS = 24 * 60 * 60 * 1000
const D = 'company-D'

beforeEach(() => {
  Object.assign(h.st, estadoInicial())
  h.st.user = { id: 'u-sa' }
  h.st.rolLlamador = 'super_admin'
  // Suspendida hace 200 días: pasa la gracia por omisión (90).
  h.st.empresa = { id: D, nombre: 'Empresa D', activa: false, suspended_at: new Date(Date.now() - 200 * DIA_MS).toISOString(), suspended_reason: 'impago', logo_url: null, created_at: '2025-01-01T00:00:00.000Z' }
})

function purgar(origin = 'https://administratodo.com'): Promise<Response> {
  return h.served.handler!(new Request('https://edge.test/delete-company', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', Origin: origin },
    body: JSON.stringify({ company_id: D, confirm_name: 'Empresa D' }),
  }))
}
const deAppUsers = (op: Escritura['op']) => h.st.writes.filter(w => w.table === 'app_users' && w.op === op)

describe('delete-company · el superadministrador que cuelga de la empresa se desliga sin proyecto (V8-09 X01)', () => {
  it('UN UPDATE por superadministrador colgado, con company_id: null Y project_id: null, acotado a su id; el resto se purga y la empresa se borra', async () => {
    h.st.usuarios = [
      { id: 'u-sa-colgado', role: 'superadmin', full_name: 'SA colgado' },
      { id: 'u-op', role: 'operator', full_name: 'Operador' },
    ]
    const r = await purgar()
    expect(r.status).toBe(200)
    const desliga = deAppUsers('update')
    expect(desliga).toHaveLength(1)
    expect(desliga[0].payload).toHaveProperty('company_id', null)
    expect(desliga[0].payload).toHaveProperty('project_id', null)
    expect(desliga[0].filtros).toEqual([['eq', 'id', 'u-sa-colgado']])
    // al superadministrador no se le borra: sólo al operador
    expect(deAppUsers('delete').map(w => w.filtros)).toEqual([[['eq', 'id', 'u-op']]])
    expect(h.st.deleteUser).toEqual(['u-op'])
    expect(h.st.writes.some(w => w.table === 'companies' && w.op === 'delete')).toBe(true)
  })

  it('sin superadministradores colgados no hay ningún UPDATE de app_users', async () => {
    h.st.usuarios = [{ id: 'u-op', role: 'operator', full_name: 'Operador' }]
    expect((await purgar()).status).toBe(200)
    expect(deAppUsers('update')).toHaveLength(0)
  })
})

describe('delete-company · compuertas previas (se conservan)', () => {
  it('un origen no permitido: 403 «Origin not allowed» sin escribir nada', async () => {
    const r = await purgar('https://evil.example')
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'Origin not allowed' })
    expect(h.st.writes).toHaveLength(0)
  })

  it('quien no es superadministrador (propietario incluido) no purga: 403 sin escribir nada', async () => {
    for (const rol of ['company_owner', 'admin', null]) {
      h.st.rolLlamador = rol
      expect((await purgar()).status).toBe(403)
    }
    expect(h.st.writes).toHaveLength(0)
  })
})
