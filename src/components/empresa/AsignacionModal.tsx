import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

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
      const { data } = await supabase
        .from('user_project_assignments')
        .select('project_id')
        .eq('user_id', usuario.id)
      if (data) {
        setAsignados(new Set(data.map((a: { project_id: string }) => a.project_id)))
      }
      setLoading(false)
    }
    void cargarAsignaciones()
  }, [usuario.id])

  async function guardar() {
    setSaving(true)
    try {
      const { error: deleteError } = await supabase
        .from('user_project_assignments')
        .delete()
        .eq('user_id', usuario.id)
      if (deleteError) throw deleteError

      if (asignados.size > 0) {
        const nuevas = Array.from(asignados).map(project_id => ({
          user_id: usuario.id,
          project_id,
          permission_type: 'total',
        }))
        const { error: insertError } = await supabase
          .from('user_project_assignments')
          .insert(nuevas)
        if (insertError) throw insertError
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
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#1e293b', borderRadius: '16px', padding: '28px',
          width: '480px', maxWidth: '95vw', boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ color: '#f1f5f9', fontSize: '18px', fontWeight: 700, margin: 0 }}>
            Asignar Acceso a Proyectos
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px' }}>
            {usuario.full_name} · {roleLabel[usuario.role] ?? usuario.role}
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>Cargando...</div>
        ) : proyectos.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>
            No hay proyectos en esta empresa.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
            {proyectos.map(p => {
              const checked = asignados.has(p.id)
              return (
                <label
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                    background: checked ? 'rgba(14,165,233,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${checked ? '#0ea5e9' : 'transparent'}`,
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProyecto(p.id)}
                    style={{ accentColor: '#0ea5e9', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ color: checked ? '#38bdf8' : '#cbd5e1', fontSize: '14px', fontWeight: checked ? 600 : 400 }}>
                    {p.nombre}
                  </span>
                </label>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '14px',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void guardar()}
            disabled={saving}
            style={{
              padding: '9px 20px', borderRadius: '8px', border: 'none',
              background: saving ? '#334155' : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
              color: 'white', cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '14px', fontWeight: 600,
            }}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
