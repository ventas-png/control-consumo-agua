import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Unidad, MensajePortal, TipoMensajePortal } from '../../../types'

interface Props {
  unidad: Unidad
  mensajes: MensajePortal[]
  proyectoId: string
  companyId: string
  isAdmin: boolean
  onRefresh: () => void
  onGenerarToken: () => void
}

const TIPO_MSG: Record<TipoMensajePortal, { label: string; icon: string }> = {
  consulta:    { label: 'Consulta',    icon: '💬' },
  queja:       { label: 'Queja',       icon: '😤' },
  sugerencia:  { label: 'Sugerencia',  icon: '💡' },
  emergencia:  { label: 'Emergencia',  icon: '🚨' },
}

const ESTADO_MSG: Record<string, { label: string; color: string }> = {
  nuevo:       { label: 'Nuevo',       color: '#2563eb' },
  leido:       { label: 'Leído',       color: '#64748b' },
  respondido:  { label: 'Respondido',  color: '#16a34a' },
  cerrado:     { label: 'Cerrado',     color: '#94a3b8' },
}

function blankMsg() {
  return { asunto: '', cuerpo: '', tipo: 'consulta' as TipoMensajePortal }
}

export function PortalMiUnidadTab({ unidad, mensajes, proyectoId, companyId, isAdmin, onRefresh, onGenerarToken }: Props) {
  const [showMsgForm, setShowMsgForm] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [msgForm, setMsgForm]         = useState(blankMsg())

  async function enviarMensaje() {
    if (!msgForm.asunto.trim() || !msgForm.cuerpo.trim()) {
      Swal.fire('Error', 'Complete asunto y mensaje.', 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('mensajes_portal').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: unidad.id,
      asunto: msgForm.asunto.trim(), cuerpo: msgForm.cuerpo.trim(), tipo: msgForm.tipo,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: '¡Mensaje enviado!', text: 'La administración lo revisará pronto.', timer: 1800, showConfirmButton: false })
    setMsgForm(blankMsg()); setShowMsgForm(false); onRefresh()
  }

  async function responderMensaje(id: string) {
    const { value: respuesta } = await Swal.fire({
      title: 'Responder al residente', input: 'textarea', inputPlaceholder: 'Escriba la respuesta...',
      showCancelButton: true, confirmButtonText: 'Enviar respuesta', cancelButtonText: 'Cancelar',
    })
    if (!respuesta) return
    await supabase.from('mensajes_portal').update({ estado: 'respondido', respuesta: respuesta as string, respondido_en: new Date().toISOString() }).eq('id', id)
    onRefresh()
  }

  const portalUrl = unidad.token_portal
    ? `${window.location.origin}/portal/${unidad.token_portal}`
    : null

  return (
    <div>
      {/* Info de la unidad */}
      <div style={{ background: 'linear-gradient(135deg,#1e40af,#1d4ed8)', borderRadius: '16px', padding: '20px', marginBottom: '22px', color: 'white' }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>🏠</div>
        <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '4px' }}>{unidad.nombre}</div>
        <div style={{ fontSize: '13.5px', opacity: 0.85, display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {unidad.tipo && <span>{unidad.tipo.replace('_', ' ')}</span>}
          {unidad.piso != null && <span>Piso {unidad.piso}</span>}
          {unidad.area_m2 && <span>{unidad.area_m2} m²</span>}
          {unidad.estado_ocupacional && <span>{unidad.estado_ocupacional}</span>}
        </div>
        {unidad.propietario_nombre && (
          <div style={{ marginTop: '10px', fontSize: '13px', opacity: 0.75 }}>
            Propietario: {unidad.propietario_nombre}
            {unidad.propietario_telefono && ` · ${unidad.propietario_telefono}`}
          </div>
        )}
      </div>

      {/* Link del portal (solo admin) */}
      {isAdmin && (
        <div style={{ background: '#f5f3ff', border: '1.5px solid #ddd6fe', borderRadius: '14px', padding: '16px', marginBottom: '22px' }}>
          <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#6d28d9', marginBottom: '8px' }}>🔗 Enlace del portal del residente</div>
          {portalUrl ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: 1, background: 'white', border: '1px solid #ddd6fe', borderRadius: '7px', padding: '7px 10px', fontSize: '12px', color: '#4c1d95', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {portalUrl}
              </code>
              <button onClick={() => { navigator.clipboard.writeText(portalUrl); Swal.fire({ icon: 'success', title: '¡Copiado!', timer: 1000, showConfirmButton: false }) }}
                style={{ padding: '7px 14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                📋 Copiar
              </button>
              <button onClick={onGenerarToken}
                style={{ padding: '7px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                🔄 Regenerar
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: '#64748b' }}>Sin enlace activo.</span>
              <button onClick={onGenerarToken}
                style={{ padding: '7px 16px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Generar enlace
              </button>
            </div>
          )}
          <p style={{ margin: '8px 0 0', fontSize: '11.5px', color: '#7c3aed', opacity: 0.75 }}>
            Comparte este enlace con el propietario para que acceda a su portal personal.
          </p>
        </div>
      )}

      {/* Mensajes al administrador */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Mensajes a la administración</h4>
        {!isAdmin && (
          <button onClick={() => setShowMsgForm(true)}
            style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Enviar mensaje
          </button>
        )}
      </div>

      {showMsgForm && (
        <div style={{ background: 'white', border: '1.5px solid #bfdbfe', borderRadius: '12px', padding: '16px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
              {(Object.entries(TIPO_MSG) as [TipoMensajePortal, typeof TIPO_MSG[TipoMensajePortal]][]).map(([k, v]) => (
                <button key={k} onClick={() => setMsgForm(f => ({ ...f, tipo: k }))}
                  style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid', borderColor: msgForm.tipo === k ? '#2563eb' : '#e2e8f0', background: msgForm.tipo === k ? '#eff6ff' : 'white', color: msgForm.tipo === k ? '#2563eb' : '#94a3b8' }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
            <input value={msgForm.asunto} onChange={e => setMsgForm(f => ({ ...f, asunto: e.target.value }))} placeholder="Asunto *"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            <textarea value={msgForm.cuerpo} onChange={e => setMsgForm(f => ({ ...f, cuerpo: e.target.value }))} placeholder="Escriba su mensaje..." rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={enviarMensaje} disabled={saving} style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Enviando...' : '📤 Enviar'}
            </button>
            <button onClick={() => { setShowMsgForm(false); setMsgForm(blankMsg()) }} style={{ padding: '9px 14px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {mensajes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
          <p style={{ fontWeight: 600, color: '#64748b', fontSize: '13px' }}>Sin mensajes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {mensajes.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(m => {
            const tc = TIPO_MSG[m.tipo]
            const ec = ESTADO_MSG[m.estado] ?? ESTADO_MSG.nuevo
            return (
              <div key={m.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>{m.asunto}</span>
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: ec.color }}>{ec.label}</span>
                    </div>
                    <p style={{ margin: '0 0 5px', fontSize: '13px', color: '#374151' }}>{m.cuerpo}</p>
                    {m.respuesta && (
                      <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '8px 12px', marginTop: '6px' }}>
                        <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#16a34a', marginBottom: '2px' }}>Respuesta de administración:</div>
                        <div style={{ fontSize: '13px', color: '#374151' }}>{m.respuesta}</div>
                      </div>
                    )}
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '4px' }}>
                      {new Date(m.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  {isAdmin && m.estado !== 'respondido' && m.estado !== 'cerrado' && (
                    <button onClick={() => responderMensaje(m.id)}
                      style={{ padding: '5px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>
                      Responder
                    </button>
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
