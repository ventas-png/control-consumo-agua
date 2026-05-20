import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { PresenciaPersonal, EstadoPresencia } from '../../../types'

interface Props {
  registros: PresenciaPersonal[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADOS_PRESENCIA: { value: EstadoPresencia; label: string; color: string; bg: string }[] = [
  { value: 'presente', label: 'Presente', color: '#10b981', bg: '#d1fae5' },
  { value: 'ausente', label: 'Ausente', color: '#ef4444', bg: '#fee2e2' },
  { value: 'tardanza', label: 'Tardanza', color: '#f59e0b', bg: '#fef3c7' },
  { value: 'permiso', label: 'Permiso', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'vacaciones', label: 'Vacaciones', color: 'var(--at-primary-2)', bg: 'var(--at-primary-soft)' },
]

export default function PresenciaPersonalTab({ registros, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().split('T')[0]
  const [fechaFiltro, setFechaFiltro] = useState(hoy)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    nombre: '',
    cargo: '',
    fecha: hoy,
    hora_entrada: '',
    hora_salida: '',
    estado: 'presente' as EstadoPresencia,
    observaciones: '',
  })

  const registrosDia = registros.filter(r => r.fecha === fechaFiltro)

  const contadores = ESTADOS_PRESENCIA.reduce((acc, s) => {
    acc[s.value] = registrosDia.filter(r => r.estado === s.value).length
    return acc
  }, {} as Record<EstadoPresencia, number>)

  async function guardar() {
    if (!form.nombre.trim()) { Swal.fire('Faltan datos', 'Nombre obligatorio', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('presencia_personal').insert({
      company_id: companyId,
      project_id: proyectoId,
      nombre: form.nombre.trim(),
      cargo: form.cargo.trim() || null,
      fecha: form.fecha,
      hora_entrada: form.hora_entrada || null,
      hora_salida: form.hora_salida || null,
      estado: form.estado,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ nombre: '', cargo: '', fecha: hoy, hora_entrada: '', hora_salida: '', estado: 'presente', observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function actualizarEstado(id: string, estado: EstadoPresencia) {
    const { error } = await supabase.from('presencia_personal').update({ estado }).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function registrarSalida(id: string) {
    const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    const { error } = await supabase.from('presencia_personal').update({ hora_salida: hora }).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--at-ink-2)' }}>Fecha:</span>
          <input type="date" value={fechaFiltro} onChange={e => setFechaFiltro(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '6px 10px' }} />
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Registrar persona'}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {ESTADOS_PRESENCIA.map(s => (
          <div key={s.value} style={{ background: s.bg, borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{contadores[s.value] || 0}</div>
            <div style={{ fontSize: 11, color: s.color }}>{s.label}</div>
          </div>
        ))}
        <div style={{ background: 'var(--at-chip)', borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-ink-2)' }}>{registrosDia.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Total</div>
        </div>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Registrar asistencia</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Nombre *</label>
              <input style={inp} placeholder="Juan Pérez" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Cargo</label>
              <input style={inp} placeholder="Guardia, Conserje…" value={form.cargo} onChange={e => setForm(p => ({ ...p, cargo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha</label>
              <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoPresencia }))}>
                {ESTADOS_PRESENCIA.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Hora entrada</label>
              <input type="time" style={inp} value={form.hora_entrada} onChange={e => setForm(p => ({ ...p, hora_entrada: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Hora salida</label>
              <input type="time" style={inp} value={form.hora_salida} onChange={e => setForm(p => ({ ...p, hora_salida: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Observaciones</label>
            <input style={inp} placeholder="Opcional" value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Guardar'}
          </button>
        </div>
      )}

      {/* Lista del día */}
      {registrosDia.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          Sin registros para {fechaFiltro}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {registrosDia.map(r => {
            const est = ESTADOS_PRESENCIA.find(s => s.value === r.estado)
            const horasTotal = r.hora_entrada && r.hora_salida
              ? (() => {
                  const [hE, mE] = r.hora_entrada.split(':').map(Number)
                  const [hS, mS] = r.hora_salida.split(':').map(Number)
                  const mins = (hS * 60 + mS) - (hE * 60 + mE)
                  return mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}min` : null
                })()
              : null
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 10, background: est?.bg, color: est?.color, fontSize: 12, fontWeight: 600 }}>{est?.label}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.nombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                      {r.cargo && <span>{r.cargo} · </span>}
                      {r.hora_entrada && <span>Entrada: {r.hora_entrada}</span>}
                      {r.hora_salida && <span> · Salida: {r.hora_salida}</span>}
                      {horasTotal && <span style={{ color: 'var(--at-accent)' }}> · {horasTotal}</span>}
                    </div>
                    {r.observaciones && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{r.observaciones}</div>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!r.hora_salida && r.estado === 'presente' && (
                      <button onClick={() => registrarSalida(r.id)}
                        style={{ padding: '5px 10px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                        Registrar salida
                      </button>
                    )}
                    <select value={r.estado} onChange={e => actualizarEstado(r.id, e.target.value as EstadoPresencia)}
                      style={{ padding: '4px 8px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
                      {ESTADOS_PRESENCIA.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
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
