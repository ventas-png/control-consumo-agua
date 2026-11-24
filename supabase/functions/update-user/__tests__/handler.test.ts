// HANDLER de update-user (index.ts, con el cliente del llamador y el de servicio simulados). La función escribe con service_role (sin RLS) el nombre en app_users y el
// correo y la contraseña en auth.users: lo que la RLS no puede frenar lo frena el gate. Sólo el PRINCIPAL edita, sólo dentro de su empresa y nunca a otro propietario.
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

function llamar(cuerpoCrudo: string): Promise<Response> {
  return h.served.handler!(new Request('https://edge.test/update-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', Origin: 'https://administratodo.com' },
    body: cuerpoCrudo,
  }))
}
const editar = (cambios: Record<string, unknown> = {}, userId = 'u-objetivo') => llamar(JSON.stringify({ user_id: userId, ...cambios }))
function como(role: string, company: string | null = 'C') { h.st.user = { id: 'u-llamador' }; h.st.perfilLlamador = { role, company_id: company } }
function objetivo(role: string, company: string | null = 'C') { h.st.lecturas.app_users = { data: { id: 'u-objetivo', role, company_id: company, full_name: 'Objetivo' }, error: null } }
const escribe = (t: string) => h.st.writes.filter(w => w.table === t)
const error = async (r: Response) => ((await r.json()) as { error: string }).error

describe('update-user · sólo el principal edita', () => {
  for (const rol of ['admin', 'operator', 'viewer', 'collector', 'cliente', '']) {
    it(`«${rol}» → 403 con el motivo y NO se escribe nada (ni el acceso ni el nombre ni la bitácora)`, async () => {
      como(rol); objetivo('operator')
      const r = await editar({ full_name: 'Otro', email: 'otro@x.test', password: '12345678' })
      expect(r.status).toBe(403)
      expect(await error(r)).toMatch(/propietario/i)
      expect(h.st.writes).toHaveLength(0)
      expect(h.st.updateUser).toHaveLength(0)
    })
  }

  it('el propietario NO edita a alguien de otra empresa', async () => {
    como('company_owner'); objetivo('operator', 'OTRA')
    const r = await editar({ password: '12345678' })
    expect(r.status).toBe(403)
    expect(await error(r)).toMatch(/otra empresa/i)
    expect(h.st.updateUser).toHaveLength(0)
  })

  it('un propietario SIN empresa no edita a una persona sin empresa', async () => {
    como('company_owner', null); objetivo('operator', null)
    expect((await editar({ password: '12345678' })).status).toBe(403)
    expect(h.st.updateUser).toHaveLength(0)
  })

  for (const rol of ['company_owner', 'super_admin', 'cliente']) {
    it(`el propietario NO edita a un «${rol}» de su empresa`, async () => {
      como('company_owner'); objetivo(rol)
      const r = await editar({ email: 'tomado@x.test', password: '12345678' })
      expect(r.status).toBe(403)
      expect(h.st.updateUser).toHaveLength(0)
      expect(h.st.writes).toHaveLength(0)
    })
  }

  it('nadie se edita a sí mismo por aquí', async () => {
    como('company_owner')
    const r = await editar({ password: '12345678' }, 'u-llamador')
    expect(r.status).toBe(400)
    expect(h.st.updateUser).toHaveLength(0)
  })

  for (const grafia of ['super_admin', 'superadmin']) {
    it(`«${grafia}» edita a un propietario de cualquier empresa`, async () => {
      como(grafia, null); objetivo('company_owner', 'OTRA')
      const r = await editar({ email: 'nuevo@x.test' })
      expect(r.status).toBe(200)
      expect(h.st.updateUser).toEqual([{ id: 'u-objetivo', attrs: { email: 'nuevo@x.test', email_confirm: true } }])
    })
  }
})

