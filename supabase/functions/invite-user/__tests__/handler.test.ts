// HANDLER completo de invite-user (index.ts, con el cliente del llamador y el de servicio simulados): «el rol admin sólo lo invita el principal de la empresa», la
// validación de tipos del cuerpo, la revocación de invitaciones pendientes y que los fallos de la base de datos fallen cerrados y sin filtrar detalles. El control real del camino directo (INSERT en user_invitations por la API) son las políticas
// RLS de la migración 20261026000700; este archivo prueba el camino por service_role, que la RLS no frena.
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
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srk', APP_URL: 'https://administratodo.com' } as Record<string, string>)[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  // send-email por fetch: no sale a la red en la prueba
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  await import('../index.ts')
})

beforeEach(() => {
  Object.assign(h.st, estadoVacio())
  h.st.escrituras.user_invitations = { data: { id: 'inv-1' }, error: null }
  h.st.lecturas.companies = { data: { nombre: 'Empresa C', logo_url: '' }, error: null }
})

const C = 'company-C'
const D = 'company-D'

function llamar(cuerpoCrudo: string): Promise<Response> {
  return h.served.handler!(new Request('https://edge.test/invite-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', Origin: 'https://administratodo.com' },
    body: cuerpoCrudo,
  }))
}
const cuerpo = (role: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ email: 'Nuevo@Ejemplo.com ', role, full_name: 'N', ...extra })
function como(role: string | null, company: string | null = C) {
  h.st.user = { id: 'u-llamador' }
  h.st.perfilLlamador = role === null ? null : { role, company_id: company }
}
const inserts = () => h.st.writes.filter(w => w.table === 'user_invitations' && w.op === 'insert')
const updates = () => h.st.writes.filter(w => w.table === 'user_invitations' && w.op === 'update')
const pendiente = (id: string, email: string, role: string) => ({ id, email, role })

describe('invite-user · el administrador NO invita administradores (variantes del rol)', () => {
  it('admin + role=admin: 403 con el motivo, sin revocar ni insertar nada', async () => {
    como('admin')
    const r = await llamar(cuerpo('admin'))
    expect(r.status).toBe(403)
    expect(((await r.json()) as { error: string }).error).toMatch(/propietario/)
    expect(h.st.writes).toHaveLength(0)
  })

  const variantes: Array<[string, unknown, number]> = [
    ['" admin " (el handler recorta)', ' admin ', 403],
    ['"\\tadmin\\n" (recortado)', '\tadmin\n', 403],
    ['Admin', 'Admin', 400], ['ADMIN', 'ADMIN', 400], ['administrador', 'administrador', 400],
    ['superadmin', 'superadmin', 400], ['super_admin', 'super_admin', 400], ['company_owner', 'company_owner', 400],
    ['null', null, 400], ['vacío', '', 400],
    ['arreglo ["admin"]', ['admin'], 400], ['objeto', { role: 'admin' }, 400], ['número', 7, 400], ['booleano', true, 400],
    ['admin con NUL', 'admin\u0000', 400],
  ]
  for (const [etq, valor, estado] of variantes) {
    it(`administrador + role=${etq}: ${estado} y no se escribe nada`, async () => {
      como('admin')
      const r = await llamar(cuerpo(valor))
      expect(r.status).toBe(estado)
      expect(inserts()).toHaveLength(0)
      expect(h.st.writes).toHaveLength(0)
    })
  }

  it('rol repetido en el JSON ({"role":"operator", … ,"role":"admin"}): gana el último y se rechaza', async () => {
    como('admin')
    const r = await llamar(`{"email":"a@b.co","role":"operator","role":"admin"}`)
    expect(r.status).toBe(403)
    expect(h.st.writes).toHaveLength(0)
  })

  it('el rol sale de app_users por el cliente con JWT del llamador, no de sus claims', async () => {
    h.st.user = { id: 'u-llamador', app_metadata: { role: 'company_owner' }, user_metadata: { role: 'super_admin' } }
    h.st.perfilLlamador = { role: 'admin', company_id: C }
    expect((await llamar(cuerpo('admin'))).status).toBe(403)
    expect(h.st.lecturasLlamador.some(l => l.table === 'app_users')).toBe(true)
  })

  for (const rol of ['operator', 'operador', 'viewer', 'visor', 'collector', 'cliente']) {
    it(`llamador ${rol}: 403 sin escribir`, async () => {
      como(rol)
      expect((await llamar(cuerpo('operator'))).status).toBe(403)
      expect(h.st.writes).toHaveLength(0)
    })
  }
})

