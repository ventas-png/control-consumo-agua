import { useState, useEffect } from 'react'
import {
  fetchUserProjectAssignments,
  guardarAsignacionesProyecto,
  puedeEditarAsignaciones,
} from '../../domain/empresa/usuarios'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { notify } from '../shared/Dialog'

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
  /** Quien edita. Un administrador no puede editarse a sí mismo (el servidor lo rechaza): se deshabilita Guardar con la explicación. */
  actor?: { id: string; role: string }
}

export function AsignacionModal({ usuario, proyectos, onClose, onSaved, actor }: AsignacionModalProps) {
  const permiso = actor ? puedeEditarAsignaciones(actor, usuario) : { permitido: true, motivo: null }
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
    if (!permiso.permitido) return
    setSaving(true)
    try {
      // Inserta las que faltan y borra sólo las que sobran (las filas que no cambian no se tocan) y lo comprueba leyendo de vuelta.
      const { error } = await guardarAsignacionesProyecto(
        usuario.id,
        Array.from(asignados),
        proyectos.map(p => p.id),
      )
      if (error) {
        notify({ title: 'Asignaciones sin guardar', text: error, variant: 'error', duration: 9000 })
        return
      }
      onSaved()
      onClose()
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
            disabled={!permiso.permitido}
          >
            Guardar
          </Button>
        </>
      }
    >
      {!permiso.permitido && (
        <div
          role="note"
          style={{
            marginBottom: '12px', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.4,
            color: 'var(--at-ink)', background: 'var(--at-surface-2)', border: '1px solid var(--at-line-strong)',
          }}
        >
          {permiso.motivo}
        </div>
      )}
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
                  disabled={!permiso.permitido}
                  onChange={() => toggleProyecto(p.id)}
                  style={{ accentColor: 'var(--at-primary)', width: '16px', height: '16px', cursor: permiso.permitido ? 'pointer' : 'not-allowed' }}
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
