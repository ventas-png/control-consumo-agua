import { useState } from 'react'
import type { ConversationAssignment } from '../../types'

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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div style={{
        background: 'white', borderRadius: '14px', width: '100%', maxWidth: '420px',
        padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#15291F' }}>
          Asignar conversación
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#7E9389' }}>
          Selecciona los miembros del equipo que deben atender esta conversación.
        </p>

        {teamUsers.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#7E9389', textAlign: 'center', padding: '20px 0' }}>
            No hay usuarios del equipo disponibles.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '280px', overflowY: 'auto', marginBottom: '16px' }}>
            {teamUsers.map(u => {
              const isSelected = selected.has(u.id)
              return (
                <button
                  key={u.id}
                  onClick={() => toggleUser(u.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', border: `1px solid ${isSelected ? '#CE8A63' : '#E1DDD0'}`,
                    borderRadius: '8px', background: isSelected ? '#F4EBE3' : 'white',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: '20px', height: '20px', borderRadius: '4px',
                    border: `2px solid ${isSelected ? '#9C5733' : '#C7C2B0'}`,
                    background: isSelected ? '#9C5733' : 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: '12px', color: 'white',
                  }}>
                    {isSelected ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#15291F' }}>
                    {u.full_name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#7E9389', textTransform: 'capitalize' }}>
                    {u.role}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid #C7C2B0', borderRadius: '8px', background: 'white', fontSize: '13px', cursor: 'pointer', color: '#3E5A4C' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: '8px',
              background: '#9C5733', color: 'white', fontSize: '13px', fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            }}>
            {saving ? 'Guardando…' : 'Guardar asignaciones'}
          </button>
        </div>
      </div>
    </div>
  )
}
