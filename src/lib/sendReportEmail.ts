import { supabase } from './supabase'
import { exportData, type ExportFormat, type ExportColumn } from './exportData'

// ============================================================================
// sendReportByEmail — F4.5.1d: dispara la entrega de un saved report por
// email a los recipients configurados en la template.
// ============================================================================
//
// Flow:
//   1. Genera el archivo via exportData() pero captura el Blob en lugar de
//      disparar download (forzamos la captura via override de URL.createObjectURL).
//   2. Sube el Blob a Supabase Storage en path
//      report-attachments/{company_id}/{template_id}/{timestamp}.{format}
//   3. Crea signed URL de 24h
//   4. INSERT en email_send_queue por cada recipient con template_key
//      'saved_report_delivery' + vars
//
// El worker de email_send_queue (F2.15e #229) procesa los inserts con retry +
// backoff exponencial. No hay que esperar al envio aqui.

interface SendOptions<T> {
  companyId: string
  templateId: string
  templateName: string
  sourceTable: string
  format: ExportFormat
  data: T[]
  columns: ExportColumn<T>[]
  recipients: string[]
}

interface SendResult {
  success: boolean
  enqueued: number
  attachmentPath: string
  error?: string
}

export async function sendReportByEmail<T>(opts: SendOptions<T>): Promise<SendResult> {
  if (opts.recipients.length === 0) {
    return { success: false, enqueued: 0, attachmentPath: '', error: 'No hay destinatarios configurados.' }
  }

  // 1. Generar archivo capturando el blob (sin trigger download)
  const blob = await generateBlob(opts.format, opts.data, opts.columns, opts.templateName)

  // 2. Upload a storage
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `${opts.companyId}/${opts.templateId}/${timestamp}.${opts.format}`
  const { error: uploadErr } = await supabase.storage
    .from('report-attachments')
    .upload(path, blob, { contentType: mimeFor(opts.format) })
  if (uploadErr) {
    return { success: false, enqueued: 0, attachmentPath: '', error: `Upload falló: ${uploadErr.message}` }
  }

  // 3. Signed URL (24h)
  const { data: signed, error: signErr } = await supabase.storage
    .from('report-attachments')
    .createSignedUrl(path, 24 * 60 * 60)
  if (signErr || !signed?.signedUrl) {
    return { success: false, enqueued: 0, attachmentPath: path, error: signErr?.message ?? 'Sign URL falló.' }
  }

  // 4. Encolar email por cada recipient
  const { data: { user } } = await supabase.auth.getUser()
  const sourceLabel = SOURCE_LABEL_MAP[opts.sourceTable] ?? opts.sourceTable
  const vars = {
    report_name:  opts.templateName,
    rows_count:   String(opts.data.length),
    format:       opts.format.toUpperCase(),
    source_table: sourceLabel,
    attachment_url: signed.signedUrl,
    generated_at: new Date().toLocaleString('es-GT', { dateStyle: 'long', timeStyle: 'short' }),
  }

  const enqueueRows = opts.recipients.map(email => ({
    payload: {
      company_id:  opts.companyId,
      template_key:'saved_report_delivery',
      to_email:    email,
      vars,
    },
    company_id:  opts.companyId,
    triggered_by: user?.id ?? null,
    status: 'pending',
  }))

  const { error: queueErr } = await supabase.from('email_send_queue').insert(enqueueRows)
  if (queueErr) {
    return { success: false, enqueued: 0, attachmentPath: path, error: `Cola falló: ${queueErr.message}` }
  }

  return { success: true, enqueued: enqueueRows.length, attachmentPath: path }
}

const SOURCE_LABEL_MAP: Record<string, string> = {
  cuotas_condominio:        'Cuotas de condominio',
  pagos:                    'Pagos',
  tickets_mantenimiento:    'Tickets de mantenimiento',
  gastos_condominio:        'Gastos',
  fondo_reserva_condominio: 'Fondo de reserva',
}

function mimeFor(format: ExportFormat): string {
  if (format === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (format === 'pdf')  return 'application/pdf'
  return 'text/csv;charset=utf-8'
}

// Captura del blob: exportData() dispara download via createObjectURL + anchor
// click. Sobreescribimos createObjectURL/click para capturar el Blob sin que
// el usuario vea el download. Restauramos al terminar.
async function generateBlob<T>(
  format: ExportFormat,
  data: T[],
  columns: ExportColumn<T>[],
  filename: string,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let captured: Blob | null = null
    const origCreateUrl = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    const origAppend = document.body.appendChild.bind(document.body)

    URL.createObjectURL = (b: Blob) => {
      captured = b
      return 'blob:report-mock'
    }
    URL.revokeObjectURL = () => {}
    document.body.appendChild = function<T extends Node>(node: T): T {
      // No-op: evita que el <a> click descargue
      if (node instanceof HTMLAnchorElement) return node
      return origAppend(node) as T
    }

    void exportData(format, { filename, data, columns })
      .then(() => {
        URL.createObjectURL = origCreateUrl
        URL.revokeObjectURL = origRevoke
        document.body.appendChild = origAppend
        if (captured) resolve(captured)
        else reject(new Error('No se pudo capturar el archivo generado.'))
      })
      .catch(err => {
        URL.createObjectURL = origCreateUrl
        URL.revokeObjectURL = origRevoke
        document.body.appendChild = origAppend
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}
