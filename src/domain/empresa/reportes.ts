// domain/empresa/reportes.ts — Acceso a datos de los "reportes guardados" del
// tenant (T7/PR3). Baja a domain/ lo que vivía inline en SavedReportsModal:
// CRUD de `report_templates`, histórico de `report_runs`, la ejecución del
// SELECT dinámico sobre la tabla fuente (con filtros guardados) y el log de la
// corrida (incluye la resolución del actor vía auth.getUser). La exportación
// (exportData) y el envío por email se quedan en la UI/lib.
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'

/** Columnas de report_templates que consume la pantalla (evita select('*')). */
const TEMPLATE_COLS =
  'id, company_id, project_id, name, description, source_table, columns, filters, schedule_kind, recipients, default_format, created_by, created_at, last_run_at'

/** Plantillas de reporte de la empresa (más recientes primero). */
export async function fetchReportTemplates<T>(
  companyId: string,
): Promise<{ data: T[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('report_templates')
    .select(TEMPLATE_COLS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  return { data: (data as T[]) ?? null, error: error?.message ?? null }
}

/** Crea una plantilla (payload ya armado por la UI). */
export async function createReportTemplate(
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('report_templates').insert(payload)
  return { error: error?.message ?? null }
}

/** Elimina una plantilla por id. */
export async function deleteReportTemplate(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('report_templates').delete().eq('id', id)
  return { error: error?.message ?? null }
}

/** Actualiza los destinatarios de email de una plantilla. */
export async function updateReportTemplateRecipients(
  id: string,
  recipients: string[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('report_templates').update({ recipients }).eq('id', id)
  return { error: error?.message ?? null }
}

/** Últimas 5 corridas de una plantilla (histórico). */
export async function fetchReportRuns<T>(
  templateId: string,
): Promise<{ data: T[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('report_runs')
    .select('id, triggered_by, triggered_at, rows_count, format, status, error_msg')
    .eq('template_id', templateId)
    .order('triggered_at', { ascending: false })
    .limit(5)
  return { data: (data as T[]) ?? null, error: error?.message ?? null }
}

/**
 * Ejecuta el SELECT dinámico de un reporte: tabla fuente + scope de empresa,
 * excluye soft-deleted (`deleted_at IS NULL`) y aplica los filtros guardados
 * (ignora null/''/undefined). Devuelve las filas crudas para exportar.
 *
 * D1: trae el resultado COMPLETO paginando server-side con `.range()` en vez de
 * un solo SELECT — que quedaba a merced del tope silencioso de PostgREST (~1000
 * filas), exportando/enviando reportes incompletos sin aviso. El orden por `id`
 * (todas las tablas fuente del whitelist lo tienen) da una paginación estable.
 */
export async function runReportQuery(
  sourceTable: string,
  companyId: string,
  filters: Record<string, unknown>,
): Promise<{ data: Array<Record<string, unknown>> | null; error: string | null; truncated?: boolean }> {
  const { data, error, truncated } = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let q = supabase.from(sourceTable).select('*').eq('company_id', companyId).is('deleted_at', null)
    for (const [k, v] of Object.entries(filters)) {
      if (v !== null && v !== '' && v !== undefined) q = q.eq(k, v)
    }
    return q.order('id', { ascending: true }).range(from, to)
  })
  if (error) return { data: null, error, truncated }
  return { data, error: null, truncated }
}

export interface LogReportRunInput {
  templateId: string
  companyId: string
  triggeredBy: 'manual' | 'scheduled' | 'api'
  rowsCount: number
  format: string
  status: 'success' | 'failed'
  errorMsg: string | null
}

/**
 * Registra una corrida en report_runs (resuelve el actor con auth.getUser).
 * Fire-and-forget desde la UI; no lanza.
 */
export async function logReportRun(input: LogReportRunInput): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('report_runs').insert({
    template_id: input.templateId,
    company_id: input.companyId,
    triggered_by: input.triggeredBy,
    rows_count: input.rowsCount,
    format: input.format,
    status: input.status,
    error_msg: input.errorMsg,
    actor_id: user?.id ?? null,
  })
}
