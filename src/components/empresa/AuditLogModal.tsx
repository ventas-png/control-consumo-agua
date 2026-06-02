import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { DataTable, type DataTableColumn } from '../shared/DataTable'

interface Props {
  onClose: () => void
}

interface AuditRow {
  id: number
  actor_id: string | null
  target_user_id: string | null
  target_role_id: string | null
  action: string
  details: Record<string, unknown> | null
  occurred_at: string
}

interface UserMap { [id: string]: string }
interface RoleMap { [id: string]: { name: string; color: string } }

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  assign_role:       { label: 'Asignó rol',       color: 'var(--at-success)' },
  remove_role:       { label: 'Quitó rol',        color: 'var(--at-danger)' },
  create_role:       { label: 'Creó rol',         color: 'var(--at-primary-2)' },
  update_role:       { label: 'Editó rol',        color: 'var(--at-warning)' },
  delete_role:       { label: 'Eliminó rol',      color: 'var(--at-danger)' },
  grant_permission:  { label: 'Agregó permiso',   color: 'var(--at-success)' },
  revoke_permission: { label: 'Quitó permiso',    color: 'var(--at-danger)' },
  user_deleted:      { label: 'Eliminó usuario',  color: 'var(--at-danger)' },
}

export function AuditLogModal({ onClose }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [users, setUsers] = useState<UserMap>({})
  const [roles, setRoles] = useState<RoleMap>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterAction, setFilterAction] = useState<string>('')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('permission_audit_log')
        .select('id, actor_id, target_user_id, target_role_id, action, details, occurred_at')
        .order('occurred_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1)
      if (filterAction) query = query.eq('action', filterAction)
      const { data, error: err } = await query
      if (err) throw err
      const auditRows = (data ?? []) as AuditRow[]
      setRows(auditRows)

      // Batch-fetch related users + roles
      const userIds = new Set<string>()
      const roleIds = new Set<string>()
      for (const r of auditRows) {
        if (r.actor_id) userIds.add(r.actor_id)
        if (r.target_user_id) userIds.add(r.target_user_id)
        if (r.target_role_id) roleIds.add(r.target_role_id)
      }
      if (userIds.size > 0) {
        const { data: u } = await supabase.from('app_users')
          .select('id, full_name').in('id', [...userIds])
        const map: UserMap = {}
        for (const x of (u ?? []) as Array<{ id: string; full_name: string }>) map[x.id] = x.full_name
        setUsers(map)
      }
      if (roleIds.size > 0) {
        const { data: r } = await supabase.from('roles')
          .select('id, name, color').in('id', [...roleIds])
        const map: RoleMap = {}
        for (const x of (r ?? []) as Array<{ id: string; name: string; color: string }>) map[x.id] = { name: x.name, color: x.color }
        setRoles(map)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el log de auditoría.')
    } finally {
      setLoading(false)
    }
  }, [page, filterAction])

  useEffect(() => { void load() }, [load])

  const columns: DataTableColumn<AuditRow>[] = [
    {
      key: 'occurred_at', header: 'Fecha',
      accessor: r => r.occurred_at,
      render: r => <span style={{ color: 'var(--at-ink-2)' }}>{formatDate(r.occurred_at)}</span>,
    },
    {
      key: 'actor', header: 'Actor',
      accessor: r => r.actor_id ? users[r.actor_id] ?? '—' : 'Sistema',
      render: r => r.actor_id ? users[r.actor_id] ?? '—' : 'Sistema',
    },
    {
      key: 'action', header: 'Acción',
      accessor: r => r.action,
      render: r => {
        const a = ACTION_LABELS[r.action] ?? { label: r.action, color: 'var(--at-ink-3)' }
        return (
          <span style={{
            fontSize: '11px', fontWeight: 600, color: a.color,
            background: a.color + '14', padding: '2px 8px', borderRadius: '999px',
          }}>{a.label}</span>
        )
      },
    },
    {
      key: 'target', header: 'Objetivo',
      render: r => {
        const targetUser = r.target_user_id
          ? users[r.target_user_id] ?? null
          : (typeof r.details?.full_name === 'string' ? r.details.full_name : null)
        const targetRole = r.target_role_id ? roles[r.target_role_id] : null
        return (
          <>
            {targetUser && <div style={{ color: 'var(--at-ink)' }}>👤 {targetUser}</div>}
            {targetRole && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: targetUser ? '3px' : 0 }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: targetRole.color }} />
                <span style={{ color: 'var(--at-ink-2)' }}>{targetRole.name}</span>
              </div>
            )}
            {!targetUser && !targetRole && <span style={{ color: 'var(--at-line-strong)' }}>—</span>}
          </>
        )
      },
    },
    {
      key: 'details', header: 'Detalles',
      render: r => <DetailsCell details={r.details} />,
      hideOnMobile: true,
    },
  ]

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '880px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 14px', borderBottom: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>Auditoría de roles y permisos</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Cambios recientes ordenados por fecha (más recientes primero)
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px',
            color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Filters */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--at-line)', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Filtrar acción:</span>
          <select
            value={filterAction}
            onChange={e => { setFilterAction(e.target.value); setPage(0) }}
            style={{
              padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--at-line-strong)',
              fontSize: '12px', color: 'var(--at-ink)', background: 'var(--at-surface)',
            }}
          >
            <option value="">Todas</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        {/* Body — F3.9.3: migrado a <DataTable> shared en modo server */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px' }}>
          {error ? (
            <div style={{ textAlign: 'center', color: 'var(--at-danger)', marginTop: '40px', fontSize: '13px' }}>{error}</div>
          ) : (
            <DataTable<AuditRow>
              data={rows}
              columns={columns}
              rowKey="id"
              isLoading={loading}
              paginationMode="server"
              currentPage={page}
              onPageChange={setPage}
              pageSize={pageSize}
              emptyState={{ title: filterAction ? 'Sin eventos para este filtro.' : 'Sin eventos en el log.' }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function DetailsCell({ details }: { details: Record<string, unknown> | null }) {
  const summary = useMemo(() => {
    if (!details || Object.keys(details).length === 0) return null
    const parts: string[] = []
    if (details.permission_key) parts.push(String(details.permission_key))
    if (details.effect)         parts.push(`(${details.effect})`)
    if (details.name)           parts.push(`"${details.name}"`)
    if (details.role)           parts.push(`rol: ${String(details.role)}`)
    if (details.expires_at)     parts.push(`expira: ${formatDate(String(details.expires_at))}`)
    return parts.length > 0 ? parts.join(' ') : JSON.stringify(details).slice(0, 60)
  }, [details])
  if (!summary) return <span style={{ color: 'var(--at-line-strong)' }}>—</span>
  return <span style={{ color: 'var(--at-ink-3)', fontFamily: 'monospace', fontSize: '11px' }}>{summary}</span>
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-GT', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

