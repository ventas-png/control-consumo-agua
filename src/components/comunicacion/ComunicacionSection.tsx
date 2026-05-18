import { useEffect, useRef, useState } from 'react'
import Swal from 'sweetalert2'
import { useConversations } from '../../hooks/useConversations'
import { sanitizeInput } from '../../lib/validation'
import { supabase } from '../../lib/supabase'
import { SecureImage } from '../shared/SecureImage'
import { useSignedUrl } from '../../lib/storageUrls'
import DifusionTab from './DifusionTab'
import { NuevaConversacionModal } from './NuevaConversacionModal'
import { NuevaDiscusionInternaModal } from './NuevaDiscusionInternaModal'

// Sub-componente para firmar el link a un adjunto no-imagen del chat
// (bucket conv-attachments es privado tras S6 follow-up).
function AttachmentLink({ src, name, type, getIcon, body }: {
  src: string
  name?: string | null
  type?: string | null
  getIcon: (mime?: string | null) => string
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
      </div>
    </a>
  )
}

// Sub-componente para imágenes adjuntas: SecureImage envuelta en link firmado.
function AttachmentImage({ src, name, body }: { src: string; name?: string | null; body?: string | null }) {
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
import { AssignToUsersModal } from './AssignToUsersModal'
import { ConversationList } from './ConversationList'
import { AccessRulesPanel } from './AccessRulesPanel'
import {
  CATEGORY_LABELS, PRIORITY_LABELS, PRIORITY_COLORS,
  STATUS_LABELS, STATUS_COLORS,
  getFileIcon, formatBytes,
} from './conversationConstants'
import type {
  UserSession,
  Cliente,
  Proyecto,
  Unidad,
  Conversation,
  ConversationCategory,
  ConversationPriority,
  ConversationStatus,
  ConversationServiceType,
} from '../../types'
import { AGUA_CATEGORIES, CONDOMINIOS_CATEGORIES } from '../../types'

interface Props {
  currentUser: UserSession
  clientes: Cliente[]
  proyectos: Proyecto[]
  unidades: Unidad[]
  canCreate: boolean
  canEdit: boolean
  serviceType?: ConversationServiceType
}

// ── Componente principal ─────────────────────────────────────────────────────
export function ComunicacionSection({ currentUser, clientes, proyectos, unidades, canCreate, canEdit, serviceType = 'agua' }: Props) {
  const {
    conversations,
    messages,
    accessRules,
    assignments,
    activeConversationId,
    loading,
    sending,
    loadConversations,
    loadMessages,
    loadAccessRules,
    loadAssignments,
    createConversation,
    createInternalConversation,
    sendMessage,
    updateConversation,
    saveAccessRule,
    assignToUsers,
    removeAssignment,
    markAssignmentSeen,
  } = useConversations({
    companyId: currentUser.company_id,
    userId: currentUser.user_id,
    isCliente: false,
    serviceType,
  })

  const [mainTab, setMainTab] = useState<'conversaciones' | 'difusion'>('conversaciones')
  const [view, setView] = useState<'list' | 'detail' | 'config'>('list')
  const [convTab, setConvTab] = useState<'clientes' | 'equipo'>('clientes')
  const [filterText, setFilterText] = useState('')
  const [filterStatus, setFilterStatus] = useState<ConversationStatus | 'todas'>('todas')
  const [filterCategory, setFilterCategory] = useState<ConversationCategory | 'todas'>('todas')
  const [messageText, setMessageText] = useState('')
  const [isInternalNote, setIsInternalNote] = useState(false)
  const [showNuevaModal, setShowNuevaModal] = useState(false)
  const [showNuevaInternaModal, setShowNuevaInternaModal] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [teamUsers, setTeamUsers] = useState<{ id: string; full_name: string; role: string }[]>([])
  const teamUsersLoadedRef = useRef(false)

  const clientesTabLabel = serviceType === 'condominios' ? 'Residentes' : 'Clientes'
  const showDifusion = serviceType !== 'condominios'

  // isAdmin: puede VER el panel de configuración
  const isAdmin = serviceType === 'condominios'
    ? ['super_admin', 'company_owner'].includes(currentUser.role)
        || currentUser.condominios_role === 'administrador_general'
        || (currentUser.condominios_roles?.includes('administrador_general') ?? false)
    : ['super_admin', 'company_owner', 'admin'].includes(currentUser.role)
  // canEditRules: puede GUARDAR cambios en conversation_access_rules (coincide con RLS)
  const canEditRules = ['super_admin', 'company_owner'].includes(currentUser.role)

  async function handleCrearConversacion(data: {
    clienteId: string
    clienteNombre: string
    subject: string
    category: ConversationCategory
    priority: ConversationPriority
    firstMessage: string
  }) {
    try {
      const conv = await createConversation({
        ...data,
        companyId: currentUser.company_id!,
        senderName: currentUser.name,
      })
      setShowNuevaModal(false)
      if (conv) {
        loadMessages(conv.id)
        setView('detail')
      }
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo crear la conversación.' })
    }
  }

  async function handleCrearDiscusionInterna(data: { subject: string; category: ConversationCategory; firstMessage: string }) {
    try {
      const conv = await createInternalConversation({
        ...data,
        companyId: currentUser.company_id!,
        senderName: currentUser.name,
      })
      setShowNuevaInternaModal(false)
      if (conv) {
        loadMessages(conv.id)
        setView('detail')
      }
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo crear la discusión.' })
    }
  }

  useEffect(() => {
    loadConversations()
    loadAssignments()
    if (isAdmin) loadAccessRules()
  }, [loadConversations, loadAssignments, loadAccessRules, isAdmin])

  async function loadTeamUsers() {
    if (teamUsersLoadedRef.current || !currentUser.company_id) return
    const { data } = await supabase
      .from('app_users')
      .select('id, full_name, role')
      .eq('company_id', currentUser.company_id)
      .eq('activo', true)
      .neq('role', 'cliente')
      .order('full_name')
    if (data) {
      setTeamUsers(data)
      teamUsersLoadedRef.current = true
    }
  }

  const activeConversation = conversations.find(c => c.id === activeConversationId) ?? null

  function handleSelectConversation(id: string) {
    loadMessages(id)
    setView('detail')
    setMessageText('')
    // Si hay una asignación no vista para el usuario actual, marcarla como vista
    const hasUnseen = assignments.some(
      a => a.conversation_id === id && a.user_id === currentUser.user_id && !a.seen_at
    )
    if (hasUnseen) {
      markAssignmentSeen(id, currentUser.user_id)
    }
  }

  async function handleSendMessage() {
    if (!activeConversationId || (!messageText.trim() && !pendingFile)) return
    const clean = sanitizeInput(messageText.trim())

    try {
      await sendMessage({
        conversationId: activeConversationId,
        body: clean,
        senderName: currentUser.name,
        isInternalNote,
        attachment: pendingFile ?? undefined,
      })
      setMessageText('')
      setPendingFile(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Error desconocido'
      Swal.fire({ icon: 'error', title: 'Error al enviar', text: msg })
      return
    }

    // Actualizar estado conversación — separado para no confundir con error de envío
    if (!isInternalNote) {
      const st = activeConversation?.status
      if (st === 'esperando_cliente' || st === 'abierta') {
        updateConversation(activeConversationId, { status: 'en_progreso' }).catch(() => {})
      }
    }
  }

  async function handleAssignToMe() {
    if (!activeConversationId) return
    try {
      await updateConversation(activeConversationId, {
        assigned_to: currentUser.user_id,
        assigned_name: currentUser.name,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo asignar la conversación.' })
    }
  }

  async function handleUnassign() {
    if (!activeConversationId) return
    try {
      await updateConversation(activeConversationId, {
        assigned_to: null,
        assigned_name: null,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo desasignar.' })
    }
  }

  async function handleOpenAssignModal() {
    await loadTeamUsers()
    setShowAssignModal(true)
  }

  async function handleAssignToUsers(selectedIds: string[]) {
    if (!activeConversationId) return
    const users = selectedIds.map(id => {
      const u = teamUsers.find(u => u.id === id)
      return { userId: id, userName: u?.full_name ?? id }
    })
    try {
      await assignToUsers(activeConversationId, users, {
        id: currentUser.user_id,
        name: currentUser.name,
      })
      setShowAssignModal(false)
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo asignar la conversación.' })
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    try {
      await removeAssignment(assignmentId)
    } catch {
      Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo quitar la asignación.' })
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
  const clientConvs = conversations.filter(c => !c.is_internal)
  const teamConvs = conversations.filter(c => c.is_internal)
  const tabConvs = convTab === 'clientes' ? clientConvs : teamConvs

  const visibleConversations = tabConvs.filter(c => {
    if (filterStatus !== 'todas' && c.status !== filterStatus) return false
    if (filterCategory !== 'todas' && c.category !== filterCategory) return false
    return true
  })

  const stats = {
    abiertas: clientConvs.filter(c => c.status === 'abierta').length,
    en_progreso: clientConvs.filter(c => c.status === 'en_progreso').length,
    esperando: clientConvs.filter(c => c.status === 'esperando_cliente').length,
    resueltas: clientConvs.filter(c => c.status === 'resuelta').length,
  }

  // Conversaciones asignadas al usuario actual que aún no ha visto
  const unseenConvIds = new Set(
    assignments
      .filter(a => a.user_id === currentUser.user_id && !a.seen_at)
      .map(a => a.conversation_id)
  )

  // Asignaciones de la conversación activa
  const activeAssignments = assignments.filter(
    a => a.conversation_id === activeConversationId
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Main tabs: Conversaciones / Difusión ── */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid #e2e8f0', paddingBottom: '0' }}>
        {(['conversaciones', ...(showDifusion ? ['difusion'] : [])] as ('conversaciones' | 'difusion')[]).map(tab => {
          const active = mainTab === tab
          return (
            <button
              key={tab}
              onClick={() => setMainTab(tab)}
              style={{
                padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: active ? 700 : 500,
                color: active ? '#0ea5e9' : '#6b7280',
                borderBottom: active ? '2px solid #0ea5e9' : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.13s ease',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              {tab === 'conversaciones' ? (
                <>
                  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Conversaciones
                </>
              ) : (
                <>
                  <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                  </svg>
                  Difusión
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Difusión tab ── */}
      {mainTab === 'difusion' && (
        <DifusionTab
          currentUser={currentUser}
          clientes={clientes}
          proyectos={proyectos}
          unidades={unidades}
          canCreate={canCreate}
        />
      )}

      {/* ── Conversaciones tab ── */}
      {mainTab === 'conversaciones' && <>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' }}>Centro de Comunicación</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Gestión de conversaciones con clientes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && convTab === 'clientes' && (
            <button
              onClick={() => setShowNuevaModal(true)}
              style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: '#0ea5e9', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              + Nueva conversación
            </button>
          )}
          {canCreate && convTab === 'equipo' && (
            <button
              onClick={() => setShowNuevaInternaModal(true)}
              style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: '#7c3aed', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              + Nueva discusión
            </button>
          )}
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
            canEdit={canEditRules}
            serviceType={serviceType}
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
            {/* Tabs: Clientes / Equipo */}
            <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9' }}>
              {([['clientes', `👥 ${clientesTabLabel}`, clientConvs.length], ['equipo', '🏢 Equipo', teamConvs.length]] as const).map(([tab, label, count]) => (
                <button key={tab} onClick={() => { setConvTab(tab); setView('list') }}
                  style={{
                    flex: 1, padding: '10px 8px', border: 'none', borderBottom: `2px solid ${convTab === tab ? (tab === 'equipo' ? '#7c3aed' : '#0ea5e9') : 'transparent'}`,
                    background: 'white', cursor: 'pointer', fontSize: '12.5px', fontWeight: convTab === tab ? 700 : 400,
                    color: convTab === tab ? (tab === 'equipo' ? '#7c3aed' : '#0ea5e9') : '#6b7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                  }}>
                  {label}
                  <span style={{ background: convTab === tab ? (tab === 'equipo' ? '#ede9fe' : '#e0f2fe') : '#f3f4f6', color: convTab === tab ? (tab === 'equipo' ? '#7c3aed' : '#0369a1') : '#9ca3af', borderRadius: '999px', padding: '1px 6px', fontSize: '11px', fontWeight: 600 }}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

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
                  {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
                    <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
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
                  unseenConvIds={unseenConvIds}
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
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', marginLeft: '26px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {activeConversation.is_internal ? (
                      <span style={{ background: '#ede9fe', color: '#7c3aed', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', fontWeight: 600 }}>
                        🏢 Discusión interna de equipo
                      </span>
                    ) : (
                      <span>{activeConversation.cliente_nombre} ·</span>
                    )}
                    <span>{CATEGORY_LABELS[activeConversation.category]}</span>
                    {activeConversation.assigned_name && <span>· Agente: {activeConversation.assigned_name}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
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
                    {/* Asignación principal */}
                    {activeConversation.assigned_name ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11.5px', color: '#6b7280' }}>
                          👤 {activeConversation.assigned_name}
                        </span>
                        <button
                          onClick={handleUnassign}
                          style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '11px', color: '#6b7280', cursor: 'pointer', padding: '2px 8px' }}
                        >
                          Desasignar
                        </button>
                        {activeConversation.assigned_to !== currentUser.user_id && (
                          <button
                            onClick={handleAssignToMe}
                            style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11px', color: '#1d4ed8', cursor: 'pointer', padding: '2px 8px', fontWeight: 600 }}
                          >
                            Asignarme
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={handleAssignToMe}
                        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11.5px', color: '#1d4ed8', cursor: 'pointer', padding: '4px 10px', fontWeight: 600 }}
                      >
                        + Asignarme
                      </button>
                    )}
                    {/* Asignación a equipo */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                      <button
                        onClick={handleOpenAssignModal}
                        style={{
                          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px',
                          fontSize: '11.5px', color: '#15803d', cursor: 'pointer', padding: '4px 10px', fontWeight: 600,
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
                                background: '#ede9fe', color: '#6d28d9',
                                fontSize: '11px', padding: '2px 6px', borderRadius: '999px', fontWeight: 500,
                              }}
                            >
                              {a.user_name}
                              <button
                                onClick={() => handleRemoveAssignment(a.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', padding: '0', lineHeight: 1, fontSize: '12px' }}
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
                          {msg.body && (
                            <div style={{ fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {msg.body}
                            </div>
                          )}
                          {msg.attachment_url && msg.attachment_type?.startsWith('image/') && (
                            <AttachmentImage src={msg.attachment_url} name={msg.attachment_name} body={msg.body} />
                          )}
                          {msg.attachment_url && !msg.attachment_type?.startsWith('image/') && (
                            <AttachmentLink
                              src={msg.attachment_url}
                              name={msg.attachment_name}
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
              {canCreate && activeConversation.status !== 'cerrada' && (
                <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 14px' }}>
                  {/* Toggle nota interna — solo para conversaciones con clientes */}
                  {!activeConversation.is_internal && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280', cursor: 'pointer', marginBottom: '8px', userSelect: 'none' }}>
                      <input type="checkbox" checked={isInternalNote} onChange={e => setIsInternalNote(e.target.checked)}
                        style={{ width: '13px', height: '13px', accentColor: '#f59e0b' }} />
                      Nota interna (solo visible para el equipo)
                    </label>
                  )}
                  {/* Preview archivo pendiente */}
                  {pendingFile && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', marginBottom: '7px',
                      background: '#f0f9ff', border: '1px solid #bae6fd',
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
                        <div style={{ fontSize: '12px', fontWeight: 500, color: '#0369a1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pendingFile.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>{formatBytes(pendingFile.size)}</div>
                      </div>
                      <button
                        onClick={() => setPendingFile(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '16px', lineHeight: 1, padding: '2px', flexShrink: 0 }}
                      >
                        ×
                      </button>
                    </div>
                  )}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label title="Adjuntar archivo" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', border: '1px solid #e5e7eb', borderRadius: '10px', background: 'white', fontSize: '18px' }}>
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
                              Swal.fire({ icon: 'warning', title: 'Archivo muy grande', text: 'El archivo no puede superar los 10 MB.' })
                              return
                            }
                            setPendingFile(file)
                          }}
                        />
                      </label>
                      <button
                        onClick={handleSendMessage}
                        disabled={sending || (!messageText.trim() && !pendingFile)}
                        style={{
                          padding: '10px 16px',
                          background: (sending || (!messageText.trim() && !pendingFile)) ? '#9ca3af' : '#0ea5e9',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontWeight: 600,
                          fontSize: '13px',
                          cursor: (sending || (!messageText.trim() && !pendingFile)) ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'background 0.14s',
                        }}
                      >
                        {sending ? '…' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '5px' }}>
                    Ctrl+Enter para enviar · Max 10 MB por adjunto
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

      {/* ── Modal Nueva Conversación (cliente) ── */}
      {showNuevaModal && (
        <NuevaConversacionModal
          clientes={clientes}
          sending={sending}
          onClose={() => setShowNuevaModal(false)}
          onConfirm={handleCrearConversacion}
          serviceType={serviceType}
        />
      )}

      {/* ── Modal Nueva Discusión Interna (equipo) ── */}
      {showNuevaInternaModal && (
        <NuevaDiscusionInternaModal
          sending={sending}
          onClose={() => setShowNuevaInternaModal(false)}
          onConfirm={handleCrearDiscusionInterna}
          serviceType={serviceType}
        />
      )}

      {/* ── Modal Asignar a usuarios ── */}
      {showAssignModal && activeConversationId && (
        <AssignToUsersModal
          teamUsers={teamUsers}
          currentAssignments={activeAssignments}
          onClose={() => setShowAssignModal(false)}
          onAssign={handleAssignToUsers}
          onRemove={handleRemoveAssignment}
        />
      )}
      </>}
    </div>
  )
}
