import { useState, type CSSProperties, type ReactNode } from 'react'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { Avatar, ChatThread } from './ChatThread'
import { MessageComposer } from './MessageComposer'
import { PriorityPill, StatusPill } from './ConversationBadges'
import { CATEGORY_ICONS, CATEGORY_LABELS, STATUS_LABELS } from './conversationConstants'
import type { Conversation, ConversationMessage, ConversationStatus } from '../../types'

interface Assignment {
  id: string
  user_name: string
}

// Detalle de conversación en ventana emergente: encabezado con estado y
// cliente, barra de gestión (estado, responsable, equipo), hilo de mensajes y
// compositor. Antes era un panel al lado de la lista que en el teléfono
// quedaba aplastado a una franja ilegible; como modal tiene todo el ancho en
// escritorio y la pantalla completa en el teléfono.
interface Props {
  conversation: Conversation
  messages: ConversationMessage[]
  canCreate: boolean
  canEdit: boolean
  currentUserId: string
  activeAssignments: Assignment[]
  onClose: () => void
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

export function ConversationDetailModal({
  conversation, messages, canCreate, canEdit, currentUserId, activeAssignments,
  onClose, onChangeStatus, onAssignToMe, onUnassign, onOpenAssignModal, onRemoveAssignment,
  messageText, onChangeMessage, isInternalNote, onToggleInternalNote,
  pendingFile, onPickFile, sending, onSendMessage,
}: Props) {
  // Solo los mensajes de ESTA conversación: al abrir otra, el hook conserva los
  // de la anterior hasta que responde la consulta, y se verían por un instante.
  const thread = messages.filter(m => m.conversation_id === conversation.id)
  const isClosed = conversation.status === 'cerrada'

  const subtitle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
      <StatusPill status={conversation.status} />
      <PriorityPill priority={conversation.priority} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '12.5px' }}>
        {conversation.is_internal
          ? <span>🏢 Discusión interna de equipo</span>
          : <span>👤 {conversation.cliente_nombre ?? 'Cliente'}</span>}
        <span aria-hidden="true">·</span>
        <span>{CATEGORY_ICONS[conversation.category]} {CATEGORY_LABELS[conversation.category]}</span>
      </span>
    </div>
  )

  let footer: ReactNode
  if (canCreate && !isClosed) {
    footer = (
      <MessageComposer
        allowInternalNote={!conversation.is_internal}
        isInternalNote={isInternalNote}
        onToggleInternalNote={onToggleInternalNote}
        pendingFile={pendingFile}
        onPickFile={onPickFile}
        messageText={messageText}
        onChangeMessage={onChangeMessage}
        sending={sending}
        onSend={onSendMessage}
      />
    )
  } else if (isClosed) {
    footer = (
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>
          🔒 Esta conversación está cerrada.
        </span>
        {canEdit && (
          <Button variant="outline-primary" size="sm" onClick={() => onChangeStatus('abierta')}>
            Reabrir conversación
          </Button>
        )}
      </div>
    )
  }

  return (
    <EditModal
      title={conversation.subject}
      subtitle={subtitle}
      onClose={onClose}
      maxWidth="760px"
      height="820px"
      fullScreenOnMobile
      noPadding
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        {canEdit && (
          <ManageBar
            conversation={conversation}
            currentUserId={currentUserId}
            activeAssignments={activeAssignments}
            onChangeStatus={onChangeStatus}
            onAssignToMe={onAssignToMe}
            onUnassign={onUnassign}
            onOpenAssignModal={onOpenAssignModal}
            onRemoveAssignment={onRemoveAssignment}
          />
        )}

        <ChatThread
          messages={thread}
          viewer="agent"
          empty={`Aún no hay mensajes${canCreate && !isClosed ? '. Escribe el primero abajo.' : '.'}`}
        />
      </div>
    </EditModal>
  )
}

// ── Barra de gestión (solo quien puede editar) ──────────────────────────────
// Pegada arriba del hilo: al bajar por una conversación larga, el estado y el
// responsable siguen a mano. En el teléfono arranca plegada en una línea de
// resumen (sus tres filas se comían un tercio de la pantalla antes del primer
// mensaje); en escritorio el botón de plegar no se muestra (index.css).

const groupStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }
const groupLabelStyle: CSSProperties = {
  fontSize: '10.5px', fontWeight: 700, color: 'var(--at-ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
const smallBtn: CSSProperties = {
  height: '32px', padding: '0 10px', borderRadius: '8px', cursor: 'pointer',
  fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap',
  border: '1px solid var(--at-line-strong)', background: 'var(--at-surface)', color: 'var(--at-ink-2)',
}
const smallBtnPrimary: CSSProperties = {
  ...smallBtn,
  border: '1px solid var(--at-primary-soft-2)', background: 'var(--at-primary-tint)', color: 'var(--at-primary)',
}

function ManageBar({
  conversation, currentUserId, activeAssignments,
  onChangeStatus, onAssignToMe, onUnassign, onOpenAssignModal, onRemoveAssignment,
}: Pick<Props,
  'conversation' | 'currentUserId' | 'activeAssignments' | 'onChangeStatus' | 'onAssignToMe'
  | 'onUnassign' | 'onOpenAssignModal' | 'onRemoveAssignment'
>) {
  const [open, setOpen] = useState(false)
  const assignee = conversation.assigned_to === currentUserId ? 'tú' : conversation.assigned_name
  const summary = [
    STATUS_LABELS[conversation.status],
    assignee ? `👤 ${assignee}` : 'Sin responsable',
    ...(activeAssignments.length > 0 ? [`👥 ${activeAssignments.length}`] : []),
  ].join(' · ')

  return (
    <div className={`conv-manage${open ? ' is-open' : ''}`} style={{
      position: 'sticky', top: 0, zIndex: 1,
      background: 'var(--at-surface)', borderBottom: '1px solid var(--at-line)',
    }}>
      <button
        type="button"
        className="conv-manage-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', alignItems: 'center', gap: '8px', padding: '10px 16px',
          border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
          color: 'var(--at-ink-2)', fontSize: '13px',
        }}
      >
        <span style={{ ...groupLabelStyle, flexShrink: 0 }}>Gestionar</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
          {summary}
        </span>
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div className="conv-manage-body" style={{
        padding: '10px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px',
      }}>
        <label style={groupStyle}>
          <span style={groupLabelStyle}>Estado</span>
          <select
            value={conversation.status}
            aria-label="Estado"
            onChange={e => onChangeStatus(e.target.value as ConversationStatus)}
            style={{
              height: '32px', padding: '0 8px', borderRadius: '8px', cursor: 'pointer',
              border: '1px solid var(--at-line-strong)', background: 'var(--at-surface)',
              color: 'var(--at-ink)', fontSize: '13px', fontWeight: 600,
            }}
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>

        <div style={groupStyle}>
          <span style={groupLabelStyle}>Responsable</span>
          {conversation.assigned_name ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>
                <Avatar name={conversation.assigned_name} size={24} tone="primary" />
                {conversation.assigned_to === currentUserId ? 'Tú' : conversation.assigned_name}
              </span>
              {conversation.assigned_to !== currentUserId && (
                <button type="button" onClick={onAssignToMe} style={smallBtnPrimary}>Asignarme</button>
              )}
              <button type="button" onClick={onUnassign} style={smallBtn} title="Quitar responsable">Quitar</button>
            </>
          ) : (
            <button type="button" onClick={onAssignToMe} style={smallBtnPrimary}>+ Asignarme</button>
          )}
        </div>

        <div style={groupStyle}>
          <span style={groupLabelStyle}>Equipo</span>
          {activeAssignments.map(a => (
            <span key={a.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: '2px',
              height: '28px', padding: '0 4px 0 10px', borderRadius: '999px',
              background: 'var(--at-accent-tint)', color: 'var(--at-accent-dark)',
              fontSize: '12px', fontWeight: 600,
            }}>
              {a.user_name}
              <button
                type="button"
                onClick={() => onRemoveAssignment(a.id)}
                aria-label={`Quitar a ${a.user_name}`}
                style={{
                  width: '22px', height: '22px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: 'transparent', color: 'var(--at-accent-hover)', fontSize: '15px', lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" onClick={onOpenAssignModal} style={smallBtn}>
            {activeAssignments.length > 0 ? '+ Agregar' : '👥 Asignar a…'}
          </button>
        </div>
      </div>
    </div>
  )
}
