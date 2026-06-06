import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { TareaCondominio, CategoriaTareaCondominio, PrioridadTarea, EstadoTarea, ComentarioTarea } from '../../../types'

interface Props {
  tareas: TareaCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADOS: { value: EstadoTarea; label: string; color: string; bg: string }[] = [
  { value: 'pendiente',   label: 'Pendiente',   color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'en_proceso',  label: 'En proceso',  color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'completada',  label: 'Completada',  color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'cancelada',   label: 'Cancelada',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
]

const PRIORIDADES: { value: PrioridadTarea; label: string; color: string }[] = [
  { value: 'baja',    label: '🔵 Baja',    color: 'var(--at-primary-2)' },
  { value: 'media',   label: '🟡 Media',   color: 'var(--at-warning)' },
  { value: 'alta',    label: '🔴 Alta',    color: 'var(--at-danger)' },
  { value: 'urgente', label: '🚨 Urgente', color: 'var(--at-danger)' },
]

const CATEGORIAS: { value: CategoriaTareaCondominio; label: string }[] = [
  { value: 'operativa',      label: 'Operativa' },
  { value: 'mantenimiento',  label: 'Mantenimiento' },
  { value: 'administrativa', label: 'Administrativa' },
  { value: 'seguridad',      label: 'Seguridad' },
  { value: 'limpieza',       label: 'Limpieza' },
  { value: 'otro',           label: 'Otro' },
]

const FLUJO: EstadoTarea[] = ['pendiente', 'en_proceso', 'completada']

function diasRestantes(fecha?: string | null): number | null {
  if (!fecha) return null
  return Math.round((new Date(fecha).getTime() - Date.now()) / 86400000)
}

export default function TareasCondominioTab({ tareas, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<TareaCondominio | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoTarea | ''>('')
  const [filtroPrio, setFiltroPrio] = useState<PrioridadTarea | ''>('')

  const [form, setForm] = useState({
    titulo: '', descripcion: '', categoria: 'operativa' as CategoriaTareaCondominio,
    prioridad: 'media' as PrioridadTarea, asignado_a: '', reportado_por: '',
    area: '', fecha_inicio: '', fecha_limite: '', costo_estimado: '', notas: '',
  })

  const [comentario, setComentario] = useState({ autor: '', texto: '' })

  const lista = tareas.filter(t =>
    (filtroEstado === '' || t.estado === filtroEstado) &&
    (filtroPrio === '' || t.prioridad === filtroPrio)
  )

  const kpis = ESTADOS.map(s => ({ ...s, count: tareas.filter(t => t.estado === s.value).length }))
  const vencidas = tareas.filter(t => {
    const d = diasRestantes(t.fecha_limite)
    return d !== null && d < 0 && t.estado !== 'completada' && t.estado !== 'cancelada'
  })

  async function guardar() {
    if (!form.titulo.trim()) { notify({ variant: 'warning', title: 'Faltan datos', text: 'Título obligatorio' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('tareas_condominio', {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), descripcion: form.descripcion.trim() || null,
      categoria: form.categoria, prioridad: form.prioridad, estado: 'pendiente' as EstadoTarea,
      asignado_a: form.asignado_a.trim() || null, reportado_por: form.reportado_por.trim() || null,
      area: form.area.trim() || null,
      fecha_inicio: form.fecha_inicio || null, fecha_limite: form.fecha_limite || null,
      costo_estimado: form.costo_estimado ? parseFloat(form.costo_estimado) : null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ titulo: '', descripcion: '', categoria: 'operativa', prioridad: 'media', asignado_a: '', reportado_por: '', area: '', fecha_inicio: '', fecha_limite: '', costo_estimado: '', notas: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function avanzarEstado(t: TareaCondominio) {
    const idx = FLUJO.indexOf(t.estado)
    if (idx < 0 || idx >= FLUJO.length - 1) return
    const siguiente = FLUJO[idx + 1]
    const patch: Record<string, unknown> = { estado: siguiente }
    if (siguiente === 'completada') patch.fecha_cierre = new Date().toISOString().split('T')[0]
    const { error } = await updateCondominioRow('tareas_condominio', t.id, patch)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selected?.id === t.id) setSelected(prev => prev ? { ...prev, ...patch } as TareaCondominio : null)
    onRefresh()
  }

  async function cancelar(t: TareaCondominio) {
    const res = await confirm({ title: 'Cancelar tarea', text: '¿Seguro?', icon: 'warning', confirmText: 'Cancelar tarea' })
    if (!res.isConfirmed) return
    await updateCondominioRow('tareas_condominio', t.id, { estado: 'cancelada' as EstadoTarea })
    if (selected?.id === t.id) setSelected(prev => prev ? { ...prev, estado: 'cancelada' } as TareaCondominio : null)
    onRefresh()
  }

  async function agregarComentario(t: TareaCondominio) {
    if (!comentario.texto.trim()) return
    const nuevo: ComentarioTarea = {
      fecha: new Date().toISOString().split('T')[0],
      autor: comentario.autor.trim() || 'Admin',
      texto: comentario.texto.trim(),
    }
    const nuevos = [...t.comentarios, nuevo]
    const { error } = await updateCondominioRow('tareas_condominio', t.id, { comentarios: nuevos })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setSelected(prev => prev ? { ...prev, comentarios: nuevos } : null)
    setComentario({ autor: '', texto: '' })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Tareas ({lista.length})</span>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nueva
              </button>
            )}
          </div>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {kpis.map(k => (
              <div key={k.value} onClick={() => setFiltroEstado(filtroEstado === k.value ? '' : k.value)}
                style={{ textAlign: 'center', padding: '4px', borderRadius: 6, cursor: 'pointer', background: filtroEstado === k.value ? k.bg : 'var(--at-surface-2)', border: `1px solid ${filtroEstado === k.value ? k.color : 'var(--at-line)'}` }}>
                <div style={{ fontWeight: 700, color: k.color, fontSize: 14 }}>{k.count}</div>
                <div style={{ fontSize: 9, color: k.color }}>{k.label}</div>
              </div>
            ))}
          </div>
          <select style={inp} value={filtroPrio} onChange={e => setFiltroPrio(e.target.value as PrioridadTarea | '')}>
            <option value="">Todas las prioridades</option>
            {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {vencidas.length > 0 && (
          <div style={{ padding: '6px 12px', background: 'var(--at-danger-tint)', borderBottom: '1px solid var(--at-danger-border)', fontSize: 12, color: 'var(--at-danger)' }}>
            🔴 {vencidas.length} tarea(s) vencida(s)
          </div>
        )}

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin tareas</div>}

        {lista.map(t => {
          const est = ESTADOS.find(s => s.value === t.estado)
          const prio = PRIORIDADES.find(p => p.value === t.prioridad)
          const dias = diasRestantes(t.fecha_limite)
          const vencida = dias !== null && dias < 0 && t.estado !== 'completada' && t.estado !== 'cancelada'
          return (
            <div key={t.id} onClick={() => { setSelected(t); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === t.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', borderLeft: vencida ? '3px solid var(--at-danger)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1, marginRight: 8 }}>{t.titulo}</span>
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: est?.bg, color: est?.color, flexShrink: 0 }}>{est?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: prio?.color }}>{prio?.label}</span>
                {t.asignado_a && <span>→ {t.asignado_a}</span>}
              </div>
              {t.fecha_limite && (
                <div style={{ fontSize: 11, color: vencida ? 'var(--at-danger)' : dias !== null && dias <= 3 ? 'var(--at-warning)' : 'var(--at-ink-3)', marginTop: 2 }}>
                  {vencida ? `⚠️ Vencida hace ${Math.abs(dias!)} días` : dias === 0 ? '⏰ Vence hoy' : `Vence: ${t.fecha_limite}`}
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
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nueva tarea</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Título *</label>
                <input style={inp} placeholder="Descripción breve de la tarea" value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaTareaCondominio }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Prioridad</label>
                <select style={inp} value={form.prioridad} onChange={e => setForm(p => ({ ...p, prioridad: e.target.value as PrioridadTarea }))}>
                  {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Área</label>
                <input style={inp} placeholder="Piscina, lobby…" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Asignado a</label>
                <input style={inp} value={form.asignado_a} onChange={e => setForm(p => ({ ...p, asignado_a: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Reportado por</label>
                <input style={inp} value={form.reportado_por} onChange={e => setForm(p => ({ ...p, reportado_por: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Costo estimado ({moneda})</label>
                <input type="number" style={inp} value={form.costo_estimado} onChange={e => setForm(p => ({ ...p, costo_estimado: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha inicio</label>
                <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha límite</label>
                <input type="date" style={inp} value={form.fecha_limite} onChange={e => setForm(p => ({ ...p, fecha_limite: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Descripción</label>
                <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Crear tarea'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const est = ESTADOS.find(s => s.value === selected.estado)
          const prio = PRIORIDADES.find(p => p.value === selected.prioridad)
          const dias = diasRestantes(selected.fecha_limite)
          const idx = FLUJO.indexOf(selected.estado)
          const siguiente = idx >= 0 && idx < FLUJO.length - 1 ? FLUJO[idx + 1] : null
          const siguienteLabel = siguiente ? ESTADOS.find(s => s.value === siguiente)?.label : null
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.titulo}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ padding: '3px 10px', borderRadius: 10, background: est?.bg, color: est?.color, fontSize: 12, fontWeight: 600 }}>{est?.label}</span>
                    <span style={{ fontSize: 12, color: prio?.color, fontWeight: 600 }}>{prio?.label}</span>
                    {selected.area && <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>📍 {selected.area}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {siguiente && (
                      <button onClick={() => avanzarEstado(selected)}
                        style={{ padding: '7px 14px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                        → {siguienteLabel}
                      </button>
                    )}
                    {selected.estado !== 'completada' && selected.estado !== 'cancelada' && (
                      <button onClick={() => cancelar(selected)}
                        style={{ padding: '7px 12px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
              </div>

              {dias !== null && selected.estado !== 'completada' && selected.estado !== 'cancelada' && (
                <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: dias < 0 ? 'var(--at-danger-tint)' : dias <= 3 ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', fontSize: 13, color: dias < 0 ? 'var(--at-danger)' : dias <= 3 ? 'var(--at-warning-strong)' : 'var(--at-success-strong)' }}>
                  {dias < 0 ? `⚠️ Vencida hace ${Math.abs(dias)} días` : dias === 0 ? '⏰ Vence hoy' : `✅ Vence en ${dias} días (${selected.fecha_limite})`}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Asignado a', value: selected.asignado_a || '—' },
                  { label: 'Reportado por', value: selected.reportado_por || '—' },
                  { label: 'Fecha inicio', value: selected.fecha_inicio || '—' },
                  { label: 'Fecha límite', value: selected.fecha_limite || '—' },
                  { label: `Costo est. (${moneda})`, value: selected.costo_estimado?.toLocaleString() ?? '—' },
                  { label: `Costo real (${moneda})`, value: selected.costo_real?.toLocaleString() ?? '—' },
                ].map(d => (
                  <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 6, padding: '7px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{d.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</div>
                  </div>
                ))}
              </div>

              {selected.descripcion && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13 }}>
                  {selected.descripcion}
                </div>
              )}

              {/* Comentarios */}
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Comentarios ({selected.comentarios.length})</div>
              {selected.comentarios.map((c, i) => (
                <div key={i} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 2 }}>{c.autor} · {c.fecha}</div>
                  <div style={{ fontSize: 13 }}>{c.texto}</div>
                </div>
              ))}
              {canEdit && selected.estado !== 'cancelada' && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 80px', gap: 8, marginTop: 8 }}>
                  <input style={inp} placeholder="Nombre" value={comentario.autor} onChange={e => setComentario(p => ({ ...p, autor: e.target.value }))} />
                  <input style={inp} placeholder="Agregar comentario…" value={comentario.texto} onChange={e => setComentario(p => ({ ...p, texto: e.target.value }))} />
                  <button onClick={() => agregarComentario(selected)}
                    style={{ padding: '7px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                    + Agregar
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona una tarea o crea una nueva
          </div>
        )}
      </div>
    </div>
  )
}
