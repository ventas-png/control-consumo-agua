import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ProgramacionLimpieza } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

interface Props {
  programaciones: ProgramacionLimpieza[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const FRECUENCIA_DIAS: Record<string, number> = { diaria: 1, semanal: 7, quincenal: 15, mensual: 30 }

const FRECUENCIA_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  diaria:    { label: 'Diaria',    bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  semanal:   { label: 'Semanal',   bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
  quincenal: { label: 'Quincenal', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  mensual:   { label: 'Mensual',   bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

const BLANK = { area: '', frecuencia: 'semanal', responsable: '', ultima_ejecucion: '', proxima_ejecucion: '', activo: 'true', notas: '' }

function addDays(date: string, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function getAlerta(p: ProgramacionLimpieza): 'vencida' | 'proxima' | 'ok' | 'sin_fecha' {
  if (!p.proxima_ejecucion) return 'sin_fecha'
  const hoy = new Date().toISOString().slice(0, 10)
  if (p.proxima_ejecucion < hoy) return 'vencida'
  const en3 = addDays(hoy, 3)
  if (p.proxima_ejecucion <= en3) return 'proxima'
  return 'ok'
}

const ALERTA_STYLE = {
  vencida:   { bg: 'var(--at-danger-tint)', border: 'var(--at-danger-border)', badge: 'var(--at-danger)', badgeBg: 'var(--at-danger-tint)', label: 'Vencida' },
  proxima:   { bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)', badge: 'var(--at-warning-strong)', badgeBg: 'var(--at-warning-tint)', label: 'Próxima' },
  ok:        { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', badge: 'var(--at-success)', badgeBg: 'var(--at-success-tint)', label: 'Al día' },
  sin_fecha: { bg: 'var(--at-surface-2)', border: 'var(--at-line)', badge: 'var(--at-ink-3)', badgeBg: 'var(--at-chip)', label: 'Sin fecha' },
}

export function ProgramacionLimpiezaTab({ programaciones, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterFrecuencia, setFilterFrecuencia] = useState('')
  const [filterActivo, setFilterActivo] = useState<'activas' | 'inactivas' | ''>('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true) }
  const openEdit = (p: ProgramacionLimpieza) => {
    setForm({
      area: p.area, frecuencia: p.frecuencia, responsable: p.responsable ?? '',
      ultima_ejecucion: p.ultima_ejecucion ?? '', proxima_ejecucion: p.proxima_ejecucion ?? '',
      activo: String(p.activo), notas: p.notas ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.area.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'El área es obligatoria.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      area: form.area.trim(), frecuencia: form.frecuencia,
      responsable: form.responsable || null,
      ultima_ejecucion: form.ultima_ejecucion || null,
      proxima_ejecucion: form.proxima_ejecucion || null,
      activo: form.activo === 'true',
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('programacion_limpieza').update(payload).eq('id', editId)
      : await supabase.from('programacion_limpieza').insert(payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const marcarEjecutada = async (p: ProgramacionLimpieza) => {
    const hoy = new Date().toISOString().slice(0, 10)
    const proxima = addDays(hoy, FRECUENCIA_DIAS[p.frecuencia])
    const { error } = await supabase.from('programacion_limpieza').update({ ultima_ejecucion: hoy, proxima_ejecucion: proxima, estado: 'completado' }).eq('id', p.id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const toggleActivo = async (p: ProgramacionLimpieza) => {
    await supabase.from('programacion_limpieza').update({ activo: !p.activo }).eq('id', p.id)
    onRefresh()
  }

  const handleDelete = async (p: ProgramacionLimpieza) => {
    const r = await Swal.fire({ title: '¿Eliminar programación?', text: p.area, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('programacion_limpieza').delete().eq('id', p.id)
    onRefresh()
  }

  const filtered = programaciones.filter(p =>
    (!filterFrecuencia || p.frecuencia === filterFrecuencia) &&
    (filterActivo === '' || (filterActivo === 'activas' ? p.activo : !p.activo))
  )

  const vencidas = programaciones.filter(p => p.activo && getAlerta(p) === 'vencida').length
  const proximas = programaciones.filter(p => p.activo && getAlerta(p) === 'proxima').length
  const alDia    = programaciones.filter(p => p.activo && getAlerta(p) === 'ok').length

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        {[
          { label: 'Vencidas', value: vencidas, icon: '🔴', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
          { label: 'Próximas (≤3d)', value: proximas, icon: '🟡', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
          { label: 'Al día', value: alDia, icon: '🟢', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nueva área
          </button>
        )}
        <select value={filterFrecuencia} onChange={e => setFilterFrecuencia(e.target.value)} style={{ ...inputStyle, width: '150px' }}>
          <option value="">Todas las frecuencias</option>
          {Object.entries(FRECUENCIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterActivo} onChange={e => setFilterActivo(e.target.value as '' | 'activas' | 'inactivas')} style={{ ...inputStyle, width: '130px' }}>
          <option value="">Todas</option>
          <option value="activas">Activas</option>
          <option value="inactivas">Inactivas</option>
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar área' : 'Nueva área de limpieza'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Área *</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Piscina, Lobby, Gimnasio" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Frecuencia</label>
              <select style={inputStyle} value={form.frecuencia} onChange={e => setF('frecuencia', e.target.value)}>
                {Object.entries(FRECUENCIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Responsable</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Nombre o empresa" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Última ejecución</label>
              <input style={inputStyle} type="date" value={form.ultima_ejecucion} onChange={e => setF('ultima_ejecucion', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Próxima ejecución</label>
              <input style={inputStyle} type="date" value={form.proxima_ejecucion} onChange={e => setF('proxima_ejecucion', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo} onChange={e => setF('activo', e.target.value)}>
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Instrucciones especiales, productos, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🧹</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin áreas de limpieza programadas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {filtered.map(p => {
            const alerta = getAlerta(p)
            const al = ALERTA_STYLE[alerta]
            const fr = FRECUENCIA_LABEL[p.frecuencia]
            return (
              <div key={p.id} style={{ background: p.activo ? al.bg : 'var(--at-surface-2)', border: `1.5px solid ${p.activo ? al.border : 'var(--at-line)'}`, borderRadius: '12px', padding: '16px', opacity: p.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>🧹 {p.area}</div>
                    {p.responsable && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>👤 {p.responsable}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                    {canEdit && <button onClick={() => openEdit(p)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>}
                    <button onClick={() => handleDelete(p)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)' }}>🗑</button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: fr.bg, color: fr.color }}>{fr.label}</span>
                  {p.activo && <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: al.badgeBg, color: al.badge }}>{al.label}</span>}
                  {!p.activo && <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>Inactiva</span>}
                </div>

                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                  <div>Última: {p.ultima_ejecucion ?? '—'}</div>
                  <div style={{ fontWeight: p.proxima_ejecucion && getAlerta(p) === 'vencida' ? 700 : 400, color: getAlerta(p) === 'vencida' ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                    Próxima: {p.proxima_ejecucion ?? '—'}
                  </div>
                </div>

                {canEdit && p.activo && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => marcarEjecutada(p)} style={{ flex: 1, padding: '6px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>
                      ✓ Ejecutada hoy
                    </button>
                    <button onClick={() => toggleActivo(p)} style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)' }}>⏸</button>
                  </div>
                )}
                {canEdit && !p.activo && (
                  <button onClick={() => toggleActivo(p)} style={{ width: '100%', padding: '6px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>▶ Activar</button>
                )}
                {p.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '8px' }}>{p.notas}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
