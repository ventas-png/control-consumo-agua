import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ObjetoPerdido, EstadoObjeto } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

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
  en_custodia: { label: 'En Custodia',  color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  reclamado:   { label: 'Reclamado',    color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  donado:      { label: 'Donado',       color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  descartado:  { label: 'Descartado',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
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
    if (!form.descripcion?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Describe el objeto.' })
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
      confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)',
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
    width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
    fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Objetos Perdidos / Custodia</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Objeto
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>
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
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Reclamo modal */}
      {reclamoId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--at-surface)', borderRadius: '12px', padding: '24px', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700 }}>Registrar Reclamo</h3>
            <label style={labelStyle}>Reclamado por (nombre)</label>
            <input style={{ ...inputStyle, marginBottom: '16px' }} value={reclamadoPor} onChange={e => setReclamadoPor(e.target.value)} placeholder="Nombre de quien reclama…" autoFocus />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setReclamoId(null)} style={{ padding: '8px 14px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmarReclamo} style={{ padding: '8px 14px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Confirmar Reclamo</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroEstado('todos')}
          style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            borderColor: filtroEstado === 'todos' ? 'var(--at-primary)' : 'var(--at-line)',
            background: filtroEstado === 'todos' ? 'var(--at-primary-soft)' : 'var(--at-surface)',
            color: filtroEstado === 'todos' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
          Todos ({objetos.length})
        </button>
        {(Object.entries(ESTADO_CONFIG) as [EstadoObjeto, typeof ESTADO_CONFIG[EstadoObjeto]][]).map(([k, v]) => {
          const count = objetos.filter(o => o.estado === k).length
          return (
            <button key={k} onClick={() => setFiltroEstado(k)}
              style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                borderColor: filtroEstado === k ? v.color : 'var(--at-line)',
                background: filtroEstado === k ? v.bg : 'var(--at-surface)',
                color: filtroEstado === k ? v.color : 'var(--at-ink-3)' }}>
              {v.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay objetos en esta categoría</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filtered.map(o => {
            const cfg = ESTADO_CONFIG[o.estado]
            return (
              <div key={o.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>{o.descripcion}</div>
                    {o.lugar_encontrado && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>📍 {o.lugar_encontrado}</div>}
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
                    {cfg.label}
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  Encontrado: {o.fecha_encontrado}
                  {o.reclamado_por && <span style={{ marginLeft: '8px' }}>· {o.reclamado_por}</span>}
                  {o.fecha_reclamo && <span style={{ marginLeft: '4px' }}>({o.fecha_reclamo})</span>}
                </div>

                {o.notas && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontStyle: 'italic' }}>{o.notas}</div>}

                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {o.estado === 'en_custodia' && (
                      <>
                        <button onClick={() => handleEstado(o.id, 'reclamado')} style={{ padding: '4px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Reclamado
                        </button>
                        <button onClick={() => handleEstado(o.id, 'donado')} style={{ padding: '4px 10px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Donar
                        </button>
                        <button onClick={() => handleEstado(o.id, 'descartado')} style={{ padding: '4px 10px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          Descartar
                        </button>
                      </>
                    )}
                    <button onClick={() => startEdit(o)} style={{ padding: '4px 10px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(o.id)} style={{ padding: '4px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
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
