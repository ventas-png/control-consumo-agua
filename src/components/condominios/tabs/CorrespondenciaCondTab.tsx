import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { CorrespondenciaCondominio, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  correspondencia: CorrespondenciaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CAT_LABELS: Record<string, string> = {
  carta: 'Carta', notificacion_legal: 'Notif. Legal', factura: 'Factura', circular: 'Circular', otro: 'Otro',
}
const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  pendiente: { bg: '#fef3c7', color: '#92400e' },
  atendido:  { bg: '#dcfce7', color: '#16a34a' },
  archivado: { bg: '#f1f5f9', color: '#94a3b8' },
}

const BLANK = {
  tipo: 'entrada', categoria: 'carta', asunto: '', remitente: '', destinatario: '',
  fecha: new Date().toISOString().slice(0, 10), numero_guia: '', prioridad: 'normal',
  observaciones: '', unidad_id: '',
}

export function CorrespondenciaCondTab({ correspondencia, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrada' | 'salida'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'atendido' | 'archivado'>('todos')
  const [selected, setSelected] = useState<string | null>(null)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.asunto.trim()) return Swal.fire('Requerido', 'El asunto es obligatorio.', 'warning')
    setSaving(true)
    const { error } = await supabase.from('correspondencia_condominio').insert({
      company_id: companyId, project_id: proyectoId,
      tipo: form.tipo, categoria: form.categoria, asunto: form.asunto.trim(),
      remitente: form.remitente || null, destinatario: form.destinatario || null,
      fecha: form.fecha, numero_guia: form.numero_guia || null,
      prioridad: form.prioridad, observaciones: form.observaciones || null,
      unidad_id: form.unidad_id || null, estado: 'pendiente',
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await supabase.from('correspondencia_condominio').update({ estado }).eq('id', id)
    onRefresh()
  }

  const filtered = correspondencia
    .filter(c => filtroTipo === 'todos' || c.tipo === filtroTipo)
    .filter(c => filtroEstado === 'todos' || c.estado === filtroEstado)

  const entrada   = correspondencia.filter(c => c.tipo === 'entrada').length
  const salida    = correspondencia.filter(c => c.tipo === 'salida').length
  const pendientes = correspondencia.filter(c => c.estado === 'pendiente').length
  const urgentes  = correspondencia.filter(c => c.prioridad === 'urgente' && c.estado === 'pendiente').length

  const detail = selected ? correspondencia.find(c => c.id === selected) : null

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Correspondencia</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Entrada',   value: String(entrada),    color: '#0ea5e9' },
          { label: 'Salida',    value: String(salida),     color: '#8b5cf6' },
          { label: 'Pendiente', value: String(pendientes), color: '#f59e0b' },
          { label: 'Urgente',   value: String(urgentes),   color: '#ef4444' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Registrar Correspondencia</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                <option value="entrada">📥 Entrada</option>
                <option value="salida">📤 Salida</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Categoría</label>
              <select style={inputStyle} value={form.categoria} onChange={e => setF('categoria', e.target.value)}>
                {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Prioridad</label>
              <select style={inputStyle} value={form.prioridad} onChange={e => setF('prioridad', e.target.value)}>
                <option value="normal">Normal</option>
                <option value="urgente">🔴 Urgente</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Asunto *</label>
              <input style={inputStyle} value={form.asunto} onChange={e => setF('asunto', e.target.value)} placeholder="Descripción del documento" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Remitente</label>
              <input style={inputStyle} value={form.remitente} onChange={e => setF('remitente', e.target.value)} placeholder="Quién envía" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Destinatario</label>
              <input style={inputStyle} value={form.destinatario} onChange={e => setF('destinatario', e.target.value)} placeholder="A quién va dirigido" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>N° guía / referencia</label>
              <input style={inputStyle} value={form.numero_guia} onChange={e => setF('numero_guia', e.target.value)} placeholder="Número de tracking" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad relacionada</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Ninguna —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['todos', 'entrada', 'salida'] as const).map(f => (
            <button key={f} onClick={() => setFiltroTipo(f)}
              style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                borderColor: filtroTipo === f ? '#0ea5e9' : '#e2e8f0', background: filtroTipo === f ? '#e0f2fe' : 'white', color: filtroTipo === f ? '#0369a1' : '#64748b', fontWeight: filtroTipo === f ? 700 : 500 }}>
              {f === 'todos' ? 'Todos' : f === 'entrada' ? '📥 Entrada' : '📤 Salida'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['todos', 'pendiente', 'atendido', 'archivado'] as const).map(f => (
            <button key={f} onClick={() => setFiltroEstado(f)}
              style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                borderColor: filtroEstado === f ? '#8b5cf6' : '#e2e8f0', background: filtroEstado === f ? '#ede9fe' : 'white', color: filtroEstado === f ? '#7c3aed' : '#64748b', fontWeight: filtroEstado === f ? 700 : 500 }}>
              {f === 'todos' ? 'Todos estados' : f}
            </button>
          ))}
        </div>
      </div>

      {/* Split view */}
      <div style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 340px' : '1fr', gap: '16px' }}>
        {/* List */}
        <div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay correspondencia.</div>
          ) : (
            <div style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Tipo', 'Asunto', 'Categoría', 'Fecha', 'Estado', ''].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => {
                    const es = ESTADO_STYLE[c.estado]
                    return (
                      <tr key={c.id} onClick={() => setSelected(selected === c.id ? null : c.id)}
                        style={{ background: selected === c.id ? '#f0f9ff' : i % 2 === 0 ? 'white' : '#fafafa', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{ fontSize: '13px' }}>{c.tipo === 'entrada' ? '📥' : '📤'}</span>
                          {c.prioridad === 'urgente' && <span style={{ fontSize: '10px', marginLeft: '4px', color: '#ef4444', fontWeight: 700 }}>URG</span>}
                        </td>
                        <td style={{ padding: '9px 12px', fontWeight: 600, color: '#0f172a' }}>{c.asunto}</td>
                        <td style={{ padding: '9px 12px', color: '#64748b', fontSize: '12px' }}>{CAT_LABELS[c.categoria]}</td>
                        <td style={{ padding: '9px 12px', color: '#64748b', fontSize: '12px' }}>{c.fecha}</td>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es?.bg, color: es?.color }}>{c.estado}</span>
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          {canEdit && c.estado === 'pendiente' && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button onClick={e => { e.stopPropagation(); cambiarEstado(c.id, 'atendido') }}
                                style={{ padding: '2px 7px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                                Atender
                              </button>
                              <button onClick={e => { e.stopPropagation(); cambiarEstado(c.id, 'archivado') }}
                                style={{ padding: '2px 7px', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}>
                                Archivar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail */}
        {detail && (
          <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', alignSelf: 'flex-start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>{detail.tipo === 'entrada' ? '📥' : '📤'}</span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '16px' }}>✕</button>
            </div>
            <h3 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{detail.asunto}</h3>
            {[
              ['Categoría', CAT_LABELS[detail.categoria]],
              ['Fecha', detail.fecha],
              ['Remitente', detail.remitente ?? '—'],
              ['Destinatario', detail.destinatario ?? '—'],
              ['N° guía', detail.numero_guia ?? '—'],
              ['Prioridad', detail.prioridad],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>{k}</span>
                <span style={{ color: '#0f172a' }}>{v}</span>
              </div>
            ))}
            {detail.observaciones && (
              <div style={{ marginTop: '10px', padding: '8px', background: '#f8fafc', borderRadius: '6px', fontSize: '12px', color: '#374151' }}>
                {detail.observaciones}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
