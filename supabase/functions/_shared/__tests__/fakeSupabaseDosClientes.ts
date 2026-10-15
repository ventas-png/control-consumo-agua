// Harness de tests para HANDLERS de edge functions que deciden con DOS clientes (vitest, sin Deno real).
//
// A diferencia de fakeSupabase.ts (que sirve a create-charge / confirm-charge), este distingue:
//   • el cliente del LLAMADOR (createClient con `global.headers`, o sea con su JWT; en producción la RLS se le aplica): `auth.getUser()` devuelve
//     `st.user` y `.from('app_users')` devuelve `st.perfilLlamador` (el rol que decide la función sale de ahí, nunca de los claims del token);
//   • el cliente de SERVICIO (service_role, sin RLS, sin `global`): sus lecturas salen de `st.lecturas[tabla]`, sus escrituras de `st.escrituras[tabla]`,
//     y TODA escritura queda registrada en `st.writes` con sus filtros encadenados (eq, neq, in…) para que el test asserte QUÉ se escribió y SOBRE QUÉ filas.
// Así un test puede probar que una escritura con service_role NO ocurre cuando el llamador no es el principal: lo que la RLS no puede frenar.
export interface Escritura { table: string; op: 'insert' | 'update' | 'delete'; payload: unknown; filtros: Array<[string, ...unknown[]]> }

export interface EstadoDosClientes {
  /** Usuario que devuelve auth.getUser() del llamador. */
  user: Record<string, unknown> | null
  /** Fila de app_users que ve el LLAMADOR por su cliente con JWT (null = sin fila). */
  perfilLlamador: Record<string, unknown> | null
  /** Lecturas del cliente de servicio por tabla. */
  lecturas: Record<string, unknown>
  /** Resultado de las escrituras por tabla (por omisión { error: null }). */
  escrituras: Record<string, unknown>
  /** Llamadas a auth.admin.createUser. */
  createUser: Array<Record<string, unknown>>
  deleteUser: string[]
  writes: Escritura[]
  /** Lecturas del cliente CON JWT (tabla + columnas). */
  lecturasLlamador: Array<{ table: string; cols: string }>
}

export function estadoVacio(): EstadoDosClientes {
  return { user: null, perfilLlamador: null, lecturas: {}, escrituras: {}, createUser: [], deleteUser: [], writes: [], lecturasLlamador: [] }
}

function builder(st: EstadoDosClientes, table: string, esLlamador: boolean) {
  let op: 'read' | Escritura['op'] = 'read'
  const filtros: Escritura['filtros'] = []
  const resolver = () => {
    if (op !== 'read') return st.escrituras[table] ?? { data: null, error: null }
    if (esLlamador) return { data: table === 'app_users' ? st.perfilLlamador : null, error: st.perfilLlamador ? null : { message: 'PGRST116' } }
    return st.lecturas[table] ?? { data: null, error: null }
  }
  const b: Record<string, unknown> = {}
  b.select = (c?: string) => { if (op === 'read' && esLlamador) st.lecturasLlamador.push({ table, cols: c ?? '' }); return b }
  for (const m of ['eq', 'neq', 'ilike', 'is', 'in', 'or', 'order', 'limit', 'gte', 'lte']) {
    b[m] = (...a: unknown[]) => { filtros.push([m, ...a]); return b }
  }
  b.insert = (payload: unknown) => { op = 'insert'; st.writes.push({ table, op, payload, filtros }); return b }
  b.update = (payload: unknown) => { op = 'update'; st.writes.push({ table, op, payload, filtros }); return b }
  b.delete = () => { op = 'delete'; st.writes.push({ table, op, payload: null, filtros }); return b }
  b.single = () => Promise.resolve(resolver())
  b.maybeSingle = () => Promise.resolve(resolver())
  ;(b as { then: unknown }).then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko)
  return b
}

/** `createClient` falso: con `opts.global` es el cliente del llamador; sin él, el de servicio. */
export function makeCreateClient(st: EstadoDosClientes) {
  return (_url: string, _key: string, opts?: { global?: unknown }) => {
    if (opts?.global) {
      return {
        auth: { getUser: async () => ({ data: { user: st.user }, error: st.user ? null : { message: 'invalid' } }) },
        from: (table: string) => builder(st, table, true),
      }
    }
    return {
      auth: {
        getUser: async () => ({ data: { user: st.user }, error: null }),
        admin: {
          createUser: async (a: Record<string, unknown>) => { st.createUser.push(a); return { data: { user: { id: 'nuevo-1' } }, error: null } },
          deleteUser: async (id: string) => { st.deleteUser.push(id); return { error: null } },
        },
      },
      from: (table: string) => builder(st, table, false),
      rpc: async () => ({ data: null, error: null }),
    }
  }
}
