import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ObjetoPerdido, EstadoObjeto } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  objetos: ObjetoPerdido[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoObjeto, { label: string; color: string; bg: string }> = {
  en_custodia: { label: 'En Custodia',  color: '#0ea5e9', bg: '#e0f2fe' },
  reclamado:   { label: 'Reclamado',    color: '#10b981', bg: '#d1fae5' },
  donado:      { label: 'Donado',       color: '#8b5cf6', bg: '#ede9fe' },
  descartado:  { label: 'Descartado',   color: '#64748b', bg: '#f1f5f9' },
}

const blank = (): Partial<ObjetoPerdido> => ({
  descripcion: '',
  lugar_encontrado: '',
  fecha_encontrado: new Date().toISOString().slice(0, 10),
  estado: 'en_custodia',
  notas: '',
})

export function ObjetosTab({ objetos, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoObjeto | 'todos'>('en_custodia')
  const [form, setForm] = useState<Partial<ObjetoPerdido>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reclamoId, setReclamoId] = useState<string | null>(null)
  const [reclamadoPor, setReclamadoPor] = useState('')

  const filtered = objetos.filter(o => filtroEstado === 'todos' || o.estado === filtroEstado)

  function startEdit(o: ObjetoPerdido) {
    setForm({
      descripcion: o.descripcion,
      lugar_encontrado: o.lugar_encontrado ?? '',
      fecha_encontrado: o.fecha_encontrado,
      estado: o.estado,
      notas: o.notas ?? '',
    })
    setEditId(o.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setForm(blank())
  }

  async function handleSave() {
    if (!form.descripcion?.trim()) return Swal.fire('Campo requerido', 'Describe el objeto.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId,
      project_id: proyectoId,
      descripcion: form.descripcion!.trim(),
      lugar_encontrado: form.lugar_encontrado || null,
      fecha_encontrado: form.fecha_encontrado ?? new Date().toISOString().slice(0, 10),
      estado: form.estado ?? 'en_custodia',
      notas: form.notas || null,
      registrado_por: userId || null,
    }
    if (editId) {
      const { error } = await supabase.from('objetos_perdidos').update(payload).eq('id', editId)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { error } = await supabase.from('objetos_perdidos').insert(payload)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    }
    setSaving(false)
    cancelForm()
    onRefresh()
  }

  async function handleDelete(id: string) {
    const result = await Swal.fire({
      title: '¿Eliminar objeto?', icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444',
    })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('objetos_perdidos').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoObjeto) {
    if (estado === 'reclamado') {
      setReclamoId(id)
      setReclamadoPor('')
      return
    }
    const { error } = await supabase.from('objetos_perdidos').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function confirmarReclamo() {
    if (!reclamoId) return
    const { error } = await supabase.from('objetos_perdidos').update({
      estado: 'reclamado',
      reclamado_por: reclamadoPor || null,
      fecha_reclamo: new Date().toISOString().slice(0, 10),
    }).eq('id', reclamoId)
    if (error) return Swal.fire('Error', error.message, 'error')
    setReclamoId(null)
    setReclamadoPor('')
    onRefresh()
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px',
    fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Objetos Perdidos / Custodia</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Objeto
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
            {editId ? 'Editar Registro' : 'Registrar Objeto Encontrado'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción *</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="¿Qué objeto es? (ej. llaves, cartera, celular…)" />
            </div>
            <div>
              <label style={labelStyle}>Lugar encontrado</label>
              <input style={inputStyle} value={form.lugar_encontrado ?? ''} onChange={e => setForm(f => ({ ...f, lugar_encontrado: e.target.value }))} placeholder="ej. Área de piscina, lobby…" />
            </div>
            <div>
              <label style={labelStyle}>Fecha encontrado</label>
              <input style={inputStyle} type="date" value={form.fecha_encontrado ?? ''} onChange={e => setForm(f => ({ ...f, fecha_encontrado: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'en_custodia'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoObjeto }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones adicionales…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Reclamo modal */}
      {reclamoId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700 }}>Registrar Reclamo</h3>
            <label style={labelStyle}>Reclamado por (nombre)</label>
            <input style={{ ...inputStyle, marginBottom: '16px' }} value={reclamadoPor} onChange={e => setReclamadoPor(e.target.value)} placeholder="Nombre de quien reclama…" autoFocus />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setReclamoId(null)} style={{ padding: '8px 14px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmarReclamo} style={{ padding: '8px 14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Confirmar Reclamo</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroEstado('todos')}
          style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            borderColor: filtroEstado === 'todos' ? '#0ea5e9' : '#e2e8f0',
            background: filtroEstado === 'todos' ? '#e0f2fe' : 'white',
            color: filtroEstado === 'todos' ? '#0ea5e9' : '#64748b' }}>
          Todos ({objetos.length})
        </button>
        {(Object.entries(ESTADO_CONFIG) as [EstadoObjeto, typeof ESTADO_CONFIG[EstadoObjeto]][]).map(([k, v]) => {
          const count = objetos.filter(o => o.estado === k).length
          return (
            <button key={k} onClick={() => setFiltroEstado(k)}
              style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                borderColor: filtroEstado === k ? v.color : '#e2e8f0',
                background: filtroEstado === k ? v.bg : 'white',
                color: filtroEstado === k ? v.color : '#64748b' }}>
              {v.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay objetos en esta categoría</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filtered.map(o => {
            const cfg = ESTADO_CONFIG[o.estado]
            return (
              <div key={o.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>{o.descripcion}</div>
                    {o.lugar_encontrado && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>📍 {o.lugar_encontrado}</div>}
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
                    {cfg.label}
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Encontrado: {o.fecha_encontrado}
                  {o.reclamado_por && <span style={{ marginLeft: '8px' }}>· {o.reclamado_por}</span>}
                  {o.fecha_reclamo && <span style={{ marginLeft: '4px' }}>({o.fecha_reclamo})</span>}
                </div>

                {o.notas && <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>{o.notas}</div>}

                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {o.estado === 'en_custodia' && (
                      <>
                        <button onClick={() => handleEstado(o.id, 'reclamado')} style={{ padding: '4px 10px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Reclamado
                        </button>
                        <button onClick={() => handleEstado(o.id, 'donado')} style={{ padding: '4px 10px', background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Donar
                        </button>
                        <button onClick={() => handleEstado(o.id, 'descartado')} style={{ padding: '4px 10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Descartar
                        </button>
                      </>
                    )}
                    <button onClick={() => startEdit(o)} style={{ padding: '4px 10px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(o.id)} style={{ padding: '4px 10px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
