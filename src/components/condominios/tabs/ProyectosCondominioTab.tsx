import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { ProyectoCondominio, CategoriaProyectoCond, EstadoProyectoCond } from '../../../types'

interface Props {
  proyectos: ProyectoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CAT_CFG: Record<CategoriaProyectoCond, { label: string; icon: string; color: string }> = {
  mejora:        { label: 'Mejora',        icon: '🏗️', color: 'var(--at-primary-hover)' },
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', color: 'var(--at-warning)' },
  seguridad:     { label: 'Seguridad',     icon: '🛡️', color: 'var(--at-accent-hover)' },
  tecnologia:    { label: 'Tecnología',    icon: '💻', color: 'var(--at-primary-hover)' },
  otro:          { label: 'Otro',          icon: '📌', color: 'var(--at-ink-3)' },
}
const ESTADO_CFG: Record<EstadoProyectoCond, { label: string; bg: string; color: string; barColor: string }> = {
  planificado:  { label: 'Planificado',  bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', barColor: 'var(--at-accent-2)' },
  en_progreso:  { label: 'En progreso',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning)', barColor: 'var(--at-warning)' },
  pausado:      { label: 'Pausado',      bg: 'var(--at-chip)', color: 'var(--at-ink-3)', barColor: 'var(--at-line-strong)' },
  completado:   { label: 'Completado',   bg: 'var(--at-success-tint)', color: 'var(--at-success)', barColor: 'var(--at-success)' },
  cancelado:    { label: 'Cancelado',    bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', barColor: 'var(--at-danger-border)' },
}

const BLANK = {
  nombre: '', descripcion: '', categoria: 'mejora' as CategoriaProyectoCond,
  estado: 'planificado' as EstadoProyectoCond, responsable: '',
  fecha_inicio: '', fecha_fin_estimada: '',
  porcentaje_avance: '0', presupuesto: '', costo_real: '', notas: '',
}

export default function ProyectosCondominioTab({ proyectos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ProyectoCondominio | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoProyectoCond | ''>('')
  const [form, setForm] = useState(BLANK)

  const lista = proyectos.filter(p => !filtroEstado || p.estado === filtroEstado)
  const enProgreso = proyectos.filter(p => p.estado === 'en_progreso').length
  const totalPresupuesto = proyectos.reduce((s, p) => s + (p.presupuesto ?? 0), 0)
  const totalCostoReal = proyectos.reduce((s, p) => s + (p.costo_real ?? 0), 0)

  function abrirNuevo() { setForm(BLANK); setEditId(null); setMostrarForm(true) }
  function abrirEditar(p: ProyectoCondominio) {
    setForm({
      nombre: p.nombre, descripcion: p.descripcion ?? '',
      categoria: p.categoria, estado: p.estado, responsable: p.responsable ?? '',
      fecha_inicio: p.fecha_inicio ?? '', fecha_fin_estimada: p.fecha_fin_estimada ?? '',
      porcentaje_avance: String(p.porcentaje_avance),
      presupuesto: p.presupuesto ? String(p.presupuesto) : '',
      costo_real: p.costo_real ? String(p.costo_real) : '',
      notas: p.notas ?? '',
    })
    setEditId(p.id); setMostrarForm(true)
  }
  function cancelar() { setMostrarForm(false); setEditId(null) }

  async function guardar() {
    if (!form.nombre.trim()) { notify({ variant: 'warning', title: 'Error', text: 'El nombre es obligatorio' }); return }
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null,
      categoria: form.categoria, estado: form.estado,
      responsable: form.responsable.trim() || null,
      fecha_inicio: form.fecha_inicio || null, fecha_fin_estimada: form.fecha_fin_estimada || null,
      porcentaje_avance: Math.min(100, Math.max(0, parseInt(form.porcentaje_avance) || 0)),
      presupuesto: form.presupuesto ? parseFloat(form.presupuesto) : null,
      costo_real: form.costo_real ? parseFloat(form.costo_real) : null,
      notas: form.notas.trim() || null,
    }
    const { error } = editId
      ? await supabase.from('proyectos_condominio').update(payload).eq('id', editId)
      : await supabase.from('proyectos_condominio').insert(payload)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    cancelar(); onRefresh()
  }

  async function actualizarAvance(p: ProyectoCondominio) {
    const { value } = await Swal.fire({
      title: 'Actualizar avance',
      html: `<input id="pct" class="swal2-input" type="number" min="0" max="100" value="${p.porcentaje_avance}" style="font-size:14px">
             <p style="font-size:11px;color:var(--at-ink-3)">0–100%</p>`,
      showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const v = parseInt((document.getElementById('pct') as HTMLInputElement)?.value ?? '0')
        return Math.min(100, Math.max(0, v))
      },
    })
    if (value === undefined) return
    const nuevoEstado: EstadoProyectoCond = value === 100 ? 'completado' : p.estado === 'planificado' ? 'en_progreso' : p.estado
    await supabase.from('proyectos_condominio').update({ porcentaje_avance: value, estado: nuevoEstado }).eq('id', p.id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const { isConfirmed } = await Swal.fire({ title: '¿Eliminar proyecto?', icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!isConfirmed) return
    await supabase.from('proyectos_condominio').delete().eq('id', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'En progreso', val: enProgreso, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: 'Completados', val: proyectos.filter(p => p.estado === 'completado').length, bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Presupuesto total', val: `${moneda} ${totalPresupuesto.toFixed(2)}`, bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
          { label: 'Costo real', val: `${moneda} ${totalCostoReal.toFixed(2)}`, bg: totalCostoReal > totalPresupuesto && totalPresupuesto > 0 ? 'var(--at-danger-tint)' : 'var(--at-surface-2)', color: totalCostoReal > totalPresupuesto && totalPresupuesto > 0 ? 'var(--at-danger)' : 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['', 'planificado', 'en_progreso', 'pausado', 'completado', 'cancelado'] as (EstadoProyectoCond | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-primary-hover)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>
              {e === '' ? 'Todos' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={mostrarForm && !editId ? cancelar : abrirNuevo}
            style={{ padding: '8px 16px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm && !editId ? '✕ Cancelar' : '+ Nuevo proyecto'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>{editId ? 'Editar proyecto' : 'Nuevo proyecto interno'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Nombre *</label>
              <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Renovación áreas comunes Bloque A" />
            </div>
            <div>
              <label style={lbl}>Categoría</label>
              <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaProyectoCond }))}>
                {(Object.keys(CAT_CFG) as CategoriaProyectoCond[]).map(c => <option key={c} value={c}>{CAT_CFG[c].icon} {CAT_CFG[c].label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Descripción</label>
              <input style={inp} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Descripción breve del proyecto" />
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoProyectoCond }))}>
                {(Object.keys(ESTADO_CFG) as EstadoProyectoCond[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Responsable</label>
              <input style={inp} value={form.responsable} onChange={e => setForm(p => ({ ...p, responsable: e.target.value }))} placeholder="Nombre del responsable" />
            </div>
            <div>
              <label style={lbl}>Avance (%)</label>
              <input type="number" min={0} max={100} style={inp} value={form.porcentaje_avance} onChange={e => setForm(p => ({ ...p, porcentaje_avance: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha inicio</label>
              <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha fin estimada</label>
              <input type="date" style={inp} value={form.fecha_fin_estimada} onChange={e => setForm(p => ({ ...p, fecha_fin_estimada: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Presupuesto ({moneda})</label>
              <input type="number" step="0.01" style={inp} value={form.presupuesto} onChange={e => setForm(p => ({ ...p, presupuesto: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Costo real ({moneda})</label>
              <input type="number" step="0.01" style={inp} value={form.costo_real} onChange={e => setForm(p => ({ ...p, costo_real: e.target.value }))} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones, links, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={guardar} disabled={saving}
              style={{ padding: '8px 20px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              {saving ? 'Guardando…' : editId ? '💾 Actualizar' : '✅ Crear proyecto'}
            </button>
            <button onClick={cancelar} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista + Detalle */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏗️</div>
          Sin proyectos internos registrados
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lista.map(p => {
              const cat = CAT_CFG[p.categoria]
              const est = ESTADO_CFG[p.estado]
              const sobrePresupuesto = p.presupuesto && p.costo_real && p.costo_real > p.presupuesto
              return (
                <div key={p.id} onClick={() => setSelected(p === selected ? null : p)}
                  style={{ background: selected?.id === p.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', border: `1.5px solid ${selected?.id === p.id ? 'var(--at-primary-hover)' : 'var(--at-line)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 16 }}>{cat.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>{p.nombre}</span>
                        <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                        {sobrePresupuesto && <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontWeight: 700 }}>⚠ Sobre presupuesto</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                        {cat.label}
                        {p.responsable && ` · ${p.responsable}`}
                        {p.fecha_inicio && ` · Inicio: ${p.fecha_inicio}`}
                        {p.fecha_fin_estimada && ` → ${p.fecha_fin_estimada}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: est.color }}>{p.porcentaje_avance}%</div>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ background: 'var(--at-chip)', borderRadius: 20, height: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: est.barColor, width: `${p.porcentaje_avance}%`, borderRadius: 20, transition: 'width 0.3s' }} />
                  </div>
                  {(p.presupuesto || p.costo_real) && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--at-ink-3)' }}>
                      {p.presupuesto && <span>Presupuesto: <strong>{moneda} {p.presupuesto.toFixed(2)}</strong></span>}
                      {p.costo_real && <span>Real: <strong style={{ color: sobrePresupuesto ? 'var(--at-danger)' : 'var(--at-success)' }}>{moneda} {p.costo_real.toFixed(2)}</strong></span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 260, flexShrink: 0, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>{selected.nombre}</div>
              {selected.descripcion && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 10, lineHeight: 1.4 }}>{selected.descripcion}</div>}
              {[
                ['Categoría', `${CAT_CFG[selected.categoria].icon} ${CAT_CFG[selected.categoria].label}`],
                ['Estado', ESTADO_CFG[selected.estado].label],
                ['Avance', `${selected.porcentaje_avance}%`],
                ['Responsable', selected.responsable ?? '—'],
                ['Inicio', selected.fecha_inicio ?? '—'],
                ['Fin estimado', selected.fecha_fin_estimada ?? '—'],
                ['Presupuesto', selected.presupuesto ? `${moneda} ${selected.presupuesto.toFixed(2)}` : '—'],
                ['Costo real', selected.costo_real ? `${moneda} ${selected.costo_real.toFixed(2)}` : '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--at-chip)' }}>
                  <span style={{ color: 'var(--at-ink-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>{v}</span>
                </div>
              ))}
              {selected.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 8 }}>{selected.notas}</div>}
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button onClick={() => actualizarAvance(selected)}
                    style={{ flex: 1, padding: '7px 0', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    📊 Avance
                  </button>
                  <button onClick={() => abrirEditar(selected)}
                    style={{ flex: 1, padding: '7px 0', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    ✏️ Editar
                  </button>
                  <button onClick={() => eliminar(selected.id)}
                    style={{ padding: '7px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    🗑
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
