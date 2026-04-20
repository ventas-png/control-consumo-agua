import React, { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { BitacoraGuardia, TurnoGuardia, EstadoBitacoraGuardia, TipoNovedadGuardia, NovedadGuardia } from '../../../types'

interface Props {
  registros: BitacoraGuardia[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TURNOS: { value: TurnoGuardia; label: string; color: string }[] = [
  { value: 'mañana', label: '🌅 Mañana', color: '#f59e0b' },
  { value: 'tarde', label: '🌆 Tarde', color: '#6366f1' },
  { value: 'noche', label: '🌙 Noche', color: '#1e293b' },
]

const TIPOS_NOV: { value: TipoNovedadGuardia; label: string; color: string }[] = [
  { value: 'normal', label: 'Normal', color: '#6b7280' },
  { value: 'informativo', label: 'Informativo', color: '#3b82f6' },
  { value: 'urgente', label: 'Urgente', color: '#ef4444' },
]

export default function BitacoraGuardiaTab({ registros, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().split('T')[0]
  const [selected, setSelected] = useState<BitacoraGuardia | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form
  const [form, setForm] = useState({
    fecha: hoy,
    turno: 'mañana' as TurnoGuardia,
    guardia_nombre: '',
    hora_inicio: '',
    hora_fin: '',
    observaciones: '',
  })
  const [novedades, setNovedades] = useState<NovedadGuardia[]>([])
  const [novForm, setNovForm] = useState({ hora: '', descripcion: '', tipo: 'normal' as TipoNovedadGuardia })

  // Edición de novedades en detalle
  const [novDetalle, setNovDetalle] = useState({ hora: '', descripcion: '', tipo: 'normal' as TipoNovedadGuardia })

  function addNovedad() {
    if (!novForm.descripcion.trim()) return
    setNovedades(prev => [...prev, { ...novForm, hora: novForm.hora || new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) }])
    setNovForm({ hora: '', descripcion: '', tipo: 'normal' })
  }

  function removeNovedad(i: number) { setNovedades(prev => prev.filter((_, idx) => idx !== i)) }

  async function guardar() {
    if (!form.guardia_nombre.trim()) { Swal.fire('Faltan datos', 'Nombre del guardia obligatorio', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('bitacora_guardia').insert({
      company_id: companyId,
      project_id: proyectoId,
      fecha: form.fecha,
      turno: form.turno,
      guardia_nombre: form.guardia_nombre.trim(),
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
      novedades,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ fecha: hoy, turno: 'mañana', guardia_nombre: '', hora_inicio: '', hora_fin: '', observaciones: '' })
    setNovedades([])
    setMostrarForm(false)
    onRefresh()
  }

  async function cerrarTurno(b: BitacoraGuardia) {
    const res = await Swal.fire({ title: 'Cerrar turno', text: '¿Marcar bitácora como cerrada?', icon: 'question', showCancelButton: true, confirmButtonText: 'Cerrar turno' })
    if (!res.isConfirmed) return
    const { error } = await supabase.from('bitacora_guardia').update({ estado: 'cerrado' as EstadoBitacoraGuardia }).eq('id', b.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    if (selected?.id === b.id) setSelected(prev => prev ? { ...prev, estado: 'cerrado' } : null)
    onRefresh()
  }

  async function agregarNovedadDetalle(b: BitacoraGuardia) {
    if (!novDetalle.descripcion.trim()) return
    const nueva: NovedadGuardia = { ...novDetalle, hora: novDetalle.hora || new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) }
    const nuevas = [...b.novedades, nueva]
    const { error } = await supabase.from('bitacora_guardia').update({ novedades: nuevas }).eq('id', b.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setSelected(prev => prev ? { ...prev, novedades: nuevas } : null)
    setNovDetalle({ hora: '', descripcion: '', tipo: 'normal' })
    onRefresh()
  }

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid #e5e7eb', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Bitácoras ({registros.length})</span>
          {canCreate && (
            <button onClick={() => { setMostrarForm(true); setSelected(null) }}
              style={{ padding: '5px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              + Nuevo turno
            </button>
          )}
        </div>
        {registros.length === 0 && (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 16px', fontSize: 13 }}>Sin bitácoras</div>
        )}
        {registros.map(b => {
          const turno = TURNOS.find(t => t.value === b.turno)
          return (
            <div key={b.id} onClick={() => { setSelected(b); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: selected?.id === b.id ? '#eef2ff' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{b.fecha}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: b.estado === 'cerrado' ? '#f3f4f6' : '#fef3c7', color: b.estado === 'cerrado' ? '#6b7280' : '#92400e' }}>
                  {b.estado === 'cerrado' ? 'Cerrado' : 'Abierto'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: turno?.color || '#6b7280', marginTop: 2 }}>{turno?.label}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{b.guardia_nombre} · {b.novedades.length} novedades</div>
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Formulario nuevo */}
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo turno de guardia</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Fecha</label>
                <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Turno</label>
                <select style={inp} value={form.turno} onChange={e => setForm(p => ({ ...p, turno: e.target.value as TurnoGuardia }))}>
                  {TURNOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Nombre del guardia *</label>
                <input style={inp} placeholder="Carlos Méndez" value={form.guardia_nombre} onChange={e => setForm(p => ({ ...p, guardia_nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora inicio</label>
                <input type="time" style={inp} value={form.hora_inicio} onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora fin</label>
                <input type="time" style={inp} value={form.hora_fin} onChange={e => setForm(p => ({ ...p, hora_fin: e.target.value }))} />
              </div>
            </div>
            {/* Novedades */}
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Novedades del turno</div>
              {novedades.map((n, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: '#fff', borderRadius: 6, marginBottom: 6, border: '1px solid #e5e7eb' }}>
                  <div>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: TIPOS_NOV.find(t => t.value === n.tipo)?.color, color: '#fff', marginRight: 6 }}>{n.tipo}</span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{n.hora}</span>
                    <span style={{ fontSize: 13, marginLeft: 8 }}>{n.descripcion}</span>
                  </div>
                  <button onClick={() => removeNovedad(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px 80px', gap: 8, marginTop: 8 }}>
                <input type="time" style={inp} placeholder="Hora" value={novForm.hora} onChange={e => setNovForm(p => ({ ...p, hora: e.target.value }))} />
                <input style={inp} placeholder="Descripción de la novedad" value={novForm.descripcion} onChange={e => setNovForm(p => ({ ...p, descripcion: e.target.value }))} />
                <select style={inp} value={novForm.tipo} onChange={e => setNovForm(p => ({ ...p, tipo: e.target.value as TipoNovedadGuardia }))}>
                  {TIPOS_NOV.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button onClick={addNovedad} style={{ padding: '7px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+ Agregar</button>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Observaciones generales</label>
              <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Guardar turno'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Detalle */}
        {!mostrarForm && selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.fecha} — {TURNOS.find(t => t.value === selected.turno)?.label}</div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                  Guardia: {selected.guardia_nombre}
                  {selected.hora_inicio && ` · ${selected.hora_inicio} – ${selected.hora_fin || '?'}`}
                </div>
              </div>
              {canEdit && selected.estado === 'abierto' && (
                <button onClick={() => cerrarTurno(selected)}
                  style={{ padding: '7px 14px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                  🔒 Cerrar turno
                </button>
              )}
            </div>

            <div style={{ background: '#f9fafb', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Novedades ({selected.novedades.length})</div>
              {selected.novedades.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>Sin novedades registradas</div>}
              {selected.novedades.map((n, i) => {
                const tipo = TIPOS_NOV.find(t => t.value === n.tipo)
                return (
                  <div key={i} style={{ padding: '8px 10px', background: '#fff', borderRadius: 6, marginBottom: 6, border: `1px solid ${tipo?.color}30`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, background: tipo?.color, color: '#fff', fontSize: 11, flexShrink: 0 }}>{tipo?.label}</span>
                    <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{n.hora}</span>
                    <span style={{ fontSize: 13 }}>{n.descripcion}</span>
                  </div>
                )
              })}
              {canEdit && selected.estado === 'abierto' && (
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '80px 1fr 110px 80px', gap: 8 }}>
                  <input type="time" style={inp} value={novDetalle.hora} onChange={e => setNovDetalle(p => ({ ...p, hora: e.target.value }))} />
                  <input style={inp} placeholder="Nueva novedad…" value={novDetalle.descripcion} onChange={e => setNovDetalle(p => ({ ...p, descripcion: e.target.value }))} />
                  <select style={inp} value={novDetalle.tipo} onChange={e => setNovDetalle(p => ({ ...p, tipo: e.target.value as TipoNovedadGuardia }))}>
                    {TIPOS_NOV.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <button onClick={() => agregarNovedadDetalle(selected)}
                    style={{ padding: '7px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                    + Agregar
                  </button>
                </div>
              )}
            </div>

            {selected.observaciones && (
              <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: '#92400e' }}>Observaciones</div>
                <div style={{ fontSize: 13 }}>{selected.observaciones}</div>
              </div>
            )}
          </div>
        )}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#9ca3af', fontSize: 14 }}>
            Selecciona una bitácora o crea un nuevo turno
          </div>
        )}
      </div>
    </div>
  )
}
