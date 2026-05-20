import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import type { InfraccionCondominio, Unidad, TipoInfraccion, EstadoInfraccion } from '../../../types'

interface Props {
  infracciones: InfraccionCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_CONFIG: Record<TipoInfraccion, { label: string; icon: string }> = {
  ruido:            { label: 'Ruido',            icon: '🔊' },
  basura:           { label: 'Basura',           icon: '🗑️' },
  estacionamiento:  { label: 'Estacionamiento',  icon: '🚗' },
  mascota:          { label: 'Mascota',          icon: '🐾' },
  'daños':          { label: 'Daños',            icon: '🔨' },
  otro:             { label: 'Otro',             icon: '⚠️' },
}

const ESTADO_CONFIG: Record<EstadoInfraccion, { label: string; bg: string; color: string }> = {
  emitida:      { label: 'Emitida',      bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  notificada:   { label: 'Notificada',   bg: '#fff7ed', color: '#ea580c' },
  en_descargo:  { label: 'En descargo',  bg: '#fef3c7', color: '#d97706' },
  resuelta:     { label: 'Resuelta',     bg: '#f0fdf4', color: '#16a34a' },
  anulada:      { label: 'Anulada',      bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

export function InfraccionesTab({ infracciones, unidades, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoInfraccion | 'todos'>('todos')
  const [form, setForm] = useState({
    unidad_id: '', tipo: 'ruido' as TipoInfraccion, descripcion: '',
    monto_multa: '', fecha_infraccion: new Date().toISOString().slice(0, 10),
    fecha_limite_descargo: '',
  })

  const filtradas = filtroEstado === 'todos' ? infracciones : infracciones.filter(i => i.estado === filtroEstado)

  const totales = {
    activas: infracciones.filter(i => !['resuelta','anulada'].includes(i.estado)).length,
    monto: infracciones.filter(i => i.estado !== 'anulada').reduce((s, i) => s + (i.monto_multa ?? 0), 0),
  }

  function resetForm() {
    setForm({ unidad_id: '', tipo: 'ruido', descripcion: '', monto_multa: '', fecha_infraccion: new Date().toISOString().slice(0, 10), fecha_limite_descargo: '' })
    setShowForm(false)
  }

  async function handleGuardar() {
    if (!form.descripcion.trim()) { toast.error('Ingrese la descripción de la infracción.'); return }
    if (!form.unidad_id) { toast.error('Seleccione la unidad infractora.'); return }
    setSaving(true)
    const { error } = await supabase.from('infracciones_condominio').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      monto_multa: form.monto_multa ? Number(form.monto_multa) : null,
      estado: 'emitida', reportado_por: userId,
      fecha_infraccion: form.fecha_infraccion,
      fecha_limite_descargo: form.fecha_limite_descargo || null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Infracción registrada')
    resetForm(); onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoInfraccion) {
    await supabase.from('infracciones_condominio').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar infracción?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('infracciones_condominio').delete().eq('id', id)
    onRefresh()
  }

  function notificarWA(i: InfraccionCondominio) {
    const msg = `⚠️ Infracción registrada\nUnidad: ${i.unidad_nombre ?? ''}\nTipo: ${TIPO_CONFIG[i.tipo].label}\nDescripción: ${i.descripcion}${i.monto_multa ? `\nMulta: ${moneda} ${i.monto_multa.toFixed(2)}` : ''}${i.fecha_limite_descargo ? `\nFecha límite descargo: ${i.fecha_limite_descargo}` : ''}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Infracciones</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {totales.activas} activas · <span style={{ fontWeight: 600, color: '#dc2626' }}>{moneda} {totales.monto.toFixed(2)} en multas</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar infracción
          </button>
        )}
      </div>

      {/* Filtro estado */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroEstado('todos')}
          style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === 'todos' ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === 'todos' ? 'var(--at-primary-tint)' : 'white', color: filtroEstado === 'todos' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
          Todas ({infracciones.length})
        </button>
        {(Object.entries(ESTADO_CONFIG) as [EstadoInfraccion, typeof ESTADO_CONFIG[EstadoInfraccion]][]).map(([e, cfg]) => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? cfg.color : 'var(--at-line)', background: filtroEstado === e ? cfg.bg : 'white', color: filtroEstado === e ? cfg.color : 'var(--at-ink-3)' }}>
            {cfg.label} ({infracciones.filter(i => i.estado === e).length})
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva infracción</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad infractora *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoInfraccion }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {(Object.entries(TIPO_CONFIG) as [TipoInfraccion, typeof TIPO_CONFIG[TipoInfraccion]][]).map(([v, c]) => (
                  <option key={v} value={v}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción *</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Describe la infracción cometida..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Monto multa ({moneda})</label>
              <input type="number" value={form.monto_multa} onChange={e => setForm(f => ({ ...f, monto_multa: e.target.value }))} placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha infracción</label>
              <input type="date" value={form.fecha_infraccion} onChange={e => setForm(f => ({ ...f, fecha_infraccion: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha límite descargo</label>
              <input type="date" value={form.fecha_limite_descargo} onChange={e => setForm(f => ({ ...f, fecha_limite_descargo: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Registrar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚖️</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay infracciones registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtradas.map(i => {
            const tipo = TIPO_CONFIG[i.tipo]
            const estado = ESTADO_CONFIG[i.estado]
            const hoy = new Date().toISOString().slice(0, 10)
            const vencida = i.fecha_limite_descargo && i.fecha_limite_descargo < hoy && i.estado === 'en_descargo'
            return (
              <div key={i.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '14px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ fontSize: '24px', flexShrink: 0, marginTop: '2px' }}>{tipo.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink-2)' }}>{tipo.label}</span>
                      {i.unidad_nombre && <span style={{ fontSize: '12.5px', color: 'var(--at-primary)', fontWeight: 600 }}>📍 {i.unidad_nombre}</span>}
                      {i.monto_multa && <span style={{ fontSize: '12.5px', color: '#dc2626', fontWeight: 700 }}>💰 {moneda} {i.monto_multa.toFixed(2)}</span>}
                      {vencida && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>Descargo vencido</span>}
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: '13.5px', color: 'var(--at-ink-2)' }}>{i.descripcion}</p>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>📅 {i.fecha_infraccion}</span>
                      {i.fecha_limite_descargo && <span>Límite descargo: {i.fecha_limite_descargo}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', flexShrink: 0 }}>
                    {canEdit ? (
                      <select value={i.estado} onChange={e => cambiarEstado(i.id, e.target.value as EstadoInfraccion)}
                        style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: estado.bg, color: estado.color }}>
                        {(Object.entries(ESTADO_CONFIG) as [EstadoInfraccion, typeof ESTADO_CONFIG[EstadoInfraccion]][]).map(([v, c]) => (
                          <option key={v} value={v}>{c.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: estado.bg, color: estado.color }}>{estado.label}</span>
                    )}
                    {!['resuelta', 'anulada'].includes(i.estado) && (
                      <button onClick={() => notificarWA(i)} title="Notificar por WhatsApp" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', fontSize: '15px', padding: '2px 4px' }}>💬</button>
                    )}
                    <button onClick={() => eliminar(i.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '15px', padding: '2px 4px' }}>🗑</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
