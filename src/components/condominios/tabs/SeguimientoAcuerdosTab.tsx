import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { SeguimientoAcuerdo, ActaReunion } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

interface Props {
  acuerdos: SeguimientoAcuerdo[]
  actas: ActaReunion[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pendiente:   { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)',  label: 'Pendiente' },
  en_proceso:  { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)',  label: 'En proceso' },
  cumplido:    { bg: 'var(--at-success-tint)', color: 'var(--at-success)',  label: 'Cumplido' },
  vencido:     { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)',  label: 'Vencido' },
  cancelado:   { bg: 'var(--at-chip)', color: 'var(--at-ink-3)',  label: 'Cancelado' },
}

const BLANK = { acta_id: '', titulo: '', descripcion: '', responsable: '', fecha_limite: '', estado: 'pendiente', notas_seguimiento: '' }

export function SeguimientoAcuerdosTab({ acuerdos, actas, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'en_proceso' | 'cumplido' | 'vencido' | 'cancelado'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(a: SeguimientoAcuerdo) {
    setEditId(a.id)
    setForm({ acta_id: a.acta_id ?? '', titulo: a.titulo, descripcion: a.descripcion ?? '', responsable: a.responsable ?? '', fecha_limite: a.fecha_limite ?? '', estado: a.estado, notas_seguimiento: a.notas_seguimiento ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.titulo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El título es obligatorio.' })
    setSaving(true)
    const payload = {
      acta_id: form.acta_id || null, titulo: form.titulo.trim(),
      descripcion: form.descripcion || null, responsable: form.responsable || null,
      fecha_limite: form.fecha_limite || null, estado: form.estado,
      notas_seguimiento: form.notas_seguimiento || null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('seguimiento_acuerdos').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('seguimiento_acuerdos').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await supabase.from('seguimiento_acuerdos').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar acuerdo?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)' })
    if (!r.isConfirmed) return
    await supabase.from('seguimiento_acuerdos').delete().eq('id', id)
    onRefresh()
  }

  const today = new Date().toISOString().slice(0, 10)

  // Auto-flag vencidos (fecha_limite < today and still pendiente/en_proceso)
  const enriched = acuerdos.map(a => ({
    ...a,
    estado: a.estado !== 'cumplido' && a.estado !== 'cancelado' && a.fecha_limite && a.fecha_limite < today ? 'vencido' : a.estado,
  }))

  const filtered = filtroEstado === 'todos' ? enriched : enriched.filter(a => a.estado === filtroEstado)

  const pendientes = enriched.filter(a => a.estado === 'pendiente').length
  const enProceso  = enriched.filter(a => a.estado === 'en_proceso').length
  const vencidos   = enriched.filter(a => a.estado === 'vencido').length
  const cumplidos  = enriched.filter(a => a.estado === 'cumplido').length
  const total      = enriched.length
  const tasaCumplimiento = total > 0 ? Math.round(cumplidos / total * 100) : 0

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Seguimiento de Acuerdos</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Control de compromisos derivados de actas y reuniones</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Acuerdo
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Pendientes',  value: String(pendientes), color: 'var(--at-warning)' },
          { label: 'En proceso',  value: String(enProceso),  color: 'var(--at-primary)' },
          { label: 'Vencidos',    value: String(vencidos),   color: 'var(--at-danger)' },
          { label: 'Cumplimiento', value: `${tasaCumplimiento}%`, color: tasaCumplimiento >= 70 ? 'var(--at-success)' : 'var(--at-warning)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar acuerdo' : 'Nuevo Acuerdo'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Contratar empresa de mantenimiento eléctrico" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Acta de origen</label>
              <select style={inputStyle} value={form.acta_id} onChange={e => setF('acta_id', e.target.value)}>
                <option value="">— Ninguna —</option>
                {actas.map(a => <option key={a.id} value={a.id}>{a.titulo} ({a.fecha})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Responsable</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Persona o área encargada" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha límite</label>
              <input style={inputStyle} type="date" value={form.fecha_limite} onChange={e => setF('fecha_limite', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                {Object.entries(ESTADO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción / Notas de seguimiento</label>
              <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notas_seguimiento} onChange={e => setF('notas_seguimiento', e.target.value)}
                placeholder="Avances, observaciones, próximos pasos…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'pendiente', 'en_proceso', 'cumplido', 'vencido', 'cancelado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer', fontWeight: filtroEstado === f ? 700 : 500,
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)', fontSize: '13px' }}>No hay acuerdos.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(a => {
            const est = ESTADO_STYLE[a.estado]
            const acta = actas.find(ac => ac.id === a.acta_id)
            const diasRestantes = a.fecha_limite ? Math.ceil((new Date(a.fecha_limite).getTime() - new Date(today).getTime()) / 86400000) : null

            return (
              <div key={a.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{a.titulo}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: est?.bg, color: est?.color }}>{est?.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {a.responsable && <span>👤 {a.responsable}</span>}
                      {acta && <span>📋 {acta.titulo}</span>}
                      {a.fecha_limite && (
                        <span style={{ color: diasRestantes !== null && diasRestantes < 0 ? 'var(--at-danger)' : diasRestantes !== null && diasRestantes <= 7 ? 'var(--at-warning)' : 'var(--at-ink-3)', fontWeight: diasRestantes !== null && diasRestantes <= 7 ? 700 : 400 }}>
                          📅 {a.fecha_limite}{diasRestantes !== null ? ` (${diasRestantes >= 0 ? `${diasRestantes}d` : 'vencido'})` : ''}
                        </span>
                      )}
                    </div>
                    {a.notas_seguimiento && (
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '4px', fontStyle: 'italic' }}>{a.notas_seguimiento}</div>
                    )}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      {a.estado === 'pendiente' && (
                        <button onClick={() => cambiarEstado(a.id, 'en_proceso')}
                          style={{ padding: '3px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                          Iniciar
                        </button>
                      )}
                      {['pendiente', 'en_proceso', 'vencido'].includes(a.estado) && (
                        <button onClick={() => cambiarEstado(a.id, 'cumplido')}
                          style={{ padding: '3px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                          ✓ Cumplido
                        </button>
                      )}
                      <button onClick={() => startEdit(a as SeguimientoAcuerdo)}
                        style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(a.id)}
                        style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
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
