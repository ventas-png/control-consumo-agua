// Lógica pura de delete-company, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno, supabase-js ni stripe → corre
// directo en vitest. El handler (index.ts) importa estos símbolos.
//
// El handler mezcla I/O (queries, Stripe, la RPC, auth, storage) con las
// decisiones de la purga; aquí vive SOLO la parte pura: validación del cuerpo,
// gates de confirmación/gracia, la clasificación del error de Stripe, la
// traducción de los errores de `purgar_empresa` a HTTP y la lectura de su
// respuesta. Lo que la purga escribe (personas, datos, auditoría) ya no se
// decide aquí: lo hace la RPC `purgar_empresa`, en una sola transacción
// (supabase/migrations/20261027000000_purgar_empresa_atomica.sql).

export const DEFAULT_GRACE_DAYS = 90

/** `true` si el rol es super_admin (ambas grafías históricas). */
export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin'
}

/**
 * Días de gracia efectivos: entero POSITIVO del env DELETE_COMPANY_GRACE_DAYS,
 * o el default (90) si no está definido / no parsea / es 0 o negativo.
 *
 * Un negativo no puede pasar: `-5` días de gracia harían elegible a una
 * empresa suspendida hace un minuto. La RPC además rechaza `< 1`.
 */
export function resolveGraceDays(raw: string | null | undefined): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_GRACE_DAYS
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PurgeBody =
  | { ok: true; companyId: string; confirmName: string }
  | { ok: false; error: string }

/**
 * Valida el cuerpo YA parseado (`await req.json().catch(() => null)`): un
 * objeto (no arreglo, no null) con `company_id` UUID y `confirm_name` texto no
 * vacío. Antes, `null`, JSON roto o un `company_id` numérico reventaban en el
 * `.trim()` y salían como 500.
 */
export function parsePurgeBody(raw: unknown): PurgeBody {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'El cuerpo debe ser un objeto JSON con company_id y confirm_name' }
  }
  const body = raw as Record<string, unknown>
  for (const campo of ['company_id', 'confirm_name'] as const) {
    if (body[campo] !== undefined && typeof body[campo] !== 'string') {
      return { ok: false, error: `${campo} debe ser texto` }
    }
  }
  const companyId = ((body.company_id as string | undefined) ?? '').trim()
  const confirmName = ((body.confirm_name as string | undefined) ?? '').trim()
  if (!companyId || !confirmName) {
    return { ok: false, error: 'Faltan company_id o confirm_name' }
  }
  if (!UUID_RE.test(companyId)) {
    return { ok: false, error: 'company_id no es un identificador válido' }
  }
  return { ok: true, companyId, confirmName }
}

/** Fila de companies que el handler lee antes de la purga. */
export interface CompanyRow {
  id: string
  nombre: string
  activa: boolean
  suspended_at: string | null
  logo_url: string | null
}

/** Resultado de los gates: ok, o el status + mensaje exactos del handler. */
export type PurgeGate = { ok: true } | { ok: false; status: number; error: string }

/**
 * Gates de confirmación previos a la purga, en el MISMO orden que la RPC:
 *   1. confirm_name debe coincidir EXACTO (case-sensitive) con companies.nombre → 400.
 *   2. La empresa debe estar suspendida (activa=false) → 409.
 *   3. Deben haber pasado >= graceDays días desde suspended_at → 409 (con la
 *      fecha elegible si suspended_at existe).
 * El handler los evalúa ANTES de tocar Stripe; la RPC los repite con la
 * empresa bloqueada. `now` inyectable para que el test sea determinista.
 */
export function checkPurgeGates(
  company: Pick<CompanyRow, 'nombre' | 'activa' | 'suspended_at'>,
  confirmName: string,
  graceDays: number,
  now: Date = new Date(),
): PurgeGate {
  if (confirmName !== company.nombre) {
    return { ok: false, status: 400, error: 'El nombre de confirmación no coincide con el nombre de la empresa' }
  }
  if (company.activa) {
    return { ok: false, status: 409, error: 'La empresa debe estar suspendida antes de eliminarse' }
  }
  const suspendedAt = company.suspended_at ? new Date(company.suspended_at) : null
  const graceEnds = suspendedAt ? new Date(suspendedAt.getTime() + graceDays * 24 * 60 * 60 * 1000) : null
  if (!suspendedAt || !graceEnds || graceEnds > now) {
    return {
      ok: false,
      status: 409,
      error: `La empresa debe llevar al menos ${graceDays} días suspendida antes de la purga definitiva` +
        (graceEnds ? ` (elegible el ${graceEnds.toISOString().slice(0, 10)})` : ''),
    }
  }
  return { ok: true }
}

