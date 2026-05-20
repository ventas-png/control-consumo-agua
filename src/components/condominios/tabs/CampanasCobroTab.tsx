import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { toast } from '../../../lib/toast'
import { CampanaCobro, CanalCampana, EstadoCampana, CuotaCondominio, Unidad } from '../../../types'

interface Props {
  campanas: CampanaCobro[]
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CANAL_CFG: Record<CanalCampana, { label: string; icon: string; bg: string; color: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '💬', bg: '#dcfce7', color: '#16a34a' },
  email:    { label: 'Email',    icon: '✉️',  bg: '#EEF2EC', color: '#1B3B36' },
  sms:      { label: 'SMS',      icon: '📱', bg: '#FAF1EA', color: '#9C5733' },
}
const ESTADO_CFG: Record<EstadoCampana, { label: string; bg: string; color: string }> = {
  borrador:   { label: 'Borrador',   bg: '#EAE6D8', color: '#7E9389' },
  enviada:    { label: 'Enviada',    bg: '#D9E2DC', color: '#102622' },
  completada: { label: 'Completada', bg: '#dcfce7', color: '#16a34a' },
}

const BLANK = {
  nombre: '', mensaje: '', canal: 'whatsapp' as CanalCampana,
  criterio_dias_mora: '', criterio_monto_min: '',
}

