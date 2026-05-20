import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { NotaAdmin, CategoriaNota, PrioridadNota } from '../../../types'

interface Props {
  notas: NotaAdmin[]
  proyectoId: string
  companyId: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaNota; label: string; icon: string; color: string }[] = [
  { value: 'general',       label: 'General',       icon: '📝', color: '#7E9389' },
  { value: 'urgente',       label: 'Urgente',       icon: '🚨', color: '#ef4444' },
  { value: 'recordatorio',  label: 'Recordatorio',  icon: '⏰', color: '#f59e0b' },
  { value: 'seguimiento',   label: 'Seguimiento',   icon: '🔄', color: '#B96A3F' },
  { value: 'reunion',       label: 'Reunión',       icon: '👥', color: '#10b981' },
  { value: 'otro',          label: 'Otro',          icon: '📌', color: '#B96A3F' },
]

const PRIORIDADES: { value: PrioridadNota; label: string; color: string; bg: string }[] = [
  { value: 'normal',  label: 'Normal',  color: '#7E9389', bg: '#EAE6D8' },
  { value: 'alta',    label: 'Alta',    color: '#f59e0b', bg: '#fef3c7' },
  { value: 'urgente', label: 'Urgente', color: '#ef4444', bg: '#fef2f2' },
]

export default function NotasAdminTab({ notas, proyectoId, companyId, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<NotaAdmin | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaNota | ''>('')
  const [filtroResuelta, setFiltroResuelta] = useState<'pendiente' | 'resuelta' | ''>('pendiente')
  const [editando, setEditando] = useState(false)

  const [form, setForm] = useState({
    titulo: '', contenido: '', categoria: 'general' as CategoriaNota,
    prioridad: 'normal' as PrioridadNota, fijada: false, fecha_recordatorio: '',
  })

  const fijadas = notas.filter(n => n.fijada && !n.resuelta)
  const lista = notas.filter(n =>
    !n.fijada &&
    (filtroCategoria === '' || n.categoria === filtroCategoria) &&
    (filtroResuelta === '' || (filtroResuelta === 'pendiente' ? !n.resuelta : n.resuelta))
  ).sort((a, b) => {
    const prioOrd: Record<PrioridadNota, number> = { urgente: 0, alta: 1, normal: 2 }
    return prioOrd[a.prioridad] - prioOrd[b.prioridad] || b.created_at.localeCompare(a.created_at)
  })

  function diasHastaRecordatorio(fecha: string | null | undefined): number | null {
    if (!fecha) return null
    const diff = new Date(fecha).getTime() - new Date().setHours(0, 0, 0, 0)
    return Math.ceil(diff / 86400000)
  }

  async function guardar() {
    if (!form.titulo.trim() || !form.contenido.trim()) {
      Swal.fire('Faltan datos', 'Título y contenido son obligatorios', 'warning'); return
    }
    setSaving(true)
    if (editando && selected) {
      const { error } = await supabase.from('notas_admin').update({
        titulo: form.titulo.trim(), contenido: form.contenido.trim(),
        categoria: form.categoria, prioridad: form.prioridad,
        fijada: form.fijada,
        fecha_recordatorio: form.fecha_recordatorio || null,
      }).eq('id', selected.id)
      setSaving(false)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
    } else {
      const { error } = await supabase.from('notas_admin').insert({
        company_id: companyId, project_id: proyectoId,
        titulo: form.titulo.trim(), contenido: form.contenido.trim(),
        categoria: form.categoria, prioridad: form.prioridad,
        fijada: form.fijada, autor: autorNombre || null,
        fecha_recordatorio: form.fecha_recordatorio || null,
      })
      setSaving(false)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
    }
    resetForm()
    onRefresh()
  }

  function resetForm() {
    setForm({ titulo: '', contenido: '', categoria: 'general', prioridad: 'normal', fijada: false, fecha_recordatorio: '' })
    setMostrarForm(false)
    setEditando(false)
  }

  async function toggleFijada(n: NotaAdmin) {
    await supabase.from('notas_admin').update({ fijada: !n.fijada }).eq('id', n.id)
    if (selected?.id === n.id) setSelected(prev => prev ? { ...prev, fijada: !prev.fijada } : null)
    onRefresh()
  }

  async function resolver(n: NotaAdmin) {
    const res = await Swal.fire({ title: 'Resolver nota', text: '¿Marcar como resuelta?', icon: 'question', showCancelButton: true, confirmButtonText: 'Resolver', confirmButtonColor: '#10b981' })
    if (!res.isConfirmed) return
    await supabase.from('notas_admin').update({ resuelta: true, fijada: false }).eq('id', n.id)
    if (selected?.id === n.id) setSelected(null)
    onRefresh()
  }

  async function eliminar(n: NotaAdmin) {
    const res = await Swal.fire({ title: 'Eliminar nota', text: '¿Eliminar esta nota?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!res.isConfirmed) return
    await supabase.from('notas_admin').delete().eq('id', n.id)
    if (selected?.id === n.id) setSelected(null)
    onRefresh()
  }

  function iniciarEdicion(n: NotaAdmin) {
    setForm({ titulo: n.titulo, contenido: n.contenido, categoria: n.categoria, prioridad: n.prioridad, fijada: n.fijada, fecha_recordatorio: n.fecha_recordatorio || '' })
    setEditando(true)
    setSelected(n)
    setMostrarForm(true)
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  function NotaCard({ n, highlight = false }: { n: NotaAdmin; highlight?: boolean }) {
    const cat = CATEGORIAS.find(c => c.value === n.categoria)
    const prio = PRIORIDADES.find(p => p.value === n.prioridad)
    const dias = diasHastaRecordatorio(n.fecha_recordatorio)
    return (
      <div onClick={() => { setSelected(n); setMostrarForm(false) }}
        style={{ background: highlight ? '#fffbeb' : n.resuelta ? '#FAF7EF' : '#fff', border: `1px solid ${selected?.id === n.id ? '#B96A3F' : highlight ? '#fde68a' : '#E1DDD0'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', opacity: n.resuelta ? 0.65 : 1, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }}>
            {n.fijada && <span title="Fijada">📌</span>}
            <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.titulo}</span>
          </div>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: prio?.bg, color: prio?.color, marginLeft: 6, flexShrink: 0 }}>{prio?.label}</span>
        </div>
        <div style={{ fontSize: 12, color: '#7E9389', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {n.contenido}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: cat?.color }}>{cat?.icon} {cat?.label}</span>
          {dias !== null && (
            <span style={{ fontSize: 10, color: dias < 0 ? '#ef4444' : dias === 0 ? '#f59e0b' : '#7E9389' }}>
              ⏰ {dias < 0 ? `Vencido ${Math.abs(dias)}d` : dias === 0 ? 'Hoy' : `En ${dias}d`}
            </span>
          )}
          {n.resuelta && <span style={{ fontSize: 10, color: '#10b981' }}>✓ Resuelta</span>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid #E1DDD0', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #E1DDD0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Notas ({notas.filter(n => !n.resuelta).length} activas)</span>
            {canCreate && (
              <button onClick={() => { resetForm(); setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nueva
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaNota | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <select style={inp} value={filtroResuelta} onChange={e => setFiltroResuelta(e.target.value as 'pendiente' | 'resuelta' | '')}>
            <option value="pendiente">Solo pendientes</option>
            <option value="resuelta">Solo resueltas</option>
            <option value="">Todas</option>
          </select>
        </div>

        <div style={{ padding: '10px 12px' }}>
          {fijadas.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>📌 Fijadas</div>
              {fijadas.map(n => <NotaCard key={n.id} n={n} highlight />)}
            </div>
          )}
          {lista.length === 0 && !fijadas.length && (
            <div style={{ textAlign: 'center', color: '#7E9389', padding: '32px 0', fontSize: 13 }}>Sin notas</div>
          )}
          {lista.map(n => <NotaCard key={n.id} n={n} />)}
        </div>
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{editando ? 'Editar nota' : 'Nueva nota'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Título *</label>
                <input style={inp} placeholder="Resumen de la nota" value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Contenido *</label>
                <textarea style={{ ...inp, height: 120, resize: 'vertical' }} value={form.contenido} onChange={e => setForm(p => ({ ...p, contenido: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaNota }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Prioridad</label>
                <select style={inp} value={form.prioridad} onChange={e => setForm(p => ({ ...p, prioridad: e.target.value as PrioridadNota }))}>
                  {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Recordatorio (fecha)</label>
                <input type="date" style={inp} value={form.fecha_recordatorio} onChange={e => setForm(p => ({ ...p, fecha_recordatorio: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                <input type="checkbox" id="fijada_check" checked={form.fijada} onChange={e => setForm(p => ({ ...p, fijada: e.target.checked }))} />
                <label htmlFor="fijada_check" style={{ fontSize: 13, cursor: 'pointer' }}>📌 Fijar nota</label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : `✅ ${editando ? 'Actualizar' : 'Crear nota'}`}
              </button>
              <button onClick={resetForm}
                style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const cat = CATEGORIAS.find(c => c.value === selected.categoria)
          const prio = PRIORIDADES.find(p => p.value === selected.prioridad)
          const dias = diasHastaRecordatorio(selected.fecha_recordatorio)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: cat?.color + '20', color: cat?.color }}>{cat?.icon} {cat?.label}</span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: prio?.bg, color: prio?.color }}>{prio?.label}</span>
                    {selected.fijada && <span style={{ fontSize: 11, color: '#f59e0b' }}>📌 Fijada</span>}
                    {selected.resuelta && <span style={{ fontSize: 11, color: '#10b981' }}>✓ Resuelta</span>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.titulo}</div>
                  <div style={{ fontSize: 12, color: '#7E9389', marginTop: 4 }}>
                    {selected.autor && <span>{selected.autor} · </span>}
                    {new Date(selected.created_at).toLocaleDateString('es-ES')}
                  </div>
                </div>
                {canEdit && !selected.resuelta && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => iniciarEdicion(selected)}
                      style={{ padding: '6px 12px', background: '#EAE6D8', color: '#3E5A4C', border: '1px solid #E1DDD0', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✏️ Editar
                    </button>
                    <button onClick={() => toggleFijada(selected)}
                      style={{ padding: '6px 12px', background: selected.fijada ? '#fef3c7' : '#EAE6D8', color: selected.fijada ? '#f59e0b' : '#3E5A4C', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      {selected.fijada ? '📌 Desfijar' : '📌 Fijar'}
                    </button>
                  </div>
                )}
              </div>

              {dias !== null && (
                <div style={{ background: dias < 0 ? '#fef2f2' : dias === 0 ? '#fef3c7' : '#F4EBE3', border: `1px solid ${dias < 0 ? '#fecaca' : dias === 0 ? '#fde68a' : '#E6CDBB'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>⏰</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: dias < 0 ? '#ef4444' : dias === 0 ? '#f59e0b' : '#B96A3F' }}>
                      {dias < 0 ? `Recordatorio vencido hace ${Math.abs(dias)} días` : dias === 0 ? 'Recordatorio: hoy' : `Recordatorio en ${dias} días`}
                    </div>
                    <div style={{ fontSize: 11, color: '#7E9389' }}>{selected.fecha_recordatorio}</div>
                  </div>
                </div>
              )}

              <div style={{ background: '#FAF7EF', borderRadius: 10, padding: '16px 20px', fontSize: 14, lineHeight: 1.7, color: '#3E5A4C', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
                {selected.contenido}
              </div>

              {canEdit && !selected.resuelta && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => resolver(selected)}
                    style={{ padding: '6px 14px', background: '#d1fae5', color: '#10b981', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    ✓ Resolver
                  </button>
                  <button onClick={() => eliminar(selected)}
                    style={{ padding: '6px 14px', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    🗑 Eliminar
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#7E9389', fontSize: 14 }}>
            Selecciona una nota o crea una nueva
          </div>
        )}
      </div>
    </div>
  )
}
