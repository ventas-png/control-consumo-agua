import { useState, useEffect } from 'react'
import { notify } from '../shared/Dialog'
import { useConversations } from '../../hooks/useConversations'
import { useBroadcasts } from '../../hooks/useBroadcasts'
import { sanitizeInput } from '../../lib/validation'
import { SecureImage } from '../shared/SecureImage'
import { useSignedUrl } from '../../lib/storageUrls'

function ChatAttachmentImage({ src, name, body }: { src: string; name?: string | null; body?: string | null }) {
  const signed = useSignedUrl(src, 'conv-attachments')
  if (!signed) return null
  return (
    <a href={signed} target="_blank" rel="noopener noreferrer">
      <SecureImage
        bucket="conv-attachments"
        src={src}
        alt={name ?? 'imagen'}
        style={{ maxWidth: '220px', maxHeight: '200px', borderRadius: '8px', marginTop: body ? '6px' : 0, display: 'block' }}
      />
    </a>
  )
}

function ChatAttachmentLink({ src, name, type, size, getIcon, fmt, body }: {
  src: string
  name?: string | null
  type?: string | null
  size?: number | null
  getIcon: (mime?: string | null) => string
  fmt: (bytes: number) => string
  body?: string | null
}) {
  const signed = useSignedUrl(src, 'conv-attachments')
  if (!signed) return null
  return (
    <a
      href={signed}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        marginTop: body ? '6px' : 0,
        background: 'rgba(0,0,0,0.08)', borderRadius: '8px',
        padding: '8px 10px', color: 'inherit', textDecoration: 'none',
      }}
    >
      <span style={{ fontSize: '20px' }}>{getIcon(type)}</span>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        {size && <div style={{ fontSize: '10px', opacity: 0.7 }}>{fmt(size)}</div>}
      </div>
    </a>
  )
}
import type {
  UserSession,
  ConversationCategory,
  ConversationPriority,
  ConversationStatus,
} from '../../types'

function getFileIcon(mimeType?: string | null): string {
  if (!mimeType) return '📎'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝'
  if (mimeType.startsWith('image/')) return '🖼️'
  return '📎'
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  currentUser: UserSession
  companyId: string
}

const CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general: 'General',
  pagos: 'Pagos',
  tecnico: 'Técnico',
  calidad: 'Calidad del Agua',
  mantenimiento: 'Mantenimiento',
  finanzas: 'Finanzas',
  convivencia: 'Convivencia',
}

const CATEGORY_ICONS: Record<ConversationCategory, string> = {
  general: '💬',
  pagos: '💳',
  tecnico: '🔧',
  calidad: '💧',
  mantenimiento: '🔨',
  finanzas: '💰',
  convivencia: '🤝',
}

const STATUS_LABELS: Record<ConversationStatus, string> = {
  abierta: 'Abierta',
  en_progreso: 'En Progreso',
  esperando_cliente: 'Esperando tu respuesta',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  abierta: 'var(--at-primary-2)',
  en_progreso: 'var(--at-warning)',
  esperando_cliente: 'var(--at-accent)',
  resuelta: 'var(--at-success)',
  cerrada: 'var(--at-ink-3)',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `Hace ${diffH}h`
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })
}

