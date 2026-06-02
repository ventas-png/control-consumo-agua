import { useState } from 'react'
import type { ConversationAssignment } from '../../types'
import { EditModal } from '../shared/EditModal'

interface Props {
  teamUsers: { id: string; full_name: string; role: string }[]
  currentAssignments: ConversationAssignment[]
  onClose: () => void
  onAssign: (selectedIds: string[]) => Promise<void>
  onRemove: (assignmentId: string) => Promise<void>
}

export function AssignToUsersModal({ teamUsers, currentAssignments, onClose, onAssign, onRemove }: Props) {
  const assignedIds = new Set(currentAssignments.map(a => a.user_id))
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedIds))
  const [saving, setSaving] = useState(false)

  function toggleUser(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    const toRemove = currentAssignments.filter(a => !selected.has(a.user_id))
    for (const a of toRemove) {
      await onRemove(a.id)
    }
    const toAdd = [...selected].filter(id => !assignedIds.has(id))
    if (toAdd.length > 0) {
      await onAssign(toAdd)
    } else {
      onClose()
    }
    setSaving(false)
  }

  return (
    <EditModal
      title="Asignar conversación"
      subtitle="Selecciona los miembros del equipo que deben atender esta conversación."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid var(--at-line-strong)', borderRadius: '8px', background: 'var(--at-surface)', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-2)' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: '8px',
              background: 'var(--at-accent-hover)', color: 'white', fontSize: '13px', fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}>
            {saving ? 'Guardando…' : 'Guardar asignaciones'}
          </button>
        </>
      }
    >
      {teamUsers.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--at-ink-3)', textAlign: 'center', padding: '20px 0' }}>
          No hay usuarios del equipo disponibles.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
          {teamUsers.map(u => {
            const isSelected = selected.has(u.id)
            return (
              <button
                key={u.id}
                onClick={() => toggleUser(u.id)}
                aria-pressed={isSelected}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px', border: `1px solid ${isSelected ? 'var(--at-accent-light)' : 'var(--at-line)'}`,
                  borderRadius: '8px', background: isSelected ? 'var(--at-accent-tint)' : 'var(--at-surface)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{
                  width: '20px', height: '20px', borderRadius: '4px',
                  border: `2px solid ${isSelected ? 'var(--at-accent-hover)' : 'var(--at-line-strong)'}`,
                  background: isSelected ? 'var(--at-accent-hover)' : 'var(--at-surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, fontSize: '12px', color: 'white',
                }}>
                  {isSelected ? '✓' : ''}
                </span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--at-ink)' }}>
                  {u.full_name}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', textTransform: 'capitalize' }}>
                  {u.role}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </EditModal>
  )
}
