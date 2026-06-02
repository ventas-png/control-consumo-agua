import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { confirm, notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { exportData, type ExportColumn } from '../../lib/exportData'

// ============================================================================
// SavedReportsModal — F4.5.1 MVP: Reportes guardados con ejecucion manual.
// ============================================================================
// Permite al admin guardar una definicion de reporte (tabla fuente + columnas
// + filtros) y re-ejecutarla en un click sin reconfigurar.
//
// Ejecucion (MVP):
//   1. SELECT al source_table con filtros aplicados client-side
//   2. exportData() genera XLSX/CSV/PDF (default segun template)
//   3. INSERT en report_runs con rows_count + status para trazabilidad
//
// Scope NO incluido (PRs siguientes):
//   - F4.5.1b: edge function run-report (server-side, para reports pesados)
//   - F4.5.1c: pg_cron schedule (monthly_day1, weekly_monday)
//   - F4.5.1d: email delivery a recipients (Resend via email_send_queue)

interface Props { onClose: () => void; companyId: string }

type SourceTable =
  | 'cuotas_condominio'
  | 'pagos'
  | 'tickets_mantenimiento'
  | 'gastos_condominio'
  | 'fondo_reserva_condominio'

type ScheduleKind = 'manual' | 'monthly_day1' | 'weekly_monday'
type Format = 'xlsx' | 'csv' | 'pdf'

interface ReportTemplate {
  id: string
  company_id: string
  project_id: string | null
  name: string
  description: string | null
  source_table: SourceTable
  columns: Array<{ header: string; accessor: string }>
  filters: Record<string, string | number | null>
  schedule_kind: ScheduleKind
  recipients: string[]
  default_format: Format
  created_by: string | null
  created_at: string
}

const SOURCE_LABELS: Record<SourceTable, string> = {
  cuotas_condominio:        'Cuotas de condominio',
  pagos:                    'Pagos',
  tickets_mantenimiento:    'Tickets de mantenimiento',
  gastos_condominio:        'Gastos',
  fondo_reserva_condominio: 'Fondo de reserva',
}

// Columnas sugeridas por tabla (template inicial al elegir source)
const DEFAULT_COLUMNS: Record<SourceTable, Array<{ header: string; accessor: string }>> = {
  cuotas_condominio: [
    { header: 'Periodo', accessor: 'periodo' },
    { header: 'Concepto', accessor: 'concepto' },
    { header: 'Monto', accessor: 'monto' },
    { header: 'Estado', accessor: 'estado' },
    { header: 'Vencimiento', accessor: 'fecha_vencimiento' },
  ],
  pagos: [
    { header: 'Fecha', accessor: 'fecha_pago' },
    { header: 'Monto', accessor: 'monto' },
    { header: 'Estado', accessor: 'estado' },
    { header: 'Método', accessor: 'metodo_pago' },
    { header: 'Referencia', accessor: 'referencia_pago' },
  ],
  tickets_mantenimiento: [
    { header: 'Título', accessor: 'titulo' },
    { header: 'Estado', accessor: 'estado' },
    { header: 'Prioridad', accessor: 'prioridad' },
    { header: 'Creado', accessor: 'created_at' },
  ],
  gastos_condominio: [
    { header: 'Fecha', accessor: 'fecha' },
    { header: 'Categoría', accessor: 'categoria' },
    { header: 'Concepto', accessor: 'concepto' },
    { header: 'Monto', accessor: 'monto' },
    { header: 'Estado', accessor: 'estado' },
  ],
  fondo_reserva_condominio: [
    { header: 'Fecha', accessor: 'fecha' },
    { header: 'Concepto', accessor: 'concepto' },
    { header: 'Tipo', accessor: 'tipo' },
    { header: 'Monto', accessor: 'monto' },
  ],
}

const SCHEDULE_LABELS: Record<ScheduleKind, string> = {
  manual:        'Solo manual',
  monthly_day1:  'Mensual (día 1)',
  weekly_monday: 'Semanal (lunes)',
}

export function SavedReportsModal({ onClose, companyId }: Props) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('report_templates')
        .select('id, company_id, project_id, name, description, source_table, columns, filters, schedule_kind, recipients, default_format, created_by, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
      if (err) throw err
      setTemplates((data ?? []) as ReportTemplate[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los reportes.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  async function handleCreate() {
    const result = await openPromptDialog({
      title: 'Nuevo reporte guardado',
      fields: [
        { name: 'name', label: 'Nombre', required: true, autoFocus: true, placeholder: 'Ej: Cuotas pendientes del mes' },
        { name: 'description', label: 'Descripción (opcional)', control: 'textarea' },
        {
          name: 'source_table', label: 'Tabla fuente', required: true, control: 'select',
          options: (Object.entries(SOURCE_LABELS) as Array<[SourceTable, string]>).map(([v, l]) => ({ value: v, label: l })),
        },
        {
          name: 'default_format', label: 'Formato por defecto', required: true, control: 'select',
          options: [
            { value: 'xlsx', label: 'Excel (.xlsx)' },
            { value: 'csv', label: 'CSV (.csv)' },
            { value: 'pdf', label: 'PDF (.pdf)' },
          ],
          initialValue: 'xlsx',
        },
      ],
      submitText: 'Crear',
      validate: data => data.name.trim() ? null : 'El nombre es obligatorio',
    })
    if (!result) return
    const source = result.source_table as SourceTable
    const format = result.default_format as Format
    const { error: err } = await supabase.from('report_templates').insert({
      company_id: companyId,
      name: result.name.trim(),
      description: result.description?.trim() || null,
      source_table: source,
      columns: DEFAULT_COLUMNS[source],
      filters: {},
      schedule_kind: 'manual',
      recipients: [],
      default_format: format,
    })
    if (err) { notify({ variant: 'error', title: 'Error', text: err.message }); return }
    notify({ variant: 'success', title: 'Reporte creado', duration: 1500 })
    void load()
  }

  async function handleDelete(t: ReportTemplate) {
    const r = await confirm({
      title: '¿Eliminar reporte guardado?',
      text: `"${t.name}" — esta acción no se puede deshacer.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Eliminar',
    })
    if (!r.isConfirmed) return
    const { error: err } = await supabase.from('report_templates').delete().eq('id', t.id)
    if (err) { notify({ variant: 'error', title: 'Error', text: err.message }); return }
    notify({ variant: 'success', title: 'Eliminado', duration: 1500 })
    void load()
  }

  async function handleRun(t: ReportTemplate) {
    setRunning(t.id)
    let status: 'success' | 'failed' = 'success'
    let errorMsg: string | null = null
    let rowsCount = 0
    try {
      let q = supabase.from(t.source_table).select('*').eq('company_id', companyId)
      // Filtrar soft-deleted en tablas con esa columna (F2.7)
      q = q.is('deleted_at', null)
      // Aplicar filtros guardados (key/value)
      for (const [k, v] of Object.entries(t.filters)) {
        if (v !== null && v !== '' && v !== undefined) {
          q = q.eq(k, v)
        }
      }
      const { data, error: err } = await q
      if (err) throw err
      const rows = (data ?? []) as Array<Record<string, unknown>>
      rowsCount = rows.length
      const exportColumns: ExportColumn<Record<string, unknown>>[] = t.columns.map(c => ({
        header: c.header,
        accessor: c.accessor,
      }))
      await exportData(t.default_format, {
        filename: `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`,
        data: rows,
        columns: exportColumns,
        title: t.name,
        subtitle: t.description ?? undefined,
      })
      notify({ variant: 'success', title: 'Reporte exportado', text: `${rowsCount} filas`, duration: 1800 })
    } catch (e: unknown) {
      status = 'failed'
      errorMsg = e instanceof Error ? e.message : String(e)
      notify({ variant: 'error', title: 'Error', text: errorMsg })
    } finally {
      // Log run para auditoria — fire-and-forget, ya manejamos el error principal
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('report_runs').insert({
        template_id: t.id,
        company_id: companyId,
        triggered_by: 'manual',
        rows_count: rowsCount,
        format: t.default_format,
        status,
        error_msg: errorMsg,
        actor_id: user?.id ?? null,
      })
      setRunning(null)
    }
  }

  return (
    <div
      style={overlayStyle}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={modalStyle} role="dialog" aria-labelledby="reports-title">
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div id="reports-title" style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>
              📑 Reportes guardados
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Define una vez, re-ejecuta cuando quieras. Schedule + email llegan en próximos PRs.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => void handleCreate()}
              style={primaryBtnStyle}
            >
              + Nuevo reporte
            </button>
            <button onClick={onClose} aria-label="Cerrar" style={closeBtnStyle}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {loading ? (
            <div style={emptyStateStyle}>Cargando…</div>
          ) : error ? (
            <div style={{ ...emptyStateStyle, color: 'var(--at-danger)' }}>{error}</div>
          ) : templates.length === 0 ? (
            <div style={emptyStateStyle}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📑</div>
              <p style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>Sin reportes guardados</p>
              <p style={{ fontSize: '13px' }}>Crea el primero para tener un atajo a la vista que necesitas regularmente.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {templates.map(t => (
                <div key={t.id} style={cardStyle}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>{t.name}</span>
                      <span style={badgeStyle}>{SOURCE_LABELS[t.source_table]}</span>
                      <span style={badgeStyle}>{t.default_format.toUpperCase()}</span>
                      {t.schedule_kind !== 'manual' && (
                        <span style={{ ...badgeStyle, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>
                          ⏰ {SCHEDULE_LABELS[t.schedule_kind]}
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{t.description}</div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                      {t.columns.length} columna{t.columns.length === 1 ? '' : 's'} · {Object.keys(t.filters).length} filtro{Object.keys(t.filters).length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => void handleRun(t)}
                      disabled={running === t.id}
                      style={runBtnStyle(running === t.id)}
                    >
                      {running === t.id ? '⏳…' : '▶ Ejecutar'}
                    </button>
                    <button
                      onClick={() => void handleDelete(t)}
                      title="Eliminar reporte"
                      style={dangerBtnStyle}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ───── Styles ─────
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
}
const modalStyle: CSSProperties = {
  background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '760px',
  boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
  display: 'flex', flexDirection: 'column', maxHeight: '90vh',
}
const headerStyle: CSSProperties = {
  padding: '20px 24px 14px', borderBottom: '1px solid var(--at-line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
}
const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px',
  color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
}
const primaryBtnStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '9px 16px', borderRadius: '8px', border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
}
const emptyStateStyle: CSSProperties = {
  textAlign: 'center', color: 'var(--at-ink-3)', marginTop: '40px', fontSize: '13px',
}
const cardStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  padding: '12px 14px', borderRadius: '10px',
  border: '1px solid var(--at-line)', background: 'var(--at-surface-2)',
}
const badgeStyle: CSSProperties = {
  fontSize: '10px', fontWeight: 700, color: 'var(--at-ink-3)',
  background: 'var(--at-chip)', padding: '2px 6px', borderRadius: '4px',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}
function runBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--at-primary)',
    background: 'var(--at-primary-tint)', color: 'var(--at-primary)',
    fontSize: '12px', fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}
const dangerBtnStyle: CSSProperties = {
  padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--at-line)',
  background: 'var(--at-surface)', color: 'var(--at-danger)',
  fontSize: '14px', cursor: 'pointer',
}
