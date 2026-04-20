import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { AccesoResidente } from '../../../types'
import type { Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  accesos: AccesoResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  tarjeta:       { bg: '#e0f2fe', color: '#0369a1', label: 'Tarjeta',       icon: '💳' },
  codigo:        { bg: '#fef3c7', color: '#92400e', label: 'Código',         icon: '🔢' },
  llave_digital: { bg: '#f3e8ff', color: '#7c3aed', label: 'Llave digital',  icon: '📱' },
  biometrico:    { bg: '#dcfce7', color: '#16a34a', label: 'Biométrico',     icon: '🔏' },
}

const BLANK = { unidad_id: '', tipo: 'tarjeta', identificador: '', titular: '', activo: true, fecha_emision: new Date().toISOString().slice(0, 10), fecha_vencimiento: '', notas: '' }

export function AccesosResTab({ accesos, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [soloActivos, setSoloActivos] = useState(true)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(a: AccesoResidente) {
    setEditId(a.id)
    setForm({ unidad_id: a.unidad_id, tipo: a.tipo, identificador: a.identificador, titular: a.titular, activo: a.activo, fecha_emision: a.fecha_emision, fecha_vencimiento: a.fecha_vencimiento ?? '', notas: a.notas ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.unidad_id) return Swal.fire('Requerido', 'Seleccione una unidad.', 'warning')
    if (!form.identificador.trim()) return Swal.fire('Requerido', 'El identificador es obligatorio.', 'warning')
    if (!form.titular.trim()) return Swal.fire('Requerido', 'El titular es obligatorio.', 'warning')
    setSaving(true)
    const payload = {
      unidad_id: form.unidad_id, tipo: form.tipo, identificador: form.identificador.trim(),
      titular: form.titular.trim(), activo: form.activo, fecha_emision: form.fecha_emision,
      fecha_vencimiento: form.fecha_vencimiento || null, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('accesos_residentes').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('accesos_residentes').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar acceso?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('accesos_residentes').delete().eq('id', id)
    onRefresh()
  }

  async function toggleActivo(a: AccesoResidente) {
    await supabase.from('accesos_residentes').update({ activo: !a.activo }).eq('id', a.id)
    onRefresh()
  }

  const today = new Date().toISOString().slice(0, 10)
  let filtered = accesos
  if (filtroUnidad) filtered = filtered.filter(a => a.unidad_id === filtroUnidad)
  if (filtroTipo !== 'todos') filtered = filtered.filter(a => a.tipo === filtroTipo)
  if (soloActivos) filtered = filtered.filter(a => a.activo)

  const porVencer = accesos.filter(a => a.activo && a.fecha_vencimiento && a.fecha_vencimiento <= addDays(today, 30))
  const vencidos  = accesos.filter(a => a.activo && a.fecha_vencimiento && a.fecha_vencimiento < today)

  function addDays(d: string, days: number) {
    const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10)
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Accesos de Residentes</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>{accesos.filter(a => a.activo).length} activos · {vencidos.length > 0 ? `${vencidos.length} vencidos` : 'sin vencidos'}</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Acceso
          </button>
        )}
      </div>

      {/* Alerts */}
      {(vencidos.length > 0 || porVencer.length > 0) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {vencidos.length > 0 && (
            <div style={{ background: '#fee2e2', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>
              ⚠️ {vencidos.length} acceso(s) vencido(s)
            </div>
          )}
          {porVencer.length > 0 && (
            <div style={{ background: '#fef3c7', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
              🕐 {porVencer.length} por vencer en 30 días
            </div>
          )}
        </div>
      )}

      {/* KPIs by type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(TIPO_STYLE).map(([tipo, s]) => (
          <div key={tipo} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px' }}>{s.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: s.color }}>{accesos.filter(a => a.tipo === tipo && a.activo).length}</div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar acceso' : 'Nuevo Acceso'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Identificador *</label>
              <input style={inputStyle} value={form.identificador} onChange={e => setF('identificador', e.target.value)} placeholder="Nº tarjeta / código…" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Titular *</label>
              <input style={inputStyle} value={form.titular} onChange={e => setF('titular', e.target.value)} placeholder="Nombre del titular" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha emisión</label>
              <input style={inputStyle} type="date" value={form.fecha_emision} onChange={e => setF('fecha_emision', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha vencimiento</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento} onChange={e => setF('fecha_vencimiento', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo ? 'true' : 'false'} onChange={e => setF('activo', e.target.value === 'true')}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones…" />
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

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 'auto' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo activos
        </label>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay accesos registrados.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '10px' }}>
          {filtered.map(a => {
            const unidad = unidades.find(u => u.id === a.unidad_id)
            const ts = TIPO_STYLE[a.tipo] ?? TIPO_STYLE.tarjeta
            const vencido = a.fecha_vencimiento && a.fecha_vencimiento < today
            const proxVencer = a.fecha_vencimiento && !vencido && a.fecha_vencimiento <= addDays(today, 30)
            return (
              <div key={a.id} style={{ background: 'white', border: `1.5px solid ${vencido ? '#fca5a5' : proxVencer ? '#fde68a' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px', opacity: a.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '16px' }}>{ts.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>{a.identificador}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: ts.bg, color: ts.color }}>{ts.label}</span>
                      {!a.activo && <span style={{ fontSize: '10px', padding: '2px 5px', background: '#f1f5f9', color: '#94a3b8', borderRadius: '20px' }}>Inactivo</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: '#374151', fontWeight: 600 }}>{a.titular}</div>
                    {unidad && <div style={{ fontSize: '11px', color: '#0ea5e9' }}>🏠 {unidad.nombre}</div>}
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Emitido: {a.fecha_emision}</div>
                    {a.fecha_vencimiento && (
                      <div style={{ fontSize: '11px', color: vencido ? '#ef4444' : proxVencer ? '#f59e0b' : '#94a3b8', fontWeight: (vencido || proxVencer) ? 700 : 400 }}>
                        Vence: {a.fecha_vencimiento}{vencido ? ' ⚠️' : proxVencer ? ' 🕐' : ''}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <button onClick={() => toggleActivo(a)}
                        style={{ padding: '3px 7px', background: a.activo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', color: a.activo ? '#ef4444' : '#16a34a' }}>
                        {a.activo ? 'Desact.' : 'Activar'}
                      </button>
                      <button onClick={() => startEdit(a)}
                        style={{ padding: '3px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(a.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
