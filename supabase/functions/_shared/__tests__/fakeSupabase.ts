// Harness de tests para HANDLERS de edge functions (vitest, sin Deno real).
//
// Provee un `createClient` falso para mockear `https://esm.sh/@supabase/supabase-js@2`
// en los tests de los `index.ts` (create-charge / confirm-charge). Dos clientes:
//   • admin (service_role): `.from(tabla)` devuelve un builder encadenable cuya
//     resolución sale de `state.byTable[tabla]` (lecturas) o `state.writes[tabla]`
//     (insert/update/delete), y REGISTRA cada escritura en `state.calls` para que
//     los tests asserten payloads (p. ej. el cliente_id del payment_request).
//   • caller (anon + Authorization): `auth.getUser()` → `state.auth` y `.rpc()`
//     → `state.rpcsUsuario` (cayendo a `state.rpcs`). El `.rpc()` del caller
//     existe porque notify-package autoriza preguntando a los helpers de RBAC
//     CON EL JWT DEL USUARIO; sin poder responder distinto según quién pregunta,
//     un test no puede distinguir "lo decidió la base sobre el llamante" de
//     "lo decidió el service_role sobre nadie".
//
// El shape que espera cada lectura lo fija el test (lista u objeto), igual que el
// patrón `byTable` de src/domain/condominios/__tests__/tabQueries.test.ts.

export interface FakeWriteCall {
  table: string
  op: 'insert' | 'update' | 'delete'
  payload: unknown
}

export interface FakeRpcCall {
  fn: string
  args: unknown
  /** true si la llamada salió del cliente con el JWT del usuario, no del admin. */
  comoUsuario?: boolean
}

export interface FakeSupabaseState {
  /** Resolución de LECTURAS por tabla: `{ data, error }` con el shape esperado. */
  byTable: Record<string, unknown>
  /**
   * COLA de lecturas por tabla, para handlers que leen la MISMA tabla varias
   * veces con shapes distintos (p. ej. confirm-charge lee `pagos` como lista de
   * abonos y luego como chequeo de idempotencia). Cada lectura consume el
   * siguiente elemento; agotada la cola, cae a `byTable`.
   */
  readQueues: Record<string, unknown[]>
  /** Resolución de ESCRITURAS por tabla (p. ej. insert().select().maybeSingle()). */
  writes: Record<string, unknown>
  /** Registro de escrituras para asserts. */
  calls: FakeWriteCall[]
  /** Registro de llamadas RPC para asserts. */
  rpcCalls: FakeRpcCall[]
  /** Resolución de RPCs por nombre: `{ data, error }`. */
  rpcs: Record<string, unknown>
  /** Resolución de RPCs llamadas POR EL CLIENTE DEL USUARIO (JWT). */
  rpcsUsuario: Record<string, unknown>
  /** Resultado de caller.auth.getUser(). */
  auth: unknown
}

export function emptyState(): FakeSupabaseState {
  return {
    byTable: {}, readQueues: {}, writes: {}, calls: [],
    rpcCalls: [], rpcs: {}, rpcsUsuario: {},
    auth: { data: { user: null }, error: null },
  }
}

const FALLBACK = { data: null, error: null }

function makeBuilder(state: FakeSupabaseState, table: string) {
  let op: FakeWriteCall['op'] | 'read' = 'read'
  const resolve = () => {
    if (op !== 'read') return state.writes[table] ?? FALLBACK
    const queue = state.readQueues[table]
    if (queue && queue.length > 0) return queue.shift()
    return state.byTable[table] ?? FALLBACK
  }

  const b: Record<string, unknown> = {}
  const chain = (..._args: unknown[]) => b
  // Métodos de filtro/proyección: encadenan sin efecto.
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'or', 'order', 'limit', 'gte', 'lte', 'abortSignal']) {
    b[m] = chain
  }
  // Escrituras: registran la llamada y cambian el modo de resolución.
  b.insert = (payload: unknown) => { op = 'insert'; state.calls.push({ table, op: 'insert', payload }); return b }
  b.update = (payload: unknown) => { op = 'update'; state.calls.push({ table, op: 'update', payload }); return b }
  b.delete = () => { op = 'delete'; state.calls.push({ table, op: 'delete', payload: null }); return b }
  // Resoluciones.
  b.maybeSingle = () => Promise.resolve(resolve())
  b.single = () => Promise.resolve(resolve())
  ;(b as { then: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled)
  return b
}

/**
 * Fábrica del mock de `createClient`. El handler crea el admin con
 * `(URL, SERVICE_ROLE_KEY)` y el caller con `(URL, ANON, { global: { headers } })`:
 * se distingue por la presencia de `opts.global`.
 */
export function makeCreateClient(state: FakeSupabaseState) {
  return (_url: string, _key: string, opts?: { global?: unknown }) => {
    if (opts?.global) {
      return {
        auth: { getUser: async () => state.auth },
        rpc: (fn: string, args?: unknown) => {
          state.rpcCalls.push({ fn, args, comoUsuario: true })
          const r = state.rpcsUsuario[fn] ?? state.rpcs[fn]
          // Sin resolución declarada se DEVUELVE UN ERROR, no `{data:null}`:
          // un helper de autorización que "no contesta" no puede parecerse a
          // uno que contesta que no. Los tests declaran lo que quieren probar.
          return Promise.resolve(r ?? { data: null, error: { message: `rpc ${fn} sin declarar en rpcsUsuario` } })
        },
      }
    }
    return {
      // El admin también valida JWTs: notify-package hace
      // `admin.auth.getUser(token)` para que GoTrue reconozca al llamante ANTES
      // de abrirle un cliente propio. Comparte `state.auth` con el caller: es
      // el mismo usuario visto por el mismo GoTrue.
      auth: { getUser: async (_token?: string) => state.auth },
      from: (table: string) => makeBuilder(state, table),
      rpc: (fn: string, args?: unknown) => {
        state.rpcCalls.push({ fn, args })
        return Promise.resolve(state.rpcs[fn] ?? FALLBACK)
      },
    }
  }
}
