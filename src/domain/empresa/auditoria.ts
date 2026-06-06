// domain/empresa/auditoria.ts — Acceso a datos de trazabilidad y papelera del
// tenant (T7/PR3). Baja a domain/ los `select`/`update` que vivían inline en
// AuditLogModal (permission_audit_log), FinancialAuditModal (audit_log) y
// PapeleraModal (soft-delete + restore). Los filtros/paginación los decide la
// UI y se pasan como parámetros; la resolución de nombres de actor reusa
// `domain/usuarios.fetchAppUserNamesByIds`. Sólo I/O aquí.
import { supabase } from '../../lib/supabase'

// ── permission_audit_log (roles/permisos) — AuditLogModal ──

export interface PermissionAuditRow {
  id: number
  actor_id: string | null
  target_user_id: string | null
  target_role_id: string | null
  action: string
  details: Record<string, unknown> | null
  occurred_at: string
}

export interface AuditPageOpts {
  page: number
  pageSize: number
  /** Filtro opcional por acción. */
  action?: string
}

/** Página del log de auditoría de permisos (filtro por acción opcional). */
export async function fetchPermissionAuditLog(
  opts: AuditPageOpts,
): Promise<{ data: PermissionAuditRow[] | null; error: string | null }> {
  let query = supabase
    .from('permission_audit_log')
    .select('id, actor_id, target_user_id, target_role_id, action, details, occurred_at')
    .order('occurred_at', { ascending: false })
    .range(opts.page * opts.pageSize, opts.page * opts.pageSize + opts.pageSize - 1)
  if (opts.action) query = query.eq('action', opts.action)
  const { data, error } = await query
  return { data: (data as PermissionAuditRow[]) ?? null, error: error?.message ?? null }
}

/** Nombres + color de roles por id (chips del log de permisos). Degrada a `[]`. */
export async function fetchRoleNamesByIds(
  ids: string[],
): Promise<Array<{ id: string; name: string; color: string }>> {
  const { data } = await supabase.from('roles').select('id, name, color').in('id', ids)
  return (data as Array<{ id: string; name: string; color: string }>) ?? []
}

// ── audit_log (financiero/mantenimiento) — FinancialAuditModal ──

export interface FinancialAuditRow {
  id: number
  table_name: string
  record_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  actor_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  project_id: string | null
  occurred_at: string
}

export interface FinancialAuditPageOpts extends AuditPageOpts {
  tableName?: string
  /** Rango de fechas (yyyy-mm-dd); la función arma los límites del día. */
  from?: string
  to?: string
}

/** Página del log financiero/mantenimiento con filtros de tabla/acción/fechas. */
export async function fetchFinancialAuditLog(
  opts: FinancialAuditPageOpts,
): Promise<{ data: FinancialAuditRow[] | null; error: string | null }> {
  let q = supabase
    .from('audit_log')
    .select('id, table_name, record_id, action, actor_id, before, after, project_id, occurred_at')
    .order('occurred_at', { ascending: false })
    .range(opts.page * opts.pageSize, opts.page * opts.pageSize + opts.pageSize - 1)
  if (opts.tableName) q = q.eq('table_name', opts.tableName)
  if (opts.action) q = q.eq('action', opts.action)
  if (opts.from) q = q.gte('occurred_at', `${opts.from}T00:00:00`)
  if (opts.to) q = q.lte('occurred_at', `${opts.to}T23:59:59`)
  const { data, error } = await q
  return { data: (data as FinancialAuditRow[]) ?? null, error: error?.message ?? null }
}

// ── Papelera (soft-delete recovery) — PapeleraModal ──

export interface DeletedRow {
  id: string
  deleted_at: string
  deleted_by: string | null
  [key: string]: unknown
}

/**
 * Página de filas soft-deleted (`deleted_at != NULL`) de una tabla con soft
 * delete. `orderCol` es el desempate secundario (created_at/fecha). La RLS de
 * cada tabla ya acota por tenant.
 */
export async function fetchDeletedRows(
  table: string,
  orderCol: string,
  page: number,
  pageSize: number,
): Promise<{ data: DeletedRow[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .order(orderCol, { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  return { data: (data as DeletedRow[]) ?? null, error: error?.message ?? null }
}

/**
 * Restaura filas (individual o bulk) limpiando `deleted_at`/`deleted_by`. El
 * trigger de audit_log registra el restore automáticamente.
 */
export async function restoreDeletedRows(
  table: string,
  ids: string[],
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: null, deleted_by: null })
    .in('id', ids)
  return { error: error?.message ?? null }
}
