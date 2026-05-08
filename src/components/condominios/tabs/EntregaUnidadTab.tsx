import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { EntregaUnidad } from '../../../types'
import type { Unidad } from '../../../types'
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

interface ItemInventario { item: string; condicion: string; notas: string }

const CONDICION_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  excelente:   { bg: '#dcfce7', color: '#16a34a', label: 'Excelente' },
  buena:       { bg: '#e0f2fe', color: '#0369a1', label: 'Buena' },
  regular:     { bg: '#fef3c7', color: '#92400e', label: 'Regular' },
  deteriorada: { bg: '#fee2e2', color: '#ef4444', label: 'Deteriorada' },
}

const BLANK = { unidad_id: '', tipo: 'entrega', fecha: new Date().toISOString().slice(0, 10), condicion_general: 'buena', inquilino: '', propietario: '', representante_admin: '', observaciones: '' }
const BLANK_ITEM: ItemInventario = { item: '', condicion: 'buena', notas: '' }

export function EntregaUnidadTab({ entregas, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [items, setItems] = useState<ItemInventario[]>([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<EntregaUnidad | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrega' | 'devolucion'>('todos')
  const [filtroUnidad, setFiltroUnidad] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
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
      unidad_id: form.unidad_id, tipo: form.tipo, fecha: form.fecha,
      condicion_general: form.condicion_general, inquilino: form.inquilino || null,
      propietario: form.propietario || null, representante_admin: form.representante_admin || null,
      observaciones: form.observaciones || null, inventario_items: validItems,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('entrega_unidades').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('entrega_unidades').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
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
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                <option value="entrega">🔑 Entrega</option>
                <option value="devolucion">↩️ Devolución</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Condición general</label>
              <select style={inputStyle} value={form.condicion_general} onChange={e => setF('condicion_general', e.target.value)}>
                {Object.entries(CONDICION_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Inquilino</label>
              <input style={inputStyle} value={form.inquilino} onChange={e => setF('inquilino', e.target.value)} placeholder="Nombre del inquilino" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Propietario</label>
              <input style={inputStyle} value={form.propietario} onChange={e => setF('propietario', e.target.value)} placeholder="Nombre del propietario" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Representante admin.</label>
              <input style={inputStyle} value={form.representante_admin} onChange={e => setF('representante_admin', e.target.value)} placeholder="Nombre del administrador" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Observaciones generales</label>
              <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Estado general, comentarios…" />
            </div>
          </div>

          {/* Inventario dinámico */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>Inventario de artículos</label>
              <button onClick={addItem}
                style={{ padding: '3px 9px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                + Añadir
              </button>
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px', textAlign: 'center' }}>Sin artículos. Haga clic en "+ Añadir".</div>
            ) : items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
                <input style={{ ...inputStyle, fontSize: '12px' }} value={it.item} onChange={e => setItem(i, 'item', e.target.value)} placeholder="Artículo" />
                <select style={{ ...inputStyle, fontSize: '12px' }} value={it.condicion} onChange={e => setItem(i, 'condicion', e.target.value)}>
                  {Object.entries(CONDICION_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
                </select>
                <input style={{ ...inputStyle, fontSize: '12px' }} value={it.notas} onChange={e => setItem(i, 'notas', e.target.value)} placeholder="Notas…" />
                <button onClick={() => removeItem(i)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); setItems([]) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'entrega', 'devolucion'] as const).map(f => (
          <button key={f} onClick={() => setFiltroTipo(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroTipo === f ? '#0ea5e9' : '#e2e8f0',
              background: filtroTipo === f ? '#e0f2fe' : 'white',
              color: filtroTipo === f ? '#0369a1' : '#64748b',
              fontWeight: filtroTipo === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : f === 'entrega' ? '🔑 Entregas' : '↩️ Devoluciones'}
          </button>
        ))}
        <select style={{ padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#1e293b', background: '#f8fafc' }}
          value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay actas registradas.</div>
          ) : filtered.map(e => {
            const unidad = unidades.find(u => u.id === e.unidad_id)
            const cs = CONDICION_STYLE[e.condicion_general] ?? CONDICION_STYLE.buena
            const inv = (e.inventario_items ?? []) as ItemInventario[]
            return (
              <div key={e.id} onClick={() => setSelected(selected?.id === e.id ? null : e)}
                style={{ background: 'white', border: `1.5px solid ${selected?.id === e.id ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }}>
                      <span style={{ fontSize: '14px' }}>{e.tipo === 'entrega' ? '🔑' : '↩️'}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{e.tipo === 'entrega' ? 'Entrega' : 'Devolución'}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: cs.bg, color: cs.color }}>{cs.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {unidad && <span>🏠 {unidad.nombre}</span>}
                      <span>📅 {e.fecha}</span>
                      {e.inquilino && <span>👤 {e.inquilino}</span>}
                      {inv.length > 0 && <span>📦 {inv.length} artículo(s)</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '20px', background: e.firmado_propietario ? '#dcfce7' : '#f1f5f9', color: e.firmado_propietario ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                        {e.firmado_propietario ? '✓' : '○'} Prop.
                      </span>
                      <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '20px', background: e.firmado_inquilino ? '#dcfce7' : '#f1f5f9', color: e.firmado_inquilino ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                        {e.firmado_inquilino ? '✓' : '○'} Inq.
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }} onClick={ev => ev.stopPropagation()}>
                    <button onClick={() => handlePrint(e)}
                      style={{ padding: '3px 7px', background: '#f3e8ff', color: '#7c3aed', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🖨️</button>
                    {canEdit && <>
                      <button onClick={() => startEdit(e)}
                        style={{ padding: '3px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(e.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail */}
        {selected && (() => {
          const unidad = unidades.find(u => u.id === selected.unidad_id)
          const inv = (selected.inventario_items ?? []) as ItemInventario[]
          return (
            <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>
                  {selected.tipo === 'entrega' ? '🔑 Entrega' : '↩️ Devolución'} — {unidad?.nombre ?? ''}
                </h3>
                <button onClick={() => handlePrint(selected)}
                  style={{ padding: '4px 10px', background: '#f3e8ff', color: '#7c3aed', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                  🖨️ Imprimir
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                {[
                  { label: 'Fecha', value: selected.fecha },
                  { label: 'Condición', value: CONDICION_STYLE[selected.condicion_general]?.label ?? selected.condicion_general },
                  { label: 'Inquilino', value: selected.inquilino ?? '—' },
                  { label: 'Propietario', value: selected.propietario ?? '—' },
                  { label: 'Representante Admin.', value: selected.representante_admin ?? '—' },
                ].map(f => (
                  <div key={f.label} style={{ background: 'white', borderRadius: '7px', padding: '7px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>{f.label}</div>
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {/* Firmas */}
              {canEdit && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  {(['firmado_propietario', 'firmado_inquilino'] as const).map(campo => (
                    <button key={campo} onClick={() => toggleFirma(selected, campo)}
                      style={{ flex: 1, padding: '6px', background: selected[campo] ? '#dcfce7' : 'white', border: `1px solid ${selected[campo] ? '#86efac' : '#e2e8f0'}`, borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, color: selected[campo] ? '#16a34a' : '#64748b' }}>
                      {selected[campo] ? '✓ ' : '○ '}{campo === 'firmado_propietario' ? 'Propietario firmó' : 'Inquilino firmó'}
                    </button>
                  ))}
                </div>
              )}

              {selected.observaciones && (
                <div style={{ background: 'white', borderRadius: '8px', padding: '8px', border: '1px solid #e2e8f0', marginBottom: '8px' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '3px' }}>Observaciones</div>
                  <div style={{ fontSize: '12px', color: '#374151' }}>{selected.observaciones}</div>
                </div>
              )}

              {inv.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '5px' }}>Inventario ({inv.length})</div>
                  {inv.map((it, i) => {
                    const cs = CONDICION_STYLE[it.condicion] ?? CONDICION_STYLE.buena
                    return (
                      <div key={i} style={{ background: 'white', borderRadius: '6px', padding: '6px 8px', border: '1px solid #e2e8f0', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{it.item}</span>
                          {it.notas && <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>{it.notas}</span>}
                        </div>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: cs.bg, color: cs.color }}>{cs.label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
