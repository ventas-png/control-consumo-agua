import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
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
  abierto:     { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  en_proceso:  { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  resuelto:    { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  cerrado:     { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
}

export default function ComentariosTicketTab({ ticket, comentarios, companyId, autorNombre, canCreate, onRefresh, onClose }: Props) {
  const [contenido, setContenido] = useState('')
  const [estadoNuevo, setEstadoNuevo] = useState('')
  const [saving, setSaving] = useState(false)

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }

  async function guardar() {
    if (!contenido.trim()) { notify({ variant: 'warning', title: 'Error', text: 'Escribe un comentario' }); return }
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

  const ec = ESTADO_COLOR[ticket.estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--at-surface)', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 4 }}>{ticket.titulo}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>
                {ticket.estado.replace('_', ' ')}
              </span>
              <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>#{ticket.id.slice(0, 8)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--at-ink-3)', lineHeight: 1 }}>×</button>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {comentarios.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', fontSize: 13, padding: '24px 0' }}>Sin comentarios aún</div>
          ) : (
            comentarios.map(c => {
              const esEstado = !!c.estado_nuevo
              return (
                <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--at-accent-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--at-accent-hover)', flexShrink: 0 }}>
                    {c.autor_nombre.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)' }}>{c.autor_nombre}</span>
                      <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{new Date(c.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {esEstado && (
                        <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ESTADO_COLOR[c.estado_nuevo!]?.bg ?? 'var(--at-chip)', color: ESTADO_COLOR[c.estado_nuevo!]?.color ?? 'var(--at-ink-2)' }}>
                          → {c.estado_nuevo!.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--at-ink-2)', background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
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
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
            <textarea value={contenido} onChange={e => setContenido(e.target.value)}
              placeholder="Escribe un comentario o actualización…"
              style={{ ...inp, minHeight: 72, resize: 'vertical', marginBottom: 10, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={estadoNuevo} onChange={e => setEstadoNuevo(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, background: 'var(--at-surface)' }}>
                <option value="">Sin cambio de estado</option>
                {ESTADO_OPTIONS.filter(s => s !== ticket.estado).map(s => (
                  <option key={s} value={s}>→ {s.replace('_', ' ')}</option>
                ))}
              </select>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {saving ? 'Enviando…' : '↩ Comentar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