describe('invite-user · un cuerpo mal formado es un 400, nunca un 500 (E-08)', () => {
  it('email que no es texto (arreglo, objeto, número): 400 sin escribir', async () => {
    for (const email of [['a@b.co'], { e: 1 }, 7, true]) {
      como('company_owner')
      const r = await llamar(JSON.stringify({ email, role: 'operator' }))
      expect(r.status).toBe(400)
    }
    expect(h.st.writes).toHaveLength(0)
  })

  it('full_name o company_id que no son texto: 400', async () => {
    como('super_admin', null)
    expect((await llamar(cuerpo('operator', { full_name: ['x'] }))).status).toBe(400)
    expect((await llamar(cuerpo('operator', { company_id: { id: D } }))).status).toBe(400)
    expect(h.st.writes).toHaveLength(0)
  })

  it('cuerpo que no es un objeto JSON (null, arreglo, número, JSON roto): 400', async () => {
    como('company_owner')
    for (const crudo of ['null', '[]', '7', '"texto"', '{no es json']) expect((await llamar(crudo)).status).toBe(400)
    expect(h.st.writes).toHaveLength(0)
  })

  it('email o role ausentes: 400 (no 500)', async () => {
    como('company_owner')
    expect((await llamar(JSON.stringify({ role: 'operator' }))).status).toBe(400)
    expect((await llamar(JSON.stringify({ email: 'a@b.co' }))).status).toBe(400)
  })
})

describe('invite-user · lo legítimo', () => {
  it('el propietario invita a un administrador: inserta role admin con invited_by', async () => {
    como('company_owner')
    const r = await llamar(cuerpo('admin'))
    expect(r.status).toBe(200)
    expect(inserts()[0].payload).toMatchObject({ company_id: C, email: 'nuevo@ejemplo.com', role: 'admin', invited_by: 'u-llamador', status: 'pending' })
  })

  it('el administrador invita a un operador (se conserva)', async () => {
    como('admin')
    const r = await llamar(cuerpo('operator'))
    expect(r.status).toBe(200)
    expect(inserts()[0].payload).toMatchObject({ role: 'operator', company_id: C })
  })

  it('el propietario de D que pide company_id=C invita en D (se ignora el company_id ajeno)', async () => {
    como('company_owner', D)
    const r = await llamar(cuerpo('admin', { company_id: C }))
    expect(r.status).toBe(200)
    expect(inserts()[0].payload).toMatchObject({ company_id: D })
  })

  for (const grafia of ['super_admin', 'superadmin']) {
    it(`${grafia} invita a un administrador de OTRA empresa`, async () => {
      como(grafia, null)
      const r = await llamar(cuerpo('admin', { company_id: D }))
      expect(r.status).toBe(200)
      expect(inserts()[0].payload).toMatchObject({ company_id: D, role: 'admin' })
    })
  }
})

