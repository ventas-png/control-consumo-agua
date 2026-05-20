import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { RoleDef } from '../../types'
import { CONDOMINIOS_SECTION_GROUPS } from '../../lib/condominiosRoles'
import { AGUA_MODULE_GROUPS } from '../../lib/aguaPermissions'
import { condominiosTabPermission } from '../../lib/permissions'

interface Props {
  usuarioId: string
  usuarioNombre: string
  companyId: string
  /** Bump this counter to force a re-fetch of the roles list (preserves current selection) */
  rolesRefreshKey?: number
  onClose: () => void
  onSaved: () => void
  onOpenCustomEditor: (roleId: string | null) => void
}

interface RoleRow extends RoleDef {
  permission_keys: string[]
  service?: string | null
}

export function RolPermisosModal({
  usuarioId, usuarioNombre, companyId, rolesRefreshKey = 0, onClose, onSaved, onOpenCustomEditor,
}: Props) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  // role_id -> expiration ISO date (yyyy-mm-dd) or null for permanent
  const [expirations, setExpirations] = useState<Map<string, string | null>>(new Map())
  // Snapshot of initial state, used to detect changes for UPDATE
  const [initialExpirations, setInitialExpirations] = useState<Map<string, string | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRoles = useCallback(async () => {
    const [{ data: rolesData, error: rolesErr }, { data: rolePermsData }] = await Promise.all([
      supabase.from('roles')
        .select('id, company_id, name, description, is_system, color, service')
        .or(`is_system.eq.true,company_id.eq.${companyId}`)
        .order('is_system', { ascending: false })
        .order('name'),
      supabase.from('role_permissions').select('role_id, permission_key, effect'),
    ])
    if (rolesErr) throw rolesErr

    const permMap = new Map<string, string[]>()
    for (const rp of (rolePermsData ?? []) as Array<{ role_id: string; permission_key: string; effect: string }>) {
      if (rp.effect !== 'allow') continue
      const arr = permMap.get(rp.role_id) ?? []
      arr.push(rp.permission_key)
      permMap.set(rp.role_id, arr)
    }
    const enriched: RoleRow[] = ((rolesData ?? []) as RoleDef[]).map(r => ({
      ...r,
      permission_keys: permMap.get(r.id) ?? [],
    }))
    setRoles(enriched)
  }, [companyId])

  // Initial: fetch roles + user's current assignments. Re-runs only on user/company change.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        await loadRoles()
        const { data: userRolesData } = await supabase
          .from('user_roles').select('role_id, expires_at').eq('user_id', usuarioId)
        if (cancelled) return
        const rows = (userRolesData ?? []) as Array<{ role_id: string; expires_at: string | null }>
        setSelectedRoleIds(new Set(rows.map(ur => ur.role_id)))
        const expMap = new Map<string, string | null>()
        for (const r of rows) {
          expMap.set(r.role_id, r.expires_at ? r.expires_at.slice(0, 10) : null)
        }
        setExpirations(expMap)
        setInitialExpirations(new Map(expMap))
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los roles.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [loadRoles, usuarioId])

  // Refresh only the roles list (custom roles created/edited in another modal)
  // Preserves the current selection.
  useEffect(() => {
    if (rolesRefreshKey === 0) return
    void loadRoles().catch(e => setError(e instanceof Error ? e.message : 'Error al refrescar roles.'))
  }, [rolesRefreshKey, loadRoles])

  function toggleRole(roleId: string) {
    setSelectedRoleIds(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) {
        next.delete(roleId)
        // Drop the expiration if we removed the role
        setExpirations(em => {
          const m = new Map(em); m.delete(roleId); return m
        })
      } else {
        next.add(roleId)
      }
      return next
    })
  }

  function setExpiration(roleId: string, value: string | null) {
    setExpirations(prev => {
      const next = new Map(prev)
      if (value) next.set(roleId, value)
      else next.set(roleId, null)
      return next
    })
  }

  // Effective permissions = union of selected roles' permission keys
  const effectivePermissions = useMemo(() => {
    const set = new Set<string>()
    for (const r of roles) {
      if (selectedRoleIds.has(r.id)) for (const k of r.permission_keys) set.add(k)
    }
    return set
  }, [roles, selectedRoleIds])

  const condominiosStatus = useMemo(() =>
    CONDOMINIOS_SECTION_GROUPS.map(group => {
      const total = group.tabs.length
      const count = group.tabs.filter(t => effectivePermissions.has(condominiosTabPermission(t))).length
      const level = count === 0 ? 'ninguno' as const : count === total ? 'completo' as const : 'parcial' as const
      return { key: group.key, label: group.label, level, count, total }
    }),
    [effectivePermissions]
  )

  const aguaStatus = useMemo(() =>
    AGUA_MODULE_GROUPS.map(group => {
      const total = group.tabs.length
      // For agua, "tabs" are already full permission keys, not tab IDs
      const count = group.tabs.filter(k => effectivePermissions.has(k)).length
      const level = count === 0 ? 'ninguno' as const : count === total ? 'completo' as const : 'parcial' as const
      return { key: group.key, label: group.label, level, count, total }
    }),
    [effectivePermissions]
  )

  const condominiosSystemRoles = roles.filter(r => r.is_system && (r.service === 'condominios' || r.service == null))
  const aguaSystemRoles         = roles.filter(r => r.is_system && r.service === 'agua')
  const customRoles             = roles.filter(r => !r.is_system)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const { data: existing } = await supabase.from('user_roles').select('role_id').eq('user_id', usuarioId)
      const existingIds = new Set(((existing ?? []) as Array<{ role_id: string }>).map(r => r.role_id))

      const toAdd = [...selectedRoleIds].filter(id => !existingIds.has(id))
      const toRemove = [...existingIds].filter(id => !selectedRoleIds.has(id))
      // Rows that exist in both before and after, but whose expiration changed
      const toUpdateExpiration = [...selectedRoleIds].filter(id => {
        if (!existingIds.has(id)) return false
        const before = initialExpirations.get(id) ?? null
        const after = expirations.get(id) ?? null
        return before !== after
      })

      if (toRemove.length > 0) {
        const { error: delErr } = await supabase.from('user_roles')
          .delete().eq('user_id', usuarioId).in('role_id', toRemove)
        if (delErr) throw delErr
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map(role_id => ({
          user_id: usuarioId,
          role_id,
          expires_at: expirations.get(role_id) ? expirations.get(role_id) : null,
        }))
        const { error: insErr } = await supabase.from('user_roles').insert(rows)
        if (insErr) throw insErr
      }
      // UPDATE expires_at on roles that were already assigned
      for (const roleId of toUpdateExpiration) {
        const exp = expirations.get(roleId) ?? null
        const { error: updErr } = await supabase.from('user_roles')
          .update({ expires_at: exp })
          .eq('user_id', usuarioId).eq('role_id', roleId)
        if (updErr) throw updErr
      }

      onSaved()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCustomRole(roleId: string) {
    if (!confirm('¿Eliminar este rol personalizado? Los usuarios que lo tengan asignado perderán esos permisos.')) return
    const { error: delErr } = await supabase.from('roles').delete().eq('id', roleId)
    if (delErr) { setError(delErr.message); return }
    void loadRoles()
  }

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
        background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '780px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px', color: '#15291F' }}>Roles y permisos</div>
            <div style={{ fontSize: '13px', color: '#7E9389', marginTop: '2px' }}>{usuarioNombre}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '20px', color: '#7E9389', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left: roles */}
          <div style={{
            flex: '0 0 58%', borderRight: '1px solid var(--at-line)',
            overflowY: 'auto', padding: '16px',
          }}>
            {loading ? (
              <div style={{ color: '#7E9389', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>Cargando…</div>
            ) : (
              <>
                <SectionHeader>Condominios — roles del sistema</SectionHeader>
                {condominiosSystemRoles.map(r => (
                  <RoleCard
                    key={r.id}
                    role={r}
                    checked={selectedRoleIds.has(r.id)}
                    expiresAt={expirations.get(r.id) ?? null}
                    onToggle={() => toggleRole(r.id)}
                    onExpirationChange={(v) => setExpiration(r.id, v)}
                  />
                ))}

                {aguaSystemRoles.length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <SectionHeader>Agua — roles del sistema</SectionHeader>
                    {aguaSystemRoles.map(r => (
                      <RoleCard
                        key={r.id}
                        role={r}
                        checked={selectedRoleIds.has(r.id)}
                        onToggle={() => toggleRole(r.id)}
                      />
                    ))}
                  </div>
                )}

                <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SectionHeader>Roles personalizados</SectionHeader>
                  <button
                    onClick={() => onOpenCustomEditor(null)}
                    style={{
                      fontSize: '11px', fontWeight: 600, color: '#2F5D4F',
                      background: 'transparent', border: '1px solid var(--at-accent-2)', borderRadius: '6px',
                      padding: '3px 10px', cursor: 'pointer',
                    }}
                  >+ Crear</button>
                </div>
                {customRoles.length === 0 ? (
                  <div style={{ fontSize: '12px', color: '#7E9389', textAlign: 'center', padding: '14px 0' }}>
                    Sin roles personalizados.<br />Crea uno desde "Crear".
                  </div>
                ) : (
                  customRoles.map(r => (
                    <RoleCard
                      key={r.id}
                      role={r}
                      checked={selectedRoleIds.has(r.id)}
                      expiresAt={expirations.get(r.id) ?? null}
                      onToggle={() => toggleRole(r.id)}
                      onExpirationChange={(v) => setExpiration(r.id, v)}
                      onEdit={() => onOpenCustomEditor(r.id)}
                      onDelete={() => void handleDeleteCustomRole(r.id)}
                    />
                  ))
                )}
              </>
            )}
          </div>

          {/* Right: preview */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <SectionHeader>Permisos efectivos</SectionHeader>
            {selectedRoleIds.size === 0 ? (
              <div style={{ fontSize: '13px', color: '#7E9389', textAlign: 'center', marginTop: '32px', lineHeight: '1.6' }}>
                Sin roles asignados.<br />El usuario no tendrá<br />acceso a ningún módulo.
              </div>
            ) : (
              <>
                {selectedRoleIds.size > 1 && (
                  <Banner color="#1B3B36">{selectedRoleIds.size} roles activos — permisos combinados</Banner>
                )}

                <SubsectionHeader>Condominios</SubsectionHeader>
                {condominiosStatus.map(s => (
                  <PreviewRow key={s.key} label={s.label} level={s.level} count={s.count} total={s.total} />
                ))}

                <div style={{ marginTop: '16px' }}>
                  <SubsectionHeader>Agua</SubsectionHeader>
                  {aguaStatus.map(s => (
                    <PreviewRow key={s.key} label={s.label} level={s.level} count={s.count} total={s.total} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}>
          <div style={{ fontSize: '12px', color: error ? '#ef4444' : '#7E9389' }}>{error ?? ''}</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={{
              padding: '8px 18px', borderRadius: '8px', border: '1px solid var(--at-line)',
              background: '#fff', color: '#3E5A4C', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            }}>Cancelar</button>
            <button onClick={() => void handleSave()} disabled={saving || loading} style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: saving ? '#577B69' : '#2F5D4F', color: '#fff',
              fontWeight: 600, fontSize: '13px', cursor: saving ? 'default' : 'pointer',
            }}>{saving ? 'Guardando…' : 'Guardar roles'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 700, color: '#7E9389',
      letterSpacing: '0.06em', marginBottom: '8px', textTransform: 'uppercase',
    }}>{children}</div>
  )
}

function SubsectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 700, color: '#3E5A4C',
      letterSpacing: '0.04em', marginBottom: '4px', textTransform: 'uppercase',
      paddingBottom: '4px', borderBottom: '1px solid var(--at-line)',
    }}>{children}</div>
  )
}

