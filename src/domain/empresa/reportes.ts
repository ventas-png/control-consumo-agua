// domain/empresa/reportes.ts — Acceso a datos de los "reportes guardados" del
// tenant (T7/PR3). Baja a domain/ lo que vivía inline en SavedReportsModal:
// CRUD de `report_templates`, histórico de `report_runs`, la ejecución del
// SELECT dinámico sobre la tabla fuente (con filtros guardados) y el log de la
// corrida (incluye la resolución del actor vía auth.getUser). La exportación
// (exportData) y el envío por email se quedan en la UI/lib.
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'

// ─── Metadata de las tablas fuente (whitelist C4) ────────────────────────────
// Única fuente de verdad del FRONTEND para los reportes guardados: etiquetas,
// columnas sugeridas y — crítico — cómo se aísla el tenant en cada tabla.
// El edge process-scheduled-reports mantiene su espejo en logic.ts (no puede
// importar src/). El CHECK constraint de report_templates es la barrera en BD.
//
//   scope 'company'  → la tabla tiene company_id directo.
//   scope 'project'  → NO tiene company_id (pagos, registros): se aísla por
//                      project_id ∈ proyectos del tenant. El filtro fijo por
//                      company_id rompía los reportes de `pagos` desde el día 1.
//   softDelete false → la tabla no tiene deleted_at (gastos_condominio no
//                      estaba en F2.7; conta_asientos maneja estado/anulación
//                      propios) — el .is('deleted_at', null) fijo los rompía.
//   cols             → proyección; `registros` jamás '*' (foto es base64 de
//                      hasta ~15 MB por fila, gps es Json).

export interface ReportSourceMeta {
  label: string
  scope: 'company' | 'project'
  softDelete: boolean
  cols: string
  defaultColumns: Array<{ header: string; accessor: string }>
}

const REGISTROS_REPORT_COLS =
  'id, cliente_id, cliente_nombre, contador_id, project_id, fecha, mes, ' +
  'lectura_anterior, lectura_actual, consumo, tipo_cobro, tarifa_aplicada, ' +
  'tarifa_exceso_aplicada, canon_aplicado, monto_calculado, iva_tasa, iva_monto, ' +
  'monto_con_iva, total_a_pagar, estado, monto_pagado, fecha_pago, ' +
  'fecha_vencimiento, mora_monto, dias_servicio, notas, created_at'

export const REPORT_SOURCES = {
  cuotas_condominio: {
    label: 'Cuotas de condominio', scope: 'company', softDelete: true, cols: '*',
    defaultColumns: [
      { header: 'Periodo', accessor: 'periodo' },
      { header: 'Concepto', accessor: 'concepto' },
      { header: 'Monto', accessor: 'monto' },
      { header: 'Estado', accessor: 'estado' },
      { header: 'Vencimiento', accessor: 'fecha_vencimiento' },
    ],
  },
  pagos: {
    label: 'Pagos', scope: 'project', softDelete: true, cols: '*',
    defaultColumns: [
      { header: 'Fecha', accessor: 'created_at' },
      { header: 'Monto', accessor: 'monto' },
      { header: 'Estado', accessor: 'estado' },
      { header: 'Método', accessor: 'metodo' },
      { header: 'Referencia', accessor: 'referencia' },
    ],
  },
  tickets_mantenimiento: {
    label: 'Tickets de mantenimiento', scope: 'company', softDelete: true, cols: '*',
    defaultColumns: [
      { header: 'Título', accessor: 'titulo' },
      { header: 'Estado', accessor: 'estado' },
      { header: 'Prioridad', accessor: 'prioridad' },
      { header: 'Creado', accessor: 'created_at' },
    ],
  },
  gastos_condominio: {
    label: 'Gastos', scope: 'company', softDelete: false, cols: '*',
    defaultColumns: [
      { header: 'Fecha', accessor: 'fecha' },
      { header: 'Categoría', accessor: 'categoria' },
      { header: 'Concepto', accessor: 'concepto' },
      { header: 'Monto', accessor: 'monto' },
      { header: 'Estado', accessor: 'estado' },
    ],
  },
  fondo_reserva_condominio: {
    label: 'Fondo de reserva', scope: 'company', softDelete: true, cols: '*',
    defaultColumns: [
      { header: 'Fecha', accessor: 'fecha' },
      { header: 'Concepto', accessor: 'concepto' },
      { header: 'Tipo', accessor: 'tipo' },
      { header: 'Monto', accessor: 'monto' },
    ],
  },
  registros: {
    label: 'Lecturas / recibos de agua', scope: 'project', softDelete: true, cols: REGISTROS_REPORT_COLS,
    defaultColumns: [
      { header: 'Fecha', accessor: 'fecha' },
      { header: 'Cliente', accessor: 'cliente_nombre' },
      { header: 'Consumo m³', accessor: 'consumo' },
      { header: 'Monto', accessor: 'monto_calculado' },
      { header: 'Estado', accessor: 'estado' },
      { header: 'Mes', accessor: 'mes' },
    ],
  },
  conta_asientos: {
    label: 'Asientos contables', scope: 'company', softDelete: false, cols: '*',
    defaultColumns: [
      { header: 'Fecha', accessor: 'fecha' },
      { header: 'Número', accessor: 'numero' },
      { header: 'Concepto', accessor: 'concepto' },
      { header: 'Tipo', accessor: 'tipo' },
      { header: 'Estado', accessor: 'estado' },
      { header: 'Debe', accessor: 'total_debe' },
      { header: 'Haber', accessor: 'total_haber' },
    ],
  },
} satisfies Record<string, ReportSourceMeta>

export type ReportSourceTable = keyof typeof REPORT_SOURCES

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
 * Ejecuta el SELECT dinámico de un reporte según la metadata de la tabla
 * (REPORT_SOURCES): scope de tenant correcto por tabla (company_id directo, o
 * project_id ∈ proyectos del tenant para pagos/registros que no lo tienen),
 * soft-delete solo donde la columna existe, y proyección segura (registros sin
 * foto/gps). Aplica los filtros guardados (ignora null/''/undefined).
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
  const meta: ReportSourceMeta | undefined = (REPORT_SOURCES as Record<string, ReportSourceMeta>)[sourceTable]
  if (!meta) return { data: null, error: `Tabla fuente no soportada: ${sourceTable}`, truncated: false }

  // scope 'project': la tabla no tiene company_id — resolver los proyectos del
  // tenant primero (RLS ya acota projects; el filtro es defensivo + correcto).
  let projectIds: string[] = []
  if (meta.scope === 'project') {
    const { data: projs, error: projErr } = await supabase
      .from('projects').select('id').eq('company_id', companyId)
    if (projErr) return { data: null, error: projErr.message, truncated: false }
    projectIds = ((projs ?? []) as Array<{ id: string }>).map(p => p.id)
    if (projectIds.length === 0) return { data: [], error: null, truncated: false }
  }

  const { data, error, truncated } = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let q = supabase.from(sourceTable).select(meta.cols)
    q = meta.scope === 'company' ? q.eq('company_id', companyId) : q.in('project_id', projectIds)
    if (meta.softDelete) q = q.is('deleted_at', null)
    for (const [k, v] of Object.entries(filters)) {
      if (v !== null && v !== '' && v !== undefined) q = q.eq(k, v)
    }
    // Cast: con `select(cols)` dinámico PostgREST no puede inferir el shape de
    // la fila; el runtime devuelve objetos planos de las columnas pedidas.
    return q.order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{
      data: Array<Record<string, unknown>> | null
      error: { message: string } | null
    }>
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
