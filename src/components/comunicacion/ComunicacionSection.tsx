import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { notify } from '../shared/Dialog'
import { useConversations } from '../../hooks/useConversations'
import { useTeamUsersQuery } from '../../domain/comunicacion/queries'
import { sanitizeInput } from '../../lib/validation'
import { isProjectExempt } from '../../lib/proyectosAccess'
import {
  buildClienteProjectIndex,
  filterClientesByProjectAccess,
  filterConversationsByProjectAccess,
  filterUnidadesByProjectAccess,
  resolveConversationProjectId,
  type ProjectScope,
} from '../../lib/comunicacionAccess'
import DifusionTab from './DifusionTab'
import { NuevaConversacionModal } from './NuevaConversacionModal'
import { NuevaDiscusionInternaModal } from './NuevaDiscusionInternaModal'
import { AssignToUsersModal } from './AssignToUsersModal'
import { AccessRulesPanel } from './AccessRulesPanel'
import { ConversationStatsBar } from './ConversationStatsBar'
import { ConversationListPanel } from './ConversationListPanel'
import { ConversationDetailView } from './ConversationDetailView'
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel'
import type {
  UserSession,
  Cliente,
  Proyecto,
  Registro,
  Unidad,
  Conversation,
  ConversationCategory,
  ConversationPriority,
  ConversationStatus,
  ConversationServiceType,
} from '../../types'

interface Props {
  currentUser: UserSession
  clientes: Cliente[]
  /** Proyectos que el usuario puede ver (ya filtrados por asignación). */
  proyectos: Proyecto[]
  unidades: Unidad[]
  /**
   * Lecturas de la empresa. Solo se usan para resolver el proyecto de los
   * clientes que no ocupan ninguna unidad (ver lib/comunicacionAccess). Opcional:
   * el registry de condominios no las tiene y ahí las unidades bastan.
   */
  registros?: Registro[]
  /**
   * Alcance por proyecto ya calculado (useAguaData lo construye con las listas
   * CRUDAS de la empresa). Cuando llega, se usa tal cual: derivarlo aquí a
   * partir de unas `unidades`/`registros` ya acotados dejaría a los clientes de
   * otros proyectos como "no resolubles" y la regla de ambigüedad los
   * conservaría. Sin él (registry de condominios) se deriva de los props.
   */
  scope?: ProjectScope
  canCreate: boolean
  canEdit: boolean
  serviceType?: ConversationServiceType
}

type MainTab = 'conversaciones' | 'difusion' | 'preferencias'

