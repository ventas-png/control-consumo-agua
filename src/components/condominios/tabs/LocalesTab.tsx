import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { LocalComercial, EstadoLocal, GiroLocal } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  locales: LocalComercial[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoLocal, { label: string; color: string; bg: string }> = {
  disponible:       { label: 'Disponible',      color: '#10b981', bg: '#d1fae5' },
  ocupado:          { label: 'Ocupado',          color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  en_remodelacion:  { label: 'Remodelación',     color: '#f59e0b', bg: '#fef3c7' },
}

const GIRO_ICON: Record<GiroLocal, string> = {
  restaurante: '🍽️', oficina: '💼', comercio: '🛍️', servicio: '🔧', otro: '📋',
}

const blank = (): Partial<LocalComercial> => ({
  numero_local: '', piso: '', area_m2: undefined, giro: 'comercio',
  inquilino_nombre: '', inquilino_telefono: '', fecha_inicio: '', fecha_fin: '',
  renta_base: undefined, porcentaje_cam: 0, cuota_cam: undefined,
  estado: 'disponible', notas: '',
})

export function LocalesTab({ locales, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoLocal | 'todos'>('todos')
  const [form, setForm] = useState<Partial<LocalComercial>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = locales.filter(l => filtroEstado === 'todos' || l.estado === filtroEstado)
  const ocupados  = locales.filter(l => l.estado === 'ocupado').length
  const rentaTotal = locales.filter(l => l.estado === 'ocupado').reduce((s, l) => s + (l.renta_base ?? 0) + (l.cuota_cam ?? 0), 0)

  function startEdit(l: LocalComercial) {
    setForm({
      numero_local: l.numero_local, piso: l.piso ?? '', area_m2: l.area_m2 ?? undefined,
      giro: l.giro, inquilino_nombre: l.inquilino_nombre ?? '', inquilino_telefono: l.inquilino_telefono ?? '',
      fecha_inicio: l.fecha_inicio ?? '', fecha_fin: l.fecha_fin ?? '',
      renta_base: l.renta_base ?? undefined, porcentaje_cam: l.porcentaje_cam ?? 0,
      cuota_cam: l.cuota_cam ?? undefined, estado: l.estado, notas: l.notas ?? '',
    })
    setEditId(l.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  function recalcCAM(f: Partial<LocalComercial>) {
    if (f.renta_base && f.porcentaje_cam) {
      return { ...f, cuota_cam: parseFloat(((f.renta_base * f.porcentaje_cam) / 100).toFixed(2)) }
    }
    return f
  }

  async function handleSave() {
    if (!form.numero_local?.trim()) return Swal.fire('Campo requerido', 'Ingresa el número de local.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      numero_local: form.numero_local!.trim(), piso: form.piso || null,
      area_m2: form.area_m2 ?? null, giro: form.giro ?? 'comercio',
      inquilino_nombre: form.inquilino_nombre || null, inquilino_telefono: form.inquilino_telefono || null,
      fecha_inicio: form.fecha_inicio || null, fecha_fin: form.fecha_fin || null,
      renta_base: form.renta_base ?? null, porcentaje_cam: form.porcentaje_cam ?? 0,
      cuota_cam: form.cuota_cam ?? null, estado: form.estado ?? 'disponible',
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('locales_comerciales').update(payload).eq('id', editId)
      : await supabase.from('locales_comerciales').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar local?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('locales_comerciales').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total locales',   value: String(locales.length),  icon: '🏪', color: 'var(--at-primary)' },
          { label: 'Ocupados',        value: String(ocupados),        icon: '🔑', color: 'var(--at-accent)' },
          { label: 'Disponibles',     value: String(locales.filter(l => l.estado === 'disponible').length), icon: '✅', color: '#10b981' },
          { label: 'Renta + CAM/mes', value: rentaTotal > 0 ? `${moneda} ${rentaTotal.toFixed(0)}` : '—', icon: '💰', color: '#f59e0b' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Locales Comerciales</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Agregar Local</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Local' : 'Nuevo Local Comercial'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Número / Código *</label>
              <input style={inputStyle} value={form.numero_local ?? ''} onChange={e => setForm(f => ({ ...f, numero_local: e.target.value }))} placeholder="L-01" />
            </div>
            <div>
              <label style={labelStyle}>Piso / Nivel</label>
              <input style={inputStyle} value={form.piso ?? ''} onChange={e => setForm(f => ({ ...f, piso: e.target.value }))} placeholder="Planta baja" />
            </div>
            <div>
              <label style={labelStyle}>Área (m²)</label>
              <input style={inputStyle} type="number" min="0" step="0.1" value={form.area_m2 ?? ''} onChange={e => setForm(f => ({ ...f, area_m2: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label style={labelStyle}>Giro</label>
              <select style={inputStyle} value={form.giro ?? 'comercio'} onChange={e => setForm(f => ({ ...f, giro: e.target.value as GiroLocal }))}>
                <option value="restaurante">🍽️ Restaurante</option>
                <option value="oficina">💼 Oficina</option>
                <option value="comercio">🛍️ Comercio</option>
                <option value="servicio">🔧 Servicio</option>
                <option value="otro">📋 Otro</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoLocal }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Inquilino</label>
              <input style={inputStyle} value={form.inquilino_nombre ?? ''} onChange={e => setForm(f => ({ ...f, inquilino_nombre: e.target.value }))} placeholder="Nombre / Empresa" />
            </div>
            <div>
              <label style={labelStyle}>Teléfono inquilino</label>
              <input style={inputStyle} value={form.inquilino_telefono ?? ''} onChange={e => setForm(f => ({ ...f, inquilino_telefono: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Inicio contrato</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio ?? ''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fin contrato</label>
              <input style={inputStyle} type="date" value={form.fecha_fin ?? ''} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Renta base ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.renta_base ?? ''} onChange={e => setForm(f => recalcCAM({ ...f, renta_base: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>% CAM</label>
              <input style={inputStyle} type="number" min="0" max="100" step="0.1" value={form.porcentaje_cam ?? 0} onChange={e => setForm(f => recalcCAM({ ...f, porcentaje_cam: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Cuota CAM ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.cuota_cam ?? ''} onChange={e => setForm(f => ({ ...f, cuota_cam: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Auto-calculado" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
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
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'disponible', 'ocupado', 'en_remodelacion'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'white',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todos (${locales.length})` : `${ESTADO_CONFIG[e as EstadoLocal]?.label} (${locales.filter(l => l.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏪</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay locales registrados</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
          {filtered.map(l => {
            const est = ESTADO_CONFIG[l.estado]
            const vence = l.fecha_fin ? new Date(l.fecha_fin) < new Date() : false
            return (
              <div key={l.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${vence && l.estado === 'ocupado' ? '#fcd34d' : 'var(--at-line)'}`, borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '17px', color: 'var(--at-ink)' }}>{GIRO_ICON[l.giro]} {l.numero_local}</div>
                    {l.piso && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{l.piso}</div>}
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                  {l.area_m2 && <div>📐 {l.area_m2} m²</div>}
                  {l.inquilino_nombre && <div>👤 {l.inquilino_nombre}</div>}
                  {l.inquilino_telefono && <div>📞 {l.inquilino_telefono}</div>}
                  {(l.renta_base || l.cuota_cam) && (
                    <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>
                      💰 Renta: {moneda} {(l.renta_base ?? 0).toFixed(0)}
                      {l.cuota_cam ? ` + CAM: ${moneda} ${l.cuota_cam.toFixed(0)}` : ''}
                    </div>
                  )}
                  {l.fecha_fin && (
                    <div style={{ color: vence ? '#ef4444' : 'var(--at-ink-3)' }}>
                      📅 Vence: {l.fecha_fin}{vence ? ' ⚠️ Vencido' : ''}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => startEdit(l)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(l.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
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
