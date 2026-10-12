// HANDLER completo de create-user (index.ts, con el cliente del llamador y el de servicio simulados): el control real del camino por service_role.
// La regla «el rol admin solo lo otorga el principal de la empresa» (company_owner / super_admin) se prueba AQUÍ, con el cableado de index.ts, y no sólo en la
// función pura createRoleDenial (validate.test.ts): un `if (denial)` desactivado o un rol del llamador leído de los claims del token dejarían pasar a un administrador.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { estadoVacio, type EstadoDosClientes } from '../../_shared/__tests__/fakeSupabaseDosClientes.ts'

const h = vi.hoisted(() => ({
  st: null as unknown as EstadoDosClientes,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
}))

vi.mock('https://esm.sh/@supabase/supabase-js@2', async () => {
  const { makeCreateClient } = await import('../../_shared/__tests__/fakeSupabaseDosClientes.ts')
  return { createClient: (...a: unknown[]) => (makeCreateClient(h.st) as (...x: unknown[]) => unknown)(...a) }
})
vi.mock('../../_shared/rateLimit.ts', () => ({ enforceRateLimit: async () => null, getClientIp: () => '1.1.1.1' }))

beforeAll(async () => {
  h.st = estadoVacio()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

beforeEach(() => { Object.assign(h.st, estadoVacio()) })

const C = 'company-C'
const D = 'company-D'

function llamar(cuerpoCrudo: string): Promise<Response> {
  return h.served.handler!(new Request('https://edge.test/create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', Origin: 'https://administratodo.com' },
    body: cuerpoCrudo,
  }))
}
const cuerpo = (role: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ email: 'Nuevo@Ejemplo.com ', password: 'Abcdef12', full_name: 'Nuevo', role, company_id: C, ...extra })

function como(role: string | null, company: string | null = C, user: Record<string, unknown> = { id: 'u-llamador' }) {
  h.st.user = user
  h.st.perfilLlamador = role === null ? null : { role, company_id: company }
}
const escribioAppUser = () => h.st.writes.filter(w => w.table === 'app_users' && w.op === 'insert')
const escribioUserRoles = () => h.st.writes.filter(w => w.table === 'user_roles' && w.op === 'insert')

describe('create-user · el administrador NO fabrica administradores (variantes de entrada del rol)', () => {
  const variantes: Array<[string, unknown]> = [
    ['admin', 'admin'], ['Admin', 'Admin'], ['ADMIN', 'ADMIN'], [' admin', ' admin'], ['admin ', 'admin '], ['tab', '\tadmin'],
    ['administrador', 'administrador'], ['superadmin', 'superadmin'], ['super_admin', 'super_admin'], ['company_owner', 'company_owner'],
    ['array', ['admin']], ['objeto', { role: 'admin' }], ['null', null], ['numero', 0], ['true', true], ['NUL', 'admin\u0000'], ['i turca', 'admın'],
    ['rol vacío', ''], ['cadena larga', 'admin'.padEnd(5000, ' ')],
  ]
  for (const [etq, valor] of variantes) {
    it(`administrador + role=${etq}: no se crea nada`, async () => {
      como('admin')
      const r = await llamar(cuerpo(valor))
      expect([400, 403]).toContain(r.status)
      expect(h.st.createUser).toHaveLength(0)
      expect(escribioAppUser()).toHaveLength(0)
      expect(escribioUserRoles()).toHaveLength(0)
    })
  }

  it('rol REPETIDO en el JSON crudo ({"role":"operator", ..., "role":"admin"}): gana el último y se rechaza', async () => {
    como('admin')
    const crudo = `{"email":"a@b.co","password":"Abcdef12","full_name":"N","role":"operator","company_id":"${C}","role":"admin"}`
    const r = await llamar(crudo)
    expect(r.status).toBe(403)
    expect(escribioAppUser()).toHaveLength(0)
  })

  it('rol repetido al revés ({"role":"admin", ..., "role":"operator"}): gana el último, es un operador y se crea como tal (no admin)', async () => {
    como('admin')
    const crudo = `{"email":"a@b.co","password":"Abcdef12","full_name":"N","role":"admin","company_id":"${C}","role":"operator"}`
    const r = await llamar(crudo)
    expect(r.status).toBe(200)
    expect((escribioAppUser()[0].payload as { role: string }).role).toBe('operator')
  })

  it('el rol del llamador sale de app_users por SU cliente con JWT, no de claims: app_metadata/user_metadata falsos no lo ascienden', async () => {
    como('admin', C, { id: 'u-llamador', app_metadata: { role: 'company_owner' }, user_metadata: { role: 'super_admin', rol: 'company_owner' }, role: 'authenticated' })
    const r = await llamar(cuerpo('admin'))
    expect(r.status).toBe(403)
    expect(h.st.lecturasLlamador.some(l => l.table === 'app_users')).toBe(true)
    expect(escribioAppUser()).toHaveLength(0)
  })

  it('sin fila en app_users el llamador no puede nada (403)', async () => {
    como(null)
    expect((await llamar(cuerpo('operator'))).status).toBe(403)
    expect(h.st.createUser).toHaveLength(0)
  })

  for (const rol of ['operator', 'operador', 'viewer', 'visor', 'collector', 'cliente', 'user']) {
    it(`llamador ${rol} no gestiona usuarios (403)`, async () => {
      como(rol)
      expect((await llamar(cuerpo('operator'))).status).toBe(403)
      expect(h.st.createUser).toHaveLength(0)
    })
  }
})

