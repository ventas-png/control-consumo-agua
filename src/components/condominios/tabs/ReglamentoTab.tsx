import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import { notify } from '../../shared/Dialog'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
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
  { value: 'convivencia',   label: 'Convivencia',    icon: '🤝', color: 'var(--at-accent)' },
  { value: 'pagos',         label: 'Pagos',          icon: '💳', color: 'var(--at-success)' },
  { value: 'seguridad',     label: 'Seguridad',      icon: '🛡️', color: 'var(--at-danger)' },
  { value: 'areas_comunes', label: 'Áreas comunes',  icon: '🏊', color: 'var(--at-primary-2)' },
  { value: 'mascotas',      label: 'Mascotas',       icon: '🐾', color: 'var(--at-warning)' },
  { value: 'mudanzas',      label: 'Mudanzas',       icon: '🚚', color: 'var(--at-accent)' },
  { value: 'otro',          label: 'Otro',           icon: '📄', color: 'var(--at-ink-3)' },
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
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Capítulo, número, título y contenido son obligatorios' }); return
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
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    } else {
      const { error } = await supabase.from('reglamento_condominio').insert({
        company_id: companyId, project_id: proyectoId,
        capitulo: form.capitulo.trim(), numero_articulo: form.numero_articulo.trim(),
        titulo: form.titulo.trim(), contenido: form.contenido.trim(),
        categoria: form.categoria, version: form.version.trim(),
        fecha_vigencia: form.fecha_vigencia || null, notas: form.notas.trim() || null,
      })
      setSaving(false)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
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

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 320, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Reglamento ({lista.length})</span>
            {canCreate && (
              <Button size="sm" onClick={() => { resetForm(); setEditando(false); setMostrarForm(true); setSelected(null) }} style={{ padding: '5px 10px', fontSize: 12, background: 'var(--at-accent)', border: 'none' }}>
                + Artículo
              </Button>
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

        {lista.length === 0 && <EmptyState icon="📜" compact title="Sin artículos" />}

        {Object.entries(porCapitulo).map(([cap, items]) => (
          <div key={cap}>
            <div style={{ padding: '6px 12px', background: 'var(--at-surface-2)', fontSize: 11, fontWeight: 700, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {cap}
            </div>
            {items.map(a => {
              const cat = CATEGORIAS.find(c => c.value === a.categoria)
              return (
                <div key={a.id} onClick={() => { setSelected(a); setMostrarForm(false) }}
                  style={{ padding: '9px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === a.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', opacity: a.vigente ? 1 : 0.5, borderLeft: `3px solid ${cat?.color || 'var(--at-line)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: cat?.color }}>{a.numero_articulo}</span>
                    {!a.vigente && <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>derogado</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{a.titulo}</div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{cat?.icon} {cat?.label} · v{a.version}</div>
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
              <Button
                variant="success"
                onClick={guardar}
                loading={saving}
                loadingText="Guardando…"
                iconLeft={!saving ? '✅' : undefined}
              >
                {editando ? 'Actualizar' : 'Crear'}
              </Button>
              <Button variant="ghost" onClick={() => { setMostrarForm(false); setEditando(false); resetForm() }}>
                Cancelar
              </Button>
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
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>
                    Versión {selected.version}
                    {selected.fecha_vigencia && <span> · Vigente desde {selected.fecha_vigencia}</span>}
                    {!selected.vigente && <span style={{ color: 'var(--at-danger)' }}> · DEROGADO</span>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" size="sm" onClick={() => iniciarEdicion(selected)} style={{ padding: '6px 12px', fontSize: 12 }}>
                      ✏️ Editar
                    </Button>
                    <Button
                      variant={selected.vigente ? 'outline-danger' : 'success'}
                      size="sm"
                      onClick={() => toggleVigente(selected)}
                      style={{ padding: '6px 12px', fontSize: 12, border: 'none', background: selected.vigente ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', color: selected.vigente ? 'var(--at-danger)' : 'var(--at-success)' }}
                    >
                      {selected.vigente ? 'Derogar' : 'Restablecer'}
                    </Button>
                  </div>
                )}
              </div>

              <div style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '16px 20px', fontSize: 14, lineHeight: 1.7, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>
                {selected.contenido}
              </div>

              {selected.notas && (
                <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 12, color: 'var(--at-warning-strong)' }}>
                  <strong>Nota: </strong>{selected.notas}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona un artículo o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}
