import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ChecklistArea, ChecklistItem } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

interface Props {
  checklists: ChecklistArea[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  completo:          { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Completo',           icon: '✅' },
  con_observaciones: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Con observaciones',  icon: '⚠️' },
  pendiente:         { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Pendiente',          icon: '🕐' },
}

const ITEMS_PREDEFINIDOS = [
  'Lobby principal', 'Escaleras y pasillos', 'Ascensor',
  'Área de piscina', 'Gimnasio', 'Salón social',
  'Parqueos', 'Jardines y áreas verdes', 'Cuarto de basura',
  'Bombas de agua', 'Tablero eléctrico', 'Cámaras de seguridad',
  'Iluminación exterior', 'Portones y accesos', 'Área de juegos',
]

const BLANK_ITEM: ChecklistItem = { item: '', ok: false, observacion: '' }

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

function calcEstado(items: ChecklistItem[]): ChecklistArea['estado'] {
  if (items.length === 0) return 'pendiente'
  if (items.every(i => i.ok)) return 'completo'
  if (items.some(i => !i.ok)) return 'con_observaciones'
  return 'pendiente'
}

export function ChecklistAreasTab({ checklists, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<ChecklistArea | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formArea, setFormArea] = useState('')
  const [formFecha, setFormFecha] = useState(new Date().toISOString().slice(0, 10))
  const [formInspector, setFormInspector] = useState('')
  const [formNotas, setFormNotas] = useState('')
  const [formItems, setFormItems] = useState<ChecklistItem[]>([])
  const [filterEstado, setFilterEstado] = useState('')
  const [searchArea, setSearchArea] = useState('')
  const [saving, setSaving] = useState(false)
  const [predefinidoSel, setPredefinidoSel] = useState('')

  const openNew = () => {
    setFormArea(''); setFormFecha(new Date().toISOString().slice(0, 10))
    setFormInspector(''); setFormNotas(''); setFormItems([])
    setEditId(null); setShowForm(true); setSelected(null)
  }
  const openEdit = (c: ChecklistArea) => {
    setFormArea(c.area); setFormFecha(c.fecha)
    setFormInspector(c.inspector ?? ''); setFormNotas(c.notas ?? '')
    setFormItems(c.items.map(i => ({ ...i })))
    setEditId(c.id); setShowForm(true)
  }

  const addPredefinido = () => {
    if (!predefinidoSel) return
    setFormItems(prev => [...prev, { item: predefinidoSel, ok: false, observacion: '' }])
    setPredefinidoSel('')
  }
  const addBlank = () => setFormItems(prev => [...prev, { ...BLANK_ITEM }])
  const removeItem = (i: number) => setFormItems(prev => prev.filter((_, idx) => idx !== i))
  const setItem = (i: number, field: keyof ChecklistItem, val: string | boolean) =>
    setFormItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))

  const handleSave = async () => {
    if (!formArea.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'El área es obligatoria.' })
    setSaving(true)
    const estado = calcEstado(formItems)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      area: formArea.trim(), fecha: formFecha,
      inspector: formInspector || null, notas: formNotas || null,
      items: formItems, estado,
    }
    const { error } = editId
      ? await supabase.from('checklist_areas').update(payload).eq('id', editId)
      : await supabase.from('checklist_areas').insert(payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const toggleItem = async (c: ChecklistArea, idx: number) => {
    const items = c.items.map((it, i) => i === idx ? { ...it, ok: !it.ok } : it)
    const estado = calcEstado(items)
    const { error } = await supabase.from('checklist_areas').update({ items, estado }).eq('id', c.id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
    setSelected(sel => sel?.id === c.id ? { ...sel, items, estado } : sel)
  }

  const handleDelete = async (c: ChecklistArea) => {
    const r = await Swal.fire({ title: '¿Eliminar checklist?', text: `${c.area} · ${c.fecha}`, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('checklist_areas').delete().eq('id', c.id)
    if (selected?.id === c.id) setSelected(null)
    onRefresh()
  }

  const filtered = checklists.filter(c =>
    (!filterEstado || c.estado === filterEstado) &&
    (!searchArea || c.area.toLowerCase().includes(searchArea.toLowerCase()))
  )

  const kpiCounts = Object.keys(ESTADO_STYLE).map(k => ({ key: k, count: checklists.filter(c => c.estado === k).length }))

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* LEFT */}
      <div style={{ width: '340px', flexShrink: 0, borderRight: '1.5px solid var(--at-line)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px', borderBottom: '1px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            {kpiCounts.map(({ key, count }) => {
              const s = ESTADO_STYLE[key]
              return (
                <div key={key} style={{ flex: 1, background: s.bg, borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '18px', color: s.color }}>{count}</div>
                  <div style={{ fontSize: '10px', color: s.color, fontWeight: 600 }}>{s.icon}</div>
                </div>
              )
            })}
          </div>
          {canCreate && (
            <button onClick={openNew} style={{ width: '100%', padding: '8px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', marginBottom: '8px' }}>
              + Nuevo checklist
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input value={searchArea} onChange={e => setSearchArea(e.target.value)} placeholder="Buscar área..." style={inputStyle} />
            <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={inputStyle}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '32px', color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin registros</div>}
          {filtered.map(c => {
            const s = ESTADO_STYLE[c.estado]
            const pct = c.items.length > 0 ? Math.round(c.items.filter(i => i.ok).length / c.items.length * 100) : 0
            return (
              <div key={c.id} onClick={() => { setSelected(c); setShowForm(false) }}
                style={{ padding: '12px 14px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === c.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', borderLeft: selected?.id === c.id ? '3px solid var(--at-primary)' : '3px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{c.area}</div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{c.fecha}{c.inspector ? ` · ${c.inspector}` : ''}</div>
                    {c.items.length > 0 && (
                      <div style={{ marginTop: '4px' }}>
                        <div style={{ height: '4px', background: 'var(--at-line)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--at-success)' : 'var(--at-primary)', transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{c.items.filter(i => i.ok).length}/{c.items.length} ítems</div>
                      </div>
                    )}
                  </div>
                  <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '10px', fontWeight: 700, background: s.bg, color: s.color, flexShrink: 0, marginLeft: '6px' }}>{s.icon}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {showForm && (
          <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar checklist' : 'Nuevo checklist de área'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Área *</label>
                <input style={inputStyle} value={formArea} onChange={e => setFormArea(e.target.value)} placeholder="Ej. Lobby, Piscina, Gimnasio" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha</label>
                <input style={inputStyle} type="date" value={formFecha} onChange={e => setFormFecha(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Inspector</label>
                <input style={inputStyle} value={formInspector} onChange={e => setFormInspector(e.target.value)} placeholder="Nombre del inspector" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas generales</label>
                <input style={inputStyle} value={formNotas} onChange={e => setFormNotas(e.target.value)} placeholder="Observaciones generales" />
              </div>
            </div>

            {/* Items section */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>Ítems de inspección</div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <select value={predefinidoSel} onChange={e => setPredefinidoSel(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                  <option value="">— Seleccionar ítem predefinido —</option>
                  {ITEMS_PREDEFINIDOS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <button onClick={addPredefinido} style={{ padding: '7px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>+ Añadir</button>
                <button onClick={addBlank} style={{ padding: '7px 12px', background: 'var(--at-chip)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>+ Personalizado</button>
              </div>
              {formItems.length === 0 && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontStyle: 'italic' }}>Sin ítems añadidos</div>}
              {formItems.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', background: 'var(--at-surface)', borderRadius: '8px', padding: '8px', border: '1px solid var(--at-line)' }}>
                  <input type="checkbox" checked={it.ok} onChange={e => setItem(i, 'ok', e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--at-success)' }} />
                  <input value={it.item} onChange={e => setItem(i, 'item', e.target.value)} placeholder="Ítem de inspección" style={{ ...inputStyle, flex: 1, background: it.ok ? 'var(--at-success-tint)' : 'var(--at-surface)' }} />
                  <input value={it.observacion} onChange={e => setItem(i, 'observacion', e.target.value)} placeholder="Observación" style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={() => removeItem(i)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
            </div>
          </div>
        )}

        {!showForm && selected && (() => {
          const s = ESTADO_STYLE[selected.estado]
          const done = selected.items.filter(i => i.ok).length
          const pct = selected.items.length > 0 ? Math.round(done / selected.items.length * 100) : 0
          return (
            <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>🗒️ {selected.area}</h2>
                    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, background: s.bg, color: s.color }}>{s.icon} {s.label}</span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>{selected.fecha}{selected.inspector ? ` · Inspector: ${selected.inspector}` : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {canEdit && <button onClick={() => openEdit(selected)} style={{ padding: '6px 14px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>✏️ Editar</button>}
                  <button onClick={() => handleDelete(selected)} style={{ padding: '6px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>🗑 Eliminar</button>
                </div>
              </div>

              {selected.items.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>
                    <span>{done}/{selected.items.length} ítems completados</span>
                    <span style={{ fontWeight: 700, color: pct === 100 ? 'var(--at-success)' : 'var(--at-primary)' }}>{pct}%</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--at-line)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--at-success)' : 'var(--at-primary)', transition: 'width 0.3s' }} />
                  </div>
                </div>
              )}

              {selected.items.length === 0 && <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', fontStyle: 'italic', marginBottom: '16px' }}>Sin ítems registrados.</div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                {selected.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '8px', background: it.ok ? 'var(--at-success-tint)' : 'var(--at-surface)', border: `1px solid ${it.ok ? 'var(--at-success-border)' : 'var(--at-line)'}` }}>
                    {canEdit ? (
                      <input type="checkbox" checked={it.ok} onChange={() => toggleItem(selected, i)} style={{ width: '16px', height: '16px', marginTop: '2px', cursor: 'pointer', accentColor: 'var(--at-success)', flexShrink: 0 }} />
                    ) : (
                      <span style={{ fontSize: '16px', flexShrink: 0 }}>{it.ok ? '✅' : '○'}</span>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: it.ok ? 'var(--at-success-strong)' : 'var(--at-ink-2)', textDecoration: it.ok ? 'line-through' : 'none' }}>{it.item}</div>
                      {it.observacion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{it.observacion}</div>}
                    </div>
                  </div>
                ))}
              </div>

              {selected.notas && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Notas</div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>{selected.notas}</p>
                </div>
              )}
            </div>
          )
        })()}

        {!showForm && !selected && (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>🗒️</div>
            <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Selecciona un checklist o crea uno nuevo</p>
          </div>
        )}
      </div>
    </div>
  )
}
