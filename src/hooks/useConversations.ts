import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  fetchConversations,
  fetchConversationMessages,
  fetchAccessRules,
  createConversationWithFirstMessage,
  createInternalConversation as createInternalConversationApi,
  sendConversationMessage,
  updateConversation as updateConversationApi,
  fetchAssignments,
  assignConversationToUsers,
  deleteAssignment,
  markAssignmentSeen as markAssignmentSeenApi,
  saveAccessRule as saveAccessRuleApi,
} from '../domain/comunicacion/conversations'
import type {
  Conversation,
  ConversationMessage,
  ConversationAccessRule,
  ConversationAssignment,
  ConversationCategory,
  ConversationPriority,
  ConversationServiceType,
} from '../types'

interface UseConversationsOptions {
  companyId?: string
  clienteId?: string   // si es rol 'cliente'
  userId?: string      // auth.uid()
  isCliente?: boolean
  serviceType?: ConversationServiceType
}

export function useConversations({ companyId, clienteId, userId, isCliente = false, serviceType = 'agua' }: UseConversationsOptions) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [accessRules, setAccessRules] = useState<ConversationAccessRule[]>([])
  const [assignments, setAssignments] = useState<ConversationAssignment[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Cargar conversaciones ──────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (!companyId && !clienteId) return
    setLoading(true)
    try {
      setConversations(await fetchConversations({ companyId, clienteId, isCliente, serviceType }))
    } finally {
      setLoading(false)
    }
  }, [companyId, clienteId, isCliente])

  // ── Cargar mensajes de una conversación ───────────────────────────────────
  const loadMessages = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId)
    setMessages(await fetchConversationMessages(conversationId))
  }, [])

  // ── Cargar reglas de acceso ───────────────────────────────────────────────
  const loadAccessRules = useCallback(async () => {
    if (!companyId) return
    setAccessRules(await fetchAccessRules(companyId, serviceType))
  }, [companyId, serviceType])

  // ── Crear nueva conversación ──────────────────────────────────────────────
  const createConversation = useCallback(async (params: {
    subject: string
    category: ConversationCategory
    priority: ConversationPriority
    clienteId: string
    clienteNombre: string
    companyId: string
    projectId?: string
    firstMessage: string
    senderName: string
  }): Promise<Conversation | null> => {
    setSending(true)
    try {
      const conv = await createConversationWithFirstMessage(params, { userId, isCliente, serviceType })
      setConversations(prev => [conv, ...prev])
      return conv
    } finally {
      setSending(false)
    }
  }, [userId, isCliente])

  // ── Crear conversación interna (equipo) ──────────────────────────────────
  const createInternalConversation = useCallback(async (params: {
    subject: string
    category: ConversationCategory
    firstMessage: string
    senderName: string
    companyId: string
  }): Promise<Conversation | null> => {
    setSending(true)
    try {
      const conv = await createInternalConversationApi(params, { userId, serviceType })
      setConversations(prev => [conv, ...prev])
      return conv
    } finally {
      setSending(false)
    }
  }, [userId])

  // ── Enviar mensaje ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (params: {
    conversationId: string
    body: string
    senderName: string
    isInternalNote?: boolean
    attachment?: File
  }): Promise<void> => {
    if (!userId) return
    setSending(true)
    try {
      await sendConversationMessage(params, { userId, isCliente })
    } finally {
      setSending(false)
    }
  }, [userId, isCliente])

  // ── Actualizar estado/asignación ──────────────────────────────────────────
  const updateConversation = useCallback(async (
    id: string,
    patch: Partial<Pick<Conversation, 'status' | 'assigned_to' | 'assigned_name' | 'priority' | 'closed_at'>>
  ): Promise<void> => {
    await updateConversationApi(id, patch)
    setConversations(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  // ── Cargar asignaciones de la empresa ────────────────────────────────────
  const loadAssignments = useCallback(async () => {
    if (!companyId) return
    const rows = await fetchAssignments()
    if (rows) setAssignments(rows)
  }, [companyId])

  // ── Asignar conversación a uno o varios usuarios ──────────────────────────
  const assignToUsers = useCallback(async (
    conversationId: string,
    users: { userId: string; userName: string }[],
    assignedBy: { id: string; name: string }
  ): Promise<void> => {
    await assignConversationToUsers(conversationId, users, assignedBy)
    await loadAssignments()
  }, [loadAssignments])

  // ── Eliminar una asignación ───────────────────────────────────────────────
  const removeAssignment = useCallback(async (assignmentId: string): Promise<void> => {
    await deleteAssignment(assignmentId)
    setAssignments(prev => prev.filter(a => a.id !== assignmentId))
  }, [])

  // ── Marcar asignación como vista ──────────────────────────────────────────
  const markAssignmentSeen = useCallback(async (conversationId: string, userId: string): Promise<void> => {
    const now = new Date().toISOString()
    const ok = await markAssignmentSeenApi(conversationId, userId, now)
    if (!ok) return
    setAssignments(prev =>
      prev.map(a =>
        a.conversation_id === conversationId && a.user_id === userId && !a.seen_at
          ? { ...a, seen_at: now }
          : a
      )
    )
  }, [])

  // ── Guardar/actualizar regla de acceso ────────────────────────────────────
  const saveAccessRule = useCallback(async (rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>): Promise<void> => {
    await saveAccessRuleApi(rule)
    await loadAccessRules()
  }, [loadAccessRules])

  // ── Realtime: nuevos mensajes en la conversación activa ───────────────────
  useEffect(() => {
    if (!activeConversationId) return

    // Limpiar canal previo
    if (realtimeRef.current) {
      supabase.removeChannel(realtimeRef.current)
    }

    const channel = supabase
      .channel(`conv-messages-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as ConversationMessage
          setMessages(prev => {
            // Evitar duplicados
            if (prev.some(m => m.id === newMsg.id)) return prev
            return [...prev, newMsg]
          })
        }
      )
      .subscribe()

    realtimeRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [activeConversationId])

  // ── Realtime: nuevas conversaciones ──────────────────────────────────────
  // Sin el filter, cada cambio en CUALQUIER conversación de CUALQUIER empresa
  // disparaba loadConversations() en todos los clientes conectados — N
  // recargas por minuto en horas pico. El filter scopea el canal al tenant.
  useEffect(() => {
    if (!companyId && !clienteId) return

    const channel = supabase
      .channel(`conv-list-${companyId ?? clienteId}-${serviceType}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          ...(companyId ? { filter: `company_id=eq.${companyId}` } : {}),
        },
        () => { loadConversations() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [companyId, clienteId, serviceType, loadConversations])

  // ── Realtime: cambios en asignaciones ────────────────────────────────────
  // conversation_assignments no tiene company_id directo (linked vía
  // conversation_id), pero su volumen es bajo así que recargar todo cuando
  // hay cambio sigue siendo aceptable. Si crece, considerar agregar
  // company_id desnormalizado para poder filtrar aquí también.
  useEffect(() => {
    if (!companyId) return

    const channel = supabase
      .channel(`conv-assignments-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_assignments',
        },
        () => { loadAssignments() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [companyId, loadAssignments])

  return {
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
  }
}
