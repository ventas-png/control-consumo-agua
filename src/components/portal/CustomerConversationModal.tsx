import type { ReactNode } from 'react'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { ChatThread } from '../comunicacion/ChatThread'
import { MessageComposer } from '../comunicacion/MessageComposer'
import { StatusPill } from '../comunicacion/ConversationBadges'
import { CATEGORY_ICONS, CATEGORY_LABELS, STATUS_LABELS_CLIENTE } from '../comunicacion/conversationConstants'
import type { Conversation, ConversationMessage } from '../../types'

// Chat del portal del cliente en ventana emergente. Es la misma ventana que
// usa el equipo (hilo y compositor compartidos), vista desde el otro lado: los
// mensajes del cliente a la derecha, sin notas internas ni gestión.
interface Props {
  conversation: Conversation
  messages: ConversationMessage[]
  messageText: string
  onChangeMessage: (v: string) => void
  pendingFile: File | null
  onPickFile: (file: File | null) => void
  sending: boolean
  onSend: () => void
  onClose: () => void
  /** Desde una consulta ya cerrada, abrir una nueva. */
  onNewConsulta: () => void
}

export function CustomerConversationModal({
  conversation, messages, messageText, onChangeMessage, pendingFile, onPickFile,
  sending, onSend, onClose, onNewConsulta,
}: Props) {
  // Solo esta conversación (el hook conserva la anterior hasta que responde la
  // consulta) y nunca las notas internas del equipo.
  const thread = messages.filter(m => m.conversation_id === conversation.id && !m.is_internal_note)
  const finished = conversation.status === 'cerrada' || conversation.status === 'resuelta'

  const subtitle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px', fontSize: '12.5px' }}>
      <StatusPill status={conversation.status} label={STATUS_LABELS_CLIENTE[conversation.status]} />
      <span>{CATEGORY_ICONS[conversation.category]} {CATEGORY_LABELS[conversation.category]}</span>
      {conversation.assigned_name && <span>👤 Te atiende {conversation.assigned_name}</span>}
    </div>
  )

  let footer: ReactNode
  if (!finished) {
    footer = (
      <MessageComposer
        allowInternalNote={false}
        isInternalNote={false}
        onToggleInternalNote={() => {}}
        pendingFile={pendingFile}
        onPickFile={onPickFile}
        messageText={messageText}
        onChangeMessage={onChangeMessage}
        sending={sending}
        onSend={onSend}
        placeholder="Escribe tu mensaje…"
      />
    )
  } else {
    footer = (
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>
          {conversation.status === 'resuelta'
            ? '✅ Esta consulta fue marcada como resuelta.'
            : '🔒 Esta conversación está cerrada.'}
        </span>
        <Button variant="outline-primary" size="sm" onClick={onNewConsulta}>
          ¿Algo más? Nueva consulta
        </Button>
      </div>
    )
  }

  return (
    <EditModal
      title={conversation.subject}
      subtitle={subtitle}
      onClose={onClose}
      maxWidth="680px"
      height="780px"
      fullScreenOnMobile
      noPadding
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <ChatThread
          messages={thread}
          viewer="cliente"
          empty={finished ? 'Esta conversación no tiene mensajes.' : 'Aún no hay mensajes. Escríbenos abajo.'}
        />
      </div>
    </EditModal>
  )
}