describe('create-user · lo legítimo sigue funcionando', () => {
  it('el propietario crea un administrador en SU empresa: app_users admin + user_roles 201 con assigned_by', async () => {
    como('company_owner')
    const r = await llamar(cuerpo('admin'))
    expect(r.status).toBe(200)
    expect(escribioAppUser()[0].payload).toMatchObject({ role: 'admin', company_id: C, activo: true })
    expect(escribioUserRoles()[0].payload).toMatchObject({ role_id: '00000000-0000-0000-0000-000000000201', assigned_by: 'u-llamador' })
    // el email se normaliza (trim + minúsculas)
    expect(h.st.createUser[0]).toMatchObject({ email: 'nuevo@ejemplo.com' })
  })

  it('el administrador crea un operador (se conserva)', async () => {
    como('admin')
    const r = await llamar(cuerpo('operator'))
    expect(r.status).toBe(200)
    expect((escribioAppUser()[0].payload as { role: string }).role).toBe('operator')
  })

  it('el propietario de OTRA empresa (D) no crea nada en C aunque pida admin (403)', async () => {
    como('company_owner', D)
    const r = await llamar(cuerpo('admin'))
    expect(r.status).toBe(403)
    expect(escribioAppUser()).toHaveLength(0)
  })

  it('el propietario NO crea company_owner ni super_admin ni superadmin (403)', async () => {
    for (const rol of ['company_owner', 'super_admin', 'superadmin']) {
      como('company_owner')
      expect((await llamar(cuerpo(rol))).status).toBe(403)
    }
    expect(escribioAppUser()).toHaveLength(0)
  })

  for (const grafia of ['super_admin', 'superadmin']) {
    it(`${grafia} crea un administrador en cualquier empresa (D)`, async () => {
      como(grafia, null)
      const r = await llamar(cuerpo('admin', { company_id: D }))
      expect(r.status).toBe(200)
      expect(escribioAppUser()[0].payload).toMatchObject({ role: 'admin', company_id: D })
    })
  }

  it('role cliente se rechaza para todos (400), también al superadministrador', async () => {
    como('super_admin', null)
    expect((await llamar(cuerpo('cliente'))).status).toBe(400)
  })

  it('si falla user_roles se revierte (app_users y auth) — el administrador creado por el propietario no queda a medias', async () => {
    como('company_owner')
    h.st.escrituras.user_roles = { data: null, error: { message: 'boom' } }
    const r = await llamar(cuerpo('admin'))
    expect(r.status).toBe(500)
    expect(h.st.writes.some(w => w.table === 'app_users' && w.op === 'delete')).toBe(true)
    expect(h.st.deleteUser).toEqual(['nuevo-1'])
  })
})

describe('create-user · flujo del superadministrador (alta del propietario de una empresa nueva)', () => {
  for (const grafia of ['super_admin', 'superadmin']) {
    it(`${grafia} crea un company_owner en la empresa D: app_users company_owner y SIN rol de plataforma`, async () => {
      como(grafia, null)
      const r = await llamar(cuerpo('company_owner', { company_id: D }))
      expect(r.status).toBe(200)
      expect(escribioAppUser()[0].payload).toMatchObject({ role: 'company_owner', company_id: D })
      expect(escribioUserRoles()).toHaveLength(0)
    })
  }
})
