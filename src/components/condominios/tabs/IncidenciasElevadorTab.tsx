import React, { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { IncidenciaElevador, TipoIncidenciaElevador, EstadoIncidenciaElevador } from '../../../types'

interface Props {
  registros: IncidenciaElevador[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoIncidenciaElevador; label: string; icon: string; color: string }[] = [
  { value: 'falla',                    label: 'Falla',              icon: '⚠️', color: '#ef4444' },
  { value: 'mantenimiento_preventivo', label: 'Mant. preventivo',  icon: '🔧', color: '#6366f1' },
  { value: 'mantenimiento_correctivo', label: 'Mant. correctivo',  icon: '🛠️', color: '#f59e0b' },
  { value: 'inspeccion_legal',         label: 'Inspección legal',  icon: '🏛️', color: '#10b981' },
  { value: 'otro',                     label: 'Otro',              icon: '📋', color: '#6b7280' },
]

const ESTADOS: { value: EstadoIncidenciaElevador; label: string; color: string; bg: string }[] = [
  { value: 'reportado',            label: 'Reportado',           color: '#6366f1', bg: '#eef2ff' },
  { value: 'en_atencion',          label: 'En atención',         color: '#f59e0b', bg: '#fef3c7' },
  { value: 'resuelto',             label: 'Resuelto',            color: '#10b981', bg: '#d1fae5' },
  { value: 'requiere_seguimiento', label: 'Req. seguimiento',    color: '#ef4444', bg: '#fef2f2' },
]

export default function IncidenciasElevadorTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<IncidenciaElevador | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroElevador, setFiltroElevador] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<TipoIncidenciaElevador | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoIncidenciaElevador | ''>('')

  const [form, setForm] = useState({
    elevador: 'Elevador 1',
    tipo: 'falla' as TipoIncidenciaElevador,
    descripcion: '',
    fecha: new Date().toISOString().split('T')[0],
    hora_inicio: '', hora_fin: '',
    empresa_servicio: '', tecnico: '',
    estado: 'reportado' as EstadoIncidenciaElevador,
    costo: '', proxima_inspeccion: '', observaciones: '',
  })

  const elevadores = [...new Set(registros.map(r => r.elevador))].sort()

  const lista = registros.filter(r =>
    (filtroElevador === '' || r.elevador === filtroElevador) &&
    (filtroTipo === '' || r.tipo === filtroTipo) &&
    (filtroEstado === '' || r.estado === filtroEstado)
  )

  const fallas = registros.filter(r => r.tipo === 'falla' && r.estado !== 'resuelto').length
  const proxInspecciones = registros.filter(r => r.proxima_inspeccion).sort((a, b) => a.proxima_inspeccion!.localeCompare(b.proxima_inspeccion!)).slice(0, 3)

  function duracion(ini: string | null | undefined, fin: string | null | undefined): string | null {
    if (!ini || !fin) return null
    const [ih, im] = ini.split(':').map(Number)
    const [fh, fm] = fin.split(':').map(Number)
    const minutos = (fh * 60 + fm) - (ih * 60 + im)
    if (minutos < 0) return null
    const h = Math.floor(minutos / 60)
    const m = minutos % 60
    return h > 0 ? `${h}h ${m}min` : `${m}min`
  }

  async function guardar() {
    if (!form.elevador.trim() || !form.descripcion.trim()) {
      Swal.fire('Faltan datos', 'Elevador y descripción son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('incidencias_elevador').insert({
      company_id: companyId, project_id: proyectoId,
      elevador: form.elevador.trim(), tipo: form.tipo,
      descripcion: form.descripcion.trim(), fecha: form.fecha,
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
      empresa_servicio: form.empresa_servicio.trim() || null,
      tecnico: form.tecnico.trim() || null,
      estado: form.estado,
      costo: form.costo ? parseFloat(form.costo) : null,
      proxima_inspeccion: form.proxima_inspeccion || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ elevador: 'Elevador 1', tipo: 'falla', descripcion: '', fecha: new Date().toISOString().split('T')[0], hora_inicio: '', hora_fin: '', empresa_servicio: '', tecnico: '', estado: 'reportado', costo: '', proxima_inspeccion: '', observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function avanzarEstado(r: IncidenciaElevador) {
    const flujo: EstadoIncidenciaElevador[] = ['reportado', 'en_atencion', 'resuelto']
    const idx = flujo.indexOf(r.estado)
    if (idx === -1 || idx >= flujo.length - 1) return
    const next = flujo[idx + 1]
    await supabase.from('incidencias_elevador').update({ estado: next }).eq('id', r.id)
    if (selected?.id === r.id) setSelected(prev => prev ? { ...prev, estado: next } : null)
    onRefresh()
  }

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 300, borderRight: '1px solid #e5e7eb', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Elevadores ({lista.length})</span>
              {fallas > 0 && <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 10, background: '#fef2f2', color: '#ef4444', fontWeight: 700 }}>{fallas} falla{fallas > 1 ? 's' : ''}</span>}
            </div>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroElevador} onChange={e => setFiltroElevador(e.target.value)}>
            <option value="">Todos los elevadores</option>
            {elevadores.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoIncidenciaElevador | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select style={inp} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoIncidenciaElevador | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>

        {proxInspecciones.length > 0 && (
          <div style={{ padding: '8px 12px', background: '#eef2ff', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>🏛️ Próximas inspecciones</div>
            {proxInspecciones.map(r => (
              <div key={r.id} style={{ fontSize: 11, color: '#374151', marginBottom: 2 }}>
                {r.elevador} · <strong>{r.proxima_inspeccion}</strong>
              </div>
            ))}
          </div>
        )}

        {lista.length === 0 && <div style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 16px', fontSize: 13 }}>Sin registros</div>}

        {lista.map(r => {
          const tipo = TIPOS.find(t => t.value === r.tipo)
          const est = ESTADOS.find(e => e.value === r.estado)
          return (
            <div key={r.id} onClick={() => { setSelected(r); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: selected?.id === r.id ? '#eef2ff' : '#fff', borderLeft: `3px solid ${tipo?.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{tipo?.icon} {r.elevador}</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{r.descripcion.length > 55 ? r.descripcion.slice(0, 55) + '…' : r.descripcion}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{r.fecha}{r.empresa_servicio ? ` · ${r.empresa_servicio}` : ''}</div>
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nueva incidencia de elevador</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Elevador *</label>
                <input style={inp} placeholder="Elevador 1, Torre A…" value={form.elevador} onChange={e => setForm(p => ({ ...p, elevador: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Tipo</label>
                <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoIncidenciaElevador }))}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Estado</label>
                <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoIncidenciaElevador }))}>
                  {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Descripción *</label>
                <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha</label>
                <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora inicio</label>
                <input type="time" style={inp} value={form.hora_inicio} onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora fin</label>
                <input type="time" style={inp} value={form.hora_fin} onChange={e => setForm(p => ({ ...p, hora_fin: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Empresa servicio</label>
                <input style={inp} value={form.empresa_servicio} onChange={e => setForm(p => ({ ...p, empresa_servicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Técnico</label>
                <input style={inp} value={form.tecnico} onChange={e => setForm(p => ({ ...p, tecnico: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Costo ({moneda})</label>
                <input type="number" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Próxima inspección</label>
                <input type="date" style={inp} value={form.proxima_inspeccion} onChange={e => setForm(p => ({ ...p, proxima_inspeccion: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Observaciones</label>
                <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Registrar'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const tipo = TIPOS.find(t => t.value === selected.tipo)
          const est = ESTADOS.find(e => e.value === selected.estado)
          const dur = duracion(selected.hora_inicio, selected.hora_fin)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: tipo?.color, fontWeight: 700, marginBottom: 4 }}>{tipo?.icon} {tipo?.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>🛗 {selected.elevador}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                    {selected.fecha}
                    {selected.hora_inicio && <span> · {selected.hora_inicio.slice(0, 5)}</span>}
                    {selected.hora_fin && <span>–{selected.hora_fin.slice(0, 5)}</span>}
                    {dur && <span style={{ color: '#6366f1' }}> · {dur}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, background: est?.bg, color: est?.color, fontWeight: 600 }}>{est?.label}</span>
              </div>

              <div style={{ background: '#f9fafb', borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
                {selected.descripcion}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {selected.empresa_servicio && (
                  <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>Empresa</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.empresa_servicio}</div>
                  </div>
                )}
                {selected.tecnico && (
                  <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>Técnico</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.tecnico}</div>
                  </div>
                )}
                {selected.costo != null && (
                  <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#16a34a' }}>Costo</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{moneda} {selected.costo.toLocaleString()}</div>
                  </div>
                )}
                {selected.proxima_inspeccion && (
                  <div style={{ background: '#eef2ff', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#6366f1' }}>Próx. inspección</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#6366f1' }}>{selected.proxima_inspeccion}</div>
                  </div>
                )}
              </div>

              {selected.observaciones && (
                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
                  {selected.observaciones}
                </div>
              )}

              {canEdit && selected.estado !== 'resuelto' && (
                <button onClick={() => avanzarEstado(selected)}
                  style={{ padding: '6px 14px', background: '#d1fae5', color: '#10b981', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                  ▶ {selected.estado === 'reportado' ? 'Atender' : 'Resolver'}
                </button>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#9ca3af', fontSize: 14 }}>
            Selecciona un registro o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}
