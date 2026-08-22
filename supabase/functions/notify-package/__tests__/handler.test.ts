// Tests del HANDLER completo de notify-package.
//
// Probar sólo la capa de autorización dejaría fuera lo que más falló en este
// endpoint: CON QUÉ CLIENTE se pregunta. La versión anterior resolvía el RBAC
// leyendo tablas con el cliente de `service_role`, que salta la RLS entera y
// responde sobre `auth.uid() = NULL`; el resultado era una autorización que
// parecía consultada y no lo estaba. Aquí se comprueba, sobre el handler real,
// que las cuatro preguntas salen del cliente construido CON EL JWT DEL USUARIO.
//
// Se stubbea `Deno` (env + serve, capturando el handler) y se mockea el import
// remoto de supabase-js con el fake de _shared/__tests__/fakeSupabase.ts, que
// distingue los dos clientes por la presencia de `opts.global`.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { emptyState, type FakeSupabaseState } from '../../_shared/__tests__/fakeSupabase.ts'

const SERVICE_KEY = 'srk-secret'
const JWT = 'jwt-de-un-usuario'
const EMPRESA = 'emp-1'
const PROYECTO = 'proy-1'
const PIEZA = 'pieza-1'

const h = vi.hoisted(() => ({
  env: {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'srk-secret',
    SUPABASE_ANON_KEY: 'anon-key',
    APP_URL: 'https://app.test',
  } as Record<string, string>,
  state: null as unknown as FakeSupabaseState,
  served: { handler: null as null | ((req: Request) => Promise<Response>) },
}))

vi.mock('https://esm.sh/@supabase/supabase-js@2', async () => {
  const { makeCreateClient } = await import('../../_shared/__tests__/fakeSupabase.ts')
  return { createClient: (...args: unknown[]) => makeCreateClient(h.state)(...(args as [string, string, { global?: unknown }?])) }
})
vi.mock('../../_shared/secretsCrypto.ts', () => ({
  encryptSecret: async (x: unknown) => x,
  decryptSecret: async (x: unknown) => x,
}))

beforeAll(async () => {
  h.state = emptyState()
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => h.env[k] },
    serve: (fn: (req: Request) => Promise<Response>) => { h.served.handler = fn },
  })
  // Ningún test de este archivo llega a un proveedor externo, pero si una
  // regresión lo hiciera, que falle ruidosamente en vez de salir a la red.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no debería salir a la red') }))
  await import('../index.ts')
})

/** Pieza de correspondencia por defecto, entrante y sin avisar. */
function sembrarPieza(over: Record<string, unknown> = {}) {
  h.state.byTable['paquetes_recibidos'] = {
    data: {
      id: PIEZA, company_id: EMPRESA, project_id: PROYECTO,
      clase: 'correspondencia', direccion: 'entrante', estado: 'pendiente',
      descripcion: 'Citación', tipo: 'notificacion_legal',
      notificado_at: null,
      unidades: { nombre: 'A-1', cliente_id: 'cli-1' },
      companies: { nombre: 'Torre Norte' },
      ...over,
    },
    error: null,
  }
}

beforeEach(() => {
  h.state = emptyState()
  h.state.auth = { data: { user: { id: 'usr-1' } }, error: null }
  sembrarPieza()
  // Sin datos de contacto no se envía nada: estos tests miran la AUTORIZACIÓN,
  // no los canales.
  h.state.byTable['clientes'] = { data: null, error: null }
  h.state.byTable['app_users'] = { data: [], error: null }
  h.state.rpcs['paquete_reclamar_aviso'] = { data: true, error: null }
  h.state.rpcs['paquete_finalizar_aviso'] = { data: true, error: null }
})

