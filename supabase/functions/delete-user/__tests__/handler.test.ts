// HANDLER de delete-user (index.ts, con el cliente del llamador y el de servicio simulados). Esta función borra con service_role (sin RLS) los user_roles de la persona, su
// rol de ajustes individuales y su perfil, es decir, SE SALTA user_roles_delete y roles_delete, que desde la migración 20261026000700 son sólo del principal de la empresa.
// Por eso un administrador NO elimina a otro administrador (E-07): lo elimina el propietario o el superadministrador.
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

beforeAll(async () => {
  h.st = estadoVacio()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

beforeEach(() => { Object.assign(h.st, estadoVacio()) })

function eliminar(userId: string): Promise<Response> {
  return h.served.handler!(new Request('https://edge.test/delete-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', Origin: 'https://administratodo.com' },
    body: JSON.stringify({ user_id: userId }),
  }))
}
function como(role: string, company: string | null = 'C') { h.st.user = { id: 'u-llamador' }; h.st.perfilLlamador = { role, company_id: company } }
function objetivo(role: string, company = 'C') { h.st.lecturas.app_users = { data: { id: 'u-objetivo', role, company_id: company, full_name: 'Objetivo' }, error: null } }
const borra = (t: string) => h.st.writes.filter(w => w.table === t && w.op === 'delete')

describe('delete-user · un administrador NO elimina a otro administrador (E-07)', () => {
  it('administrador → administrador de su empresa: 403 con el motivo y NO se borra nada (ni user_roles, ni roles de ajuste, ni el perfil, ni el acceso)', async () => {
    como('admin'); objetivo('admin')
    const r = await eliminar('u-objetivo')
    expect(r.status).toBe(403)
    expect(((await r.json()) as { error: string }).error).toMatch(/propietario.*administradores/i)
    expect(h.st.writes).toHaveLength(0)
    expect(h.st.deleteUser).toHaveLength(0)
  })

  it('el PROPIETARIO elimina a un administrador de su empresa: borra user_roles, el rol de ajustes y el perfil con service_role, y el acceso', async () => {
    como('company_owner'); objetivo('admin')
    const r = await eliminar('u-objetivo')
    expect(r.status).toBe(200)
    expect(borra('user_roles')).toHaveLength(1)
    expect(borra('roles')).toHaveLength(1)           // roles.user_override_for = objetivo
    expect(borra('app_users')).toHaveLength(1)
    expect(h.st.deleteUser).toEqual(['u-objetivo'])
  })

  for (const grafia of ['super_admin', 'superadmin']) {
    it(`${grafia} elimina a un administrador de cualquier empresa`, async () => {
      como(grafia, null); objetivo('admin', 'D')
      expect((await eliminar('u-objetivo')).status).toBe(200)
      expect(h.st.deleteUser).toEqual(['u-objetivo'])
    })
  }
})

describe('delete-user · lo que el administrador sigue pudiendo y lo que no', () => {
  for (const rol of ['operator', 'operador', 'viewer', 'visor', 'collector']) {
    it(`el administrador elimina a un ${rol} de su empresa`, async () => {
      como('admin'); objetivo(rol)
      expect((await eliminar('u-objetivo')).status).toBe(200)
      expect(borra('app_users')).toHaveLength(1)
    })
  }

  it('el administrador NO elimina a un propietario ni a un superadministrador, ni a nadie de otra empresa', async () => {
    for (const rol of ['company_owner', 'super_admin', 'superadmin']) {
      como('admin'); objetivo(rol)
      expect((await eliminar('u-objetivo')).status).toBe(403)
    }
    como('admin'); objetivo('operator', 'D')
    expect((await eliminar('u-objetivo')).status).toBe(403)
    expect(h.st.writes).toHaveLength(0)
  })

  it('el propietario de OTRA empresa no elimina a un administrador de C (403, cross-tenant)', async () => {
    como('company_owner', 'D'); objetivo('admin', 'C')
    expect((await eliminar('u-objetivo')).status).toBe(403)
    expect(h.st.writes).toHaveLength(0)
  })

  it('un operador, un visor y una sesión sin app_users no eliminan a nadie (403)', async () => {
    for (const rol of ['operator', 'viewer', 'collector', 'cliente']) {
      como(rol); objetivo('viewer')
      expect((await eliminar('u-objetivo')).status).toBe(403)
    }
    h.st.user = { id: 'u-llamador' }; h.st.perfilLlamador = null; objetivo('viewer')
    expect((await eliminar('u-objetivo')).status).toBe(403)
    expect(h.st.writes).toHaveLength(0)
  })

  it('nadie se elimina a sí mismo', async () => {
    como('company_owner'); objetivo('operator')
    expect((await eliminar('u-llamador')).status).toBe(400)
    como('admin')
    expect((await eliminar('u-llamador')).status).toBe(400)
  })
})
