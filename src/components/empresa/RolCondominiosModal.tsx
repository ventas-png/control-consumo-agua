import { useState, useMemo } from 'react'
import type { CondominiosRole } from '../../types'
import {
  CONDOMINIOS_ROLES,
  CONDOMINIOS_SECTION_GROUPS,
  getEffectiveTabAccess,
} from '../../lib/condominiosRoles'

interface Props {
  usuarioNombre: string
  rolesActuales: CondominiosRole[]
  onClose: () => void
  onSave: (roles: CondominiosRole[]) => Promise<void>
}

export function RolCondominiosModal({ usuarioNombre, rolesActuales, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<Set<CondominiosRole>>(new Set(rolesActuales))
  const [saving, setSaving] = useState(false)

  function toggle(roleId: CondominiosRole) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })
  }

  const selectedArray = useMemo(() => [...selected] as CondominiosRole[], [selected])

  const effectiveAccess = useMemo(() => getEffectiveTabAccess(selectedArray), [selectedArray])

  const isFullAccess = effectiveAccess === null

  const sectionStatus = useMemo(() =>
    CONDOMINIOS_SECTION_GROUPS.map(group => {
      if (isFullAccess) return { key: group.key, label: group.label, level: 'completo' as const, count: group.tabs.length, total: group.tabs.length }
      if (!effectiveAccess || effectiveAccess.size === 0) return { key: group.key, label: group.label, level: 'ninguno' as const, count: 0, total: group.tabs.length }
      const count = group.tabs.filter(t => effectiveAccess.has(t)).length
      const level = count === 0 ? 'ninguno' as const : count === group.tabs.length ? 'completo' as const : 'parcial' as const
      return { key: group.key, label: group.label, level, count, total: group.tabs.length }
    }),
    [isFullAccess, effectiveAccess]
  )

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(selectedArray)
    } finally {
      setSaving(false)
    }
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
        background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '680px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px', color: '#1e293b' }}>Roles de Condominios</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>{usuarioNombre}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '20px', color: '#94a3b8', padding: '4px 8px',
              borderRadius: '6px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body: two columns */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left: role list */}
          <div style={{
            flex: '0 0 55%', borderRight: '1px solid #e2e8f0',
            overflowY: 'auto', padding: '16px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', marginBottom: '10px', textTransform: 'uppercase' }}>
              Asignar roles (uno o más)
            </div>

            {/* Sin rol option */}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                padding: '9px 11px', marginBottom: '6px', borderRadius: '8px',
                border: `1px solid ${selected.size === 0 ? '#94a3b8' : '#e2e8f0'}`,
                background: selected.size === 0 ? 'rgba(100,116,139,0.08)' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{
                width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0,
                border: '2px solid #cbd5e1',
                background: selected.size === 0 ? '#94a3b8' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {selected.size === 0 && <span style={{ color: '#fff', fontSize: '11px', lineHeight: 1 }}>✓</span>}
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#475569' }}>Sin rol de condominios</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>Sin acceso al módulo de condominios</div>
              </div>
            </button>

            {CONDOMINIOS_ROLES.map(r => {
              const isChecked = selected.has(r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggle(r.id)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%',
                    padding: '9px 11px', marginBottom: '6px', borderRadius: '8px',
                    border: `1px solid ${isChecked ? r.color + '55' : '#e2e8f0'}`,
                    background: isChecked ? r.color + '12' : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span style={{
                    width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, marginTop: '1px',
                    border: `2px solid ${isChecked ? r.color : '#cbd5e1'}`,
                    background: isChecked ? r.color : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isChecked && <span style={{ color: '#fff', fontSize: '11px', lineHeight: 1 }}>✓</span>}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>{r.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', lineHeight: '1.4' }}>{r.description}</div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right: permission preview */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', marginBottom: '10px', textTransform: 'uppercase' }}>
              Permisos efectivos
            </div>

            {selected.size === 0 ? (
              <div style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center', marginTop: '32px', lineHeight: '1.6' }}>
                Sin roles asignados.<br />El usuario no tendrá<br />acceso al módulo.
              </div>
            ) : (
              <>
                {selectedArray.length > 1 && (
                  <div style={{
                    fontSize: '11px', color: '#0ea5e9', background: 'rgba(14,165,233,0.08)',
                    border: '1px solid rgba(14,165,233,0.2)', borderRadius: '6px',
                    padding: '6px 10px', marginBottom: '10px', lineHeight: '1.4',
                  }}>
                    {selectedArray.length} roles activos — permisos combinados
                  </div>
                )}

                {isFullAccess && (
                  <div style={{
                    fontSize: '11px', color: '#22c55e', background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.2)', borderRadius: '6px',
                    padding: '6px 10px', marginBottom: '10px',
                  }}>
                    Acceso completo a todas las secciones
                  </div>
                )}

                {sectionStatus.map(s => (
                  <div key={s.key} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 0', borderBottom: '1px solid #f1f5f9',
                  }}>
                    <span style={{ fontSize: '13px', color: '#334155', fontWeight: 500 }}>{s.label}</span>
                    <AccessBadge level={s.level} count={s.count} total={s.total} />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'flex-end', gap: '10px',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: '8px', border: '1px solid #e2e8f0',
              background: '#fff', color: '#475569', fontWeight: 600, fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: saving ? '#93c5fd' : '#3b82f6', color: '#fff',
              fontWeight: 600, fontSize: '13px', cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Guardando…' : 'Guardar roles'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AccessBadge({ level, count, total }: { level: 'completo' | 'parcial' | 'ninguno'; count: number; total: number }) {
  if (level === 'completo') {
    return (
      <span style={{ fontSize: '11px', fontWeight: 600, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: '999px' }}>
        Completo
      </span>
    )
  }
  if (level === 'parcial') {
    return (
      <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '999px' }}>
        Parcial {count}/{total}
      </span>
    )
  }
  return (
    <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', background: 'rgba(148,163,184,0.1)', padding: '2px 8px', borderRadius: '999px' }}>
      Sin acceso
    </span>
  )
}