export default function CampanasCobroTab({ campanas, cuotas, unidades, proyectoId, companyId, moneda, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<CampanaCobro | null>(null)
  const [form, setForm] = useState(BLANK)

  // Compute moroso units for preview
  const morosas = unidades.filter(u => {
    const cuotasU = cuotas.filter(c => c.unidad_id === u.id && c.estado === 'moroso')
    return cuotasU.length > 0
  })

  const filteredPreview = morosas.filter(u => {
    const deuda = cuotas.filter(c => c.unidad_id === u.id && c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)
    if (form.criterio_monto_min && deuda < parseFloat(form.criterio_monto_min)) return false
    return true
  })

  async function crear() {
    if (!form.nombre.trim() || !form.mensaje.trim()) {
      toast.warning('Nombre y mensaje son obligatorios'); return
    }
    setSaving(true)
    const { error } = await supabase.from('campanas_cobro').insert({
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), mensaje: form.mensaje.trim(),
      canal: form.canal,
      criterio_dias_mora: form.criterio_dias_mora ? parseInt(form.criterio_dias_mora) : null,
      criterio_monto_min: form.criterio_monto_min ? parseFloat(form.criterio_monto_min) : null,
      total_destinatarios: filteredPreview.length,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function enviar(c: CampanaCobro) {
    const { isConfirmed } = await Swal.fire({
      title: `¿Enviar campaña?`,
      html: `<p style="font-size:13px">Se registrará el envío de <strong>${c.total_destinatarios}</strong> mensajes por <strong>${CANAL_CFG[c.canal].label}</strong>.</p>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: 'Enviar', cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    await supabase.from('campanas_cobro').update({
      estado: 'enviada', enviadas: c.total_destinatarios,
      enviada_por: autorNombre, fecha_envio: new Date().toISOString(),
    }).eq('id', c.id)
    toast.success('Campaña enviada')
    onRefresh()
  }

  async function completar(id: string) {
    await supabase.from('campanas_cobro').update({ estado: 'completada' }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const { isConfirmed } = await Swal.fire({ title: '¿Eliminar campaña?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!isConfirmed) return
    await supabase.from('campanas_cobro').delete().eq('id', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  const totalEnviadas = campanas.reduce((s, c) => s + c.enviadas, 0)
  const completadas = campanas.filter(c => c.estado === 'completada').length

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total campañas', val: campanas.length, bg: '#FAF7EF', color: '#3E5A4C' },
          { label: 'Enviadas', val: campanas.filter(c => c.estado === 'enviada').length, bg: '#EEF2EC', color: '#1B3B36' },
          { label: 'Completadas', val: completadas, bg: '#dcfce7', color: '#16a34a' },
          { label: 'Mensajes enviados', val: totalEnviadas, bg: '#FAF1EA', color: '#9C5733' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#7E9389' }}>
          <strong>{morosas.length}</strong> unidades morosas en el proyecto
        </span>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#9C5733', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva campaña'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#FAF1EA', border: '1px solid var(--at-accent-soft-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nueva campaña de cobro</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Nombre de la campaña *</label>
              <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Recordatorio cuotas Q1 2026" />
            </div>
            <div>
              <label style={lbl}>Canal</label>
              <select style={inp} value={form.canal} onChange={e => setForm(p => ({ ...p, canal: e.target.value as CanalCampana }))}>
                {(Object.keys(CANAL_CFG) as CanalCampana[]).map(c => <option key={c} value={c}>{CANAL_CFG[c].icon} {CANAL_CFG[c].label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Mensaje *</label>
              <textarea style={{ ...inp, height: 80, resize: 'vertical' }} value={form.mensaje} onChange={e => setForm(p => ({ ...p, mensaje: e.target.value }))} placeholder="Estimado residente, le informamos que tiene cuotas pendientes..." />
            </div>
            <div>
              <label style={lbl}>Solo unidades con mora ≥ X días</label>
              <input type="number" min={0} style={inp} value={form.criterio_dias_mora} onChange={e => setForm(p => ({ ...p, criterio_dias_mora: e.target.value }))} placeholder="Ej. 30" />
            </div>
            <div>
              <label style={lbl}>Solo deuda ≥ {moneda}</label>
              <input type="number" step="0.01" min={0} style={inp} value={form.criterio_monto_min} onChange={e => setForm(p => ({ ...p, criterio_monto_min: e.target.value }))} placeholder="Ej. 100.00" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ padding: '8px 14px', background: '#EFE0D5', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#5E3417' }}>
                👥 {filteredPreview.length} destinatarios
              </div>
            </div>
          </div>
          <button onClick={crear} disabled={saving}
            style={{ padding: '8px 20px', background: '#9C5733', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear campaña'}
          </button>
        </div>
      )}

      {/* Lista + Detalle */}
      {campanas.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📣</div>
          Sin campañas de cobro — crea una para notificar a morosos en masa
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {campanas.map(c => {
              const cc = CANAL_CFG[c.canal]
              const ec = ESTADO_CFG[c.estado]
              const pct = c.total_destinatarios > 0 ? Math.round((c.enviadas / c.total_destinatarios) * 100) : 0
              return (
                <div key={c.id} onClick={() => setSelected(c === selected ? null : c)}
                  style={{ background: selected?.id === c.id ? '#FAF1EA' : '#fff', border: `1.5px solid ${selected?.id === c.id ? '#CE8A63' : '#E1DDD0'}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 16 }}>{cc.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{c.nombre}</span>
                        <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                        <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: cc.bg, color: cc.color }}>{cc.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#7E9389' }}>
                        {c.total_destinatarios} destinatarios
                        {c.criterio_dias_mora && ` · mora ≥ ${c.criterio_dias_mora}d`}
                        {c.criterio_monto_min && ` · deuda ≥ ${moneda} ${c.criterio_monto_min}`}
                      </div>
                    </div>
                    {c.estado === 'borrador' && canEdit && (
                      <button onClick={e => { e.stopPropagation(); enviar(c) }}
                        style={{ padding: '6px 12px', background: '#9C5733', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        🚀 Enviar
                      </button>
                    )}
                  </div>
                  {c.estado !== 'borrador' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, background: '#E1DDD0', borderRadius: 20, height: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#9C5733', width: `${pct}%`, borderRadius: 20 }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#7E9389', whiteSpace: 'nowrap' }}>{c.enviadas}/{c.total_destinatarios} enviadas</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 260, flexShrink: 0, background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Detalle</div>
              <div style={{ fontSize: 12, color: '#3E5A4C', lineHeight: 1.6, background: '#FAF7EF', borderRadius: 8, padding: '10px 12px', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                {selected.mensaje}
              </div>
              {[
                ['Canal', `${CANAL_CFG[selected.canal].icon} ${CANAL_CFG[selected.canal].label}`],
                ['Destinatarios', selected.total_destinatarios],
                ['Enviadas', selected.enviadas],
                ['Fallidas', selected.fallidas],
                ['Enviada por', selected.enviada_por ?? '—'],
                ['Fecha envío', selected.fecha_envio ? new Date(selected.fecha_envio).toLocaleString('es') : '—'],
              ].map(([k, v]) => (
                <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--at-chip)' }}>
                  <span style={{ color: '#7E9389' }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {selected.estado === 'enviada' && canEdit && (
                  <button onClick={() => completar(selected.id)}
                    style={{ flex: 1, padding: '7px 0', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    ✅ Completar
                  </button>
                )}
                {selected.estado === 'borrador' && canEdit && (
                  <button onClick={() => eliminar(selected.id)}
                    style={{ flex: 1, padding: '7px 0', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    🗑 Eliminar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