function PreviewRow({ label, level, count, total }: { label: string; level: 'completo'|'parcial'|'ninguno'; count: number; total: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '7px 0', borderBottom: '1px solid var(--at-chip)',
    }}>
      <span style={{ fontSize: '13px', color: '#3E5A4C', fontWeight: 500 }}>{label}</span>
      <AccessBadge level={level} count={count} total={total} />
    </div>
  )
}

function RoleCard({
  role, checked, expiresAt, onToggle, onExpirationChange, onEdit, onDelete,
}: {
  role: RoleRow; checked: boolean; expiresAt?: string | null;
  onToggle: () => void; onExpirationChange?: (v: string | null) => void;
  onEdit?: () => void; onDelete?: () => void
}) {
  const expiresSoon = expiresAt ? new Date(expiresAt) < new Date(Date.now() + 7 * 86400000) : false
  const expired = expiresAt ? new Date(expiresAt) < new Date() : false
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', marginBottom: '6px', borderRadius: '8px',
      border: `1px solid ${checked ? role.color + '55' : '#E1DDD0'}`,
      background: checked ? role.color + '12' : 'transparent',
      transition: 'border-color 0.15s, background 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '9px 11px' }}>
        <button
          type="button"
          onClick={onToggle}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, marginTop: '1px' }}
        >
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '16px', height: '16px', borderRadius: '4px',
            border: `2px solid ${checked ? role.color : '#C7C2B0'}`,
            background: checked ? role.color : 'transparent',
          }}>
            {checked && <span style={{ color: '#fff', fontSize: '11px', lineHeight: 1 }}>✓</span>}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flex: 1, textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: role.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '13px', color: '#15291F' }}>{role.name}</span>
            {!role.is_system && (
              <span style={{
                fontSize: '9px', fontWeight: 700, color: '#9C5733',
                background: 'rgba(156, 87, 51,0.1)', padding: '1px 5px', borderRadius: '4px',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>Custom</span>
            )}
            {expiresAt && (
              <span style={{
                fontSize: '9px', fontWeight: 700,
                color: expired ? '#ef4444' : expiresSoon ? '#f59e0b' : '#1B3B36',
                background: expired ? 'rgba(239,68,68,0.1)' : expiresSoon ? 'rgba(245,158,11,0.1)' : 'rgba(27, 59, 54,0.1)',
                padding: '1px 5px', borderRadius: '4px',
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>{expired ? 'Expirado' : 'Temporal'}</span>
            )}
          </div>
          {role.description && (
            <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px', lineHeight: '1.4' }}>{role.description}</div>
          )}
        </button>
        {!role.is_system && (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button onClick={onEdit} title="Editar" style={iconBtnStyle('#2F5D4F')}>✎</button>
            <button onClick={onDelete} title="Eliminar" style={iconBtnStyle('#ef4444')}>🗑</button>
          </div>
        )}
      </div>
      {checked && onExpirationChange && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '0 11px 9px', borderTop: `1px dashed ${role.color}22`, paddingTop: '8px', marginTop: '0',
        }}>
          <label style={{ fontSize: '11px', color: '#7E9389', fontWeight: 600 }}>Expira:</label>
          <input
            type="date"
            value={expiresAt ?? ''}
            onChange={(e) => onExpirationChange(e.target.value || null)}
            min={new Date().toISOString().slice(0, 10)}
            style={{
              fontSize: '11px', padding: '3px 6px',
              border: '1px solid var(--at-line-strong)', borderRadius: '4px',
              color: '#3E5A4C', background: '#fff',
            }}
          />
          {expiresAt && (
            <button
              onClick={() => onExpirationChange(null)}
              title="Quitar expiración (permanente)"
              style={{
                fontSize: '10px', padding: '3px 7px', borderRadius: '4px',
                border: '1px solid var(--at-line-strong)', background: '#fff', color: '#7E9389',
                cursor: 'pointer', fontWeight: 600,
              }}
            >Permanente</button>
          )}
          {!expiresAt && (
            <span style={{ fontSize: '11px', color: '#7E9389' }}>(sin expiración)</span>
          )}
        </div>
      )}
    </div>
  )
}

function iconBtnStyle(color: string): React.CSSProperties {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color, fontSize: '13px', padding: '2px 5px', borderRadius: '4px',
  }
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', color, background: color + '14',
      border: `1px solid ${color}33`, borderRadius: '6px',
      padding: '6px 10px', marginBottom: '10px', lineHeight: '1.4',
    }}>{children}</div>
  )
}

function AccessBadge({ level, count, total }: { level: 'completo' | 'parcial' | 'ninguno'; count: number; total: number }) {
  const cfg = level === 'completo'
    ? { color: '#22c55e', label: 'Completo' }
    : level === 'parcial'
      ? { color: '#f59e0b', label: `Parcial ${count}/${total}` }
      : { color: '#7E9389', label: 'Sin acceso' }
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, color: cfg.color,
      background: cfg.color + '1a', padding: '2px 8px', borderRadius: '999px',
    }}>{cfg.label}</span>
  )
}
