import { useState, useEffect, type ReactNode } from 'react'
import { notify } from '../shared/Dialog'
import { Button } from '../shared/Button'
import { EmptyState } from '../shared/EmptyState'
import { Skeleton } from '../shared/Skeleton'
import { useConversations } from '../../hooks/useConversations'
import { useBroadcasts } from '../../hooks/useBroadcasts'
import { NotificationPreferencesPanel } from '../comunicacion/NotificationPreferencesPanel'
import { StatusPill } from '../comunicacion/ConversationBadges'
import {
  CATEGORY_ICONS, CATEGORY_LABELS, STATUS_LABELS_CLIENTE, formatDate,
} from '../comunicacion/conversationConstants'
import { sanitizeInput } from '../../lib/validation'
import { CustomerConversationModal } from './CustomerConversationModal'
import { NuevaConsultaModal, type NuevaConsultaData } from './NuevaConsultaModal'
import type { UserSession } from '../../types'

interface Props {
  currentUser: UserSession
  companyId: string
}

type MainTab = 'conversaciones' | 'comunicados' | 'preferencias'

const TAB_ICONS: Record<MainTab, ReactNode> = {
  conversaciones: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
    </svg>
  ),
  comunicados: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
    </svg>
  ),
  preferencias: (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
  ),
}

const TAB_LABELS: Record<MainTab, string> = {
  conversaciones: 'Conversaciones',
  comunicados: 'Comunicados',
  preferencias: 'Notificaciones',
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

  // La consulta abierta y el alta de una nueva son ventanas emergentes sobre
  // la lista: antes reemplazaban la lista en la página.
  const [detailOpen, setDetailOpen] = useState(false)
  const [showNueva, setShowNueva] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const [mainTab, setMainTab] = useState<MainTab>('conversaciones')
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
    setDetailOpen(true)
    // El borrador es de la consulta en la que se escribió.
    setMessageText('')
    setPendingFile(null)
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

  async function handleCreate(data: NuevaConsultaData): Promise<string | null> {
    const subject = sanitizeInput(data.subject.trim())
    const body = sanitizeInput(data.message.trim())
    if (!subject) return 'El asunto es requerido.'
    if (!body) return 'Debes escribir el primer mensaje.'
    if (!currentUser.cliente_id) return 'No se encontró tu perfil de cliente.'
    try {
      const conv = await createConversation({
        subject,
        category: data.category,
        priority: data.priority,
        clienteId: currentUser.cliente_id,
        clienteNombre: currentUser.name,
        companyId,
        firstMessage: body,
        senderName: currentUser.name,
      })
      if (!conv) return 'Error al crear la conversación. Intenta nuevamente.'
      // Creada: se cierra el formulario y se abre directo el chat de la consulta.
      setShowNueva(false)
      handleSelectConversation(conv.id)
      return null
    } catch {
      return 'Error al crear la conversación. Intenta nuevamente.'
    }
  }

  const unreadComunicados = clienteBroadcasts.filter(r => !r.read_at).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Main tabs (una fila con scroll horizontal en el teléfono) ── */}
      <div
        role="tablist"
        aria-label="Comunicación"
        className="tab-strip-scrollable"
        style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--at-line)', marginBottom: '-4px', overflowX: 'auto' }}
      >
        {(['conversaciones', 'comunicados', 'preferencias'] as const).map(tab => {
          const active = mainTab === tab
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
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
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {TAB_ICONS[tab]}
              {TAB_LABELS[tab]}
              {tab === 'comunicados' && unreadComunicados > 0 && (
                <span style={{
                  minWidth: '18px', height: '18px', borderRadius: '999px',
                  background: 'var(--at-danger)', color: 'var(--at-on-status)',
                  fontSize: '10px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px',
                }}>
                  {unreadComunicados}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {mainTab === 'conversaciones' && <>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--at-ink)' }}>Mis conversaciones</h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Escríbenos y te respondemos por aquí
          </p>
        </div>
        <Button variant="gradient-primary" onClick={() => setShowNueva(true)}>
          + Nueva consulta
        </Button>
      </div>

      {/* ── Lista (cada consulta se abre en ventana emergente) ── */}
      <div style={{
        background: 'var(--at-surface)',
        border: '1px solid var(--at-line)',
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      }}>
        {loading ? (
          <div aria-busy="true" aria-label="Cargando tus conversaciones">
            {[0, 1, 2].map(i => (
              <div key={i} style={{ display: 'flex', gap: '12px', padding: '14px 16px', borderBottom: '1px solid var(--at-line)' }}>
                <Skeleton width={40} height={40} radius="50%" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Skeleton width="50%" height={14} />
                  <Skeleton width="35%" height={12} />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            audience="resident"
            icon="💬"
            title="Aún no tienes conversaciones"
            description="¿Tienes alguna duda o consulta? Escríbenos."
            action={<Button variant="gradient-primary" onClick={() => setShowNueva(true)}>Iniciar conversación</Button>}
          />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {conversations.map(conv => {
              const isActive = conv.id === activeConversationId
              // La empresa respondió y espera al cliente: es lo que debe saltar a la vista.
              const needsReply = conv.status === 'esperando_cliente'
              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    className="conv-row"
                    onClick={() => handleSelectConversation(conv.id)}
                    aria-current={isActive ? 'true' : undefined}
                    style={{
                      width: '100%', textAlign: 'left', padding: '14px 16px 14px 13px', cursor: 'pointer',
                      borderTop: 'none', borderRight: 'none', borderBottom: '1px solid var(--at-line)',
                      borderLeft: `3px solid ${needsReply ? 'var(--at-accent)' : 'transparent'}`,
                      background: isActive ? 'var(--at-primary-tint)' : needsReply ? 'var(--at-accent-tint)' : 'var(--at-surface)',
                      display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--at-ink)',
                      transition: 'background 0.12s',
                    }}
                  >
                    <span aria-hidden="true" style={{
                      width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '19px', background: 'var(--at-primary-tint)',
                    }}>
                      {CATEGORY_ICONS[conv.category]}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{
                          flex: 1, minWidth: 0, fontSize: '14.5px', fontWeight: needsReply ? 800 : 700,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {conv.subject}
                        </span>
                        <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>
                          {formatDate(conv.updated_at)}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <StatusPill status={conv.status} label={STATUS_LABELS_CLIENTE[conv.status]} />
                        <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{CATEGORY_LABELS[conv.category]}</span>
                      </span>
                    </span>
                    <svg width="16" height="16" fill="none" stroke="var(--at-ink-3)" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* ── Ventana: chat de la consulta ── */}
      {detailOpen && activeConversation && (
        <CustomerConversationModal
          conversation={activeConversation}
          messages={messages}
          messageText={messageText}
          onChangeMessage={setMessageText}
          pendingFile={pendingFile}
          onPickFile={setPendingFile}
          sending={sending}
          onSend={handleSend}
          onClose={() => setDetailOpen(false)}
          onNewConsulta={() => { setDetailOpen(false); setShowNueva(true) }}
        />
      )}

      {/* ── Ventana: nueva consulta ── */}
      {showNueva && (
        <NuevaConsultaModal onClose={() => setShowNueva(false)} onSubmit={handleCreate} />
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

      {mainTab === 'preferencias' && (
        <NotificationPreferencesPanel
          userId={currentUser.user_id}
          companyId={companyId}
          lockInApp
        />
      )}
    </div>
  )
}
