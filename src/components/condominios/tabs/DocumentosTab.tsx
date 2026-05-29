import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { DocumentoCondominio, CategoriaDocumento, VisibilidadDocumento } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

interface Props {
  documentos: DocumentoCondominio[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaDocumento; label: string; icon: string }[] = [
  { value: 'reglamento',  label: 'Reglamento',  icon: '📜' },
  { value: 'circular',    label: 'Circular',    icon: '📨' },
  { value: 'manual',      label: 'Manual',      icon: '📗' },
  { value: 'acta',        label: 'Acta',        icon: '📋' },
  { value: 'contrato',    label: 'Contrato',    icon: '📄' },
  { value: 'formulario',  label: 'Formulario',  icon: '📝' },
  { value: 'otro',        label: 'Otro',        icon: '📁' },
]

const VISIBILIDAD: { value: VisibilidadDocumento; label: string; color: string }[] = [
  { value: 'admin',      label: 'Solo Admin',   color: 'var(--at-danger)' },
  { value: 'residentes', label: 'Residentes',   color: 'var(--at-primary)' },
  { value: 'todos',      label: 'Público',      color: 'var(--at-success)' },
]

const blank = (): Partial<DocumentoCondominio> => ({
  titulo: '', categoria: 'reglamento', descripcion: '', url: '',
  version: '', vigente: true, visibilidad: 'admin',
})

export function DocumentosTab({ documentos, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaDocumento | 'todos'>('todos')
  const [filtroVigente, setFiltroVigente] = useState<boolean | 'todos'>(true)
  const [busqueda, setBusqueda] = useState('')
  const [form, setForm] = useState<Partial<DocumentoCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = documentos.filter(d => {
    if (filtroCategoria !== 'todos' && d.categoria !== filtroCategoria) return false
    if (filtroVigente !== 'todos' && d.vigente !== filtroVigente) return false
    if (busqueda && !d.titulo.toLowerCase().includes(busqueda.toLowerCase())) return false
    return true
  })

  function startEdit(d: DocumentoCondominio) {
    setForm({
      titulo: d.titulo, categoria: d.categoria, descripcion: d.descripcion ?? '',
      url: d.url, version: d.version ?? '', vigente: d.vigente, visibilidad: d.visibilidad,
    })
    setEditId(d.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.titulo?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el título del documento.' })
    if (!form.url?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la URL del documento.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo!.trim(), categoria: form.categoria ?? 'reglamento',
      descripcion: form.descripcion || null, url: form.url!.trim(),
      version: form.version || null, vigente: form.vigente ?? true,
      visibilidad: form.visibilidad ?? 'admin',
      subido_por: userId || null,
    }
    const { error } = editId
      ? await supabase.from('documentos_condominio').update(payload).eq('id', editId)
      : await supabase.from('documentos_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar documento?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('documentos_condominio').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function toggleVigente(d: DocumentoCondominio) {
    const { error } = await supabase.from('documentos_condominio').update({ vigente: !d.vigente }).eq('id', d.id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const catInfo = (c: CategoriaDocumento) => CATEGORIAS.find(x => x.value === c) ?? CATEGORIAS[CATEGORIAS.length - 1]
  const visInfo = (v: VisibilidadDocumento) => VISIBILIDAD.find(x => x.value === v) ?? VISIBILIDAD[0]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  // Group by category for display
  const grouped = filtered.reduce<Record<string, DocumentoCondominio[]>>((acc, d) => {
    if (!acc[d.categoria]) acc[d.categoria] = []
    acc[d.categoria].push(d)
    return acc
  }, {})

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Biblioteca de Documentos</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar Documento
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Documento' : 'Nuevo Documento'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Título *</label>
              <input style={inputStyle} value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Nombre del documento" />
            </div>
            <div>
              <label style={labelStyle}>Categoría</label>
              <select style={inputStyle} value={form.categoria ?? 'reglamento'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaDocumento }))}>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Visibilidad</label>
              <select style={inputStyle} value={form.visibilidad ?? 'admin'} onChange={e => setForm(f => ({ ...f, visibilidad: e.target.value as VisibilidadDocumento }))}>
                {VISIBILIDAD.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Versión</label>
              <input style={inputStyle} value={form.version ?? ''} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} placeholder="v1.0" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.vigente ?? true} onChange={e => setForm(f => ({ ...f, vigente: e.target.checked }))} />
                Documento vigente
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>URL del documento *</label>
              <input style={inputStyle} value={form.url ?? ''} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://drive.google.com/… o URL directa" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Breve descripción del contenido…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar documentos…"
          style={{ padding: '6px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface-2)', minWidth: '180px' }} />
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaDocumento | 'todos')}
          style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)' }}>
          <option value="todos">Todas las categorías</option>
          {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        {(['todos', true, false] as const).map(v => (
          <button key={String(v)} onClick={() => setFiltroVigente(v)}
            style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroVigente === v ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroVigente === v ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroVigente === v ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {v === 'todos' ? 'Todos' : v ? 'Vigentes' : 'Histórico'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📁</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay documentos en la biblioteca</p>
        </div>
      ) : filtroCategoria !== 'todos' ? (
        // Vista plana cuando hay filtro de categoría
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
          {filtered.map(d => <DocumentCard key={d.id} doc={d} catInfo={catInfo} visInfo={visInfo} canEdit={canEdit} onEdit={startEdit} onDelete={handleDelete} onToggle={toggleVigente} />)}
        </div>
      ) : (
        // Vista agrupada por categoría
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {CATEGORIAS.filter(c => grouped[c.value]?.length > 0).map(cat => (
            <div key={cat.value}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <span style={{ fontSize: '18px' }}>{cat.icon}</span>
                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink-2)' }}>{cat.label}</span>
                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>({grouped[cat.value].length})</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                {grouped[cat.value].map(d => <DocumentCard key={d.id} doc={d} catInfo={catInfo} visInfo={visInfo} canEdit={canEdit} onEdit={startEdit} onDelete={handleDelete} onToggle={toggleVigente} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentCard({ doc, catInfo, visInfo, canEdit, onEdit, onDelete, onToggle }: {
  doc: DocumentoCondominio
  catInfo: (c: CategoriaDocumento) => { icon: string; label: string }
  visInfo: (v: VisibilidadDocumento) => { label: string; color: string }
  canEdit: boolean
  onEdit: (d: DocumentoCondominio) => void
  onDelete: (id: string) => void
  onToggle: (d: DocumentoCondominio) => void
}) {
  const vi = visInfo(doc.visibilidad)
  return (
    <div style={{ background: 'var(--at-surface)', border: `1.5px solid ${doc.vigente ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '10px', padding: '14px', opacity: doc.vigente ? 1 : 0.6, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '28px', flexShrink: 0 }}>{catInfo(doc.categoria).icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '13px', marginBottom: '2px' }}>{doc.titulo}</div>
        {doc.version && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>v{doc.version}</div>}
        {doc.descripcion && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px' }}>{doc.descripcion}</div>}
        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: `${vi.color}15`, color: vi.color }}>{vi.label}</span>
          {!doc.vigente && <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>Histórico</span>}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          <a href={doc.url} target="_blank" rel="noreferrer"
            style={{ padding: '4px 10px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', borderRadius: '6px', fontSize: '12px', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
            📄 Abrir
          </a>
          {canEdit && <button onClick={() => onEdit(doc)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
          {canEdit && <button onClick={() => onToggle(doc)} style={{ padding: '4px 8px', background: doc.vigente ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }} title={doc.vigente ? 'Archivar' : 'Reactivar'}>{doc.vigente ? '📦' : '♻️'}</button>}
          {canEdit && <button onClick={() => onDelete(doc.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
        </div>
      </div>
    </div>
  )
}