function post(body: Record<string, unknown>, token = JWT): Promise<Response> {
  return h.served.handler!(
    new Request('https://edge.test/notify-package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  )
}

/** Respuestas de los helpers de RBAC tal y como las daría la base. */
function autorizacion(opciones: {
  superAdmin?: boolean
  empresa?: string
  proyectoOk?: boolean
  permiso?: boolean | { data: unknown; error: { message: string } | null }
}) {
  h.state.rpcsUsuario['is_super_admin'] = { data: opciones.superAdmin ?? false, error: null }
  h.state.rpcsUsuario['get_my_company_id'] = { data: opciones.empresa ?? EMPRESA, error: null }
  h.state.rpcsUsuario['can_access_project'] = { data: opciones.proyectoOk ?? true, error: null }
  h.state.rpcsUsuario['user_has_permission'] = typeof opciones.permiso === 'object'
    ? opciones.permiso
    : { data: opciones.permiso ?? false, error: null }
}

const comoUsuario = () => h.state.rpcCalls.filter(c => c.comoUsuario).map(c => c.fn)
const comoAdmin = () => h.state.rpcCalls.filter(c => !c.comoUsuario).map(c => c.fn)

describe('notify-package/handler — quién pregunta', () => {
  it('las cuatro preguntas de RBAC salen del cliente con el JWT, no del service_role', async () => {
    autorizacion({ permiso: true })
    await post({ paquete_id: PIEZA })

    expect(comoUsuario()).toEqual(
      ['is_super_admin', 'get_my_company_id', 'can_access_project', 'user_has_permission'],
    )
    // Y el service_role sólo se usa para lo suyo: reclamar y cerrar el aviso.
    expect(comoAdmin()).toEqual(['paquete_reclamar_aviso', 'paquete_finalizar_aviso'])
  })

  it('no se leen `user_roles` ni `role_permissions`: el RBAC ya no se reimplementa', async () => {
    autorizacion({ permiso: true })
    await post({ paquete_id: PIEZA })
    const leidas = h.state.calls.map(c => c.table)
    expect(leidas).not.toContain('user_roles')
    expect(leidas).not.toContain('role_permissions')
    expect(leidas).not.toContain('user_project_assignments')
  })

  it('pregunta por el permiso DE LA CLASE de la pieza', async () => {
    autorizacion({ permiso: true })
    await post({ paquete_id: PIEZA })
    expect(h.state.rpcCalls.find(c => c.fn === 'user_has_permission')?.args)
      .toEqual({ perm_key: 'condominios.tab.correspondencia' })

    h.state.rpcCalls.length = 0
    sembrarPieza({ clase: 'paquete', tipo: 'paquete' })
    await post({ paquete_id: PIEZA })
    expect(h.state.rpcCalls.find(c => c.fn === 'user_has_permission')?.args)
      .toEqual({ perm_key: 'condominios.tab.paqueteria' })
  })
})

describe('notify-package/handler — decisiones', () => {
  it('un operador de paquetería NO puede avisar correspondencia (403)', async () => {
    // La base responde `false` al permiso de correspondencia: es exactamente lo
    // que devolvería `user_has_permission` para un rol granular de paquetería.
    autorizacion({ permiso: false })
    const res = await post({ paquete_id: PIEZA })
    expect(res.status).toBe(403)
    // Y no se reclamó nada: la denegación ocurre ANTES de tocar la pieza.
    expect(comoAdmin()).toEqual([])
  })

  it('un operador de correspondencia autorizado sí puede (200)', async () => {
    autorizacion({ permiso: true })
    const res = await post({ paquete_id: PIEZA })
    expect(res.status).toBe(200)
    expect(comoAdmin()).toContain('paquete_reclamar_aviso')
  })

  it('un deny explícito vence: la base dice false y el handler obedece', async () => {
    // El deny-over-allow lo resuelve `user_has_permission` dentro de la base
    // (probado contra Postgres real en rls-evidencias-asserts.sql, bloque 9).
    // Lo que se comprueba aquí es que el handler no lo contradiga con una
    // lista de permisos propia — que es lo que hacía antes.
    autorizacion({ permiso: false })
    expect((await post({ paquete_id: PIEZA })).status).toBe(403)
  })

  it('un ERROR al consultar la autorización devuelve 503, no permisos vacíos', async () => {
    // El fallo original: PostgREST devolvía error por la incrustación
    // imposible, el código leía sólo `data`, y la lista vacía se tomaba como
    // decisión. Ahora un error no puede parecerse a una denegación.
    autorizacion({ permiso: { data: null, error: { message: 'could not find relationship' } } })
    const res = await post({ paquete_id: PIEZA })
    expect(res.status).toBe(503)
    expect(comoAdmin()).toEqual([])
  })

  it('la pieza de otra empresa se deniega (403)', async () => {
    autorizacion({ empresa: 'otra-empresa', permiso: true })
    expect((await post({ paquete_id: PIEZA })).status).toBe(403)
  })

  it('el proyecto no asignado se deniega (403)', async () => {
    autorizacion({ proyectoOk: false, permiso: true })
    expect((await post({ paquete_id: PIEZA })).status).toBe(403)
  })

  it('super_admin conserva su comportamiento legítimo aunque sea de otra empresa', async () => {
    autorizacion({ superAdmin: true, empresa: 'otra-empresa', permiso: false })
    expect((await post({ paquete_id: PIEZA })).status).toBe(200)
  })

  it('sin JWT no se pasa (401)', async () => {
    const res = await h.served.handler!(
      new Request('https://edge.test/notify-package', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paquete_id: PIEZA }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('un JWT que GoTrue no reconoce no llega a preguntar nada (401)', async () => {
    h.state.auth = { data: { user: null }, error: { message: 'invalid token' } }
    autorizacion({ permiso: true })
    const res = await post({ paquete_id: PIEZA })
    expect(res.status).toBe(401)
    expect(comoUsuario()).toEqual([])
  })

  it('la llamada interna con la service key no necesita JWT de usuario', async () => {
    const res = await post({ paquete_id: PIEZA }, SERVICE_KEY)
    expect(res.status).toBe(200)
    // No hay a quién preguntarle: es una llamada de casa (cron u otra función).
    expect(comoUsuario()).toEqual([])
  })
})

describe('notify-package/handler — claim con dueño', () => {
  it('reclama con un UUID propio y finaliza con EL MISMO', async () => {
    autorizacion({ permiso: true })
    await post({ paquete_id: PIEZA })

    const reclamo = h.state.rpcCalls.find(c => c.fn === 'paquete_reclamar_aviso')
      ?.args as { p_claim_id: string; p_pieza_id: string; p_lease_segundos: number }
    const cierre = h.state.rpcCalls.find(c => c.fn === 'paquete_finalizar_aviso')
      ?.args as { p_claim_id: string; p_entregado: boolean }

    expect(reclamo.p_claim_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(cierre.p_claim_id).toBe(reclamo.p_claim_id)
    expect(reclamo.p_lease_segundos).toBe(120)
  })

  it('cada ejecución usa un token DISTINTO', async () => {
    autorizacion({ permiso: true })
    await post({ paquete_id: PIEZA })
    const primero = (h.state.rpcCalls.find(c => c.fn === 'paquete_reclamar_aviso')?.args as { p_claim_id: string }).p_claim_id
    h.state.rpcCalls.length = 0
    await post({ paquete_id: PIEZA })
    const segundo = (h.state.rpcCalls.find(c => c.fn === 'paquete_reclamar_aviso')?.args as { p_claim_id: string }).p_claim_id
    // Un token reutilizable dejaría a una ejecución vieja finalizar el aviso de
    // la nueva, que es justo lo que el dueño del claim viene a impedir.
    expect(segundo).not.toBe(primero)
  })

  it('si no gana el claim, no envía y lo dice', async () => {
    autorizacion({ permiso: true })
    h.state.rpcs['paquete_reclamar_aviso'] = { data: false, error: null }
    const res = await post({ paquete_id: PIEZA })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: 'already_notified', delivered: false })
    expect(comoAdmin()).not.toContain('paquete_finalizar_aviso')
  })

  it('perder el claim al finalizar se reporta como fallo, no como éxito', async () => {
    // `false` = el lease caducó y otra ejecución es la dueña. Antes esto se
    // ignoraba y la pantalla decía "avisado".
    autorizacion({ permiso: true })
    h.state.rpcs['paquete_finalizar_aviso'] = { data: false, error: null }
    const res = await post({ paquete_id: PIEZA })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ success: false })
  })

  it('una pieza SALIENTE no se avisa ni se reclama', async () => {
    autorizacion({ permiso: true })
    sembrarPieza({ direccion: 'saliente' })
    const res = await post({ paquete_id: PIEZA })
    expect(await res.json()).toMatchObject({ skipped: 'pieza_saliente', delivered: false })
    expect(comoAdmin()).toEqual([])
  })
})
