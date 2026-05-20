import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ComentarioTicket, TicketMantenimiento } from '../../../types'

interface Props {
  ticket: TicketMantenimiento
  comentarios: ComentarioTicket[]
  companyId: string
  autorNombre: string
  canCreate: boolean
  onRefresh: () => void
  onClose: () => void
}

const ESTADO_OPTIONS = ['abierto', 'en_proceso', 'resuelto', 'cerrado']
const ESTADO_COLOR: Record<string, { bg: string; color: string }> = {
  abierto:     { bg: '#fef3c7', color: '#92400e' },
  en_proceso:  { bg: '#D9E2DC', color: '#102622' },
  resuelto:    { bg: '#d1fae5', color: '#065f46' },
  cerrado:     { bg: '#EAE6D8', color: '#3E5A4C' },
}

export default function ComentariosTicketTab({ ticket, comentarios, companyId, autorNombre, canCreate, onRefresh, onClose }: Props) {
  const [contenido, setContenido] = useState('')
  const [estadoNuevo, setEstadoNuevo] = useState('')
  const [saving, setSaving] = useState(false)

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }

  async function guardar() {
    if (!contenido.trim()) { Swal.fire('Error', 'Escribe un comentario', 'warning'); return }
    setSaving(true)
    const { error: ce } = await supabase.from('comentarios_ticket').insert({
      company_id: companyId, ticket_id: ticket.id,
      autor_nombre: autorNombre,
      contenido: contenido.trim(),
      estado_nuevo: estadoNuevo || null,
    })
    if (ce) { setSaving(false); Swal.fire('Error', ce.message, 'error'); return }
    if (estadoNuevo) {
      await supabase.from('tickets_mantenimiento').update({ estado: estadoNuevo }).eq('id', ticket.id)
    }
    setSaving(false)
    setContenido('')
    setEstadoNuevo('')
    onRefresh()
  }

  const ec = ESTADO_COLOR[ticket.estado] ?? { bg: '#EAE6D8', color: '#3E5A4C' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E1DDD0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F', marginBottom: 4 }}>{ticket.titulo}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>
                {ticket.estado.replace('_', ' ')}
              </span>
              <span style={{ fontSize: 11, color: '#7E9389' }}>#{ticket.id.slice(0, 8)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#7E9389', lineHeight: 1 }}>×</button>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comentarios.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#7E9389', fontSize: 13, padding: '24px 0' }}>Sin comentarios aún</div>
          ) : (
            comentarios.map(c => {
              const esEstado = !!c.estado_nuevo
              return (
                <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EFE0D5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9C5733', flexShrink: 0 }}>
                    {c.autor_nombre.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#3E5A4C' }}>{c.autor_nombre}</span>
                      <span style={{ fontSize: 11, color: '#7E9389' }}>{new Date(c.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {esEstado && (
                        <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ESTADO_COLOR[c.estado_nuevo!]?.bg ?? '#EAE6D8', color: ESTADO_COLOR[c.estado_nuevo!]?.color ?? '#3E5A4C' }}>
                          → {c.estado_nuevo!.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#3E5A4C', background: '#FAF7EF', borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
                      {c.contenido}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Compose */}
        {canCreate && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid #E1DDD0', background: '#FAF7EF' }}>
            <textarea value={contenido} onChange={e => setContenido(e.target.value)}
              placeholder="Escribe un comentario o actualización…"
              style={{ ...inp, minHeight: 72, resize: 'vertical', marginBottom: 10, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={estadoNuevo} onChange={e => setEstadoNuevo(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="">Sin cambio de estado</option>
                {ESTADO_OPTIONS.filter(s => s !== ticket.estado).map(s => (
                  <option key={s} value={s}>→ {s.replace('_', ' ')}</option>
                ))}
              </select>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#9C5733', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {saving ? 'Enviando…' : '↩ Comentar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