describe('invite-user · la revocación de pendientes del mismo correo (service_role, sin RLS)', () => {
  it('un administrador que invita a un OPERADOR no revoca la invitación PENDIENTE de «admin» que hizo el propietario al mismo correo (E-02)', async () => {
    como('admin')
    h.st.lecturas.user_invitations = { data: [pendiente('inv-admin', 'nuevo@ejemplo.com', 'admin'), pendiente('inv-op', 'nuevo@ejemplo.com', 'operator')], error: null }
    const r = await llamar(cuerpo('operator'))
    expect(r.status).toBe(200)
    const u = updates()
    expect(u).toHaveLength(1)
    expect(u[0].payload).toEqual({ status: 'revoked' })
    expect(u[0].filtros).toContainEqual(['in', 'id', ['inv-op']])        // sólo la de operador; la de admin queda
    expect(JSON.stringify(u[0].filtros)).not.toContain('inv-admin')
  })

  it('el PROPIETARIO sí revoca la pendiente de «admin» del mismo correo al volver a invitar', async () => {
    como('company_owner')
    h.st.lecturas.user_invitations = { data: [pendiente('inv-admin', 'nuevo@ejemplo.com', 'admin'), pendiente('inv-op', 'nuevo@ejemplo.com', 'operator')], error: null }
    expect((await llamar(cuerpo('operator'))).status).toBe(200)
    expect(updates()[0].filtros).toContainEqual(['in', 'id', ['inv-admin', 'inv-op']])
  })

  it('el superadministrador también (principal, cualquier empresa)', async () => {
    como('superadmin', null)
    h.st.lecturas.user_invitations = { data: [pendiente('inv-admin', 'nuevo@ejemplo.com', 'admin')], error: null }
    expect((await llamar(cuerpo('operator', { company_id: D }))).status).toBe(200)
    expect(updates()[0].filtros).toContainEqual(['in', 'id', ['inv-admin']])
  })

  it('el correo se compara EXACTO (recortado y en minúsculas): otras pendientes de la empresa no se tocan', async () => {
    como('company_owner')
    h.st.lecturas.user_invitations = { data: [pendiente('i1', 'Nuevo@Ejemplo.com ', 'operator'), pendiente('i2', 'otro@ejemplo.com', 'operator'), pendiente('i3', null as unknown as string, 'viewer')], error: null }
    expect((await llamar(cuerpo('operator'))).status).toBe(200)
    expect(updates()[0].filtros).toContainEqual(['in', 'id', ['i1']])
  })

  it('comodines en el correo (% _ \\ *) NO amplían la revocación: ningún filtro ilike y sólo se revoca el correo idéntico (E-02: «%@%.%» revocaba todas)', async () => {
    for (const comodin of ['%@%.%', '_@_._', '*@*.*', 'a\\%@b.co']) {
      Object.assign(h.st, estadoVacio())
      h.st.escrituras.user_invitations = { data: { id: 'inv-1' }, error: null }
      h.st.lecturas.companies = { data: { nombre: 'Empresa C', logo_url: '' }, error: null }
      como('admin')
      h.st.lecturas.user_invitations = { data: [pendiente('i-admin', 'dueno@ejemplo.com', 'admin'), pendiente('i-op', 'operador@ejemplo.com', 'operator')], error: null }
      const r = await llamar(cuerpo('operator', { email: comodin }))
      expect(r.status).toBe(comodin === 'a\\%@b.co' ? 200 : 200)
      expect(h.st.writes.filter(w => w.table === 'user_invitations' && w.op === 'update')).toHaveLength(0)
      expect(h.st.writes.some(w => w.filtros.some(f => f[0] === 'ilike'))).toBe(false)
      expect(inserts()[0].payload).toMatchObject({ email: comodin, role: 'operator' })
    }
  })

  it('sin pendientes que revocar no se escribe ninguna revocación (sólo la invitación nueva)', async () => {
    como('company_owner')
    h.st.lecturas.user_invitations = { data: [], error: null }
    expect((await llamar(cuerpo('operator'))).status).toBe(200)
    expect(updates()).toHaveLength(0)
    expect(inserts()).toHaveLength(1)
  })

  it('la lectura y la revocación van acotadas a la empresa del llamador y a las pendientes', async () => {
    como('company_owner', D)
    h.st.lecturas.user_invitations = { data: [pendiente('i1', 'nuevo@ejemplo.com', 'operator')], error: null }
    expect((await llamar(cuerpo('operator', { company_id: C }))).status).toBe(200)
    expect(updates()[0].filtros).toContainEqual(['eq', 'company_id', D])
    expect(updates()[0].filtros).toContainEqual(['eq', 'status', 'pending'])
  })

  it('si el índice único (empresa, correo) choca porque quedó una pendiente que el llamador no podía revocar, es un 409 y no un 500', async () => {
    como('admin')
    h.st.lecturas.user_invitations = { data: [pendiente('inv-admin', 'nuevo@ejemplo.com', 'admin')], error: null }
    h.st.escrituras.user_invitations = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_user_invitations_pending_email"' } }
    const r = await llamar(cuerpo('operator'))
    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: string }).error).toMatch(/propietario/)
    expect(updates()).toHaveLength(0)
  })

  // V8-07 B2: el principal revoca TODAS las pendientes del correo, así que si aun así choca es que otra petición creó una entre su revocación y su INSERT; decirle
  // «la gestiona el propietario de la empresa» al propio propietario es falso y no le dice qué hacer.
  for (const [rol, empresa] of [['company_owner', C], ['super_admin', null], ['superadmin', null]] as Array<[string, string | null]>) {
    it(`${rol} (principal) que choca con el índice único: 409 que dice que otra invitación acaba de crearse y que recargue, sin culpar al propietario`, async () => {
      como(rol, empresa)
      h.st.lecturas.user_invitations = { data: [], error: null }
      h.st.escrituras.user_invitations = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_user_invitations_pending_email"' } }
      const r = await llamar(cuerpo('operator', empresa ? {} : { company_id: D }))
      expect(r.status).toBe(409)
      const { error } = (await r.json()) as { error: string }
      expect(error).toBe('Otra invitación pendiente para ese correo acaba de crearse. Recarga la página e inténtalo de nuevo.')
      expect(error).not.toMatch(/propietario/)
    })
  }
})