describe('update-user · el propietario edita a una persona de su empresa', () => {
  beforeEach(() => { como('company_owner'); objetivo('operator') })

  it('nombre, correo y contraseña: escribe el acceso (correo normalizado y confirmado), el nombre SÓLO de esa fila, y la bitácora sin la contraseña', async () => {
    const r = await editar({ full_name: '  Nombre Nuevo ', email: ' Nuevo@X.Test ', password: 'secreta-123' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, changed: ['full_name', 'email', 'password'], full_name: 'Nombre Nuevo', email: 'nuevo@x.test' })
    expect(h.st.updateUser).toEqual([{ id: 'u-objetivo', attrs: { email: 'nuevo@x.test', email_confirm: true, password: 'secreta-123' } }])
    const nombre = escribe('app_users')
    expect(nombre).toHaveLength(1)
    expect(nombre[0]).toMatchObject({ op: 'update', payload: { full_name: 'Nombre Nuevo' }, filtros: [['eq', 'id', 'u-objetivo']] })
    const bitacora = escribe('permission_audit_log')
    expect(bitacora).toHaveLength(1)
    expect(bitacora[0].payload).toMatchObject({
      actor_id: 'u-llamador', target_user_id: 'u-objetivo', action: 'user_updated',
      details: { changed: ['full_name', 'email', 'password'], full_name_before: 'Objetivo', full_name_after: 'Nombre Nuevo', email_before: 'actual@x.test', email_after: 'nuevo@x.test' },
    })
    expect(JSON.stringify(h.st.writes)).not.toContain('secreta-123')
  })

  it('sólo el nombre: no toca auth.users', async () => {
    expect((await editar({ full_name: 'Otro Nombre' })).status).toBe(200)
    expect(h.st.updateUser).toHaveLength(0)
    expect(escribe('app_users')).toHaveLength(1)
  })

  it('sólo la contraseña: no toca app_users ni el correo', async () => {
    expect((await editar({ password: '12345678' })).status).toBe(200)
    expect(h.st.updateUser).toEqual([{ id: 'u-objetivo', attrs: { password: '12345678' } }])
    expect(escribe('app_users')).toHaveLength(0)
  })

  it('sin campos: devuelve los datos actuales y NO escribe ni audita (precarga del formulario)', async () => {
    const r = await editar()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, changed: [], full_name: 'Objetivo', email: 'actual@x.test' })
    expect(h.st.writes).toHaveLength(0)
    expect(h.st.updateUser).toHaveLength(0)
  })

  it('los mismos valores que ya tiene no son un cambio', async () => {
    const r = await editar({ full_name: 'Objetivo', email: 'ACTUAL@x.test' })
    expect(((await r.json()) as { changed: string[] }).changed).toEqual([])
    expect(h.st.writes).toHaveLength(0)
    expect(h.st.updateUser).toHaveLength(0)
  })

  it('correo ya en uso: 400 con mensaje claro, y NO se cambia el nombre ni se audita', async () => {
    h.st.resultadoUpdateUser = { data: null, error: { message: 'A user with this email address has already been registered' } }
    const r = await editar({ full_name: 'Otro', email: 'tomado@x.test' })
    expect(r.status).toBe(400)
    expect(await error(r)).toBe('Ese correo ya está en uso por otra cuenta.')
    expect(h.st.writes).toHaveLength(0)
  })

  it('el nombre falla tras cambiar el acceso: 500 que avisa del estado a medias, y se audita sólo lo aplicado', async () => {
    h.st.escrituras.app_users = { data: null, error: { message: 'boom' } }
    const r = await editar({ full_name: 'Otro', password: '12345678' })
    expect(r.status).toBe(500)
    expect(await error(r)).toMatch(/nombre.*acceso sí se actualizaron/i)
    expect((escribe('permission_audit_log')[0].payload as { details: { changed: string[] } }).details.changed).toEqual(['password'])
  })

  it('persona inexistente → 404', async () => {
    h.st.lecturas.app_users = { data: null, error: { message: 'PGRST116' } }
    expect((await editar({ full_name: 'X' })).status).toBe(404)
  })

  for (const [caso, cuerpo] of [
    ['cuerpo que no es JSON', 'no-json'],
    ['cuerpo que es un arreglo', '[]'],
    ['user_id no texto', JSON.stringify({ user_id: 5 })],
    ['email no texto', JSON.stringify({ user_id: 'u-objetivo', email: ['a@b.c'] })],
    ['password no texto', JSON.stringify({ user_id: 'u-objetivo', password: { a: 1 } })],
    ['sin user_id', JSON.stringify({ full_name: 'X' })],
    ['contraseña corta', JSON.stringify({ user_id: 'u-objetivo', password: '123' })],
    ['correo inválido', JSON.stringify({ user_id: 'u-objetivo', email: 'nada' })],
    ['nombre vacío', JSON.stringify({ user_id: 'u-objetivo', full_name: '  ' })],
  ] as const) {
    it(`${caso} → 400 sin escribir`, async () => {
      expect((await llamar(cuerpo)).status).toBe(400)
      expect(h.st.writes).toHaveLength(0)
      expect(h.st.updateUser).toHaveLength(0)
    })
  }
})

describe('update-user · sin sesión', () => {
  it('token inválido → 401', async () => {
    h.st.user = null
    expect((await editar({ full_name: 'X' })).status).toBe(401)
  })
})
