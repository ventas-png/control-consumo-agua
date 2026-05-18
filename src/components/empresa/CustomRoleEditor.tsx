import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { PermissionDef, RoleDef } from '../../types'

interface Props {
  companyId: string
  /** null = create new; uuid = edit existing */
  roleId: string | null
  /** When provided, the new/edited role's permissions are pre-populated from this role (for "clone"). */
  cloneFromRoleId?: string
  onClose: () => void
  onSaved: () => void
}

const PALETTE = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#64748b', '#a855f7', '#84cc16']

export function CustomRoleEditor({ companyId, roleId, cloneFromRoleId, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [permissions, setPermissions] = useState<PermissionDef[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: permsData, error: permsErr } = await supabase
        .from('permissions')
        .select('key, category, label, description')
        .order('category')
        .order('label')
      if (permsErr) throw permsErr
      setPermissions((permsData ?? []) as PermissionDef[])

      if (roleId) {
        const { data: roleData, error: roleErr } = await supabase
          .from('roles')
          .select('id, company_id, name, description, is_system, color')
          .eq('id', roleId)
          .single()
        if (roleErr) throw roleErr
        const r = roleData as RoleDef
        setName(r.name)
        setDescription(r.description ?? '')
        setColor(r.color ?? PALETTE[0])
        const { data: rpData } = await supabase
          .from('role_permissions')
          .select('permission_key')
          .eq('role_id', roleId)
          .eq('effect', 'allow')
        setSelectedKeys(new Set(((rpData ?? []) as Array<{ permission_key: string }>).map(r => r.permission_key)))
      } else if (cloneFromRoleId) {
        const { data: rpData } = await supabase
          .from('role_permissions')
          .select('permission_key')
          .eq('role_id', cloneFromRoleId)
          .eq('effect', 'allow')
        setSelectedKeys(new Set(((rpData ?? []) as Array<{ permission_key: string }>).map(r => r.permission_key)))
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando datos.')
    } finally {
      setLoading(false)
    }
  }, [roleId, cloneFromRoleId])

  useEffect(() => { void load() }, [load])

  const grouped = useMemo(() => {
    const filtered = search.trim().length === 0
      ? permissions
      : permissions.filter(p => p.label.toLowerCase().includes(search.toLowerCase()) || p.key.toLowerCase().includes(search.toLowerCase()))
    const map = new Map<string, PermissionDef[]>()
    for (const p of filtered) {
      const arr = map.get(p.category) ?? []
      arr.push(p)
      map.set(p.category, arr)
    }
    return [...map.entries()]
  }, [permissions, search])

  function togglePerm(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleCategory(catPerms: PermissionDef[]) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      const allSelected = catPerms.every(p => next.has(p.key))
      if (allSelected) catPerms.forEach(p => next.delete(p.key))
      else catPerms.forEach(p => next.add(p.key))
      return next
    })
  }

  async function handleSave() {
    if (name.trim().length < 3) { setError('El nombre debe tener al menos 3 caracteres.'); return }
    setSaving(true)
    setError(null)
    try {
      let savedRoleId = roleId
      if (savedRoleId) {
        const { error: updErr } = await supabase.from('roles').update({
          name: name.trim(), description: description.trim() || null, color, updated_at: new Date().toISOString(),
        }).eq('id', savedRoleId)
        if (updErr) throw updErr
      } else {
        const { data: insData, error: insErr } = await supabase.from('roles').insert({
          company_id: companyId, name: name.trim(), description: description.trim() || null, is_system: false, color,
        }).select('id').single()
        if (insErr) throw insErr
        savedRoleId = (insData as { id: string }).id
      }

      const { data: existingPerms } = await supabase
        .from('role_permissions').select('permission_key').eq('role_id', savedRoleId)
      const existing = new Set(((existingPerms ?? []) as Array<{ permission_key: string }>).map(r => r.permission_key))

      const toAdd = [...selectedKeys].filter(k => !existing.has(k))
      const toRemove = [...existing].filter(k => !selectedKeys.has(k))

      if (toRemove.length > 0) {
        const { error: delErr } = await supabase.from('role_permissions')
          .delete().eq('role_id', savedRoleId).in('permission_key', toRemove)
        if (delErr) throw delErr
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map(permission_key => ({ role_id: savedRoleId, permission_key, effect: 'allow' }))
        const { error: insErr } = await supabase.from('role_permissions').insert(rows)
        if (insErr) throw insErr
      }

      onSaved()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el rol.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '780px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', maxHeight: '92vh',
      }}>
        <div style={{
          padding: '20px 24px 14px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#1e293b' }}>
            {roleId ? 'Editar rol personalizado' : 'Crear rol personalizado'}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px',
            color: '#94a3b8', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
          }}>×</button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <Label>Nombre</Label>
              <input
                value={name} onChange={e => setName(e.target.value)} placeholder="ej. Guardia nocturno"
                style={inputStyle}
              />
            </div>
            <div style={{ width: '120px' }}>
              <Label>Color</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setColor(c)} style={{
                    width: '20px', height: '20px', borderRadius: '4px', background: c,
                    border: color === c ? '2px solid #1e293b' : '1px solid #e2e8f0',
                    cursor: 'pointer', padding: 0,
                  }} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <input
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Para qué se usa este rol" style={inputStyle}
            />
          </div>
        </div>

        <div style={{ padding: '12px 24px 8px', borderBottom: '1px solid #e2e8f0' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar permiso…"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {selectedKeys.size} permisos seleccionados · {permissions.length} disponibles
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '40px' }}>Cargando…</div>
          ) : (
            grouped.map(([category, perms]) => {
              const allSelected = perms.every(p => selectedKeys.has(p.key))
              return (
                <div key={category} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {category}
                    </div>
                    <button onClick={() => toggleCategory(perms)} style={{
                      fontSize: '11px', color: '#3b82f6', background: 'transparent',
                      border: '1px solid #93c5fd', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
                    }}>{allSelected ? 'Deseleccionar' : 'Seleccionar todo'}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                    {perms.map(p => (
                      <label key={p.key} style={{
                        display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                        fontSize: '12px', color: '#334155', padding: '3px 0',
                      }}>
                        <input
                          type="checkbox" checked={selectedKeys.has(p.key)}
                          onChange={() => togglePerm(p.key)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div style={{
          padding: '14px 24px', borderTop: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '12px', color: error ? '#ef4444' : '#94a3b8' }}>{error ?? ''}</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={btnSecondary}>Cancelar</button>
            <button onClick={() => void handleSave()} disabled={saving || loading} style={{
              ...btnPrimary, background: saving ? '#93c5fd' : '#3b82f6',
              cursor: saving ? 'default' : 'pointer',
            }}>{saving ? 'Guardando…' : 'Guardar rol'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '6px',
  border: '1px solid #cbd5e1', fontSize: '13px', color: '#1e293b',
  outline: 'none', marginBottom: 0, boxSizing: 'border-box',
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: '8px', border: '1px solid #e2e8f0',
  background: '#fff', color: '#475569', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', borderRadius: '8px', border: 'none',
  color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}
