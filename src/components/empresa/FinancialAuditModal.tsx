import { useState, useEffect, useCallback, Fragment, type ReactNode, type CSSProperties } from 'react'
import { fetchFinancialAuditLog } from '../../domain/empresa/auditoria'
import { fetchAppUserNamesByIds } from '../../domain/usuarios/queries'
import { ModalPortal } from '../shared/ModalPortal'

// ============================================================================
// FinancialAuditModal — F4.2.1: UI sobre audit_log generico de F2.7.
// ============================================================================
// La tabla audit_log captura cada INSERT/UPDATE/DELETE en tablas criticas
// (pagos, cuotas_condominio, fondo_reserva_condominio, gastos_condominio,
// tickets_mantenimiento) via triggers SECURITY DEFINER. RLS restringe la
// lectura a admin/company_owner del tenant.
//
// Diferente del AuditLogModal pre-existente que solo cubre permission_audit_log
// (roles/permisos). Ambos modales coexisten porque cubren dominios distintos.
//
// Scope inicial (MVP):
//   - Filtros: tabla, accion, rango de fechas
//   - Paginacion 50 rows/pagina
//   - Expand row para ver before/after JSON
//   - Resolucion de actor_id → full_name (batch fetch app_users)
//   - Sin export CSV en este PR (vendria en F4.2.1b si se necesita)

interface Props { onClose: () => void }

interface AuditRow {
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

interface UserMap { [id: string]: string }

const TABLE_LABELS: Record<string, string> = {
  pagos:                      'Pagos',
  cuotas_condominio:          'Cuotas',
  fondo_reserva_condominio:   'Fondo de reserva',
  gastos_condominio:          'Gastos',
  tickets_mantenimiento:      'Tickets mantenimiento',
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  INSERT: { label: 'Creó',     color: 'var(--at-success)' },
  UPDATE: { label: 'Modificó', color: 'var(--at-warning)' },
  DELETE: { label: 'Eliminó',  color: 'var(--at-danger)' },
}

export function FinancialAuditModal({ onClose }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [users, setUsers] = useState<UserMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterTable, setFilterTable] = useState<string>('')
  const [filterAction, setFilterAction] = useState<string>('')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(0)
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await fetchFinancialAuditLog({
        page, pageSize,
        tableName: filterTable || undefined,
        action: filterAction || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      })
      if (err) throw new Error(err)
      const auditRows = (data ?? []) as AuditRow[]
      setRows(auditRows)

