import { useState, useEffect, useCallback, Fragment, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { confirm, notify } from '../shared/Dialog'

// ============================================================================
// PapeleraModal — F4.2.3: UI de Papelera para soft-deleted recovery.
// ============================================================================
// Muestra rows con deleted_at != NULL en las 4 tablas con soft delete (F2.7 +
// F2.15b). Cada row tiene boton "Restaurar" que ejecuta UPDATE deleted_at=NULL.
//
// El restore queda automaticamente registrado en audit_log via el trigger
// audit_trigger_func (F2.7) — no hace falta logica adicional para trazabilidad.
//
// Tablas: las 4 con columnas deleted_at + deleted_by definidas en la migracion
// 20260528000001_soft_delete_critical_tables.sql.
//
// Permisos: RLS de cada tabla restringe ya la visibilidad por tenant. UPDATE
// solo lo pueden ejecutar admin/owner del tenant (gating en EmpresaSection).
//
// Scope MVP:
//   - Filtro por tabla (4 valores)
//   - Paginacion 25 rows/pagina
//   - Restore individual (no bulk en este PR)
//   - Resolucion deleted_by → full_name
//   - JSON viewer del row entero (para que el admin valide antes de restaurar)

interface Props { onClose: () => void; defaultTable?: SoftTable }

type SoftTable = 'pagos' | 'cuotas_condominio' | 'fondo_reserva_condominio' | 'tickets_mantenimiento'

interface DeletedRow {
  id: string
  deleted_at: string
  deleted_by: string | null
  [key: string]: unknown
}

interface UserMap { [id: string]: string }

const TABLE_LABELS: Record<SoftTable, string> = {
  pagos:                      'Pagos',
  cuotas_condominio:          'Cuotas de condominio',
  fondo_reserva_condominio:   'Fondo de reserva',
  tickets_mantenimiento:      'Tickets de mantenimiento',
}

const TABLES: SoftTable[] = ['pagos', 'cuotas_condominio', 'fondo_reserva_condominio', 'tickets_mantenimiento']

// Columna timestamp para ordenamiento secundario por tabla (cuando deleted_at
// empata). fondo_reserva_condominio ordena por fecha (campo de negocio), el
// resto por created_at.
const ORDER_COLUMNS: Record<SoftTable, string> = {
  pagos:                    'created_at',
  cuotas_condominio:        'created_at',
  fondo_reserva_condominio: 'fecha',
  tickets_mantenimiento:    'created_at',
}

export function PapeleraModal({ onClose, defaultTable = 'cuotas_condominio' }: Props) {
  const [table, setTable] = useState<SoftTable>(defaultTable)
  const [rows, setRows] = useState<DeletedRow[]>([])
  const [users, setUsers] = useState<UserMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const pageSize = 25

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpanded(new Set())
    try {
      const orderCol = ORDER_COLUMNS[table]
      const { data, error: err } = await supabase
        .from(table)
        .select('*')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .order(orderCol, { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1)
      if (err) throw err
      const deleted = (data ?? []) as DeletedRow[]
      setRows(deleted)

      const actorIds = new Set<string>()
      for (const r of deleted) if (r.deleted_by) actorIds.add(r.deleted_by)
      if (actorIds.size > 0) {
        const { data: u } = await supabase.from('app_users')
          .select('id, full_name').in('id', [...actorIds])
        const map: UserMap = {}
        for (const x of (u ?? []) as Array<{ id: string; full_name: string }>) map[x.id] = x.full_name
        setUsers(map)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la papelera.')
    } finally {
      setLoading(false)
    }
  }, [table, page])

  useEffect(() => { void load() }, [load])

  async function restaurar(rowId: string) {
    const tableLabel = TABLE_LABELS[table]
    const result = await confirm({
      icon: 'question',
      title: `¿Restaurar este registro?`,
      text: `Va a restaurar 1 registro de ${tableLabel}. Volverá a aparecer en la lista activa y en los KPIs.`,
      confirmText: 'Restaurar',
      cancelText: 'Cancelar',
    })
    if (!result.isConfirmed) return
    const { error: err } = await supabase
      .from(table)
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', rowId)
    if (err) {
      notify({ variant: 'error', title: 'Error', text: err.message })
      return
    }
    notify({ variant: 'success', title: 'Restaurado', duration: 1500 })
    void load()
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const hasMore = rows.length === pageSize

  return (
    <div
      style={overlayStyle}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={modalStyle} role="dialog" aria-labelledby="papelera-title">
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div id="papelera-title" style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>
              🗑️ Papelera — recuperar borrados
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Rows marcados como `deleted_at` aun preservados. Restaurar los devuelve a la lista activa.
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={closeBtnStyle}>×</button>
        </div>

        {/* Filtros */}
        <div style={filtersStyle}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>
            Tabla
            <select
              value={table}
              onChange={e => { setTable(e.target.value as SoftTable); setPage(0) }}
              style={selectStyle}
            >
              {TABLES.map(t => (
                <option key={t} value={t}>{TABLE_LABELS[t]}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px' }}>
          {loading ? (
            <div style={emptyStateStyle}>Cargando…</div>
          ) : error ? (
            <div style={{ ...emptyStateStyle, color: 'var(--at-danger)' }}>{error}</div>
          ) : rows.length === 0 ? (
            <div style={emptyStateStyle}>
              Sin registros borrados en {TABLE_LABELS[table].toLowerCase()}.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={thStyle}>Borrado</th>
                  <th style={thStyle}>Por</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle} aria-label="Detalles" />
                  <th style={thStyle} aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const actor = r.deleted_by ? users[r.deleted_by] ?? `${r.deleted_by.slice(0, 8)}…` : 'Sistema'
                  const isExpanded = expanded.has(r.id)
                  return (
                    <Fragment key={r.id}>
                      <tr style={{ borderTop: '1px solid var(--at-chip)' }}>
                        <td style={tdStyle}>{formatDate(r.deleted_at)}</td>
                        <td style={tdStyle}>{actor}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', color: 'var(--at-ink-3)' }}>
                          {r.id.slice(0, 8)}…
                        </td>
                        <td style={tdStyle}>
                          <button
                            onClick={() => toggleExpand(r.id)}
                            aria-expanded={isExpanded}
                            aria-controls={`row-detail-${r.id}`}
                            style={expandBtnStyle}
                          >
                            {isExpanded ? 'Ocultar' : 'Ver fila'}
                          </button>
                        </td>
                        <td style={tdStyle}>
                          <button
                            onClick={() => void restaurar(r.id)}
                            style={restoreBtnStyle}
                          >
                            ↩ Restaurar
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr id={`row-detail-${r.id}`}>
                          <td colSpan={5} style={{ padding: '8px 12px 16px', background: 'var(--at-surface-2)' }}>
                            <pre style={diffPreStyle}>{JSON.stringify(r, null, 2)}</pre>
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
            Página {page + 1} · {rows.length} registros
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
  background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '880px',
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
  fontSize: '12px', color: 'var(--at-ink)', background: 'var(--at-surface)', minWidth: '200px',
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
const restoreBtnStyle: CSSProperties = {
  padding: '4px 12px', borderRadius: '6px', border: 'none',
  background: 'linear-gradient(135deg, var(--at-success), var(--at-success))',
  color: 'white', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
}
const paginationStyle: CSSProperties = {
  padding: '12px 24px', borderTop: '1px solid var(--at-line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const pageBtnStyle: CSSProperties = {
  padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--at-line-strong)',
  background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontSize: '12px', fontWeight: 600,
}
const diffPreStyle: CSSProperties = {
  background: 'var(--at-surface)', border: '1px solid var(--at-line)',
  padding: '8px', borderRadius: '6px', fontSize: '11px',
  overflow: 'auto', maxHeight: '300px', color: 'var(--at-ink)', margin: 0,
}
