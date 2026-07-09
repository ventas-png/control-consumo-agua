// ============================================================================
// process-scheduled-reports — F4.5.1c-real edge function
// ============================================================================
// Invocada desde pg_cron (vía dispatch_scheduled_reports + pg_net.http_post)
// con body { template_id }. Procesa el template:
//
//   1. SELECT data del source_table con filtros aplicados
//   2. Serializa CSV (server-side, sin libs externas)
//   3. Upload a Storage bucket 'report-attachments'
//   4. Crea signed URL (24h)
//   5. INSERT N rows en email_send_queue con template_key='saved_report_delivery'
//   6. UPDATE report_templates.last_run_at = now()
//   7. INSERT en report_runs con triggered_by='scheduled'
//
// Auth: requiere Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (verificado
// contra env var). Los cron jobs pasan el service role para bypass RLS y poder
// leer/escribir cross-tenant.
//
// Formato: solo CSV en MVP server-side. XLSX/PDF requieren libs Deno pesadas
// que disparan cold start y complican el deploy; el usuario puede usar el
// "Send by email" del frontend para esos formatos cuando lo necesite.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
// Helpers puros (CSV, filtros aplicables, path de Storage, vars y filas de la
// cola de correo) extraídos a ./logic.ts para testearlos con vitest
// (infra:I22 · Track T8/T5). Aquí queda solo el I/O.
import {
  type ReportTemplate,
  applicableFilters,
  buildQueueRows,
  buildReportVars,
  buildStoragePath,
  serializeCsv,
} from './logic.ts'

interface RequestBody {
  template_id: string
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
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
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

  // ── 2. SELECT data del source_table con filters + soft-delete filter ──
  // El whitelist en CHECK constraint de report_templates ya bloquea source_table
  // arbitrario, asi que es seguro pasarlo directo.
  let q = admin.from(template.source_table).select('*').eq('company_id', template.company_id)
  q = q.is('deleted_at', null)
  for (const [k, v] of applicableFilters(template.filters)) {
    q = q.eq(k, v)
  }
  const { data: rows, error: rowsErr } = await q
  if (rowsErr) {
    await logRun(admin, template, 0, 'failed', rowsErr.message)
    return jsonResponse({ error: 'query_failed', detail: rowsErr.message }, 500, cors)
  }
  const dataRows = (rows ?? []) as Array<Record<string, unknown>>

  // ── 3. Serializa CSV ──
  const csv = serializeCsv(template.columns, dataRows)
  const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8' })

  // ── 4. Upload a Storage ──
  const path = buildStoragePath(template.company_id, template.id)
  const { error: uploadErr } = await admin.storage
    .from('report-attachments')
    .upload(path, csvBlob, { contentType: 'text/csv;charset=utf-8' })
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
  const vars = buildReportVars(
    template,
    dataRows.length,
    signed.signedUrl,
    new Date().toLocaleString('es-GT', { dateStyle: 'long', timeStyle: 'short' }),
  )
  const enqueueRows = buildQueueRows(template, vars)
  const { error: queueErr } = await admin.from('email_send_queue').insert(enqueueRows)
  if (queueErr) {
    await logRun(admin, template, dataRows.length, 'failed', `queue: ${queueErr.message}`)
    return jsonResponse({ error: 'queue_failed', detail: queueErr.message }, 500, cors)
  }

  // ── 7. UPDATE last_run_at + INSERT report_runs ──
  await admin.from('report_templates').update({ last_run_at: new Date().toISOString() }).eq('id', template.id)
  await logRun(admin, template, dataRows.length, 'success', null)

  return jsonResponse({
    success: true,
    template_id: template.id,
    rows_count: dataRows.length,
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
): Promise<void> {
  await admin.from('report_runs').insert({
    template_id:  template.id,
    company_id:   template.company_id,
    triggered_by: 'scheduled',
    rows_count:   rowsCount,
    format:       'csv',
    status,
    error_msg:    errorMsg,
    actor_id:     null,
  })
}
