// ============================================================================
// process-scheduled-reports — F4.5.1c-real edge function
// ============================================================================
// Invocada desde pg_cron (vía dispatch_scheduled_reports + pg_net.http_post)
// con body { template_id }. Procesa el template:
//
//   1. SELECT data del source_table con filtros aplicados — POR CHUNKS (sin el
//      tope silencioso de ~1000 filas de PostgREST) y con el scoping correcto
//      por tabla (company_id directo o project_id ∈ proyectos del tenant; ver
//      SOURCE_META en logic.ts — pagos/registros no tienen company_id).
//   2. Serializa CSV o XLSX (ambos server-side, sin libs externas; el XLSX es
//      un ZIP STORE + SpreadsheetML mínimo — ver logic.ts). PDF cae a CSV.
//   3. Upload a Storage bucket 'report-attachments'
//   4. Crea signed URL (24h)
//   5. INSERT N rows en email_send_queue con template_key='saved_report_delivery'
//   6. UPDATE report_templates.last_run_at = now()
//   7. INSERT en report_runs con triggered_by='scheduled'
//
// Auth: requiere Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (verificado
// contra env var). Los cron jobs pasan el service role para bypass RLS y poder
// leer/escribir cross-tenant — por eso el scoping explícito del paso 1 es la
// ÚNICA barrera de aislamiento aquí y debe ser correcto por tabla.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { SOURCE_META, fetchAllChunks, serializeCsv, buildXlsx } from './logic.ts'
import type { ChunkResult } from './logic.ts'

interface RequestBody {
  template_id: string
}

