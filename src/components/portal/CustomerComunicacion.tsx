import { useState, useEffect } from 'react'
import { useConversations } from '../../hooks/useConversations'
import { sanitizeInput } from '../../lib/validation'
import type {
  UserSession,
  ConversationCategory,
  ConversationPriority,
  ConversationStatus,
} from '../../types'

interface Props {
  currentUser: UserSession
  companyId: string
}

const CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general: 'General',
  pagos: 'Pagos',
  tecnico: 'Técnico',
  calidad: 'Calidad del Agua',
}

const CATEGORY_ICONS: Record<ConversationCategory, string> = {
  general: '💬',
  pagos: '💳',
  tecnico: '🔧',
  calidad: '💧',
}

const STATUS_LABELS: Record<ConversationStatus, string> = {
  abierta: 'Abierta',
  en_progreso: 'En Progreso',
  esperando_cliente: 'Esperando tu respuesta',
  resuelta: 'Resuelta',
  cerrada: 'Cerrada',
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  abierta: '#3b82f6',
  en_progreso: '#f59e0b',
  esperando_cliente: '#8b5cf6',
  resuelta: '#10b981',
  cerrada: '#6b7280',
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

  // Formulario nueva conversación
  const [newSubject, setNewSubject] = useState('')
  const [newCategory, setNewCategory] = useState<ConversationCategory>('general')
  const [newPriority, setNewPriority] = useState<ConversationPriority>('media')
  const [newMessage, setNewMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

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
    if (!activeConversationId || !messageText.trim()) return
    const clean = sanitizeInput(messageText.trim())
    if (!clean) return
    try {
      await sendMessage({
        conversationId: activeConversationId,
        body: clean,
        senderName: currentUser.name,
        isInternalNote: false,
      })
      setMessageText('')
    } catch {
      // silently fail — the UI will retry
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
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>Mis Conversaciones</h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Comunícate directamente con nuestra empresa
          </p>
        </div>
        {view !== 'new' && (
          <button
            onClick={() => setView('new')}
            style={{
              padding: '9px 16px',
              background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(14,165,233,0.3)',
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
              background: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '10px',
              color: '#374151',
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
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '14px',
          padding: '24px',
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        }}>
          <h4 style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
            Nueva consulta
          </h4>

          {/* Categorías */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '8px' }}>
              Tipo de consulta
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {(Object.keys(CATEGORY_LABELS) as ConversationCategory[]).map(cat => (
                <button
                  key={cat}
                  onClick={() => setNewCategory(cat)}
                  style={{
                    padding: '10px 12px',
                    border: `2px solid ${newCategory === cat ? '#0ea5e9' : '#e5e7eb'}`,
                    borderRadius: '10px',
                    background: newCategory === cat ? '#eff6ff' : 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    fontWeight: newCategory === cat ? 600 : 400,
                    color: newCategory === cat ? '#0369a1' : '#374151',
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
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
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
                border: '1px solid #d1d5db',
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
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
              Urgencia
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {([['baja', 'Baja', '#10b981'], ['media', 'Normal', '#f59e0b'], ['alta', 'Alta', '#ef4444']] as const).map(([val, label, color]) => (
                <button
                  key={val}
                  onClick={() => setNewPriority(val as ConversationPriority)}
                  style={{
                    padding: '6px 14px',
                    border: `2px solid ${newPriority === val ? color : '#e5e7eb'}`,
                    borderRadius: '999px',
                    background: newPriority === val ? color + '18' : 'white',
                    color: newPriority === val ? color : '#6b7280',
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
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
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
                border: '1px solid #d1d5db',
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
              background: '#fee2e2', border: '1px solid #fca5a5',
              borderRadius: '8px', padding: '10px 12px',
              color: '#991b1b', fontSize: '13px', marginBottom: '14px',
            }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setView('list'); setFormError('') }}
              style={{
                padding: '10px 18px',
                background: 'white',
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                color: '#374151',
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
                background: creating ? '#9ca3af' : 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: creating ? 'not-allowed' : 'pointer',
                boxShadow: creating ? 'none' : '0 2px 8px rgba(14,165,233,0.3)',
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
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
              Cargando tus conversaciones…
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>💬</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Aún no tienes conversaciones
              </div>
              <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px' }}>
                ¿Tienes alguna duda o consulta? Escríbenos.
              </div>
              <button
                onClick={() => setView('new')}
                style={{
                  padding: '10px 22px',
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
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
                  borderBottom: idx < conversations.length - 1 ? '1px solid #f1f5f9' : 'none',
                  background: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={e => (e.currentTarget.style.background = 'white')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <span style={{ fontSize: '20px' }}>{CATEGORY_ICONS[conv.category]}</span>
                    <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#111827', lineHeight: '1.3' }}>
                      {conv.subject}
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: '#9ca3af', flexShrink: 0 }}>
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
                  <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
                    {CATEGORY_LABELS[conv.category]}
                  </span>
                  {conv.status === 'esperando_cliente' && (
                    <span style={{
                      fontSize: '11px', padding: '2px 8px',
                      background: '#ede9fe', color: '#7c3aed',
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
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid #f1f5f9',
            background: '#f8fafc',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '20px' }}>{CATEGORY_ICONS[activeConversation.category]}</span>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#111827', flex: 1 }}>
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
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', paddingLeft: '28px' }}>
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
            background: '#f9fafb',
          }}>
            {messages.filter(m => !m.is_internal_note).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '13px', paddingTop: '40px' }}>
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
                          background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
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
                          ? 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)'
                          : 'white',
                        color: isMe ? 'white' : '#111827',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                      }}>
                        {!isMe && (
                          <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', color: '#0ea5e9' }}>
                            {msg.sender_name ?? 'Empresa'}
                          </div>
                        )}
                        <div style={{ fontSize: '13.5px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {msg.body}
                        </div>
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
            <div style={{ padding: '14px 16px', borderTop: '1px solid #f1f5f9', background: 'white' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <textarea
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Escribe tu mensaje…"
                  rows={3}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    fontSize: '13.5px',
                    resize: 'none',
                    outline: 'none',
                    fontFamily: 'inherit',
                    background: '#f9fafb',
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !messageText.trim()}
                  style={{
                    padding: '12px 18px',
                    background: sending || !messageText.trim()
                      ? '#d1d5db'
                      : 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: sending || !messageText.trim() ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                    boxShadow: sending || !messageText.trim() ? 'none' : '0 2px 8px rgba(14,165,233,0.3)',
                  }}
                >
                  {sending ? '…' : 'Enviar'}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '5px' }}>
                Ctrl+Enter para enviar
              </div>
            </div>
          ) : (
            <div style={{
              padding: '14px 18px',
              background: '#f9fafb',
              borderTop: '1px solid #f1f5f9',
              textAlign: 'center',
              fontSize: '13px',
              color: '#6b7280',
            }}>
              {activeConversation.status === 'resuelta'
                ? '✅ Esta consulta fue marcada como resuelta.'
                : '🔒 Esta conversación está cerrada.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