export function CustomerComunicacion({ currentUser, companyId }: Props) {
  const {
    conversations,
    messages,
    activeConversationId,
    loading,
    sending,
    loadConversations,
    loadMessages,
    createConversation,
    sendMessage,
  } = useConversations({
    companyId,
    clienteId: currentUser.cliente_id,
    userId: currentUser.user_id,
    isCliente: true,
  })

  const [view, setView] = useState<'list' | 'detail' | 'new'>('list')
  const [messageText, setMessageText] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // Formulario nueva conversación
  const [newSubject, setNewSubject] = useState('')
  const [newCategory, setNewCategory] = useState<ConversationCategory>('general')
  const [newPriority, setNewPriority] = useState<ConversationPriority>('media')
  const [newMessage, setNewMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  const [mainTab, setMainTab] = useState<'conversaciones' | 'comunicados'>('conversaciones')
  const [expandedBroadcast, setExpandedBroadcast] = useState<string | null>(null)

  const { clienteBroadcasts, loadClienteBroadcasts, markAsRead } = useBroadcasts()

  useEffect(() => {
    if (currentUser.cliente_id) {
      loadClienteBroadcasts(currentUser.cliente_id)
    }
  }, [currentUser.cliente_id, loadClienteBroadcasts])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  const activeConversation = conversations.find(c => c.id === activeConversationId) ?? null

  function handleSelectConversation(id: string) {
    loadMessages(id)
    setView('detail')
    setMessageText('')
  }

  async function handleSend() {
    if (!activeConversationId || (!messageText.trim() && !pendingFile)) return
    const clean = sanitizeInput(messageText.trim())
    try {
      await sendMessage({
        conversationId: activeConversationId,
        body: clean,
        senderName: currentUser.name,
        isInternalNote: false,
        attachment: pendingFile ?? undefined,
      })
      setMessageText('')
      setPendingFile(null)
    } catch {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo enviar el mensaje.' })
    }
  }

  async function handleCreate() {
    setFormError('')
    const subject = sanitizeInput(newSubject.trim())
    const body = sanitizeInput(newMessage.trim())
    if (!subject) { setFormError('El asunto es requerido.'); return }
    if (!body) { setFormError('Debes escribir el primer mensaje.'); return }
    if (!currentUser.cliente_id) { setFormError('No se encontró tu perfil de cliente.'); return }

    setCreating(true)
    try {
      const conv = await createConversation({
        subject,
        category: newCategory,
        priority: newPriority,
        clienteId: currentUser.cliente_id,
        clienteNombre: currentUser.name,
        companyId,
        firstMessage: body,
        senderName: currentUser.name,
      })
      if (conv) {
        // Limpiar form
        setNewSubject('')
        setNewCategory('general')
        setNewPriority('media')
        setNewMessage('')
        handleSelectConversation(conv.id)
      }
    } catch {
      setFormError('Error al crear la conversación. Intenta nuevamente.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Main tabs ── */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--at-line)', marginBottom: '-4px' }}>
        {(['conversaciones', 'comunicados'] as const).map(tab => {
          const active = mainTab === tab
          const unreadCount = tab === 'comunicados'
            ? clienteBroadcasts.filter(r => !r.read_at).length
            : 0
          return (
            <button
              key={tab}
              onClick={() => setMainTab(tab)}
              style={{
                padding: '8px 16px',
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid var(--at-primary)' : '2px solid transparent',
                marginBottom: '-2px',
                color: active ? 'var(--at-primary)' : 'var(--at-ink-3)',
                fontWeight: active ? 700 : 500,
                fontSize: '13.5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {tab === 'conversaciones' ? (
                <>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
                  </svg>
                  Conversaciones
                </>
              ) : (
                <>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
                  </svg>
                  Comunicados
                  {unreadCount > 0 && (
                    <span style={{
                      minWidth: '18px', height: '18px', borderRadius: '999px',
                      background: 'var(--at-danger)', color: 'var(--at-on-status)',
                      fontSize: '10px', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 4px',
                    }}>
                      {unreadCount}
                    </span>
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>

      {mainTab === 'conversaciones' && <>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>Mis Conversaciones</h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Comunícate directamente con nuestra empresa
          </p>
        </div>
        {view !== 'new' && (
          <button
            onClick={() => setView('new')}
            style={{
              padding: '9px 16px',
              background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(27, 59, 54,0.3)',
            }}
          >
            + Nueva consulta
          </button>
        )}
        {view !== 'list' && (
          <button
            onClick={() => setView('list')}
            style={{
              padding: '8px 14px',
              background: 'var(--at-surface)',
              border: '1px solid var(--at-line-strong)',
              borderRadius: '10px',
              color: 'var(--at-ink-2)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            ← Volver a la lista
          </button>
        )}
      </div>

      {/* ── Vista: Nueva conversación ── */}
      {view === 'new' && (
        <div style={{
          background: 'var(--at-surface)',
          border: '1px solid var(--at-line)',
          borderRadius: '14px',
          padding: '24px',
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        }}>
          <h4 style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Nueva consulta
          </h4>

          {/* Categorías */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '8px' }}>
              Tipo de consulta
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {(Object.keys(CATEGORY_LABELS) as ConversationCategory[]).map(cat => (
                <button
                  key={cat}
                  onClick={() => setNewCategory(cat)}
                  style={{
                    padding: '10px 12px',
                    border: `2px solid ${newCategory === cat ? 'var(--at-primary)' : 'var(--at-line)'}`,
                    borderRadius: '10px',
                    background: newCategory === cat ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    fontWeight: newCategory === cat ? 600 : 400,
                    color: newCategory === cat ? 'var(--at-primary-hover)' : 'var(--at-ink-2)',
                    transition: 'all 0.12s',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{CATEGORY_ICONS[cat]}</span>
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>

          {/* Asunto */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px' }}>
              Asunto *
            </label>
            <input
              type="text"
              value={newSubject}
              onChange={e => setNewSubject(e.target.value)}
              placeholder="Ej: Consulta sobre mi factura de marzo"
              maxLength={120}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--at-line-strong)',
                borderRadius: '9px',
                fontSize: '13.5px',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Prioridad */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px' }}>
              Urgencia
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {([['baja', 'Baja', 'var(--at-success)'], ['media', 'Normal', 'var(--at-warning)'], ['alta', 'Alta', 'var(--at-danger)']] as const).map(([val, label, color]) => (
                <button
                  key={val}
                  onClick={() => setNewPriority(val as ConversationPriority)}
                  style={{
                    padding: '6px 14px',
                    border: `2px solid ${newPriority === val ? color : 'var(--at-line)'}`,
                    borderRadius: '999px',
                    background: newPriority === val ? color + '18' : 'var(--at-surface)',
                    color: newPriority === val ? color : 'var(--at-ink-3)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mensaje */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px' }}>
              Describe tu consulta *
            </label>
            <textarea
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Explica tu consulta con el mayor detalle posible…"
              rows={5}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--at-line-strong)',
                borderRadius: '9px',
                fontSize: '13.5px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {formError && (
            <div style={{
              background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)',
              borderRadius: '8px', padding: '10px 12px',
              color: 'var(--at-danger-strong)', fontSize: '13px', marginBottom: '14px',
            }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setView('list'); setFormError('') }}
              style={{
                padding: '10px 18px',
                background: 'var(--at-surface)',
                border: '1px solid var(--at-line-strong)',
                borderRadius: '10px',
                color: 'var(--at-ink-2)',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              style={{
                padding: '10px 22px',
                background: creating ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: creating ? 'not-allowed' : 'pointer',
                boxShadow: creating ? 'none' : '0 2px 8px rgba(27, 59, 54,0.3)',
              }}
            >
              {creating ? 'Enviando…' : 'Enviar consulta'}
            </button>
          </div>
        </div>
      )}

      {/* ── Vista: Lista de conversaciones ── */}
      {view === 'list' && (
        <div style={{
          background: 'var(--at-surface)',
          border: '1px solid var(--at-line)',
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '14px' }}>
              Cargando tus conversaciones…
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>💬</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
                Aún no tienes conversaciones
              </div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginBottom: '20px' }}>
                ¿Tienes alguna duda o consulta? Escríbenos.
              </div>
              <button
                onClick={() => setView('new')}
                style={{
                  padding: '10px 22px',
                  background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 600,
                  fontSize: '13.5px',
                  cursor: 'pointer',
                }}
              >
                Iniciar conversación
              </button>
            </div>
          ) : (
            conversations.map((conv, idx) => (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 18px',
                  border: 'none',
                  borderBottom: idx < conversations.length - 1 ? '1px solid var(--at-chip)' : 'none',
                  background: 'var(--at-surface)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--at-surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--at-surface)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <span style={{ fontSize: '20px' }}>{CATEGORY_ICONS[conv.category]}</span>
                    <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)', lineHeight: '1.3' }}>
                      {conv.subject}
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>
                    {formatDate(conv.updated_at)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '28px' }}>
                  <span style={{
                    fontSize: '11.5px', padding: '2px 9px',
                    borderRadius: '999px',
                    background: STATUS_COLORS[conv.status] + '18',
                    color: STATUS_COLORS[conv.status],
                    fontWeight: 600,
                  }}>
                    {STATUS_LABELS[conv.status]}
                  </span>
                  <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                    {CATEGORY_LABELS[conv.category]}
                  </span>
                  {conv.status === 'esperando_cliente' && (
                    <span style={{
                      fontSize: '11px', padding: '2px 8px',
                      background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)',
                      borderRadius: '999px', fontWeight: 600,
                    }}>
                      Tienes mensajes sin leer
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* ── Vista: Detalle / Chat ── */}
      {view === 'detail' && activeConversation && (
        <div style={{
          background: 'var(--at-surface)',
          border: '1px solid var(--at-line)',
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--at-chip)',
            background: 'var(--at-surface-2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '20px' }}>{CATEGORY_ICONS[activeConversation.category]}</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', flex: 1 }}>
                {activeConversation.subject}
              </span>
              <span style={{
                fontSize: '11.5px', padding: '3px 10px',
                borderRadius: '999px',
                background: STATUS_COLORS[activeConversation.status] + '18',
                color: STATUS_COLORS[activeConversation.status],
                fontWeight: 600,
              }}>
                {STATUS_LABELS[activeConversation.status]}
              </span>
            </div>
            {activeConversation.assigned_name && (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px', paddingLeft: '28px' }}>
                Atendido por: {activeConversation.assigned_name}
              </div>
            )}
          </div>

          {/* Mensajes */}
          <div style={{
            padding: '18px',
            minHeight: '300px',
            maxHeight: '450px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: 'var(--at-surface-2)',
          }}>
            {messages.filter(m => !m.is_internal_note).length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px', paddingTop: '40px' }}>
                No hay mensajes aún
              </div>
            ) : (
              messages
                .filter(m => !m.is_internal_note)
                .map(msg => {
                  const isMe = msg.sender_type === 'cliente'
                  return (
                    <div key={msg.id} style={{
                      display: 'flex',
                      justifyContent: isMe ? 'flex-end' : 'flex-start',
                    }}>
                      {!isMe && (
                        <div style={{
                          width: '30px', height: '30px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'white', fontSize: '12px', fontWeight: 700,
                          flexShrink: 0, marginRight: '8px', alignSelf: 'flex-end',
                        }}>
                          {(msg.sender_name ?? 'A').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{
                        maxWidth: '75%',
                        padding: '10px 14px',
                        borderRadius: isMe ? '16px 16px 3px 16px' : '16px 16px 16px 3px',
                        background: isMe
                          ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)'
                          : 'var(--at-surface)',
                        color: isMe ? 'white' : 'var(--at-ink)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                      }}>
                        {!isMe && (
                          <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', color: 'var(--at-primary)' }}>
                            {msg.sender_name ?? 'Empresa'}
                          </div>
                        )}
                        {msg.body && (
                          <div style={{ fontSize: '13.5px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {msg.body}
                          </div>
                        )}
                        {msg.attachment_url && msg.attachment_type?.startsWith('image/') && (
                          <ChatAttachmentImage src={msg.attachment_url} name={msg.attachment_name} body={msg.body} />
                        )}
                        {msg.attachment_url && !msg.attachment_type?.startsWith('image/') && (
                          <ChatAttachmentLink
                            src={msg.attachment_url}
                            name={msg.attachment_name}
                            type={msg.attachment_type}
                            size={msg.attachment_size}
                            getIcon={getFileIcon}
                            fmt={formatBytes}
                            body={msg.body}
                          />
                        )}
                        <div style={{ fontSize: '10px', opacity: 0.65, marginTop: '6px', textAlign: 'right' }}>
                          {new Date(msg.created_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  )
                })
            )}
          </div>

          {/* Compositor */}
          {activeConversation.status !== 'cerrada' && activeConversation.status !== 'resuelta' ? (
            <div style={{ padding: '14px 16px', borderTop: '1px solid var(--at-chip)', background: 'var(--at-surface)' }}>
              {/* Preview archivo pendiente */}
              {pendingFile && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 10px', marginBottom: '8px',
                  background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)',
                  borderRadius: '8px',
                }}>
                  {pendingFile.type.startsWith('image/') ? (
                    <img
                      src={URL.createObjectURL(pendingFile)}
                      alt="preview"
                      style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                    />
                  ) : (
                    <span style={{ fontSize: '22px', flexShrink: 0 }}>{getFileIcon(pendingFile.type)}</span>
                  )}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--at-primary-hover)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pendingFile.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{formatBytes(pendingFile.size)}</div>
                  </div>
                  <button
                    onClick={() => setPendingFile(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '16px', lineHeight: 1, padding: '2px', flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <textarea
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Escribe tu mensaje…"
                  rows={3}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    border: '1px solid var(--at-line)',
                    borderRadius: '12px',
                    fontSize: '13.5px',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'inherit',
                    background: 'var(--at-surface-2)',
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', border: '1px solid var(--at-line)', borderRadius: '12px', background: 'var(--at-surface-2)', fontSize: '20px' }}>
                    📎
                    <input
                      type="file"
                      accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.csv"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        if (file.size > 10 * 1024 * 1024) {
                          notify({ variant: 'warning', title: 'Archivo muy grande', text: 'El archivo no puede superar los 10 MB.' })
                          return
                        }
                        setPendingFile(file)
                      }}
                    />
                  </label>
                  <button
                    onClick={handleSend}
                    disabled={sending || (!messageText.trim() && !pendingFile)}
                    style={{
                      padding: '12px 18px',
                      background: (sending || (!messageText.trim() && !pendingFile))
                        ? 'var(--at-line-strong)'
                        : 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: (sending || (!messageText.trim() && !pendingFile)) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      boxShadow: (sending || (!messageText.trim() && !pendingFile)) ? 'none' : '0 2px 8px rgba(27, 59, 54,0.3)',
                    }}
                  >
                    {sending ? '…' : 'Enviar'}
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '5px' }}>
                Ctrl+Enter para enviar · Max 10 MB por adjunto
              </div>
            </div>
          ) : (
            <div style={{
              padding: '14px 18px',
              background: 'var(--at-surface-2)',
              borderTop: '1px solid var(--at-chip)',
              textAlign: 'center',
              fontSize: '13px',
              color: 'var(--at-ink-3)',
            }}>
              {activeConversation.status === 'resuelta'
                ? '✅ Esta consulta fue marcada como resuelta.'
                : '🔒 Esta conversación está cerrada.'}
            </div>
          )}
        </div>
      )}
      </>}

      {mainTab === 'comunicados' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>Comunicados</h3>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
              Mensajes informativos de la empresa
            </p>
          </div>
          {clienteBroadcasts.length === 0 ? (
            <div style={{
              padding: '48px 24px', textAlign: 'center',
              background: 'var(--at-surface)', borderRadius: '14px',
              border: '1px solid var(--at-line)',
              boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📢</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '4px' }}>
                Sin comunicados
              </div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
                Aquí aparecerán los mensajes informativos de la empresa.
              </div>
            </div>
          ) : (
            clienteBroadcasts.map(recipient => {
              const bc = recipient.broadcast!
              const isExpanded = expandedBroadcast === recipient.id
              const isUnread = !recipient.read_at
              return (
                <div
                  key={recipient.id}
                  style={{
                    background: 'var(--at-surface)',
                    border: `1px solid ${isUnread ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
                    borderRadius: '14px',
                    overflow: 'hidden',
                    boxShadow: isUnread ? '0 1px 8px rgba(47, 93, 79,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                  }}
                >
                  <button
                    onClick={() => {
                      if (!isExpanded) {
                        setExpandedBroadcast(recipient.id)
                        if (isUnread) markAsRead(recipient.id)
                      } else {
                        setExpandedBroadcast(null)
                      }
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '14px 18px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {isUnread && (
                      <span style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: 'var(--at-primary-2)', flexShrink: 0,
                      }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: isUnread ? 700 : 600, fontSize: '13.5px', color: 'var(--at-ink)' }}>
                        {bc.title}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                        {bc.sent_by_name} · {new Date(bc.created_at).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    <svg
                      width="14" height="14"
                      fill="none" stroke="var(--at-ink-3)" strokeWidth="2"
                      viewBox="0 0 24 24"
                      style={{ flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>
                  {isExpanded && (
                    <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--at-chip)' }}>
                      <div style={{
                        paddingTop: '14px',
                        fontSize: '14px', color: 'var(--at-ink-2)',
                        lineHeight: '1.65', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {bc.body}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
