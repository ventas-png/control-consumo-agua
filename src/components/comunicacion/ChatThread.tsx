import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { AttachmentImage, AttachmentLink } from './ChatAttachments'
import { dayKey, dayLabel, getFileIcon, initials } from './conversationConstants'
import type { ConversationMessage } from '../../types'

// Hilo de una conversación: burbujas, separadores de día y scroll al último
// mensaje. Lo usan la ventana del equipo (ConversationDetailModal) y la del
// portal del cliente (CustomerConversationModal), cada una desde su lado: los
// mensajes de quien mira van a la derecha.

interface Props {
  /** Mensajes de UNA conversación, en orden cronológico. */
  messages: ConversationMessage[]
  /** Quién lee el hilo. El portal ya llega sin notas internas. */
  viewer: 'agent' | 'cliente'
  /** Lo que se muestra cuando todavía no hay mensajes. */
  empty: ReactNode
}

export function ChatThread({ messages, viewer, empty }: Props) {
  // Como en cualquier chat, se abre mirando el último mensaje y se sigue al
  // final cuando llega uno nuevo. `?.()` porque jsdom no implementa scrollIntoView.
  const endRef = useRef<HTMLDivElement>(null)
  const conversationId = messages[0]?.conversation_id
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, conversationId])

  return (
    <div style={{
      flex: 1, padding: '16px', background: 'var(--at-surface-2)',
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {messages.length === 0 ? (
        <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px' }}>
          <div style={{ fontSize: '34px', marginBottom: '8px' }}>💬</div>
          <div style={{ fontSize: '13.5px' }}>{empty}</div>
        </div>
      ) : (
        messages.map((msg, i) => {
          const newDay = i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(msg.created_at)
          return (
            <Fragment key={msg.id}>
              {newDay && <DaySeparator label={dayLabel(msg.created_at)} />}
              <MessageBubble msg={msg} viewer={viewer} />
            </Fragment>
          )
        })
      )}
      <div ref={endRef} />
    </div>
  )
}

export function Avatar({ name, size = 28, tone = 'accent' }: { name?: string | null; size?: number; tone?: 'accent' | 'primary' }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700,
      background: tone === 'primary' ? 'var(--at-primary-soft)' : 'var(--at-accent-tint)',
      color: tone === 'primary' ? 'var(--at-primary-hover)' : 'var(--at-accent-dark)',
    }}>
      {initials(name)}
    </span>
  )
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div role="separator" style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 2px' }}>
      <span style={{
        fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)',
        background: 'var(--at-surface)', border: '1px solid var(--at-line)',
        padding: '3px 10px', borderRadius: '999px',
      }}>
        {label}
      </span>
    </div>
  )
}

function MessageBubble({ msg, viewer }: { msg: ConversationMessage; viewer: Props['viewer'] }) {
  const mine = msg.sender_type === viewer
  const isNote = msg.is_internal_note
  // El equipo ve el nombre en todas las burbujas (responden varios agentes);
  // el cliente solo en las de la empresa: las suyas son obviamente suyas.
  const showName = viewer === 'agent' || !mine
  const fallbackName = viewer === 'cliente' ? 'Empresa' : 'Usuario'
  const skin: CSSProperties = isNote
    ? { background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1px dashed var(--at-warning-border)' }
    : mine
      ? { background: 'var(--at-primary)', color: 'var(--at-on-status)', border: '1px solid transparent' }
      : { background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line)' }

  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '8px' }}>
      {!mine && <Avatar name={msg.sender_name ?? fallbackName} tone={viewer === 'cliente' ? 'primary' : 'accent'} />}
      <div style={{
        maxWidth: 'min(80%, 520px)',
        padding: showName ? '9px 13px 7px' : '10px 13px 7px',
        borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        ...skin,
      }}>
        {showName && (
          <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '3px', opacity: isNote ? 1 : 0.75 }}>
            {isNote ? '🔒 Nota interna · ' : ''}{msg.sender_name ?? fallbackName}
          </div>
        )}
        {msg.body && (
          <div style={{ fontSize: '14px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.body}
          </div>
        )}
        {msg.attachment_url && msg.attachment_type?.startsWith('image/') && (
          <AttachmentImage src={msg.attachment_url} name={msg.attachment_name ?? undefined} body={msg.body} />
        )}
        {msg.attachment_url && !msg.attachment_type?.startsWith('image/') && (
          <AttachmentLink
            src={msg.attachment_url}
            name={msg.attachment_name ?? undefined}
            type={msg.attachment_type}
            size={msg.attachment_size}
            getIcon={getFileIcon}
            body={msg.body}
          />
        )}
        <div style={{ fontSize: '10.5px', opacity: 0.65, marginTop: '4px', textAlign: 'right' }}>
          {new Date(msg.created_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
