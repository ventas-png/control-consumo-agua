import { useState, useEffect } from 'react'
import {
  fetchUserProjectAssignments,
  deleteUserProjectAssignments,
  insertUserProjectAssignments,
} from '../../domain/empresa/usuarios'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'

interface Usuario {
  id: string
  full_name: string
  role: string
}

interface Proyecto {
  id: string
  nombre: string
}

interface AsignacionModalProps {
  usuario: Usuario
  proyectos: Proyecto[]
  onClose: () => void
  onSaved: () => void
}

export function AsignacionModal({ usuario, proyectos, onClose, onSaved }: AsignacionModalProps) {
  const [asignados, setAsignados] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function cargarAsignaciones() {
      const { data } = await fetchUserProjectAssignments(usuario.id)
      if (data) {
        setAsignados(new Set(data.map(a => a.project_id)))
      }
      setLoading(false)
    }
    void cargarAsignaciones()
  }, [usuario.id])

  async function guardar() {
    setSaving(true)
    try {
      const { error: deleteError } = await deleteUserProjectAssignments(usuario.id)
      if (deleteError) throw new Error(deleteError)

      if (asignados.size > 0) {
        const nuevas = Array.from(asignados).map(project_id => ({
          user_id: usuario.id,
          project_id,
          permission_type: 'total',
        }))
        const { error: insertError } = await insertUserProjectAssignments(nuevas)
        if (insertError) throw new Error(insertError)
      }

      onSaved()
      onClose()
    } catch (err) {
      console.error('Error guardando asignaciones:', err)
      alert('Error al guardar las asignaciones. Por favor intente de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  function toggleProyecto(id: string) {
    setAsignados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const roleLabel: Record<string, string> = {
    admin: 'Administrador',
    operator: 'Operador',
    operador: 'Operador',
    viewer: 'Visualizador',
    visor: 'Visualizador',
    collector: 'Gestor de Cobros',
  }

  return (
    <EditModal
      title="Asignar Acceso a Proyectos"
      subtitle={`${usuario.full_name} · ${roleLabel[usuario.role] ?? usuario.role}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="gradient-primary"
            onClick={() => void guardar()}
            loading={saving}
            loadingText="Guardando..."
          >
            Guardar
          </Button>
        </>
      }
    >
      {loading ? (
        <div style={{ color: 'var(--at-ink-3)', textAlign: 'center', padding: '20px' }}>Cargando...</div>
      ) : proyectos.length === 0 ? (
        <div style={{ color: 'var(--at-ink-3)', textAlign: 'center', padding: '20px' }}>
          No hay proyectos en esta empresa.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {proyectos.map(p => {
            const checked = asignados.has(p.id)
            return (
              <label
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                  background: checked ? 'var(--at-primary-soft)' : 'var(--at-surface-2)',
                  border: `1px solid ${checked ? 'var(--at-primary)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleProyecto(p.id)}
                  style={{ accentColor: 'var(--at-primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <span style={{ color: 'var(--at-ink)', fontSize: '14px', fontWeight: checked ? 600 : 400 }}>
                  {p.nombre}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </EditModal>
  )
}
