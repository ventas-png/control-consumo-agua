import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ArticuloManual, SeccionManual } from '../../../types'

interface Props {
  articulos: ArticuloManual[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const SECCIONES: { id: SeccionManual; label: string; icon: string }[] = [
  { id: 'amenidades', label: 'Amenidades',          icon: '🏊' },
  { id: 'normas',     label: 'Normas',              icon: '📋' },
  { id: 'faq',        label: 'Preguntas frecuentes',icon: '❓' },
  { id: 'contactos',  label: 'Contactos clave',     icon: '📞' },
  { id: 'otro',       label: 'Otro',                icon: '📌' },
]

const BLANK = { seccion: 'normas' as SeccionManual, titulo: '', contenido: '', orden: 0 }

export default function ManualResidenteTab({ articulos, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroSeccion, setFiltroSeccion] = useState<SeccionManual | ''>('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK)
  const [mostrarInactivos, setMostrarInactivos] = useState(false)

  const lista = articulos
    .filter(a => (mostrarInactivos || a.activo) && (!filtroSeccion || a.seccion === filtroSeccion))
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.titulo.localeCompare(b.titulo))

  async function guardar() {
    if (!form.titulo.trim() || !form.contenido.trim()) {
      Swal.fire('Error', 'Título y contenido son obligatorios', 'warning'); return
    }
    setSaving(true)
    const { error } = await supabase.from('manual_residente_cond').insert({
      company_id: companyId, project_id: proyectoId,
      seccion: form.seccion, titulo: form.titulo.trim(),
      contenido: form.contenido.trim(), orden: form.orden || 0, activo: true,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function toggleActivo(id: string, activo: boolean) {
    await supabase.from('manual_residente_cond').update({ activo: !activo }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const { isConfirmed } = await Swal.fire({ title: '¿Eliminar artículo?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!isConfirmed) return
    await supabase.from('manual_residente_cond').delete().eq('id', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  const totalActivos = articulos.filter(a => a.activo).length

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 16 }}>
        {SECCIONES.map(s => {
          const n = articulos.filter(a => a.activo && a.seccion === s.id).length
          return (
            <div key={s.id} style={{ background: '#FAF7EF', borderRadius: 8, padding: '8px 12px', textAlign: 'center', cursor: 'pointer', border: `1.5px solid ${filtroSeccion === s.id ? '#1B3B36' : '#E1DDD0'}` }}
              onClick={() => setFiltroSeccion(filtroSeccion === s.id ? '' : s.id)}>
              <div style={{ fontSize: 18 }}>{s.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15291F' }}>{n}</div>
              <div style={{ fontSize: 10, color: '#7E9389' }}>{s.label}</div>
            </div>
          )
        })}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#7E9389' }}>{lista.length} artículo{lista.length !== 1 ? 's' : ''} · {totalActivos} activos</span>
          {canEdit && (
            <label style={{ fontSize: 12, color: '#7E9389', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={mostrarInactivos} onChange={e => setMostrarInactivos(e.target.checked)} />
              Ver ocultos
            </label>
          )}
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#102622', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo artículo'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#EEF2EC', border: '1px solid #C2D2CA', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Agregar artículo al manual</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Título *</label>
              <input style={inp} value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} placeholder="Ej. ¿Cómo reservar la piscina?" />
            </div>
            <div>
              <label style={lbl}>Orden</label>
              <input type="number" min={0} style={inp} value={form.orden} onChange={e => setForm(p => ({ ...p, orden: parseInt(e.target.value) || 0 }))} />
            </div>
            <div>
              <label style={lbl}>Sección</label>
              <select style={inp} value={form.seccion} onChange={e => setForm(p => ({ ...p, seccion: e.target.value as SeccionManual }))}>
                {SECCIONES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Contenido *</label>
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={form.contenido}
                onChange={e => setForm(p => ({ ...p, contenido: e.target.value }))} placeholder="Redacta el contenido del artículo…" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#102622', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Publicar'}
          </button>
        </div>
      )}

      {/* Lista agrupada por sección */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '48px 0', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
          Sin artículos en el manual — agrega el primero con el botón de arriba
        </div>
      ) : (
        SECCIONES
          .filter(s => !filtroSeccion || s.id === filtroSeccion)
          .map(sec => {
            const items = lista.filter(a => a.seccion === sec.id)
            if (items.length === 0) return null
            return (
              <div key={sec.id} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#15291F', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{sec.icon}</span> {sec.label}
                  <span style={{ fontSize: 11, color: '#7E9389', fontWeight: 400 }}>({items.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {items.map(a => (
                    <div key={a.id} style={{ background: '#fff', border: `1px solid ${a.activo ? '#E1DDD0' : '#fde68a'}`, borderRadius: 8, overflow: 'hidden', opacity: a.activo ? 1 : 0.7 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer' }}
                        onClick={() => setExpandido(expandido === a.id ? null : a.id)}>
                        {!a.activo && <span style={{ fontSize: 10, background: '#fef3c7', color: '#d97706', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>Oculto</span>}
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{a.titulo}</span>
                        <span style={{ fontSize: 10, color: '#7E9389' }}>#{a.orden}</span>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => toggleActivo(a.id, a.activo)}
                              style={{ padding: '3px 8px', background: '#EAE6D8', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: '#7E9389' }}>
                              {a.activo ? 'Ocultar' : 'Mostrar'}
                            </button>
                            <button onClick={() => eliminar(a.id)}
                              style={{ padding: '3px 8px', background: '#fef2f2', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: '#ef4444' }}>✕</button>
                          </div>
                        )}
                        <span style={{ fontSize: 11, color: '#7E9389' }}>{expandido === a.id ? '▲' : '▼'}</span>
                      </div>
                      {expandido === a.id && (
                        <div style={{ padding: '0 14px 14px', fontSize: 13, color: '#3E5A4C', whiteSpace: 'pre-wrap', lineHeight: 1.6, borderTop: '1px solid #EAE6D8', paddingTop: 10 }}>
                          {a.contenido}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })
      )}
    </div>
  )
}
