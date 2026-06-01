import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { supabase } from '../../../lib/supabase'
import type { ReglaNotificacion, EventoNotificacion, CanalNotificacion, DestinatarioNotificacion } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  reglas: ReglaNotificacion[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const EVENTO_LABELS: Record<EventoNotificacion, string> = {
  cuota_pendiente:    '💳 Cuota pendiente de pago',
  cuota_morosa:       '⚠️ Cuota marcada como morosa',
  visita_registrada:  '🚪 Visita registrada en portería',
  ticket_abierto:     '🔧 Ticket de mantenimiento abierto',
  ticket_resuelto:    '✓ Ticket de mantenimiento resuelto',
  reserva_confirmada: '🏊 Reserva de amenidad confirmada',
  alerta_activa:      '🔔 Alerta activa detectada',
  solicitud_nueva:    '📥 Nueva solicitud de residente',
}

const CANAL_LABELS: Record<CanalNotificacion, { label: string; icon: string; color: string }> = {
  email:    { label: 'Email',    icon: '✉️',  color: 'var(--at-primary)' },
  whatsapp: { label: 'WhatsApp', icon: '💬',  color: 'var(--at-success)' },
  push:     { label: 'Push',     icon: '🔔',  color: 'var(--at-accent)' },
  sms:      { label: 'SMS',      icon: '📱',  color: 'var(--at-warning)' },
}

const DEST_LABELS: Record<DestinatarioNotificacion, string> = {
  admin:     '👔 Solo administración',
  residente: '🏠 Solo residente afectado',
  ambos:     '👥 Ambos',
}

const BLANK = {
  nombre: '', evento: 'cuota_pendiente' as EventoNotificacion,
  canal: 'email' as CanalNotificacion, destinatario: 'admin' as DestinatarioNotificacion,
  dias_anticipacion: 0, mensaje_template: '', activo: true,
}

export function NotificacionesTab({ reglas, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function startNew() { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }

  function startEdit(r: ReglaNotificacion) {
    setEditId(r.id)
    setForm({
      nombre: r.nombre, evento: r.evento, canal: r.canal,
      destinatario: r.destinatario, dias_anticipacion: r.dias_anticipacion ?? 0,
      mensaje_template: r.mensaje_template ?? '', activo: r.activo,
    })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.nombre.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El nombre de la regla es obligatorio.' })
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(), evento: form.evento, canal: form.canal,
      destinatario: form.destinatario, dias_anticipacion: form.dias_anticipacion,
      mensaje_template: form.mensaje_template || null, activo: form.activo,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('reglas_notificacion').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('reglas_notificacion').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); onRefresh()
  }

  async function toggleActivo(r: ReglaNotificacion) {
    await supabase.from('reglas_notificacion').update({ activo: !r.activo }).eq('id', r.id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar regla?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('reglas_notificacion').delete().eq('id', id)
    onRefresh()
  }

  const activas   = reglas.filter(r => r.activo).length
  const inactivas = reglas.filter(r => !r.activo).length
  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Reglas de Notificación</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Configura qué eventos disparan notificaciones y a quién</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={startNew}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Regla
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: '8px', padding: '8px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--at-success)' }}>{activas}</span>
          <span style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>reglas activas</span>
        </div>
        <div style={{ background: 'var(--at-chip)', borderRadius: '8px', padding: '8px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--at-ink-3)' }}>{inactivas}</span>
          <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 600 }}>inactivas</span>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar regla' : 'Nueva regla'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Nombre de la regla *</label>
              <input style={inputStyle} value={form.nombre} onChange={e => setF('nombre', e.target.value)} placeholder="Ej: Aviso cuota morosa admin" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Evento disparador</label>
              <select style={inputStyle} value={form.evento} onChange={e => setF('evento', e.target.value as EventoNotificacion)}>
                {(Object.keys(EVENTO_LABELS) as EventoNotificacion[]).map(e => (
                  <option key={e} value={e}>{EVENTO_LABELS[e]}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Canal</label>
              <select style={inputStyle} value={form.canal} onChange={e => setF('canal', e.target.value as CanalNotificacion)}>
                {(Object.keys(CANAL_LABELS) as CanalNotificacion[]).map(c => (
                  <option key={c} value={c}>{CANAL_LABELS[c].icon} {CANAL_LABELS[c].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Destinatario</label>
              <select style={inputStyle} value={form.destinatario} onChange={e => setF('destinatario', e.target.value as DestinatarioNotificacion)}>
                {(Object.keys(DEST_LABELS) as DestinatarioNotificacion[]).map(d => (
                  <option key={d} value={d}>{DEST_LABELS[d]}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Días de anticipación</label>
              <input style={inputStyle} type="number" min="0" max="90" value={form.dias_anticipacion} onChange={e => setF('dias_anticipacion', parseInt(e.target.value) || 0)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
              <input type="checkbox" checked={form.activo} onChange={e => setF('activo', e.target.checked)} id="activo_regla" />
              <label htmlFor="activo_regla" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Regla activa</label>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Plantilla del mensaje</label>
              <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.mensaje_template} onChange={e => setF('mensaje_template', e.target.value)}
                placeholder="Ej: Estimado residente, su cuota del período {{periodo}} está pendiente de pago por un monto de {{monto}}." />
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px' }}>Variables: {'{{'} periodo {'}}'}, {'{{'} monto {'}}'}, {'{{'} unidad {'}}'}, {'{{'} nombre {'}}'}</div>
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

      {/* Rules list */}
      {reglas.length === 0 ? (
        <EmptyState icon="📋" title="No hay reglas configuradas. Crea una para comenzar" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {reglas.map(r => {
            const canal = CANAL_LABELS[r.canal]
            return (
              <div key={r.id} style={{ background: r.activo ? 'var(--at-surface)' : 'var(--at-surface-2)', border: `1.5px solid ${r.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ fontSize: '20px' }}>{canal.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: r.activo ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>{r.nombre}</span>
                      {!r.activo && <span style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600 }}>(inactiva)</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px' }}>
                      {EVENTO_LABELS[r.evento]} →
                      <span style={{ color: canal.color, fontWeight: 600, marginLeft: '4px' }}>{canal.label}</span>
                      <span style={{ marginLeft: '6px' }}>→ {DEST_LABELS[r.destinatario]}</span>
                      {r.dias_anticipacion > 0 && <span style={{ marginLeft: '6px', color: 'var(--at-ink-3)' }}>({r.dias_anticipacion}d anticipación)</span>}
                    </div>
                    {r.mensaje_template && (
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{r.mensaje_template}"
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button onClick={() => toggleActivo(r)}
                        style={{ padding: '3px 8px', background: r.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', color: r.activo ? 'var(--at-warning-strong)' : 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                        {r.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      <button onClick={() => startEdit(r)} style={{ padding: '3px 7px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(r.id)} style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
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
