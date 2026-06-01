import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { supabase } from '../../../lib/supabase'
import type { GarantiaEquipo, EstadoGarantia } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  garantias: GarantiaEquipo[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<EstadoGarantia, { bg: string; color: string; label: string }> = {
  vigente:      { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Vigente' },
  vencida:      { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Vencida' },
  reclamada:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Reclamada' },
  sin_garantia: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Sin garantía' },
}

const BLANK = { equipo: '', area: '', numero_serie: '', proveedor: '', contacto_soporte: '', fecha_compra: '', fecha_vencimiento: '', monto_compra: '', estado: 'vigente' as EstadoGarantia, notas: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }
function addDays(d: string, days: number) { const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10) }

export function GarantiasEquipoTab({ garantias, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoGarantia>('todos')
  const [search, setSearch] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(g: GarantiaEquipo) {
    setEditId(g.id)
    setForm({ equipo: g.equipo, area: g.area ?? '', numero_serie: g.numero_serie ?? '', proveedor: g.proveedor ?? '', contacto_soporte: g.contacto_soporte ?? '', fecha_compra: g.fecha_compra ?? '', fecha_vencimiento: g.fecha_vencimiento ?? '', monto_compra: g.monto_compra ? String(g.monto_compra) : '', estado: g.estado, notas: g.notas ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.equipo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El nombre del equipo es obligatorio.' })
    setSaving(true)
    const payload = {
      equipo: form.equipo.trim(), area: form.area || null, numero_serie: form.numero_serie || null,
      proveedor: form.proveedor || null, contacto_soporte: form.contacto_soporte || null,
      fecha_compra: form.fecha_compra || null, fecha_vencimiento: form.fecha_vencimiento || null,
      monto_compra: form.monto_compra ? parseFloat(form.monto_compra) : null,
      estado: form.estado, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('garantias_equipo').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('garantias_equipo').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar garantía?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('garantias_equipo').delete().eq('id', id)
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoGarantia) {
    await supabase.from('garantias_equipo').update({ estado }).eq('id', id)
    onRefresh()
  }

  const today = new Date().toISOString().slice(0, 10)
  let filtered = garantias
  if (filtroEstado !== 'todos') filtered = filtered.filter(g => g.estado === filtroEstado)
  if (search.trim()) filtered = filtered.filter(g => g.equipo.toLowerCase().includes(search.toLowerCase()) || (g.proveedor ?? '').toLowerCase().includes(search.toLowerCase()))

  const porVencer  = garantias.filter(g => g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento <= addDays(today, 60) && g.fecha_vencimiento >= today).length
  const vencidas   = garantias.filter(g => g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento < today).length
  const vigentes   = garantias.filter(g => g.estado === 'vigente').length

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Garantías de Equipos</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{vigentes} vigentes · {porVencer > 0 ? `${porVencer} por vencer` : ''}{vencidas > 0 ? ` · ${vencidas} auto-vencidas` : ''}</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Garantía
          </button>
        )}
      </div>

      {/* Alerts */}
      {(porVencer > 0 || vencidas > 0) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {vencidas > 0 && <div style={{ background: 'var(--at-danger-tint)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600 }}>⚠️ {vencidas} garantía(s) expirada(s) sin actualizar</div>}
          {porVencer > 0 && <div style={{ background: 'var(--at-warning-tint)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>🕐 {porVencer} por vencer en 60 días</div>}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(ESTADO_STYLE).map(([est, s]) => (
          <div key={est} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: s.color }}>{garantias.filter(g => g.estado === est).length}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar garantía' : 'Registrar Garantía'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Equipo *</label>
              <input style={inputStyle} value={form.equipo} onChange={e => setF('equipo', e.target.value)} placeholder="Ej: Bomba de agua principal" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Área</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Sala de máquinas…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Número de serie</label>
              <input style={inputStyle} value={form.numero_serie} onChange={e => setF('numero_serie', e.target.value)} placeholder="SN-12345…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Proveedor</label>
              <input style={inputStyle} value={form.proveedor} onChange={e => setF('proveedor', e.target.value)} placeholder="Empresa proveedora" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Contacto soporte</label>
              <input style={inputStyle} value={form.contacto_soporte} onChange={e => setF('contacto_soporte', e.target.value)} placeholder="Tel / email" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha compra</label>
              <input style={inputStyle} type="date" value={form.fecha_compra} onChange={e => setF('fecha_compra', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Vence garantía</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento} onChange={e => setF('fecha_vencimiento', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Monto compra ({moneda})</label>
              <input style={inputStyle} type="number" step="0.01" value={form.monto_compra} onChange={e => setF('monto_compra', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value as EstadoGarantia)}>
                {Object.entries(ESTADO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Cobertura, condiciones, historial de reclamos…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...inputStyle, width: '180px' }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar equipo / proveedor…" />
        {(['todos', 'vigente', 'vencida', 'reclamada', 'sin_garantia'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f as EstadoGarantia]?.label ?? f}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState icon="🛡️" title="No hay garantías registradas" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(g => {
            const es = ESTADO_STYLE[g.estado]
            const expirando = g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento <= addDays(today, 60)
            const expirada = g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento < today
            return (
              <div key={g.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${expirada ? 'var(--at-danger-border)' : expirando ? 'var(--at-warning-border)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{g.equipo}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                      {expirada && <span style={{ fontSize: '10px', color: 'var(--at-danger)', fontWeight: 700 }}>⚠️ Expirada</span>}
                      {!expirada && expirando && <span style={{ fontSize: '10px', color: 'var(--at-warning)', fontWeight: 700 }}>🕐 Por vencer</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {g.area && <span>📍 {g.area}</span>}
                      {g.numero_serie && <span>SN: {g.numero_serie}</span>}
                      {g.proveedor && <span>🏢 {g.proveedor}</span>}
                      {g.fecha_compra && <span>🛒 {g.fecha_compra}</span>}
                      {g.fecha_vencimiento && <span style={{ color: expirada ? 'var(--at-danger)' : expirando ? 'var(--at-warning)' : 'var(--at-ink-3)', fontWeight: (expirada || expirando) ? 700 : 400 }}>📅 Vence: {g.fecha_vencimiento}</span>}
                      {g.monto_compra && <span>💰 {fmt(Number(g.monto_compra), moneda)}</span>}
                    </div>
                    {g.contacto_soporte && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Soporte: {g.contacto_soporte}</div>}
                    {g.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-2)', marginTop: '3px', fontStyle: 'italic' }}>{g.notas}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                      {g.estado === 'vigente' && (
                        <button onClick={() => cambiarEstado(g.id, 'reclamada')}
                          style={{ padding: '3px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          Reclamar
                        </button>
                      )}
                      <button onClick={() => startEdit(g)}
                        style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(g.id)}
                        style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
