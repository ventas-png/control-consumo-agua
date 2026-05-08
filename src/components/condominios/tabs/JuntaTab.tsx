import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { MiembroJunta, CargoJunta, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  junta: MiembroJunta[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CARGO_ORDER: CargoJunta[] = ['presidente','vicepresidente','tesorero','secretario','fiscal','vocal','otro']

const CARGO_LABELS: Record<CargoJunta, { label: string; icon: string; color: string }> = {
  presidente:     { label: 'Presidente',      icon: '👑', color: '#8b5cf6' },
  vicepresidente: { label: 'Vicepresidente',  icon: '🌟', color: '#0ea5e9' },
  tesorero:       { label: 'Tesorero',        icon: '💰', color: '#10b981' },
  secretario:     { label: 'Secretario',      icon: '📝', color: '#f59e0b' },
  fiscal:         { label: 'Fiscal',          icon: '🔍', color: '#ef4444' },
  vocal:          { label: 'Vocal',           icon: '🗣️', color: '#64748b' },
  otro:           { label: 'Otro',            icon: '👤', color: '#94a3b8' },
}

const BLANK = {
  cargo: 'vocal' as CargoJunta, nombre: '', unidad_id: '',
  telefono: '', email: '', periodo_inicio: new Date().toISOString().slice(0,10),
  periodo_fin: '', notas: '', activo: true,
}

export function JuntaTab({ junta, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [showHistorico, setShowHistorico] = useState(false)

  const activos    = junta.filter(m => m.activo)
  const historicos = junta.filter(m => !m.activo)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function startEdit(m: MiembroJunta) {
    setEditId(m.id)
    setForm({
      cargo: m.cargo, nombre: m.nombre, unidad_id: m.unidad_id ?? '',
      telefono: m.telefono ?? '', email: m.email ?? '',
      periodo_inicio: m.periodo_inicio, periodo_fin: m.periodo_fin ?? '',
      notas: m.notas ?? '', activo: m.activo,
    })
    setShowForm(true)
  }

  function startNew() {
    setEditId(null); setForm({ ...BLANK }); setShowForm(true)
  }

  async function handleSave() {
    if (!form.nombre.trim() || !form.periodo_inicio) return Swal.fire('Campos requeridos', 'Nombre y fecha de inicio son obligatorios.', 'warning')
    setSaving(true)
    const payload = {
      cargo: form.cargo, nombre: form.nombre.trim(),
      unidad_id: form.unidad_id || null, telefono: form.telefono || null,
      email: form.email || null, periodo_inicio: form.periodo_inicio,
      periodo_fin: form.periodo_fin || null, notas: form.notas || null, activo: form.activo,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('junta_directiva').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('junta_directiva').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar miembro?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('junta_directiva').delete().eq('id', id)
    onRefresh()
  }

  async function toggleActivo(m: MiembroJunta) {
    await supabase.from('junta_directiva').update({ activo: !m.activo, periodo_fin: m.activo ? new Date().toISOString().slice(0,10) : null }).eq('id', m.id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  const sortedActivos = [...activos].sort((a, b) => CARGO_ORDER.indexOf(a.cargo) - CARGO_ORDER.indexOf(b.cargo))

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Junta Directiva</h2>
        {canCreate && (
          <button onClick={startNew}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar Miembro
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar miembro' : 'Nuevo miembro'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Cargo *</label>
              <select style={inputStyle} value={form.cargo} onChange={e => setF('cargo', e.target.value as CargoJunta)}>
                {CARGO_ORDER.map(c => <option key={c} value={c}>{CARGO_LABELS[c].label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Nombre *</label>
              <input style={inputStyle} value={form.nombre} onChange={e => setF('nombre', e.target.value)} placeholder="Nombre completo" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Teléfono</label>
              <input style={inputStyle} value={form.telefono} onChange={e => setF('telefono', e.target.value)} placeholder="+502 0000-0000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Email</label>
              <input style={inputStyle} type="email" value={form.email} onChange={e => setF('email', e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Inicio período *</label>
              <input style={inputStyle} type="date" value={form.periodo_inicio} onChange={e => setF('periodo_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fin período</label>
              <input style={inputStyle} type="date" value={form.periodo_fin} onChange={e => setF('periodo_fin', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo ? 'activo' : 'inactivo'} onChange={e => setF('activo', e.target.value === 'activo')}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo / Histórico</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones opcionales" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Active members */}
      {sortedActivos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay miembros activos registrados.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {sortedActivos.map(m => {
            const cl = CARGO_LABELS[m.cargo]
            return (
              <div key={m.id} style={{ background: 'white', border: `2px solid ${cl.color}30`, borderTop: `4px solid ${cl.color}`, borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '20px', marginBottom: '4px' }}>{cl.icon}</div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: cl.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cl.label}</div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={() => startEdit(m)} style={{ padding: '3px 7px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(m.id)} style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>{m.nombre}</div>
                {m.unidad_nombre && <div style={{ fontSize: '12px', color: '#64748b' }}>🏠 {m.unidad_nombre}</div>}
                {m.telefono && <a href={`tel:${m.telefono}`} style={{ fontSize: '12px', color: '#0ea5e9', display: 'block', textDecoration: 'none', marginTop: '4px' }}>📞 {m.telefono}</a>}
                {m.email && <a href={`mailto:${m.email}`} style={{ fontSize: '11px', color: '#64748b', display: 'block', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>✉️ {m.email}</a>}
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>Desde {m.periodo_inicio}{m.periodo_fin ? ` hasta ${m.periodo_fin}` : ''}</div>
                {canEdit && (
                  <button onClick={() => toggleActivo(m)} style={{ marginTop: '8px', padding: '3px 10px', background: '#f1f5f9', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#64748b' }}>
                    → Marcar inactivo
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Historical */}
      {historicos.length > 0 && (
        <div>
          <button onClick={() => setShowHistorico(v => !v)}
            style={{ fontSize: '12px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontWeight: 600 }}>
            {showHistorico ? '▾' : '▸'} Miembros anteriores ({historicos.length})
          </button>
          {showHistorico && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {historicos.map(m => (
                <div key={m.id} style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: '16px' }}>{CARGO_LABELS[m.cargo].icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#64748b' }}>{m.nombre}</span>
                    <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>{CARGO_LABELS[m.cargo].label} — {m.periodo_inicio}{m.periodo_fin ? ` a ${m.periodo_fin}` : ''}</span>
                  </div>
                  {canEdit && (
                    <button onClick={() => handleDelete(m.id)} style={{ padding: '2px 6px', background: '#fee2e2', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
