import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ProgramacionLimpieza } from '../../../types'
import Swal from 'sweetalert2'

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
  diaria:    { label: 'Diaria',    bg: '#e0f2fe', color: '#0369a1' },
  semanal:   { label: 'Semanal',   bg: '#f3e8ff', color: '#7c3aed' },
  quincenal: { label: 'Quincenal', bg: '#fef3c7', color: '#92400e' },
  mensual:   { label: 'Mensual',   bg: '#dcfce7', color: '#16a34a' },
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0',
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
  vencida:   { bg: '#fee2e2', border: '#fca5a5', badge: '#ef4444', badgeBg: '#fee2e2', label: 'Vencida' },
  proxima:   { bg: '#fefce8', border: '#fde68a', badge: '#92400e', badgeBg: '#fef3c7', label: 'Próxima' },
  ok:        { bg: '#f0fdf4', border: '#bbf7d0', badge: '#16a34a', badgeBg: '#dcfce7', label: 'Al día' },
  sin_fecha: { bg: '#f8fafc', border: '#e2e8f0', badge: '#64748b', badgeBg: '#f1f5f9', label: 'Sin fecha' },
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
    if (!form.area.trim()) return Swal.fire('Campo requerido', 'El área es obligatoria.', 'warning')
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
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); onRefresh()
  }

  const marcarEjecutada = async (p: ProgramacionLimpieza) => {
    const hoy = new Date().toISOString().slice(0, 10)
    const proxima = addDays(hoy, FRECUENCIA_DIAS[p.frecuencia])
    const { error } = await supabase.from('programacion_limpieza').update({ ultima_ejecucion: hoy, proxima_ejecucion: proxima, estado: 'completado' }).eq('id', p.id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const toggleActivo = async (p: ProgramacionLimpieza) => {
    await supabase.from('programacion_limpieza').update({ activo: !p.activo }).eq('id', p.id)
    onRefresh()
  }

  const handleDelete = async (p: ProgramacionLimpieza) => {
    const r = await Swal.fire({ title: '¿Eliminar programación?', text: p.area, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' })
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
          { label: 'Vencidas', value: vencidas, icon: '🔴', bg: '#fee2e2', color: '#ef4444' },
          { label: 'Próximas (≤3d)', value: proximas, icon: '🟡', bg: '#fefce8', color: '#92400e' },
          { label: 'Al día', value: alDia, icon: '🟢', bg: '#f0fdf4', color: '#16a34a' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
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
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar área' : 'Nueva área de limpieza'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Área *</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Piscina, Lobby, Gimnasio" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Frecuencia</label>
              <select style={inputStyle} value={form.frecuencia} onChange={e => setF('frecuencia', e.target.value)}>
                {Object.entries(FRECUENCIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Responsable</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Nombre o empresa" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Última ejecución</label>
              <input style={inputStyle} type="date" value={form.ultima_ejecucion} onChange={e => setF('ultima_ejecucion', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Próxima ejecución</label>
              <input style={inputStyle} type="date" value={form.proxima_ejecucion} onChange={e => setF('proxima_ejecucion', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo} onChange={e => setF('activo', e.target.value)}>
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Instrucciones especiales, productos, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🧹</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>Sin áreas de limpieza programadas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {filtered.map(p => {
            const alerta = getAlerta(p)
            const al = ALERTA_STYLE[alerta]
            const fr = FRECUENCIA_LABEL[p.frecuencia]
            return (
              <div key={p.id} style={{ background: p.activo ? al.bg : '#f8fafc', border: `1.5px solid ${p.activo ? al.border : '#e2e8f0'}`, borderRadius: '12px', padding: '16px', opacity: p.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>🧹 {p.area}</div>
                    {p.responsable && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>👤 {p.responsable}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                    {canEdit && <button onClick={() => openEdit(p)} style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>}
                    <button onClick={() => handleDelete(p)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#ef4444' }}>🗑</button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: fr.bg, color: fr.color }}>{fr.label}</span>
                  {p.activo && <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: al.badgeBg, color: al.badge }}>{al.label}</span>}
                  {!p.activo && <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, background: '#f1f5f9', color: '#64748b' }}>Inactiva</span>}
                </div>

                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                  <div>Última: {p.ultima_ejecucion ?? '—'}</div>
                  <div style={{ fontWeight: p.proxima_ejecucion && getAlerta(p) === 'vencida' ? 700 : 400, color: getAlerta(p) === 'vencida' ? '#ef4444' : '#64748b' }}>
                    Próxima: {p.proxima_ejecucion ?? '—'}
                  </div>
                </div>

                {canEdit && p.activo && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => marcarEjecutada(p)} style={{ flex: 1, padding: '6px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>
                      ✓ Ejecutada hoy
                    </button>
                    <button onClick={() => toggleActivo(p)} style={{ padding: '6px 10px', background: '#fef2f2', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#ef4444' }}>⏸</button>
                  </div>
                )}
                {canEdit && !p.activo && (
                  <button onClick={() => toggleActivo(p)} style={{ width: '100%', padding: '6px', background: '#f0fdf4', color: '#16a34a', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>▶ Activar</button>
                )}
                {p.notas && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>{p.notas}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
