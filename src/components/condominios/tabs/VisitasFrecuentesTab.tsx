import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { VisitaFrecuente, RelacionVisitaFrecuente, Unidad } from '../../../types'

interface Props {
  visitas: VisitaFrecuente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const RELACIONES: { value: RelacionVisitaFrecuente; label: string; icon: string }[] = [
  { value: 'familiar',   label: 'Familiar',   icon: '👨‍👩‍👧' },
  { value: 'empleado',   label: 'Empleado',   icon: '👷' },
  { value: 'proveedor',  label: 'Proveedor',  icon: '🚚' },
  { value: 'amigo',      label: 'Amigo',      icon: '👋' },
  { value: 'otro',       label: 'Otro',       icon: '👤' },
]

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const DIAS_LABEL: Record<string, string> = { lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D' }

export default function VisitasFrecuentesTab({ visitas, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<VisitaFrecuente | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [soloActivos, setSoloActivos] = useState(true)

  const [form, setForm] = useState({
    unidad_id: '', nombre: '', identificacion: '',
    relacion: 'familiar' as RelacionVisitaFrecuente,
    telefono: '', placa_vehiculo: '', dias_permitidos: [] as string[],
    hora_desde: '', hora_hasta: '', notas: '',
  })

  const lista = visitas.filter(v =>
    (filtroUnidad === '' || v.unidad_id === filtroUnidad) &&
    (!soloActivos || v.activo)
  )

  // Group by unidad for display
  const porUnidad = lista.reduce<Record<string, VisitaFrecuente[]>>((acc, v) => {
    const key = v.unidad_id
    if (!acc[key]) acc[key] = []
    acc[key].push(v)
    return acc
  }, {})

  function toggleDia(dia: string) {
    setForm(p => ({
      ...p,
      dias_permitidos: p.dias_permitidos.includes(dia)
        ? p.dias_permitidos.filter(d => d !== dia)
        : [...p.dias_permitidos, dia],
    }))
  }

  async function guardar() {
    if (!form.unidad_id || !form.nombre.trim()) {
      Swal.fire('Faltan datos', 'Unidad y nombre son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('visitas_frecuentes').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id, nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      relacion: form.relacion,
      telefono: form.telefono.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      dias_permitidos: form.dias_permitidos.length > 0 ? form.dias_permitidos : null,
      hora_desde: form.hora_desde || null,
      hora_hasta: form.hora_hasta || null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ unidad_id: '', nombre: '', identificacion: '', relacion: 'familiar', telefono: '', placa_vehiculo: '', dias_permitidos: [], hora_desde: '', hora_hasta: '', notas: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function toggleActivo(v: VisitaFrecuente) {
    await supabase.from('visitas_frecuentes').update({ activo: !v.activo }).eq('id', v.id)
    onRefresh()
  }

  async function eliminar(v: VisitaFrecuente) {
    const res = await Swal.fire({ title: 'Eliminar visita frecuente', text: `¿Eliminar a ${v.nombre}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!res.isConfirmed) return
    await supabase.from('visitas_frecuentes').delete().eq('id', v.id)
    if (selected?.id === v.id) setSelected(null)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={{ ...inp, width: 'auto', padding: '6px 10px' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
            Solo activos
          </label>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} visitas frecuentes</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Agregar visita frecuente'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nueva visita frecuente</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Nombre *</label>
              <input style={inp} placeholder="Juan Pérez" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Relación</label>
              <select style={inp} value={form.relacion} onChange={e => setForm(p => ({ ...p, relacion: e.target.value as RelacionVisitaFrecuente }))}>
                {RELACIONES.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Identificación</label>
              <input style={inp} placeholder="DPI, Pasaporte…" value={form.identificacion} onChange={e => setForm(p => ({ ...p, identificacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Teléfono</label>
              <input style={inp} value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Placa vehículo</label>
              <input style={inp} value={form.placa_vehiculo} onChange={e => setForm(p => ({ ...p, placa_vehiculo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Hora permitida desde</label>
              <input type="time" style={inp} value={form.hora_desde} onChange={e => setForm(p => ({ ...p, hora_desde: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Hora permitida hasta</label>
              <input type="time" style={inp} value={form.hora_hasta} onChange={e => setForm(p => ({ ...p, hora_hasta: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
            </div>
          </div>
          {/* Días permitidos */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Días permitidos (dejar vacío = todos)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {DIAS.map(d => (
                <button key={d} type="button" onClick={() => toggleDia(d)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid', fontSize: 12, cursor: 'pointer', background: form.dias_permitidos.includes(d) ? 'var(--at-accent)' : '#fff', color: form.dias_permitidos.includes(d) ? '#fff' : 'var(--at-ink-2)', borderColor: form.dias_permitidos.includes(d) ? 'var(--at-accent)' : 'var(--at-line-strong)' }}>
                  {DIAS_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Guardar'}
          </button>
        </div>
      )}

      {/* Lista agrupada por unidad */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>Sin visitas frecuentes registradas</div>
      ) : (
        Object.entries(porUnidad).map(([unidadId, items]) => {
          const unidad = unidades.find(u => u.id === unidadId)
          return (
            <div key={unidadId} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink-2)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--at-line)' }}>
                🏠 {unidad?.nombre || 'Unidad desconocida'} — {items.length} autorizado(s)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {items.map(v => {
                  const rel = RELACIONES.find(r => r.value === v.relacion)
                  return (
                    <div key={v.id} style={{ background: v.activo ? '#fff' : 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '12px 14px', opacity: v.activo ? 1 : 0.6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{rel?.icon} {v.nombre}</div>
                          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                            {rel?.label}
                            {v.identificacion && <span> · {v.identificacion}</span>}
                          </div>
                          {v.telefono && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>📞 {v.telefono}</div>}
                          {v.placa_vehiculo && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>🚗 {v.placa_vehiculo}</div>}
                          {v.dias_permitidos && v.dias_permitidos.length > 0 && (
                            <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                              {DIAS.map(d => (
                                <span key={d} style={{ padding: '2px 5px', borderRadius: 4, fontSize: 10, background: v.dias_permitidos!.includes(d) ? 'var(--at-accent-tint)' : 'var(--at-chip)', color: v.dias_permitidos!.includes(d) ? 'var(--at-accent)' : 'var(--at-line-strong)', fontWeight: v.dias_permitidos!.includes(d) ? 700 : 400 }}>
                                  {DIAS_LABEL[d]}
                                </span>
                              ))}
                            </div>
                          )}
                          {(v.hora_desde || v.hora_hasta) && (
                            <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>⏰ {v.hora_desde || '00:00'} – {v.hora_hasta || '23:59'}</div>
                          )}
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button onClick={() => toggleActivo(v)} title={v.activo ? 'Desactivar' : 'Activar'}
                              style={{ padding: '4px 8px', background: v.activo ? 'var(--at-chip)' : '#d1fae5', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                              {v.activo ? '⏸' : '▶'}
                            </button>
                            <button onClick={() => eliminar(v)} title="Eliminar"
                              style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#ef4444' }}>
                              🗑
                            </button>
                          </div>
                        )}
                      </div>
                      {v.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 6, fontStyle: 'italic' }}>{v.notas}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
