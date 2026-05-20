import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ArticuloReglamento, CategoriaReglamento } from '../../../types'

interface Props {
  articulos: ArticuloReglamento[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaReglamento; label: string; icon: string; color: string }[] = [
  { value: 'convivencia',   label: 'Convivencia',    icon: '🤝', color: '#B96A3F' },
  { value: 'pagos',         label: 'Pagos',          icon: '💳', color: '#10b981' },
  { value: 'seguridad',     label: 'Seguridad',      icon: '🛡️', color: '#ef4444' },
  { value: 'areas_comunes', label: 'Áreas comunes',  icon: '🏊', color: '#2F5D4F' },
  { value: 'mascotas',      label: 'Mascotas',       icon: '🐾', color: '#f59e0b' },
  { value: 'mudanzas',      label: 'Mudanzas',       icon: '🚚', color: '#B96A3F' },
  { value: 'otro',          label: 'Otro',           icon: '📄', color: '#7E9389' },
]

export default function ReglamentoTab({ articulos, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<ArticuloReglamento | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaReglamento | ''>('')
  const [soloVigentes, setSoloVigentes] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(false)

  const [form, setForm] = useState({
    capitulo: '', numero_articulo: '', titulo: '', contenido: '',
    categoria: 'convivencia' as CategoriaReglamento,
    version: '1.0', fecha_vigencia: '', notas: '',
  })

  const lista = articulos.filter(a =>
    (filtroCategoria === '' || a.categoria === filtroCategoria) &&
    (!soloVigentes || a.vigente) &&
    (busqueda === '' || a.titulo.toLowerCase().includes(busqueda.toLowerCase()) || a.contenido.toLowerCase().includes(busqueda.toLowerCase()) || a.numero_articulo.includes(busqueda))
  )

  // Group by capitulo
  const porCapitulo = lista.reduce<Record<string, ArticuloReglamento[]>>((acc, a) => {
    if (!acc[a.capitulo]) acc[a.capitulo] = []
    acc[a.capitulo].push(a)
    return acc
  }, {})

  async function guardar() {
    if (!form.capitulo.trim() || !form.numero_articulo.trim() || !form.titulo.trim() || !form.contenido.trim()) {
      Swal.fire('Faltan datos', 'Capítulo, número, título y contenido son obligatorios', 'warning'); return
    }
    setSaving(true)
    if (editando && selected) {
      const { error } = await supabase.from('reglamento_condominio').update({
        capitulo: form.capitulo.trim(), numero_articulo: form.numero_articulo.trim(),
        titulo: form.titulo.trim(), contenido: form.contenido.trim(),
        categoria: form.categoria, version: form.version.trim(),
        fecha_vigencia: form.fecha_vigencia || null, notas: form.notas.trim() || null,
      }).eq('id', selected.id)
      setSaving(false)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
    } else {
      const { error } = await supabase.from('reglamento_condominio').insert({
        company_id: companyId, project_id: proyectoId,
        capitulo: form.capitulo.trim(), numero_articulo: form.numero_articulo.trim(),
        titulo: form.titulo.trim(), contenido: form.contenido.trim(),
        categoria: form.categoria, version: form.version.trim(),
        fecha_vigencia: form.fecha_vigencia || null, notas: form.notas.trim() || null,
      })
      setSaving(false)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
    }
    resetForm()
    setMostrarForm(false)
    setEditando(false)
    onRefresh()
  }

  async function toggleVigente(a: ArticuloReglamento) {
    await supabase.from('reglamento_condominio').update({ vigente: !a.vigente }).eq('id', a.id)
    if (selected?.id === a.id) setSelected(prev => prev ? { ...prev, vigente: !prev.vigente } : null)
    onRefresh()
  }

  function resetForm() {
    setForm({ capitulo: '', numero_articulo: '', titulo: '', contenido: '', categoria: 'convivencia', version: '1.0', fecha_vigencia: '', notas: '' })
  }

  function iniciarEdicion(a: ArticuloReglamento) {
    setForm({
      capitulo: a.capitulo, numero_articulo: a.numero_articulo,
      titulo: a.titulo, contenido: a.contenido, categoria: a.categoria,
      version: a.version, fecha_vigencia: a.fecha_vigencia || '', notas: a.notas || '',
    })
    setEditando(true)
    setMostrarForm(true)
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid #E1DDD0', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #E1DDD0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Reglamento ({lista.length})</span>
            {canCreate && (
              <button onClick={() => { resetForm(); setEditando(false); setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Artículo
              </button>
            )}
          </div>
          <input style={{ ...inp, marginBottom: 6 }} placeholder="Buscar…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          <select style={{ ...inp, marginBottom: 6 }} value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaReglamento | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloVigentes} onChange={e => setSoloVigentes(e.target.checked)} />
            Solo artículos vigentes
          </label>
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: '#7E9389', padding: '32px 16px', fontSize: 13 }}>Sin artículos</div>}

        {Object.entries(porCapitulo).map(([cap, items]) => (
          <div key={cap}>
            <div style={{ padding: '6px 12px', background: '#FAF7EF', fontSize: 11, fontWeight: 700, color: '#3E5A4C', borderBottom: '1px solid #E1DDD0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {cap}
            </div>
            {items.map(a => {
              const cat = CATEGORIAS.find(c => c.value === a.categoria)
              return (
                <div key={a.id} onClick={() => { setSelected(a); setMostrarForm(false) }}
                  style={{ padding: '9px 12px', borderBottom: '1px solid #EAE6D8', cursor: 'pointer', background: selected?.id === a.id ? '#F4EBE3' : '#fff', opacity: a.vigente ? 1 : 0.5, borderLeft: `3px solid ${cat?.color || '#E1DDD0'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: cat?.color }}>{a.numero_articulo}</span>
                    {!a.vigente && <span style={{ fontSize: 10, color: '#7E9389' }}>derogado</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{a.titulo}</div>
                  <div style={{ fontSize: 11, color: '#7E9389' }}>{cat?.icon} {cat?.label} · v{a.version}</div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{editando ? 'Editar artículo' : 'Nuevo artículo'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Capítulo *</label>
                <input style={inp} placeholder="I. Disposiciones Generales" value={form.capitulo} onChange={e => setForm(p => ({ ...p, capitulo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>N° artículo *</label>
                <input style={inp} placeholder="Art. 1" value={form.numero_articulo} onChange={e => setForm(p => ({ ...p, numero_articulo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaReglamento }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Título *</label>
                <input style={inp} placeholder="Título del artículo" value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Contenido *</label>
                <textarea style={{ ...inp, height: 120, resize: 'vertical' }} value={form.contenido} onChange={e => setForm(p => ({ ...p, contenido: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Versión</label>
                <input style={inp} placeholder="1.0" value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha vigencia</label>
                <input type="date" style={inp} value={form.fecha_vigencia} onChange={e => setForm(p => ({ ...p, fecha_vigencia: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Notas</label>
                <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : `✅ ${editando ? 'Actualizar' : 'Crear'}`}
              </button>
              <button onClick={() => { setMostrarForm(false); setEditando(false); resetForm() }}
                style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const cat = CATEGORIAS.find(c => c.value === selected.categoria)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: cat?.color, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                    {cat?.icon} {cat?.label} · {selected.capitulo}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{selected.numero_articulo} — {selected.titulo}</div>
                  <div style={{ fontSize: 12, color: '#7E9389', marginTop: 4 }}>
                    Versión {selected.version}
                    {selected.fecha_vigencia && <span> · Vigente desde {selected.fecha_vigencia}</span>}
                    {!selected.vigente && <span style={{ color: '#ef4444' }}> · DEROGADO</span>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => iniciarEdicion(selected)}
                      style={{ padding: '6px 12px', background: '#EAE6D8', color: '#3E5A4C', border: '1px solid #E1DDD0', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✏️ Editar
                    </button>
                    <button onClick={() => toggleVigente(selected)}
                      style={{ padding: '6px 12px', background: selected.vigente ? '#fef2f2' : '#d1fae5', color: selected.vigente ? '#ef4444' : '#10b981', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      {selected.vigente ? 'Derogar' : 'Restablecer'}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ background: '#FAF7EF', borderRadius: 10, padding: '16px 20px', fontSize: 14, lineHeight: 1.7, color: '#3E5A4C', whiteSpace: 'pre-wrap' }}>
                {selected.contenido}
              </div>

              {selected.notas && (
                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 12, color: '#92400e' }}>
                  <strong>Nota: </strong>{selected.notas}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#7E9389', fontSize: 14 }}>
            Selecciona un artículo o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}
