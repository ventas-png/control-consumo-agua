import { useState, type CSSProperties } from 'react'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { CATEGORY_ICONS, CATEGORY_LABELS, tint } from '../comunicacion/conversationConstants'
import type { ConversationCategory, ConversationPriority } from '../../types'

// "Nueva consulta" del portal del cliente, en ventana emergente. Antes el
// formulario reemplazaba la lista en la página; ahora se abre encima y, al
// enviarse, deja paso directamente al chat de la consulta creada.

export interface NuevaConsultaData {
  subject: string
  category: ConversationCategory
  priority: ConversationPriority
  message: string
}

interface Props {
  onClose: () => void
  /** Crea la consulta. Devuelve el error legible, o null si salió bien. */
  onSubmit: (data: NuevaConsultaData) => Promise<string | null>
}

const URGENCIAS: [ConversationPriority, string, string][] = [
  ['baja', 'Baja', 'var(--at-success)'],
  ['media', 'Normal', 'var(--at-warning)'],
  ['alta', 'Alta', 'var(--at-danger)'],
]

const labelStyle: CSSProperties = {
  fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px',
}
const fieldStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', boxSizing: 'border-box',
  border: '1px solid var(--at-line-strong)', borderRadius: '10px',
  fontSize: '14px', fontFamily: 'inherit', background: 'var(--at-surface)', color: 'var(--at-ink)',
}

export function NuevaConsultaModal({ onClose, onSubmit }: Props) {
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<ConversationCategory>('general')
  const [priority, setPriority] = useState<ConversationPriority>('media')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setError('')
    if (!subject.trim()) { setError('El asunto es requerido.'); return }
    if (!message.trim()) { setError('Debes escribir el primer mensaje.'); return }
    setSending(true)
    const err = await onSubmit({ subject, category, priority, message })
    setSending(false)
    if (err) setError(err)
  }

  return (
    <EditModal
      title="Nueva consulta"
      subtitle="Cuéntanos qué necesitas y te responderemos por aquí."
      size="sm"
      maxWidth="560px"
      fullScreenOnMobile
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button variant="gradient-primary" onClick={handleSubmit} loading={sending} loadingText="Enviando…">
            Enviar consulta
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div role="radiogroup" aria-label="Tipo de consulta">
          <span style={labelStyle}>Tipo de consulta</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            {(Object.keys(CATEGORY_LABELS) as ConversationCategory[]).map(cat => {
              const active = category === cat
              return (
                <button
                  key={cat}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCategory(cat)}
                  style={{
                    padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${active ? 'var(--at-primary)' : 'var(--at-line)'}`,
                    background: active ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
                    fontSize: '13.5px', fontWeight: active ? 700 : 500,
                    color: active ? 'var(--at-primary-hover)' : 'var(--at-ink-2)',
                  }}
                >
                  <span style={{ fontSize: '18px', flexShrink: 0 }}>{CATEGORY_ICONS[cat]}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CATEGORY_LABELS[cat]}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label htmlFor="nueva-consulta-asunto" style={labelStyle}>Asunto *</label>
          <input
            id="nueva-consulta-asunto"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Ej: Consulta sobre mi factura de marzo"
            maxLength={120}
            style={fieldStyle}
          />
        </div>

        <div role="radiogroup" aria-label="Urgencia">
          <span style={labelStyle}>Urgencia</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {URGENCIAS.map(([val, label, color]) => {
              const active = priority === val
              return (
                <button
                  key={val}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPriority(val)}
                  style={{
                    padding: '7px 16px', borderRadius: '999px', cursor: 'pointer',
                    border: `2px solid ${active ? color : 'var(--at-line)'}`,
                    background: active ? tint(color) : 'var(--at-surface)',
                    color: active ? color : 'var(--at-ink-3)',
                    fontSize: '13px', fontWeight: 700,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label htmlFor="nueva-consulta-mensaje" style={labelStyle}>Describe tu consulta *</label>
          <textarea
            id="nueva-consulta-mensaje"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Explica tu consulta con el mayor detalle posible…"
            rows={5}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
        </div>

        {error && (
          <div role="alert" style={{
            background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)',
            borderRadius: '8px', padding: '10px 12px', color: 'var(--at-danger-strong)', fontSize: '13px',
          }}>
            {error}
          </div>
        )}
      </div>
    </EditModal>
  )
}
