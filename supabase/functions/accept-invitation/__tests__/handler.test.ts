// HANDLER de accept-invitation: caracterización de lo que HACE con la fila de user_invitations (que llega ya insertada por quien sea).
// accept-invitation NO decide quién puede ser administrador: usa invitation.role tal cual y no mira al invitador. El control real vive en las políticas RLS de
// user_invitations (migración 20261026000700: sólo el principal inserta, lee, modifica y borra las de role 'admin') y en el CHECK user_invitations_role_chk; estas
// pruebas fijan ese contrato para que nadie crea que la función lo comprueba, y para que un cambio que la vuelva a leer al invitador sea una decisión consciente.
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
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  await import('../index.ts')
})

beforeEach(() => {
  Object.assign(h.st, estadoVacio())
  h.st.lecturas.companies = { data: { nombre: 'Empresa C' }, error: null }
})

function aceptar(token = 'tok-xyz'): Promise<Response> {
  return h.served.handler!(new Request('https://edge.test/accept-invitation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://administratodo.com' },
    body: JSON.stringify({ token, password: 'Abcdef12', full_name: 'Invitado' }),
  }))
}
function invitacion(role: string, extra: Record<string, unknown> = {}) {
  h.st.lecturas.user_invitations = {
    data: { id: 'inv-1', company_id: 'company-C', email: 'Inv@Ejemplo.com', role, status: 'pending', expires_at: new Date(Date.now() + 86_400_000).toISOString(), ...extra },
    error: null,
  }
}
const appUsers = () => h.st.writes.filter(w => w.table === 'app_users' && w.op === 'insert')

describe('accept-invitation · usa invitation.role tal cual, sin saber quién invitó (la barrera es la RLS/CHECK)', () => {
  it('una invitación pendiente con role admin (da igual quién la insertó) crea app_users admin + user_roles 201', async () => {
    invitacion('admin', { invited_by: 'un-administrador-cualquiera' })
    const r = await aceptar()
    expect(r.status).toBe(200)
    expect(appUsers()[0].payload).toMatchObject({ role: 'admin', company_id: 'company-C', activo: true })
    expect(h.st.writes.find(w => w.table === 'user_roles')?.payload).toMatchObject({ role_id: '00000000-0000-0000-0000-000000000201' })
  })

  it('el handler NO valida el role de la fila (si el CHECK de la tabla faltara, una fila con company_owner crearía un propietario)', async () => {
    invitacion('company_owner')
    const r = await aceptar()
    expect(r.status).toBe(200)
    expect(appUsers()[0].payload).toMatchObject({ role: 'company_owner' })
  })

  it('el handler NO lee el invitador: ni app_users del invitador ni invited_by participan en la decisión', async () => {
    invitacion('admin', { invited_by: null })
    await aceptar()
    expect(h.st.lecturasLlamador).toHaveLength(0)
  })

  it('estados no pendientes (accepted/revoked/expired) no crean nada', async () => {
    for (const status of ['accepted', 'revoked', 'expired']) {
      invitacion('admin', { status })
      const r = await aceptar()
      expect(r.status).toBe(409)
    }
    expect(appUsers()).toHaveLength(0)
    expect(h.st.createUser).toHaveLength(0)
  })
})
