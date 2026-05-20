import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ProgramaActividad, CategoriaActividad, EstadoActividad } from '../../../types'

interface Props {
  actividades: ProgramaActividad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaActividad; label: string; icon: string; color: string }[] = [
  { value: 'recreativa',  label: 'Recreativa',  icon: '🎉', color: 'var(--at-accent)' },
  { value: 'deportiva',   label: 'Deportiva',   icon: '⚽', color: '#10b981' },
  { value: 'cultural',    label: 'Cultural',    icon: '🎭', color: 'var(--at-accent)' },
  { value: 'educativa',   label: 'Educativa',   icon: '📚', color: 'var(--at-primary-2)' },
  { value: 'salud',       label: 'Salud',       icon: '💪', color: '#ef4444' },
  { value: 'otro',        label: 'Otro',        icon: '📌', color: 'var(--at-ink-3)' },
]

const ESTADOS: { value: EstadoActividad; label: string; color: string; bg: string }[] = [
  { value: 'programada', label: 'Programada', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'activa',     label: 'Activa',     color: '#10b981', bg: '#d1fae5' },
  { value: 'completada', label: 'Completada', color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
  { value: 'cancelada',  label: 'Cancelada',  color: '#ef4444', bg: '#fef2f2' },
]

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const DIAS_LABEL: Record<string, string> = { lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D' }

export default function ProgramaActividadesTab({ actividades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<ProgramaActividad | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaActividad | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoActividad | ''>('activa')

  const [form, setForm] = useState({
    nombre: '', descripcion: '', categoria: 'recreativa' as CategoriaActividad,
    instructor: '', lugar: '', fecha_inicio: new Date().toISOString().split('T')[0],
    fecha_fin: '', hora_inicio: '', hora_fin: '', dias_semana: [] as string[],
    cupo_maximo: '', costo: '0', notas: '',
  })

  const lista = actividades.filter(a =>
    (filtroCategoria === '' || a.categoria === filtroCategoria) &&
    (filtroEstado === '' || a.estado === filtroEstado)
  )

  function toggleDia(dia: string) {
    setForm(p => ({
      ...p,
      dias_semana: p.dias_semana.includes(dia)
        ? p.dias_semana.filter(d => d !== dia)
        : [...p.dias_semana, dia],
    }))
  }

  function disponibilidad(a: ProgramaActividad) {
    if (!a.cupo_maximo) return null
    const pct = (a.inscritos / a.cupo_maximo) * 100
    return { pct, libre: a.cupo_maximo - a.inscritos }
  }

  async function guardar() {
    if (!form.nombre.trim() || !form.fecha_inicio) {
      Swal.fire('Faltan datos', 'Nombre y fecha de inicio son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('programa_actividades').insert({
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null,
      categoria: form.categoria,
      instructor: form.instructor.trim() || null,
      lugar: form.lugar.trim() || null,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin || null,
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
      dias_semana: form.dias_semana.length > 0 ? form.dias_semana : null,
      cupo_maximo: form.cupo_maximo ? parseInt(form.cupo_maximo) : null,
      costo: parseFloat(form.costo) || 0,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ nombre: '', descripcion: '', categoria: 'recreativa', instructor: '', lugar: '', fecha_inicio: new Date().toISOString().split('T')[0], fecha_fin: '', hora_inicio: '', hora_fin: '', dias_semana: [], cupo_maximo: '', costo: '0', notas: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(a: ProgramaActividad, estado: EstadoActividad) {
    await supabase.from('programa_actividades').update({ estado }).eq('id', a.id)
    if (selected?.id === a.id) setSelected(prev => prev ? { ...prev, estado } : null)
    onRefresh()
  }

  async function registrarInscripcion(a: ProgramaActividad) {
    if (a.cupo_maximo && a.inscritos >= a.cupo_maximo) {
      Swal.fire('Sin cupo', 'La actividad no tiene cupos disponibles', 'warning'); return
    }
    await supabase.from('programa_actividades').update({ inscritos: a.inscritos + 1 }).eq('id', a.id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 300, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Actividades ({lista.length})</span>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nueva
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaActividad | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <select style={inp} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoActividad | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin actividades</div>}

        {lista.map(a => {
          const cat = CATEGORIAS.find(c => c.value === a.categoria)
          const est = ESTADOS.find(e => e.value === a.estado)
          const disp = disponibilidad(a)
          return (
            <div key={a.id} onClick={() => { setSelected(a); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === a.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', borderLeft: `3px solid ${cat?.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cat?.icon} {a.nombre}</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: est?.bg, color: est?.color }}>{est?.label}</span>
              </div>
              {a.instructor && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>👤 {a.instructor}</div>}
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                {a.fecha_inicio}{a.fecha_fin ? ` → ${a.fecha_fin}` : ''}
                {a.hora_inicio && <span> · {a.hora_inicio.slice(0, 5)}{a.hora_fin ? `–${a.hora_fin.slice(0, 5)}` : ''}</span>}
              </div>
              {disp !== null && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ height: 4, background: 'var(--at-line)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(disp.pct, 100)}%`, background: disp.pct >= 100 ? '#ef4444' : disp.pct >= 80 ? '#f59e0b' : '#10b981', transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 1 }}>{a.inscritos}/{a.cupo_maximo} inscritos</div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nueva actividad</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Nombre *</label>
                <input style={inp} placeholder="Clases de natación, Yoga matutino…" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaActividad }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Instructor</label>
                <input style={inp} value={form.instructor} onChange={e => setForm(p => ({ ...p, instructor: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Lugar</label>
                <input style={inp} placeholder="Piscina, Gimnasio…" value={form.lugar} onChange={e => setForm(p => ({ ...p, lugar: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Costo ({moneda})</label>
                <input type="number" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha inicio *</label>
                <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha fin</label>
                <input type="date" style={inp} value={form.fecha_fin} onChange={e => setForm(p => ({ ...p, fecha_fin: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Cupo máximo</label>
                <input type="number" style={inp} placeholder="Sin límite" value={form.cupo_maximo} onChange={e => setForm(p => ({ ...p, cupo_maximo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora inicio</label>
                <input type="time" style={inp} value={form.hora_inicio} onChange={e => setForm(p => ({ ...p, hora_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Hora fin</label>
                <input type="time" style={inp} value={form.hora_fin} onChange={e => setForm(p => ({ ...p, hora_fin: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Descripción</label>
                <textarea style={{ ...inp, height: 60, resize: 'vertical' }} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Días de la semana</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DIAS.map(d => (
                    <button key={d} type="button" onClick={() => toggleDia(d)}
                      style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid', fontSize: 12, cursor: 'pointer', background: form.dias_semana.includes(d) ? 'var(--at-accent)' : 'var(--at-surface)', color: form.dias_semana.includes(d) ? 'white' : 'var(--at-ink-2)', borderColor: form.dias_semana.includes(d) ? 'var(--at-accent)' : 'var(--at-line-strong)' }}>
                      {DIAS_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Notas</label>
                <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Crear actividad'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const cat = CATEGORIAS.find(c => c.value === selected.categoria)
          const est = ESTADOS.find(e => e.value === selected.estado)
          const disp = disponibilidad(selected)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: cat?.color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>{cat?.icon} {cat?.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{selected.nombre}</div>
                  {selected.instructor && <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 4 }}>👤 {selected.instructor}</div>}
                  {selected.lugar && <div style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>📍 {selected.lugar}</div>}
                </div>
                <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, background: est?.bg, color: est?.color, fontWeight: 600 }}>{est?.label}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Período</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.fecha_inicio}{selected.fecha_fin ? ` → ${selected.fecha_fin}` : ''}</div>
                </div>
                {(selected.hora_inicio || selected.hora_fin) && (
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Horario</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.hora_inicio?.slice(0, 5) || '—'} – {selected.hora_fin?.slice(0, 5) || '—'}</div>
                  </div>
                )}
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Costo</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.costo === 0 ? 'Gratuita' : `${moneda} ${selected.costo.toLocaleString()}`}</div>
                </div>
              </div>

              {selected.dias_semana && selected.dias_semana.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Días</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {DIAS.map(d => (
                      <span key={d} style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, background: selected.dias_semana!.includes(d) ? 'var(--at-accent-tint)' : 'var(--at-chip)', color: selected.dias_semana!.includes(d) ? 'var(--at-accent)' : 'var(--at-line-strong)', fontWeight: selected.dias_semana!.includes(d) ? 700 : 400 }}>
                        {DIAS_LABEL[d]}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {disp !== null && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Inscritos</span>
                    <span style={{ fontSize: 13, color: disp.pct >= 100 ? '#ef4444' : 'var(--at-ink-2)' }}>{selected.inscritos} / {selected.cupo_maximo}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--at-line)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ height: '100%', width: `${Math.min(disp.pct, 100)}%`, background: disp.pct >= 100 ? '#ef4444' : disp.pct >= 80 ? '#f59e0b' : '#10b981' }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{disp.libre > 0 ? `${disp.libre} cupos disponibles` : 'Sin cupos disponibles'}</div>
                </div>
              )}

              {selected.descripcion && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.6 }}>
                  {selected.descripcion}
                </div>
              )}

              {selected.notas && (
                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e' }}>
                  <strong>Nota: </strong>{selected.notas}
                </div>
              )}

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.estado === 'programada' && (
                    <button onClick={() => cambiarEstado(selected, 'activa')}
                      style={{ padding: '6px 14px', background: '#d1fae5', color: '#10b981', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ▶ Iniciar
                    </button>
                  )}
                  {selected.estado === 'activa' && (
                    <>
                      <button onClick={() => registrarInscripcion(selected)}
                        style={{ padding: '6px 14px', background: 'var(--at-accent-tint)', color: 'var(--at-accent)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                        + Inscribir
                      </button>
                      <button onClick={() => cambiarEstado(selected, 'completada')}
                        style={{ padding: '6px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                        ✓ Completar
                      </button>
                    </>
                  )}
                  {(selected.estado === 'programada' || selected.estado === 'activa') && (
                    <button onClick={() => cambiarEstado(selected, 'cancelada')}
                      style={{ padding: '6px 14px', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✕ Cancelar
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona una actividad o crea una nueva
          </div>
        )}
      </div>
    </div>
  )
}