      // Batch fetch actores
      const actorIds = new Set<string>()
      for (const r of auditRows) if (r.actor_id) actorIds.add(r.actor_id)
      if (actorIds.size > 0) {
        const u = await fetchAppUserNamesByIds([...actorIds])
        const map: UserMap = {}
        for (const x of u) map[x.id] = x.full_name
        setUsers(map)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el log de auditoria.')
    } finally {
      setLoading(false)
    }
  }, [page, filterTable, filterAction, filterFrom, filterTo])

  useEffect(() => { void load() }, [load])

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function resetFilters() {
    setFilterTable(''); setFilterAction(''); setFilterFrom(''); setFilterTo(''); setPage(0)
  }

  const hasMore = rows.length === pageSize

  return (
    <ModalPortal>
    <div
      style={overlayStyle}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={modalStyle} role="dialog" aria-labelledby="financial-audit-title">
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div id="financial-audit-title" style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>
              Trazabilidad financiera y de mantenimiento
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Cambios en pagos, cuotas, gastos, fondo de reserva y tickets — solo lectura
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={closeBtnStyle}>×</button>
        </div>

        {/* Filtros */}
        <div style={filtersStyle}>
          <Field label="Tabla">
            <select value={filterTable} onChange={e => { setFilterTable(e.target.value); setPage(0) }} style={selectStyle}>
              <option value="">Todas</option>
              {Object.entries(TABLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Acción">
            <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0) }} style={selectStyle}>
              <option value="">Todas</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Desde">
            <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(0) }} style={selectStyle} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(0) }} style={selectStyle} />
          </Field>
          {(filterTable || filterAction || filterFrom || filterTo) && (
            <button onClick={resetFilters} style={resetBtnStyle}>Limpiar</button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px' }}>
          {loading ? (
            <div style={emptyStateStyle}>Cargando…</div>
          ) : error ? (
            <div style={{ ...emptyStateStyle, color: 'var(--at-danger)' }}>{error}</div>
          ) : rows.length === 0 ? (
            <div style={emptyStateStyle}>
              {(filterTable || filterAction || filterFrom || filterTo) ? 'Sin eventos para estos filtros.' : 'Sin eventos en el log.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={thStyle}>Fecha</th>
                  <th style={thStyle}>Tabla</th>
                  <th style={thStyle}>Acción</th>
                  <th style={thStyle}>Actor</th>
                  <th style={thStyle}>Registro</th>
                  <th style={thStyle} aria-label="Detalles" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const a = ACTION_LABELS[r.action] ?? { label: r.action, color: 'var(--at-ink-3)' }
                  const tableLabel = TABLE_LABELS[r.table_name] ?? r.table_name
                  const actor = r.actor_id ? users[r.actor_id] ?? `${r.actor_id.slice(0, 8)}…` : 'Sistema'
                  const isExpanded = expanded.has(r.id)
                  return (
                    <Fragment key={r.id}>
                      <tr style={{ borderTop: '1px solid var(--at-chip)' }}>
                        <td style={tdStyle}>{formatDate(r.occurred_at)}</td>
                        <td style={tdStyle}>{tableLabel}</td>
                        <td style={tdStyle}>
                          <span style={{
                            fontSize: '11px', fontWeight: 600, color: a.color,
                            background: a.color + '14', padding: '2px 8px', borderRadius: '999px',
                          }}>{a.label}</span>
                        </td>
                        <td style={tdStyle}>{actor}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', color: 'var(--at-ink-3)' }}>
                          {r.record_id ? r.record_id.slice(0, 8) + '…' : '—'}
                        </td>
                        <td style={tdStyle}>
                          <button
                            onClick={() => toggleExpand(r.id)}
                            aria-expanded={isExpanded}
                            aria-controls={`audit-detail-${r.id}`}
                            style={expandBtnStyle}
                          >
                            {isExpanded ? 'Ocultar' : 'Ver diff'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr id={`audit-detail-${r.id}`}>
                          <td colSpan={6} style={{ padding: '8px 12px 16px', background: 'var(--at-surface-2)' }}>
                            <JsonDiff before={r.before} after={r.after} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div style={paginationStyle}>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
            Página {page + 1} · {rows.length} eventos
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ ...pageBtnStyle, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}
            >← Anterior</button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasMore}
              style={{ ...pageBtnStyle, cursor: !hasMore ? 'not-allowed' : 'pointer', opacity: !hasMore ? 0.4 : 1 }}
            >Siguiente →</button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>
      {label}
      {children}
    </label>
  )
}

function JsonDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
      <div>
        <div style={diffLabelStyle}>Antes</div>
        <pre style={diffPreStyle}>{before ? JSON.stringify(before, null, 2) : '—'}</pre>
      </div>
      <div>
        <div style={diffLabelStyle}>Después</div>
        <pre style={diffPreStyle}>{after ? JSON.stringify(after, null, 2) : '—'}</pre>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-GT', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ───── Styles ─────
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '16px',
}
const modalStyle: CSSProperties = {
  background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '1040px',
  boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
  display: 'flex', flexDirection: 'column', maxHeight: '90vh',
}
const headerStyle: CSSProperties = {
  padding: '20px 24px 14px', borderBottom: '1px solid var(--at-line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px',
  color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
}
const filtersStyle: CSSProperties = {
  padding: '12px 24px', borderBottom: '1px solid var(--at-line)',
  display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap',
}
const selectStyle: CSSProperties = {
  padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--at-line-strong)',
  fontSize: '12px', color: 'var(--at-ink)', background: 'var(--at-surface)', minWidth: '120px',
}
const resetBtnStyle: CSSProperties = {
  padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--at-line-strong)',
  background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', alignSelf: 'flex-end',
}
const emptyStateStyle: CSSProperties = {
  textAlign: 'center', color: 'var(--at-ink-3)', marginTop: '40px', fontSize: '13px',
}
const thStyle: CSSProperties = { padding: '8px 6px', fontSize: '10px', fontWeight: 700 }
const tdStyle: CSSProperties = { padding: '8px 6px', verticalAlign: 'top', color: 'var(--at-ink-2)' }
const expandBtnStyle: CSSProperties = {
  padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--at-line)',
  background: 'var(--at-surface)', color: 'var(--at-ink-3)', fontSize: '11px',
  cursor: 'pointer', fontWeight: 600,
}
const paginationStyle: CSSProperties = {
  padding: '12px 24px', borderTop: '1px solid var(--at-line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const pageBtnStyle: CSSProperties = {
  padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--at-line-strong)',
  background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontSize: '12px', fontWeight: 600,
}
const diffLabelStyle: CSSProperties = {
  fontSize: '10px', fontWeight: 700, color: 'var(--at-ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px',
}
const diffPreStyle: CSSProperties = {
  background: 'var(--at-surface)', border: '1px solid var(--at-line)',
  padding: '8px', borderRadius: '6px', fontSize: '11px',
  overflow: 'auto', maxHeight: '240px', color: 'var(--at-ink)', margin: 0,
}
