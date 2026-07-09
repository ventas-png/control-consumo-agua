// Lógica pura de process-scheduled-reports, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js →
// corre directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// Aquí vive SOLO la decisión pura: serialización CSV (quoting + BOM), qué
// filtros del template aplican al query, path de Storage (aislado por tenant),
// variables del correo y filas de email_send_queue. El I/O (query, upload,
// signed URL, INSERTs) queda en index.ts.

export interface ReportColumn {
  header: string
  accessor: string
}

export interface ReportTemplate {
  id: string
  company_id: string
  name: string
  description: string | null
  source_table: string
  columns: ReportColumn[]
  filters: Record<string, string | number | null>
  recipients: string[]
  default_format: 'xlsx' | 'csv' | 'pdf'
}

export const SOURCE_LABEL_MAP: Record<string, string> = {
  cuotas_condominio:        'Cuotas de condominio',
  pagos:                    'Pagos',
  tickets_mantenimiento:    'Tickets de mantenimiento',
  gastos_condominio:        'Gastos',
  fondo_reserva_condominio: 'Fondo de reserva',
}

/** Etiqueta legible del source_table; cae al nombre crudo si no está mapeado. */
export function sourceLabel(sourceTable: string): string {
  return SOURCE_LABEL_MAP[sourceTable] ?? sourceTable
}

// ---------------------------------------------------------------------------
// Filtros del template
// ---------------------------------------------------------------------------

/**
 * Filtros que SÍ se aplican al query: se descartan null, '' y undefined (el
 * builder de templates guarda '' para "sin filtro"). El handler hace `.eq(k, v)`
 * por cada entrada devuelta, en el orden de Object.entries.
 */
export function applicableFilters(
  filters: Record<string, string | number | null>,
): Array<[string, string | number]> {
  return Object.entries(filters).filter(
    ([, v]) => v !== null && v !== '' && v !== undefined,
  ) as Array<[string, string | number]>
}

// ---------------------------------------------------------------------------
// CSV (server-side, sin libs externas)
// ---------------------------------------------------------------------------

export function serializeCsv(
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
): string {
  const headerLine = columns.map(c => escapeCsv(c.header)).join(',')
  const dataLines = rows.map(row =>
    columns.map(c => {
      const v = row[c.accessor]
      if (v === null || v === undefined) return ''
      if (typeof v === 'object') return escapeCsv(JSON.stringify(v))
      return escapeCsv(String(v))
    }).join(',')
  )
  // BOM UTF-8 para que Excel detecte encoding con acentos.
  return '﻿' + [headerLine, ...dataLines].join('\n')
}

export function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ---------------------------------------------------------------------------
// Storage path + payload del correo
// ---------------------------------------------------------------------------

/**
 * Path del CSV en el bucket report-attachments: `company/{template}/{timestamp}.csv`.
 * El prefijo company_id aísla los adjuntos por tenant; el timestamp ISO se
 * normaliza ([:.] → '-') porque Storage no acepta esos caracteres en el key.
 * `now` inyectable para tests deterministas.
 */
export function buildStoragePath(
  companyId: string,
  templateId: string,
  now: Date = new Date(),
): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-')
  return `${companyId}/${templateId}/${timestamp}.csv`
}

/**
 * Variables de la plantilla `saved_report_delivery`. `generatedAt` llega ya
 * formateado (el handler usa toLocaleString es-GT, que depende del runtime).
 */
export function buildReportVars(
  template: Pick<ReportTemplate, 'name' | 'source_table'>,
  rowsCount: number,
  attachmentUrl: string,
  generatedAt: string,
): Record<string, string> {
  return {
    report_name:    template.name,
    rows_count:     String(rowsCount),
    format:         'CSV',
    source_table:   sourceLabel(template.source_table),
    attachment_url: attachmentUrl,
    generated_at:   generatedAt,
  }
}

/**
 * Filas para email_send_queue: una por recipient, template_key fijo
 * 'saved_report_delivery', status 'pending' y company_id duplicado en el
 * payload y en la fila (el worker filtra por columna, el render usa el payload).
 */
export function buildQueueRows(
  template: Pick<ReportTemplate, 'company_id' | 'recipients'>,
  vars: Record<string, string>,
): Array<Record<string, unknown>> {
  return template.recipients.map(email => ({
    payload: {
      company_id:   template.company_id,
      template_key: 'saved_report_delivery',
      to_email:     email,
      vars,
    },
    company_id:    template.company_id,
    status:        'pending',
  }))
}