interface ReportTemplate {
  id: string
  company_id: string
  name: string
  description: string | null
  source_table: string
  columns: Array<{ header: string; accessor: string }>
  filters: Record<string, string | number | null>
  recipients: string[]
  default_format: 'xlsx' | 'csv' | 'pdf'
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, cors)
  }

  // ── Auth: solo service role puede invocar (lo hace pg_cron via pg_net) ──
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!serviceKey || !supabaseUrl) {
    return jsonResponse({ error: 'env_misconfigured' }, 500, cors)
  }
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  const bearerTok = (authHeader ?? '').replace('Bearer ', '').trim()
  if (!(await timingSafeEqualSecret(bearerTok, serviceKey))) {
    return jsonResponse({ error: 'unauthorized' }, 401, cors)
  }

  // ── Parse body ──
  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, cors)
  }
  if (!body.template_id) {
    return jsonResponse({ error: 'template_id is required' }, 400, cors)
  }

  // ── Cliente service-role para bypass RLS ──
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 1. Lee template ──
  const { data: tpl, error: tplErr } = await admin
    .from('report_templates')
    .select('id, company_id, name, description, source_table, columns, filters, recipients, default_format')
    .eq('id', body.template_id)
    .maybeSingle()
  if (tplErr || !tpl) {
    return jsonResponse({ error: 'template_not_found', detail: tplErr?.message }, 404, cors)
  }
  const template = tpl as ReportTemplate
  if (template.recipients.length === 0) {
    return jsonResponse({ error: 'no_recipients' }, 422, cors)
  }

  // El CHECK constraint de report_templates ya bloquea source_table arbitrario;
  // SOURCE_META es la defensa en profundidad + la config de scoping por tabla.
  const meta = SOURCE_META[template.source_table]
  if (!meta) {
    await logRun(admin, template, 0, 'failed', `unsupported source_table: ${template.source_table}`)
    return jsonResponse({ error: 'unsupported_source_table' }, 422, cors)
  }

  // ── 2. SELECT data por chunks con scoping por tabla ──
  // scope 'project': la tabla no tiene company_id (pagos, registros) — se aísla
  // por project_id ∈ proyectos del tenant.
  let projectIds: string[] = []
  if (meta.scope === 'project') {
    const { data: projs, error: projErr } = await admin
      .from('projects').select('id').eq('company_id', template.company_id)
    if (projErr) {
      await logRun(admin, template, 0, 'failed', `projects: ${projErr.message}`)
      return jsonResponse({ error: 'query_failed', detail: projErr.message }, 500, cors)
    }
    projectIds = ((projs ?? []) as Array<{ id: string }>).map(p => p.id)
  }

  let dataRows: Array<Record<string, unknown>> = []
  if (meta.scope === 'company' || projectIds.length > 0) {
    const { rows, error: rowsErr } = await fetchAllChunks((from, to) => {
      let q = admin.from(template.source_table).select(meta.cols)
      q = meta.scope === 'company'
        ? q.eq('company_id', template.company_id)
        : q.in('project_id', projectIds)
      if (meta.softDelete) q = q.is('deleted_at', null)
      for (const [k, v] of Object.entries(template.filters)) {
        if (v !== null && v !== '' && v !== undefined) {
          q = q.eq(k, v)
        }
      }
      // Orden ESTABLE por id: sin orden total, range() puede saltar/duplicar filas.
      return q.order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<ChunkResult>
    })
    if (rowsErr) {
      await logRun(admin, template, 0, 'failed', rowsErr)
      return jsonResponse({ error: 'query_failed', detail: rowsErr }, 500, cors)
    }
    dataRows = rows
  }

  // ── 3. Serializa CSV o XLSX (pdf cae a CSV: PDF server-side sigue parqueado) ──
  const format: 'csv' | 'xlsx' = template.default_format === 'xlsx' ? 'xlsx' : 'csv'
  let fileBlob: Blob
  if (format === 'xlsx') {
    const bytes = buildXlsx(template.columns, dataRows)
    fileBlob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  } else {
    // Bare `text/csv` (sin charset): espejo de sendReportEmail — el BOM en los
    // bytes ya le indica UTF-8 a Excel.
    fileBlob = new Blob([serializeCsv(template.columns, dataRows)], { type: 'text/csv' })
  }

  // ── 4. Upload a Storage ──
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `${template.company_id}/${template.id}/${timestamp}.${format}`
  const { error: uploadErr } = await admin.storage
    .from('report-attachments')
    .upload(path, fileBlob, { contentType: fileBlob.type })
  if (uploadErr) {
    await logRun(admin, template, dataRows.length, 'failed', `upload: ${uploadErr.message}`)
    return jsonResponse({ error: 'upload_failed', detail: uploadErr.message }, 500, cors)
  }

  // ── 5. Signed URL 24h ──
  const { data: signed, error: signErr } = await admin.storage
    .from('report-attachments')
    .createSignedUrl(path, 24 * 60 * 60)
  if (signErr || !signed?.signedUrl) {
    await logRun(admin, template, dataRows.length, 'failed', `sign: ${signErr?.message}`)
    return jsonResponse({ error: 'sign_failed' }, 500, cors)
  }

  // ── 6. INSERT en email_send_queue por cada recipient ──
  const vars = {
    report_name:    template.name,
    rows_count:     String(dataRows.length),
    format:         format.toUpperCase(),
    source_table:   meta.label,
    attachment_url: signed.signedUrl,
    generated_at:   new Date().toLocaleString('es-GT', { dateStyle: 'long', timeStyle: 'short' }),
  }
  const enqueueRows = template.recipients.map(email => ({
    payload: {
      company_id:   template.company_id,
      template_key: 'saved_report_delivery',
      to_email:     email,
      vars,
    },
    company_id:    template.company_id,
    status:        'pending',
  }))
  const { error: queueErr } = await admin.from('email_send_queue').insert(enqueueRows)
  if (queueErr) {
    await logRun(admin, template, dataRows.length, 'failed', `queue: ${queueErr.message}`)
    return jsonResponse({ error: 'queue_failed', detail: queueErr.message }, 500, cors)
  }

  // ── 7. UPDATE last_run_at + INSERT report_runs ──
  await admin.from('report_templates').update({ last_run_at: new Date().toISOString() }).eq('id', template.id)
  await logRun(admin, template, dataRows.length, 'success', null, format)

  return jsonResponse({
    success: true,
    template_id: template.id,
    rows_count: dataRows.length,
    format,
    enqueued: enqueueRows.length,
    attachment_path: path,
  }, 200, cors)
})

// ───── Helpers ────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function logRun(
  admin: ReturnType<typeof createClient>,
  template: ReportTemplate,
  rowsCount: number,
  status: 'success' | 'failed',
  errorMsg: string | null,
  format: 'csv' | 'xlsx' = 'csv',
): Promise<void> {
  await admin.from('report_runs').insert({
    template_id:  template.id,
    company_id:   template.company_id,
    triggered_by: 'scheduled',
    rows_count:   rowsCount,
    format,
    status,
    error_msg:    errorMsg,
    actor_id:     null,
  })
}
