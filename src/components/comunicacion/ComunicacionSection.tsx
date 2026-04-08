import { useEffect, useState } from 'react'
import Swal from 'sweetalert2'
import { useConversations } from '../../hooks/useConversations'
import { sanitizeInput } from '../../lib/validation'
import type {
  UserSession,
  Conversation,
  ConversationCategory,
  ConversationPriority,
  ConversationStatus,
  ConversationAccessRule,
} from '../../types'

interface Props {
  currentUser: UserSession
  canCreate: boolean
  canEdit: boolean
}

const CATEGORY_LABELS: Record<ConversationCategory, string> = {
  general: 'General',
  pagos: 'Pagos',
  tecnico: 'Técnico',
  calidad: 'Calidad Agua',
}

const PRIORITY_LABELS: Record<ConversationPriority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

const PRIORITY_COLORS: Record<ConversationPriority, string> = {
  baja: '#10b981',
  media: '#f59e0b',
  alta: '#ef4444',
  urgente: '#7c3aed',
}

const STATUS_LABELS: Record<ConversationStatus, string> = {
  abierta: 'Abierta',
  en_progreso: 'En Progreso',
  esperando_cliente: 'Esperando Cliente',
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

// ── Sub-componente: Lista de conversaciones ──────────────────────────────────
function ConversationList({
  conversations,
  activeId,
  onSelect,
  filter,
}: {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  filter: string
}) {
  const filtered = conversations.filter(c => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      c.subject.toLowerCase().includes(q) ||
      (c.cliente_nombre ?? '').toLowerCase().includes(q)
    )
  })

  if (filtered.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9ca3af' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>💬</div>
        <div style={{ fontSize: '13px' }}>No hay conversaciones</div>
      </div>
    )
  }

  return (
    <div>
      {filtered.map(conv => {
        const isActive = conv.id === activeId
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '12px 14px',
              border: 'none',
              borderBottom: '1px solid #f1f5f9',
              background: isActive ? '#eff6ff' : 'white',
              cursor: 'pointer',
              transition: 'background 0.12s',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{
                fontSize: '13px',
                fontWeight: 600,
                color: isActive ? '#1d4ed8' : '#111827',
                lineHeight: '1.3',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {conv.subject}
              </span>
              <span style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>
                {formatDate(conv.updated_at)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '11px',
                color: '#6b7280',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {conv.cliente_nombre ?? 'Cliente'}
              </span>
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '999px',
                background: STATUS_COLORS[conv.status] + '18',
                color: STATUS_COLORS[conv.status],
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {STATUS_LABELS[conv.status]}
              </span>
              <span style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '999px',
                background: PRIORITY_COLORS[conv.priority] + '18',
                color: PRIORITY_COLORS[conv.priority],
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {PRIORITY_LABELS[conv.priority]}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: '#9ca3af' }}>
              {CATEGORY_LABELS[conv.category]}
              {conv.assigned_name && ` · Asignado: ${conv.assigned_name}`}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Sub-componente: Panel de configuración de acceso ────────────────────────
function AccessRulesPanel({
  companyId,
  accessRules,
  onSave,
}: {
  companyId: string
  accessRules: ConversationAccessRule[]
  onSave: (rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
}) {
  const roles = ['admin', 'operator', 'collector', 'viewer'] as const
  const allCategories = ['general', 'pagos', 'tecnico', 'calidad']

  const getRuleForRole = (role: string): ConversationAccessRule | undefined =>
    accessRules.find(r => r.role === role)

  const [saving, setSaving] = useState<string | null>(null)

  async function handleToggle(role: string, field: 'can_view_all' | 'can_respond' | 'can_assign', current: boolean) {
    setSaving(role + field)
    try {
      const existing = getRuleForRole(role)
      await onSave({
        company_id: companyId,
        role,
        can_view_all: field === 'can_view_all' ? !current : (existing?.can_view_all ?? false),
        can_respond: field === 'can_respond' ? !current : (existing?.can_respond ?? false),
        can_assign: field === 'can_assign' ? !current : (existing?.can_assign ?? false),
        categories: existing?.categories ?? null,
      })
    } finally {
      setSaving(null)
    }
  }

  async function handleCategoryToggle(role: string, cat: string) {
    setSaving(role + cat)
    try {
      const existing = getRuleForRole(role)
      const current = existing?.categories ?? null
      let next: string[] | null
      if (current === null) {
        next = allCategories.filter(c => c !== cat)
      } else if (current.includes(cat)) {
        next = current.filter(c => c !== cat)
        if (next.length === allCategories.length) next = null
      } else {
        next = [...current, cat]
        if (next.length === allCategories.length) next = null
      }
      await onSave({
        company_id: companyId,
        role,
        can_view_all: existing?.can_view_all ?? false,
        can_respond: existing?.can_respond ?? false,
        can_assign: existing?.can_assign ?? false,
        categories: next,
      })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Configure qué roles pueden ver y responder conversaciones, y en qué categorías.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {roles.map(role => {
          const rule = getRuleForRole(role)
          const categories = rule?.categories ?? null
          const isBusy = saving?.startsWith(role)
          return (
            <div key={role} style={{
              border: '1px solid #e5e7eb',
              borderRadius: '10px',
              padding: '14px 16px',
              background: 'white',
              opacity: isBusy ? 0.7 : 1,
            }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#374151', marginBottom: '10px', textTransform: 'capitalize' }}>
                {role === 'collector' ? 'Gestor de Cobros' : role === 'operator' ? 'Operador' : role === 'viewer' ? 'Visualizador' : 'Administrador'}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {(['can_view_all', 'can_respond', 'can_assign'] as const).map(field => {
                  const val = rule ? rule[field] : false
                  const label = field === 'can_view_all' ? 'Ver todas' : field === 'can_respond' ? 'Responder' : 'Asignar'
                  return (
                    <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px', color: '#374151' }}>
                      <input
                        type="checkbox"
                        checked={val}
                        disabled={isBusy}
                        onChange={() => handleToggle(role, field, val)}
                        style={{ width: '14px', height: '14px', accentColor: '#0ea5e9' }}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
              <div style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '6px' }}>
                Categorías visibles ({categories === null ? 'Todas' : `${categories.length}`}):
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {allCategories.map(cat => {
                  const active = categories === null || categories.includes(cat)
                  return (
                    <button
                      key={cat}
                      disabled={isBusy}
                      onClick={() => handleCategoryToggle(role, cat)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: '999px',
                        border: `1px solid ${active ? '#0ea5e9' : '#d1d5db'}`,
                        background: active ? '#e0f2fe' : 'white',
                        color: active ? '#0369a1' : '#6b7280',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {CATEGORY_LABELS[cat as ConversationCategory]}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
export function ComunicacionSection({ currentUser, canCreate, canEdit }: Props) {
  const {
    conversations,
    messages,
    accessRules,
    activeConversationId,
    loading,
    sending,
    loadConversations,
    loadMessages,
    loadAccessRules,
    sendMessage,
    updateConversation,
    saveAccessRule,
  } = useConversations({
    companyId: currentUser.company_id,
    userId: currentUser.user_id,
    isCliente: false,
  })

  const [view, setView] = useState<'list' | 'detail' | 'config'>('list')
  const [filterText, setFilterText] = useState('')
  const [filterStatus, setFilterStatus] = useState<ConversationStatus | 'todas'>('todas')
  const [filterCategory, setFilterCategory] = useState<ConversationCategory | 'todas'>('todas')
  const [messageText, setMessageText] = useState('')
  const [isInternalNote, setIsInternalNote] = useState(false)

  const isAdmin = ['super_admin', 'company_owner', 'admin'].includes(currentUser.role)

  useEffect(() => {
    loadConversations()
    if (isAdmin) loadAccessRules()
  }, [loadConversations, loadAccessRules, isAdmin])

  const activeConversation = conversations.find(c => c.id === activeConversationId) ?? null

  function handleSelectConversation(id: string) {
    loadMessages(id)
    setView('detail')
    setMessageText('')
  }

  async function handleSendMessage() {
    if (!activeConversationId || !messageText.trim()) return
    const clean = sanitizeInput(messageText.trim())
    if (!clean) return

    try {
      await sendMessage({
        conversationId: activeConversationId,
        body: clean,
        senderName: currentUser.name,
        isInternalNote,
      })
      setMessageText('')
      // Si era del agente y estaba esperando cliente → en_progreso
      if (activeConversation?.status === 'esperando_cliente' && !isInternalNote) {
        await updateConversation(activeConversationId, { status: 'en_progreso' })
      }
      // Si era del agente y estaba abierta → en_progreso
      if (activeConversation?.status === 'abierta' && !isInternalNote) {
        await updateConversation(activeConversationId, { status: 'en_progreso' })
      }
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo enviar el mensaje.' })
    }
  }

  async function handleChangeStatus(status: ConversationStatus) {
    if (!activeConversationId) return
    try {
      const patch: Partial<Conversation> = { status }
      if (status === 'cerrada' || status === 'resuelta') {
        patch.closed_at = new Date().toISOString()
      }
      await updateConversation(activeConversationId, patch)
      Swal.fire({ icon: 'success', title: 'Estado actualizado', timer: 1200, showConfirmButton: false })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    }
  }

  // Filtros aplicados
  const visibleConversations = conversations.filter(c => {
    if (filterStatus !== 'todas' && c.status !== filterStatus) return false
    if (filterCategory !== 'todas' && c.category !== filterCategory) return false
    return true
  })

  const stats = {
    abiertas: conversations.filter(c => c.status === 'abierta').length,
    en_progreso: conversations.filter(c => c.status === 'en_progreso').length,
    esperando: conversations.filter(c => c.status === 'esperando_cliente').length,
    resueltas: conversations.filter(c => c.status === 'resuelta').length,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>Centro de Comunicación</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Gestión de conversaciones con clientes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isAdmin && (
            <button
              onClick={() => setView(view === 'config' ? 'list' : 'config')}
              style={{
                padding: '8px 14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                background: view === 'config' ? '#f0f9ff' : 'white',
                color: '#374151',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              ⚙️ Configurar accesos
            </button>
          )}
        </div>
      </div>

      {/* ── Stats rápidas ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
        {[
          { label: 'Abiertas', value: stats.abiertas, color: '#3b82f6' },
          { label: 'En Progreso', value: stats.en_progreso, color: '#f59e0b' },
          { label: 'Esperando', value: stats.esperando, color: '#8b5cf6' },
          { label: 'Resueltas', value: stats.resueltas, color: '#10b981' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            padding: '12px 14px',
            borderTop: `3px solid ${s.color}`,
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Vista Configuración ── */}
      {view === 'config' && isAdmin && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#111827' }}>
            Reglas de Acceso por Rol
          </h3>
          <AccessRulesPanel
            companyId={currentUser.company_id!}
            accessRules={accessRules}
            onSave={saveAccessRule}
          />
        </div>
      )}

      {/* ── Vista Lista + Detalle ── */}
      {view !== 'config' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: view === 'detail' ? '320px 1fr' : '1fr',
          gap: '16px',
          alignItems: 'start',
          minHeight: '500px',
        }}>
          {/* Lista */}
          <div style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Filtros */}
            <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f1f5f9' }}>
              <input
                type="text"
                placeholder="Buscar conversación..."
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: '8px',
                }}
              />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value as ConversationStatus | 'todas')}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11.5px', outline: 'none' }}
                >
                  <option value="todas">Todos los estados</option>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value as ConversationCategory | 'todas')}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '11.5px', outline: 'none' }}
                >
                  <option value="todas">Todas las categorías</option>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Lista de conversaciones */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '600px' }}>
              {loading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                  Cargando…
                </div>
              ) : (
                <ConversationList
                  conversations={visibleConversations}
                  activeId={activeConversationId}
                  onSelect={handleSelectConversation}
                  filter={filterText}
                />
              )}
            </div>
          </div>

          {/* Detalle */}
          {view === 'detail' && activeConversation && (
            <div style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: '500px',
            }}>
              {/* Header conversación */}
              <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setView('list')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '18px', padding: '0', lineHeight: 1 }}
                    >
                      ←
                    </button>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: '#111827' }}>{activeConversation.subject}</span>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                      background: STATUS_COLORS[activeConversation.status] + '18',
                      color: STATUS_COLORS[activeConversation.status], fontWeight: 600,
                    }}>
                      {STATUS_LABELS[activeConversation.status]}
                    </span>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
                      background: PRIORITY_COLORS[activeConversation.priority] + '18',
                      color: PRIORITY_COLORS[activeConversation.priority], fontWeight: 600,
                    }}>
                      {PRIORITY_LABELS[activeConversation.priority]}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', marginLeft: '26px' }}>
                    {activeConversation.cliente_nombre} · {CATEGORY_LABELS[activeConversation.category]}
                    {activeConversation.assigned_name && ` · Agente: ${activeConversation.assigned_name}`}
                  </div>
                </div>
                {canEdit && (
                  <select
                    value={activeConversation.status}
                    onChange={e => handleChangeStatus(e.target.value as ConversationStatus)}
                    style={{
                      padding: '6px 10px',
                      border: '1px solid #d1d5db',
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
                )}
              </div>

              {/* Mensajes */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px' }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '13px', marginTop: '40px' }}>
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
                            ? '#fffbeb'
                            : isAgent
                            ? '#0ea5e9'
                            : '#f1f5f9',
                          color: isNote ? '#78350f' : isAgent ? 'white' : '#111827',
                          border: isNote ? '1px solid #fde68a' : 'none',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                        }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', opacity: 0.7 }}>
                            {isNote ? '📝 Nota interna · ' : ''}{msg.sender_name ?? 'Usuario'}
                          </div>
                          <div style={{ fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {msg.body}
                          </div>
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
              {canCreate && activeConversation.status !== 'cerrada' && (
                <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 14px' }}>
                  {/* Toggle nota interna */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '12px',
                    color: '#6b7280',
                    cursor: 'pointer',
                    marginBottom: '8px',
                    userSelect: 'none',
                  }}>
                    <input
                      type="checkbox"
                      checked={isInternalNote}
                      onChange={e => setIsInternalNote(e.target.checked)}
                      style={{ width: '13px', height: '13px', accentColor: '#f59e0b' }}
                    />
                    Nota interna (solo visible para el equipo)
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <textarea
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      placeholder={isInternalNote ? 'Escribe una nota interna…' : 'Escribe una respuesta al cliente…'}
                      rows={3}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        border: `1px solid ${isInternalNote ? '#fde68a' : '#e5e7eb'}`,
                        borderRadius: '10px',
                        fontSize: '13px',
                        resize: 'none',
                        outline: 'none',
                        fontFamily: 'inherit',
                        background: isInternalNote ? '#fffbeb' : 'white',
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage()
                      }}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={sending || !messageText.trim()}
                      style={{
                        padding: '10px 16px',
                        background: sending || !messageText.trim() ? '#9ca3af' : '#0ea5e9',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: sending || !messageText.trim() ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.14s',
                      }}
                    >
                      {sending ? '…' : 'Enviar'}
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '5px' }}>
                    Ctrl+Enter para enviar rápido
                  </div>
                </div>
              )}

              {activeConversation.status === 'cerrada' && (
                <div style={{
                  borderTop: '1px solid #f1f5f9', padding: '12px 14px',
                  background: '#f9fafb', textAlign: 'center',
                  fontSize: '12.5px', color: '#6b7280',
                }}>
                  Esta conversación está cerrada.
                  {canEdit && (
                    <button
                      onClick={() => handleChangeStatus('abierta')}
                      style={{ marginLeft: '10px', color: '#0ea5e9', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Placeholder si no hay conversación seleccionada */}
          {view === 'list' && conversations.length > 0 && (
            <div style={{
              display: 'none', // solo en mobile ya que ocultamos el detalle
            }} />
          )}
        </div>
      )}
    </div>
  )
}