const TAB_ICONS: Record<MainTab, ReactNode> = {
  conversaciones: (
    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  difusion: (
    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  ),
  preferencias: (
    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
}

const TAB_LABELS: Record<MainTab, string> = {
  conversaciones: 'Conversaciones',
  difusion: 'Difusión',
  preferencias: 'Notificaciones',
}

// Default estable para `registros`: un `= []` en la firma crearía un array nuevo
// en cada render y recalcularía el scope (y con él toda la lista) sin motivo.
const SIN_REGISTROS: Registro[] = []

// ── Componente principal (orquestador; sub-componentes en com:N6) ────────────
export function ComunicacionSection({ currentUser, clientes, proyectos, unidades, registros = SIN_REGISTROS, scope: scopeProp, canCreate, canEdit, serviceType = 'agua' }: Props) {
  const {
    conversations: allConversations,
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

  // ── Scope por proyecto ────────────────────────────────────────────────────
  // `conversations` y `broadcasts` solo se acotan por empresa (RLS + la query),
  // así que un usuario asignado a un subconjunto de proyectos veía la
  // comunicación de TODOS. `proyectos` ya llega filtrado por asignación
  // (useAguaData → filterProyectosByAssignment), así que sus ids son el conjunto
  // accesible; el resto del scope se deriva igual que en rutas.
  const scopeDerivado: ProjectScope = useMemo(() => ({
    accessibleProjectIds: new Set(proyectos.map(p => p.id)),
    exempt: isProjectExempt(currentUser.role, currentUser.assigned_role_ids),
    clienteProjects: buildClienteProjectIndex({ unidades, registros }),
  }), [proyectos, unidades, registros, currentUser.role, currentUser.assigned_role_ids])
  const scope = scopeProp ?? scopeDerivado

  // Las conversaciones asignadas al usuario nunca se ocultan (espeja la RLS de
  // agentes): si alguien te asignó un caso, lo ves aunque sea de otro proyecto.
  const assignedConversationIds = useMemo(
    () => new Set(assignments.filter(a => a.user_id === currentUser.user_id).map(a => a.conversation_id)),
    [assignments, currentUser.user_id],
  )

  const conversations = useMemo(
    () => filterConversationsByProjectAccess({
      conversations: allConversations,
      scope,
      userId: currentUser.user_id,
      assignedConversationIds,
    }),
    [allConversations, scope, currentUser.user_id, assignedConversationIds],
  )

  // Audiencia seleccionable (nueva conversación / comunicado): también acotada,
  // para no poder escribirle a clientes de proyectos ajenos desde esta pantalla.
  const clientesVisibles = useMemo(() => filterClientesByProjectAccess(clientes, scope), [clientes, scope])
  const unidadesVisibles = useMemo(() => filterUnidadesByProjectAccess(unidades, scope), [unidades, scope])

  const [mainTab, setMainTab] = useState<MainTab>('conversaciones')
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
  // Carga perezosa de usuarios del equipo: solo cuando se va a asignar (com:N6 →
  // capa de datos useTeamUsersQuery, habilitada al pedirla).
  const [teamUsersRequested, setTeamUsersRequested] = useState(false)
  const { data: teamUsers = [] } = useTeamUsersQuery(
    teamUsersRequested ? currentUser.company_id : undefined,
  )

  const clientesTabLabel = serviceType === 'condominios' ? 'Residentes' : 'Clientes'
  // Difusión es el canal masivo de AGUA. En condominios se deja fuera a
  // propósito: el condominio ya tiene el suyo —el tablón (`anuncios_comunidad`),
  // que además llega al portal del residente— y montar Difusión encima serían
  // dos canales compitiendo por lo mismo. Lo único que Difusión sumaba (entrega
  // por email y acuse de lectura) se le añadió al tablón en 20260801000500, así
  // que ya no hay nada que ganar duplicándolo. Además el registry entra aquí con
  // `clientes={[]}`: sin padrón el modal no podría resolver la audiencia.
  const showDifusion = serviceType !== 'condominios'
  const mainTabs: MainTab[] = ['conversaciones', ...(showDifusion ? ['difusion' as const] : []), 'preferencias']

  // isAdmin: puede VER el panel de configuración
  // For condominios: exempt platform roles OR has the "Administrador General" system role
  // (role id 00000000-0000-0000-0000-000000000001 — see src/lib/systemRoleIds.ts)
  const ADMIN_GENERAL_ROLE_ID = '00000000-0000-0000-0000-000000000001'
  const isAdmin = serviceType === 'condominios'
    ? ['super_admin', 'company_owner'].includes(currentUser.role)
        || (currentUser.assigned_role_ids?.includes(ADMIN_GENERAL_ROLE_ID) ?? false)
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
        // Sella el proyecto del cliente cuando es inequívoco: es lo que permite
        // filtrar esta conversación por proyecto sin re-derivarla cada vez.
        projectId: resolveConversationProjectId(data.clienteId, scope) ?? undefined,
        senderName: currentUser.name,
      })
      setShowNuevaModal(false)
      if (conv) {
        loadMessages(conv.id)
        setView('detail')
      }
    } catch {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo crear la conversación.' })
    }
  }

  async function handleCrearDiscusionInterna(data: { subject: string; category: ConversationCategory; firstMessage: string; projectId?: string }) {
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
      notify({ variant: 'error', title: 'Error', text: 'No se pudo crear la discusión.' })
    }
  }

  useEffect(() => {
    loadConversations()
    loadAssignments()
    if (isAdmin) loadAccessRules()
  }, [loadConversations, loadAssignments, loadAccessRules, isAdmin])

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
      notify({ variant: 'error', title: 'Error al enviar', text: msg })
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
      notify({ variant: 'error', title: 'Error', text: 'No se pudo asignar la conversación.' })
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
      notify({ variant: 'error', title: 'Error', text: 'No se pudo desasignar.' })
    }
  }

  function handleOpenAssignModal() {
    setTeamUsersRequested(true)
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
      notify({ variant: 'error', title: 'Error', text: 'No se pudo asignar la conversación.' })
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    try {
      await removeAssignment(assignmentId)
    } catch {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo quitar la asignación.' })
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
      notify({ variant: 'success', title: 'Estado actualizado', duration: 1200 })
    } catch {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
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
      {/* ── Main tabs: Conversaciones / Difusión / Notificaciones ── */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--at-line)', paddingBottom: '0' }}>
        {mainTabs.map(tab => {
          const active = mainTab === tab
          return (
            <button
              key={tab}
              onClick={() => setMainTab(tab)}
              style={{
                padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: active ? 700 : 500,
                color: active ? 'var(--at-primary)' : 'var(--at-ink-3)',
                borderBottom: active ? '2px solid var(--at-primary)' : '2px solid transparent',
                marginBottom: '-2px', transition: 'all 0.13s ease',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              {TAB_ICONS[tab]}
              {TAB_LABELS[tab]}
            </button>
          )
        })}
      </div>

      {/* ── Difusión tab ── */}
      {mainTab === 'difusion' && (
        <DifusionTab
          clientes={clientesVisibles}
          proyectos={proyectos}
          unidades={unidadesVisibles}
          todasLasUnidades={unidades}
          scope={scope}
          canCreate={canCreate}
        />
      )}

      {/* ── Preferencias de notificación tab ── */}
      {mainTab === 'preferencias' && (
        <NotificationPreferencesPanel
          userId={currentUser.user_id}
          companyId={currentUser.company_id}
          lockInApp
        />
      )}

      {/* ── Conversaciones tab ── */}
      {mainTab === 'conversaciones' && <>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Centro de Comunicación</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Gestión de conversaciones con clientes
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && convTab === 'clientes' && (
            <button
              onClick={() => setShowNuevaModal(true)}
              style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: 'var(--at-primary)', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              + Nueva conversación
            </button>
          )}
          {canCreate && convTab === 'equipo' && (
            <button
              onClick={() => setShowNuevaInternaModal(true)}
              style={{ padding: '8px 14px', border: 'none', borderRadius: '8px', background: 'var(--at-accent-hover)', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              + Nueva discusión
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setView(view === 'config' ? 'list' : 'config')}
              style={{
                padding: '8px 14px',
                border: '1px solid var(--at-line-strong)',
                borderRadius: '8px',
                background: view === 'config' ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                color: 'var(--at-ink-2)',
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
      <ConversationStatsBar stats={stats} />

      {/* ── Vista Configuración ── */}
      {view === 'config' && isAdmin && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
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
          <ConversationListPanel
            convTab={convTab}
            onChangeTab={tab => { setConvTab(tab); setView('list') }}
            clientesTabLabel={clientesTabLabel}
            clientConvCount={clientConvs.length}
            teamConvCount={teamConvs.length}
            filterText={filterText}
            onFilterText={setFilterText}
            filterStatus={filterStatus}
            onFilterStatus={setFilterStatus}
            filterCategory={filterCategory}
            onFilterCategory={setFilterCategory}
            serviceType={serviceType}
            loading={loading}
            visibleConversations={visibleConversations}
            activeConversationId={activeConversationId}
            onSelect={handleSelectConversation}
            unseenConvIds={unseenConvIds}
          />

          {/* Detalle */}
          {view === 'detail' && activeConversation && (
            <ConversationDetailView
              conversation={activeConversation}
              messages={messages}
              canCreate={canCreate}
              canEdit={canEdit}
              currentUserId={currentUser.user_id}
              activeAssignments={activeAssignments}
              onBack={() => setView('list')}
              onChangeStatus={handleChangeStatus}
              onAssignToMe={handleAssignToMe}
              onUnassign={handleUnassign}
              onOpenAssignModal={handleOpenAssignModal}
              onRemoveAssignment={handleRemoveAssignment}
              messageText={messageText}
              onChangeMessage={setMessageText}
              isInternalNote={isInternalNote}
              onToggleInternalNote={setIsInternalNote}
              pendingFile={pendingFile}
              onPickFile={setPendingFile}
              sending={sending}
              onSendMessage={handleSendMessage}
            />
          )}
        </div>
      )}

      {/* ── Modal Nueva Conversación (cliente) ── */}
      {showNuevaModal && (
        <NuevaConversacionModal
          clientes={clientesVisibles}
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
          proyectos={proyectos}
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