/**
 * `true` si el fallo al cancelar la suscripción en Stripe es benigno (ya
 * cancelada / inexistente) y la purga puede continuar. Cualquier otro fallo
 * aborta para no dejar un cobro recurrente huérfano.
 */
export function isBenignStripeCancelError(msg: string): boolean {
  return /No such subscription|canceled/i.test(msg)
}

/** Prefijo con el que `purgar_empresa(..., p_ensayo => true)` señala que el ensayo pasó. */
export const PURGE_REHEARSAL_OK = 'PURGA_ENSAYO_OK'

/** Error de PostgREST/supabase-js tal como lo devuelve `.rpc()`. */
export interface RpcError {
  code?: string | null
  message?: string | null
}

/**
 * Traduce un error de la RPC `purgar_empresa` a HTTP. La RPC se revirtió
 * ENTERA en todos estos casos: no se borró ninguna persona, ningún dato ni la
 * auditoría. Los códigos de negocio van como prefijo del mensaje (ver la
 * migración); el resto se decide por SQLSTATE.
 */
export function mapPurgeRpcError(err: RpcError): { status: number; error: string } {
  const message = err.message ?? ''
  const prefijo = /^([A-Z_]+):/.exec(message)?.[1] ?? ''
  const detalle = message.replace(/^[A-Z_]+:\s*/, '')
  switch (prefijo) {
    case 'PURGA_PARAMETROS':
    case 'PURGA_NOMBRE_NO_COINCIDE':
    case 'PURGA_ACTOR_DE_LA_EMPRESA':
      return { status: 400, error: detalle }
    case 'PURGA_SOLO_SUPERADMIN':
      return { status: 403, error: detalle }
    case 'PURGA_EMPRESA_NO_ENCONTRADA':
      return { status: 404, error: 'Empresa no encontrada' }
    case 'PURGA_EMPRESA_ACTIVA':
    case 'PURGA_EN_GRACIA':
      return { status: 409, error: detalle }
    // La empresa tiene historia financiera, fiscal o laboral que se conserva
    // (docs/PURGA_EMPRESA.md › Política de retención y purga): se queda
    // suspendida. El detalle nombra lo que la retiene.
    case 'PURGA_RETENCION':
      return { status: 409, error: detalle }
  }
  // Una FK que la purga no pudo despejar (23503) o un guard de inmutabilidad
  // (23514 check_violation, 23001 restrict_violation): la empresa tiene datos
  // que el esquema no deja borrar. Es un conflicto con el estado, no un fallo
  // del servidor, y el mensaje de Postgres nombra la tabla o el guard.
  if (err.code === '23503' || err.code === '23514' || err.code === '23001') {
    return {
      status: 409,
      error: `La purga se revirtió entera: la empresa tiene datos que el esquema no permite borrar (${message}). No se borró nada.`,
    }
  }
  return { status: 500, error: 'No se pudo purgar la empresa; la purga se revirtió entera y no se borró nada.' }
}

/** Lo que devuelve `purgar_empresa` al confirmar. */
export interface PurgeResult {
  company_id: string
  nombre: string
  logo_url: string | null
  usuarios_auth: string[]
  personas: number
  cuentas_cliente: number
  clientes: number
  proyectos: number
  unidades: number
  superadmins_desligados: number
}

/**
 * Lee la respuesta de la RPC sin confiar en su forma: si no trae la lista de
 * identidades a borrar, el handler no puede cumplir su parte y lo dice.
 */
export function parsePurgeResult(raw: unknown): PurgeResult | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.usuarios_auth) || !r.usuarios_auth.every((x) => typeof x === 'string')) return null
  if (typeof r.company_id !== 'string' || typeof r.nombre !== 'string') return null
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    company_id: r.company_id,
    nombre: r.nombre,
    logo_url: typeof r.logo_url === 'string' && r.logo_url ? r.logo_url : null,
    usuarios_auth: r.usuarios_auth as string[],
    personas: num(r.personas),
    cuentas_cliente: num(r.cuentas_cliente),
    clientes: num(r.clientes),
    proyectos: num(r.proyectos),
    unidades: num(r.unidades),
    superadmins_desligados: num(r.superadmins_desligados),
  }
}

/**
 * `true` si `auth.admin.deleteUser` falló porque la identidad ya no existe:
 * para la purga eso es éxito (idempotente), no una identidad pendiente.
 * `message` está en el tipo porque el handler también le pasa el error de una
 * promesa rechazada (`{ message }`, sin status ni code → no "gone"); sin él, TS
 * lo rechaza por no compartir propiedades con `{ status?, code? }` (TS2345).
 */
export function isAuthUserGone(
  err: { status?: number; code?: string; message?: string } | null | undefined,
): boolean {
  return !!err && (err.status === 404 || err.code === 'user_not_found')
}
