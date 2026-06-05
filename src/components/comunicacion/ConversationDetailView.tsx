import { AttachmentImage, AttachmentLink } from './ChatAttachments'
import { MessageComposer } from './MessageComposer'
import {
  CATEGORY_LABELS, PRIORITY_LABELS, PRIORITY_COLORS,
  STATUS_LABELS, STATUS_COLORS, getFileIcon,
} from './conversationConstants'
import type { Conversation, ConversationMessage, ConversationStatus } from '../../types'

interface Assignment {
  id: string
  user_name: string
}

// Detalle de conversación (header + asignaciones + mensajes + compositor).
// Extraído de ComunicacionSection (com:N6) sin cambiar comportamiento.
interface Props {
  conversation: Conversation
  messages: ConversationMessage[]
  canCreate: boolean
  canEdit: boolean
  currentUserId: string
  activeAssignments: Assignment[]
  onBack: () => void
  onChangeStatus: (status: ConversationStatus) => void
  onAssignToMe: () => void
  onUnassign: () => void
  onOpenAssignModal: () => void
  onRemoveAssignment: (assignmentId: string) => void
  // Composer
  messageText: string
  onChangeMessage: (v: string) => void
  isInternalNote: boolean
  onToggleInternalNote: (v: boolean) => void
  pendingFile: File | null
  onPickFile: (file: File | null) => void
  sending: boolean
  onSendMessage: () => void
}

export function ConversationDetailView({
  conversation, messages, canCreate, canEdit, currentUserId, activeAssignments,
  onBack, onChangeStatus, onAssignToMe, onUnassign, onOpenAssignModal, onRemoveAssignment,
  messageText, onChangeMessage, isInternalNote, onToggleInternalNote,
  pendingFile, onPickFile, sending, onSendMessage,
}: Props) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      border: '1px solid var(--at-line)',
      borderRadius: '12px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: '500px',
    }}>
      {/* Header conversación */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--at-chip)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={onBack}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '18px', padding: '0', lineHeight: 1 }}
            >
              ←
            </button>
            <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{conversation.subject}</span>
            <span style={{
              fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
              background: STATUS_COLORS[conversation.status] + '18',
              color: STATUS_COLORS[conversation.status], fontWeight: 600,
            }}>
              {STATUS_LABELS[conversation.status]}
            </span>
            <span style={{
              fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
              background: PRIORITY_COLORS[conversation.priority] + '18',
              color: PRIORITY_COLORS[conversation.priority], fontWeight: 600,
            }}>
              {PRIORITY_LABELS[conversation.priority]}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px', marginLeft: '26px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {conversation.is_internal ? (
              <span style={{ background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', fontWeight: 600 }}>
                🏢 Discusión interna de equipo
              </span>
            ) : (
              <span>{conversation.cliente_nombre} ·</span>
            )}
            <span>{CATEGORY_LABELS[conversation.category]}</span>
            {conversation.assigned_name && <span>· Agente: {conversation.assigned_name}</span>}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
            <select
              value={conversation.status}
              onChange={e => onChangeStatus(e.target.value as ConversationStatus)}
              style={{
                padding: '6px 10px',
                border: '1px solid var(--at-line-strong)',
                borderRadius: '8px',
                fontSize: '12px',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {/* Asignación principal */}
            {conversation.assigned_name ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                  👤 {conversation.assigned_name}
                </span>
                <button
                  onClick={onUnassign}
                  style={{ background: 'none', border: '1px solid var(--at-line-strong)', borderRadius: '6px', fontSize: '11px', color: 'var(--at-ink-3)', cursor: 'pointer', padding: '2px 8px' }}
                >
                  Desasignar
                </button>
                {conversation.assigned_to !== currentUserId && (
                  <button
                    onClick={onAssignToMe}
                    style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '6px', fontSize: '11px', color: 'var(--at-primary-hover)', cursor: 'pointer', padding: '2px 8px', fontWeight: 600 }}
                  >
                    Asignarme
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={onAssignToMe}
                style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--at-primary-hover)', cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}
              >
                + Asignarme
              </button>
            )}
            {/* Asignación a equipo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
              <button
                onClick={onOpenAssignModal}
                style={{
                  background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '6px',
                  fontSize: '11.5px', color: 'var(--at-success-strong)', cursor: 'pointer', padding: '4px 10px', fontWeight: 600,
                }}
              >
                👥 Asignar a...
              </button>
              {activeAssignments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end' }}>
                  {activeAssignments.map(a => (
                    <span
                      key={a.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        background: 'var(--at-accent-tint)', color: 'var(--at-accent-dark)',
                        fontSize: '11px', padding: '2px 6px', borderRadius: '999px', fontWeight: 500,
                      }}
                    >
                      {a.user_name}
                      <button
                        onClick={() => onRemoveAssignment(a.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-accent-hover)', padding: '0', lineHeight: 1, fontSize: '12px' }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mensajes */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px', marginTop: '40px' }}>
            No hay mensajes aún
          </div>
        ) : (
          messages.map(msg => {
            const isAgent = msg.sender_type === 'agent'
            const isNote = msg.is_internal_note
            return (
              <div key={msg.id} style={{
                display: 'flex',
                justifyContent: isAgent ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '72%',
                  padding: '10px 13px',
                  borderRadius: isAgent ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                  background: isNote
                    ? 'var(--at-warning-tint)'
                    : isAgent
                    ? 'var(--at-primary)'
                    : 'var(--at-chip)',
                  color: isNote ? 'var(--at-warning-strong)' : isAgent ? 'white' : 'var(--at-ink)',
                  border: isNote ? '1px solid var(--at-warning-border)' : 'none',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', opacity: 0.7 }}>
                    {isNote ? '📝 Nota interna · ' : ''}{msg.sender_name ?? 'Usuario'}
                  </div>
                  {msg.body && (
                    <div style={{ fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
                      getIcon={getFileIcon}
                      body={msg.body}
                    />
                  )}
                  <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '5px', textAlign: 'right' }}>
                    {new Date(msg.created_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Compositor de mensaje */}
      {canCreate && conversation.status !== 'cerrada' && (
        <MessageComposer
          isInternalConversation={!!conversation.is_internal}
          isInternalNote={isInternalNote}
          onToggleInternalNote={onToggleInternalNote}
          pendingFile={pendingFile}
          onPickFile={onPickFile}
          messageText={messageText}
          onChangeMessage={onChangeMessage}
          sending={sending}
          onSend={onSendMessage}
        />
      )}

      {conversation.status === 'cerrada' && (
        <div style={{
          borderTop: '1px solid var(--at-chip)', padding: '12px 14px',
          background: 'var(--at-surface-2)', textAlign: 'center',
          fontSize: '12.5px', color: 'var(--at-ink-3)',
        }}>
          Esta conversación está cerrada.
          {canEdit && (
            <button
              onClick={() => onChangeStatus('abierta')}
              style={{ marginLeft: '10px', color: 'var(--at-primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
            >
              Reabrir
            </button>
          )}
        </div>
      )}
    </div>
  )
}
