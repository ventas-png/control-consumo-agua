import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { EntregaUnidad, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  entregas: EntregaUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type ItemInventario = { item: string; condicion: string; notas: string }
const BLANK_ITEM: ItemInventario = { item: '', condicion: 'bueno', notas: '' }

type FormData = {
  unidad_id: string
  tipo: 'entrega' | 'devolucion'
  fecha: string
  condicion_general: string
  inquilino: string
  propietario: string
  representante_admin: string
  observaciones: string
}

const BLANK: FormData = {
  unidad_id: '', tipo: 'entrega', fecha: new Date().toISOString().slice(0, 10),
  condicion_general: 'bueno', inquilino: '', propietario: '',
  representante_admin: '', observaciones: '',
}

const CONDICION_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  excelente: { label: 'Excelente', color: '#16a34a', bg: '#f0fdf4' },
  bueno:     { label: 'Bueno',     color: '#2563eb', bg: '#eff6ff' },
  regular:   { label: 'Regular',   color: '#f59e0b', bg: '#fef3c7' },
  malo:      { label: 'Malo',      color: '#dc2626', bg: '#fef2f2' },
}

export function EntregaUnidadTab({ entregas, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm]     = useState(false)
  const [editId, setEditId]         = useState<string | null>(null)
  const [form, setForm]             = useState<FormData>({ ...BLANK })
  const [items, setItems]           = useState<ItemInventario[]>([])
  const [saving, setSaving]         = useState(false)
  const [selected, setSelected]     = useState<EntregaUnidad | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrega' | 'devolucion'>('todos')
  const [filtroUnidad, setFiltroUnidad] = useState('')

  const setF = (k: keyof FormData, v: string) => setForm(f => ({ ...f, [k]: v }))

  function addItem() { setItems(p => [...p, { ...BLANK_ITEM }]) }
  function removeItem(i: number) { setItems(p => p.filter((_, idx) => idx !== i)) }
  function setItem(i: number, field: keyof ItemInventario, val: string) { setItems(p => p.map((it, idx) => idx === i ? { ...it, [field]: val } : it)) }

  function startEdit(e: EntregaUnidad) {
    setEditId(e.id)
    setForm({ unidad_id: e.unidad_id, tipo: e.tipo, fecha: e.fecha, condicion_general: e.condicion_general, inquilino: e.inquilino ?? '', propietario: e.propietario ?? '', representante_admin: e.representante_admin ?? '', observaciones: e.observaciones ?? '' })
    setItems((e.inventario_items ?? []) as ItemInventario[])
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.unidad_id) return Swal.fire('Requerido', 'Seleccione una unidad.', 'warning')
    const validItems = items.filter(it => it.item.trim())
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id, tipo: form.tipo, fecha: form.fecha,
      condicion_general: form.condicion_general, inquilino: form.inquilino || null,
      propietario: form.propietario || null, representante_admin: form.representante_admin || null,
      observaciones: form.observaciones || null, inventario_items: validItems,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('entrega_unidades').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('entrega_unidades').insert(payload))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); setItems([]); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar acta de entrega?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('entrega_unidades').delete().eq('id', id)
    if (selected?.id === id) setSelected(null)
    onRefresh()
  }

  async function toggleFirma(e: EntregaUnidad, campo: 'firmado_propietario' | 'firmado_inquilino') {
    const update = { [campo]: !e[campo] }
    await supabase.from('entrega_unidades').update(update).eq('id', e.id)
    onRefresh()
  }

  function handlePrint(e: EntregaUnidad) {
    const unidad = unidades.find(u => u.id === e.unidad_id)
    const inv = (e.inventario_items ?? []) as ItemInventario[]
    const cond = CONDICION_STYLE[e.condicion_general]
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acta de ${e.tipo === 'entrega' ? 'Entrega' : 'Devolución'}</title>
<style>body{font-family:Arial,sans-serif;padding:30px;font-size:13px}h1{font-size:18px;margin-bottom:4px}h2{font-size:14px;margin:16px 0 6px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f8fafc}
.sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}.sig-box{border-top:1px solid #000;padding-top:6px;font-size:11px}</style></head><body>
<h1>Acta de ${e.tipo === 'entrega' ? 'Entrega' : 'Devolución'} de Unidad</h1>
<p style="color:#64748b">Fecha: ${e.fecha}</p>
<h2>Datos Generales</h2>
<table><tr><th>Unidad</th><td>${unidad?.nombre ?? '—'}</td><th>Condición general</th><td>${cond?.label ?? e.condicion_general}</td></tr>
<tr><th>Inquilino</th><td>${e.inquilino ?? '—'}</td><th>Propietario</th><td>${e.propietario ?? '—'}</td></tr>
<tr><th>Representante Admin.</th><td colspan="3">${e.representante_admin ?? '—'}</td></tr></table>
${e.observaciones ? `<h2>Observaciones</h2><p>${e.observaciones}</p>` : ''}
${inv.length > 0 ? `<h2>Inventario</h2><table><tr><th>Artículo</th><th>Condición</th><th>Notas</th></tr>${inv.map(it => `<tr><td>${it.item}</td><td>${CONDICION_STYLE[it.condicion]?.label ?? it.condicion}</td><td>${it.notas || '—'}</td></tr>`).join('')}</table>` : ''}
<div class="sig"><div class="sig-box">Propietario${e.firmado_propietario ? ' ✓' : ''}<br>${e.propietario ?? ''}</div><div class="sig-box">Inquilino${e.firmado_inquilino ? ' ✓' : ''}<br>${e.inquilino ?? ''}</div><div class="sig-box">Admin. Condominio<br>${e.representante_admin ?? ''}</div></div>
</body></html>`
    const w = window.open('', '_blank'); if (!w) return; w.document.write(html); w.document.close(); w.print()
  }

  let filtered = entregas
  if (filtroTipo !== 'todos') filtered = filtered.filter(e => e.tipo === filtroTipo)
  if (filtroUnidad) filtered = filtered.filter(e => e.unidad_id === filtroUnidad)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Entrega de Unidades</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>{entregas.filter(e => e.tipo === 'entrega').length} entregas · {entregas.filter(e => e.tipo === 'devolucion').length} devoluciones</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setItems([]); setShowForm(true) }}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Acta
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Acta' : 'Nueva Acta de Entrega/Devolución'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                <option value="entrega">Entrega</option>
                <option value="devolucion">Devolución</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha *</label>
              <input type="date" style={inputStyle} value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Condición general</label>
              <select style={inputStyle} value={form.condicion_general} onChange={e => setF('condicion_general', e.target.value)}>
                {Object.entries(CONDICION_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Inquilino</label>
              <input style={inputStyle} value={form.inquilino} onChange={e => setF('inquilino', e.target.value)} placeholder="Nombre" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Propietario</label>
              <input style={inputStyle} value={form.propietario} onChange={e => setF('propietario', e.target.value)} placeholder="Nombre" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Representante Admin.</label>
              <input style={inputStyle} value={form.representante_admin} onChange={e => setF('representante_admin', e.target.value)} placeholder="Nombre" />
            </div>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Observaciones</label>
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} />
          </div>

          {/* Inventory items */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Inventario</label>
              <button onClick={addItem} style={{ padding: '4px 10px', background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>+ Artículo</button>
            </div>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                <input style={inputStyle} placeholder="Artículo" value={it.item} onChange={e => setItem(i, 'item', e.target.value)} />
                <select style={inputStyle} value={it.condicion} onChange={e => setItem(i, 'condicion', e.target.value)}>
                  {Object.entries(CONDICION_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <input style={inputStyle} placeholder="Notas" value={it.notas} onChange={e => setItem(i, 'notas', e.target.value)} />
                <button onClick={() => removeItem(i)} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
              </div>
            ))}
            {items.length === 0 && <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>Sin artículos de inventario</p>}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '9px 20px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Guardando…' : (editId ? 'Guardar cambios' : 'Crear Acta')}</button>
            <button onClick={() => { setShowForm(false); setEditId(null); setForm({ ...BLANK }); setItems([]) }} style={{ padding: '9px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <select style={{ padding: '7px 10px', borderRadius: '7px', border: '1.5px solid #e2e8f0', fontSize: '13px', background: '#f8fafc' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as typeof filtroTipo)}>
          <option value="todos">Todos los tipos</option>
          <option value="entrega">Entregas</option>
          <option value="devolucion">Devoluciones</option>
        </select>
        <select style={{ padding: '7px 10px', borderRadius: '7px', border: '1.5px solid #e2e8f0', fontSize: '13px', background: '#f8fafc' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
          <p style={{ margin: 0, fontSize: '14px' }}>No hay actas de entrega registradas.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {filtered.map(e => {
            const unidad = unidades.find(u => u.id === e.unidad_id)
            const cond = CONDICION_STYLE[e.condicion_general]
            const isSelected = selected?.id === e.id
            return (
              <div key={e.id} style={{ border: `1.5px solid ${isSelected ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '10px', background: isSelected ? '#f0f9ff' : 'white', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', cursor: 'pointer' }} onClick={() => setSelected(isSelected ? null : e)}>
                  <div style={{ fontSize: '20px' }}>{e.tipo === 'entrega' ? '📦' : '🔄'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>{unidad?.nombre ?? 'Unidad desconocida'}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{e.tipo === 'entrega' ? 'Entrega' : 'Devolución'} · {e.fecha}</div>
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: cond?.color ?? '#64748b', background: cond?.bg ?? '#f1f5f9', padding: '3px 9px', borderRadius: '20px' }}>{cond?.label ?? e.condicion_general}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{isSelected ? '▲' : '▼'}</div>
                </div>

                {isSelected && (
                  <div style={{ borderTop: '1px solid #e2e8f0', padding: '14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px', marginBottom: '10px', fontSize: '13px' }}>
                      {e.inquilino && <div><span style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>INQUILINO</span><br />{e.inquilino}</div>}
                      {e.propietario && <div><span style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>PROPIETARIO</span><br />{e.propietario}</div>}
                      {e.representante_admin && <div><span style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>REPR. ADMIN</span><br />{e.representante_admin}</div>}
                    </div>
                    {e.observaciones && <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#475569' }}>{e.observaciones}</p>}

                    {/* Inventory */}
                    {((e.inventario_items ?? []) as ItemInventario[]).length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>INVENTARIO</div>
                        <div style={{ display: 'grid', gap: '4px' }}>
                          {((e.inventario_items ?? []) as ItemInventario[]).map((it, i) => {
                            const c = CONDICION_STYLE[it.condicion]
                            return (
                              <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '12.5px', padding: '5px 8px', background: '#f8fafc', borderRadius: '6px' }}>
                                <span style={{ flex: 1 }}>{it.item}</span>
                                <span style={{ color: c?.color, fontWeight: 600 }}>{c?.label ?? it.condicion}</span>
                                {it.notas && <span style={{ color: '#94a3b8' }}>{it.notas}</span>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Firmas */}
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => toggleFirma(e, 'firmado_propietario')}
                          style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: e.firmado_propietario ? '#f0fdf4' : '#f8fafc', color: e.firmado_propietario ? '#16a34a' : '#64748b' }}>
                          {e.firmado_propietario ? '✓' : '□'} Firma Propietario
                        </button>
                        <button
                          onClick={() => toggleFirma(e, 'firmado_inquilino')}
                          style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: e.firmado_inquilino ? '#f0fdf4' : '#f8fafc', color: e.firmado_inquilino ? '#16a34a' : '#64748b' }}>
                          {e.firmado_inquilino ? '✓' : '□'} Firma Inquilino
                        </button>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handlePrint(e)} style={{ padding: '6px 14px', background: '#eff6ff', color: '#2563eb', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>🖨️ Imprimir</button>
                      {canEdit && <button onClick={() => startEdit(e)} style={{ padding: '6px 14px', background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>✏️ Editar</button>}
                      {canEdit && <button onClick={() => handleDelete(e.id)} style={{ padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>🗑️ Eliminar</button>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