describe('invite-user · los fallos de la base de datos fallan CERRADO y no filtran detalles (V8-07 B4, V8-08)', () => {
  it('si la lectura de las invitaciones pendientes falla: 500 genérico, sin revocar ni insertar nada (antes se trataba como «no hay pendientes» y se insertaba)', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const [rol, empresa] of [['admin', C], ['company_owner', C], ['super_admin', null]] as Array<[string, string | null]>) {
        Object.assign(h.st, estadoVacio())
        h.st.escrituras.user_invitations = { data: { id: 'inv-1' }, error: null }
        como(rol, empresa)
        h.st.lecturas.user_invitations = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout (detalle interno)' } }
        const r = await llamar(cuerpo('operator', empresa ? {} : { company_id: D }))
        expect(r.status).toBe(500)
        const texto = await r.text()
        expect(JSON.parse(texto)).toEqual({ error: 'No se pudo crear la invitación. Intenta de nuevo.' })
        expect(texto).not.toMatch(/timeout|detalle interno|57014/)
        expect(h.st.writes).toHaveLength(0)
      }
      expect(consola).toHaveBeenCalled()
    } finally {
      consola.mockRestore()
    }
  })

  it('cualquier otro fallo del INSERT: 500 con un mensaje genérico (no el insertErr.message crudo); el detalle va a console.error sin el correo invitado', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      como('company_owner')
      h.st.lecturas.user_invitations = { data: [], error: null }
      h.st.escrituras.user_invitations = { data: null, error: { code: '23503', message: 'insert or update on table "user_invitations" violates foreign key constraint "user_invitations_company_id_fkey"', details: 'Key (email)=(nuevo@ejemplo.com) is not present' } }
      const r = await llamar(cuerpo('operator'))
      expect(r.status).toBe(500)
      const texto = await r.text()
      expect(JSON.parse(texto)).toEqual({ error: 'No se pudo crear la invitación. Intenta de nuevo.' })
      expect(texto).not.toMatch(/foreign key|user_invitations|23503|nuevo@ejemplo\.com/)
      expect(consola).toHaveBeenCalled()
      const registrado = JSON.stringify(consola.mock.calls)
      expect(registrado).toMatch(/23503/)
      expect(registrado).not.toMatch(/nuevo@ejemplo\.com/i)
    } finally {
      consola.mockRestore()
    }
  })

  it('INSERT sin error pero sin fila devuelta: 500 con el mismo mensaje genérico', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      como('company_owner')
      h.st.escrituras.user_invitations = { data: null, error: null }
      const r = await llamar(cuerpo('operator'))
      expect(r.status).toBe(500)
      expect(await r.json()).toEqual({ error: 'No se pudo crear la invitación. Intenta de nuevo.' })
    } finally {
      consola.mockRestore()
    }
  })
})
