import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
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
      let query = supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })

      if (isCliente && clienteId) {
        query = query.eq('cliente_id', clienteId)
      } else if (companyId) {
        query = query.eq('company_id', companyId)
      }

      query = query.eq('service_type', serviceType)

      const { data, error } = await query
      if (error) throw error
      setConversations(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [companyId, clienteId, isCliente])

  // ── Cargar mensajes de una conversación ───────────────────────────────────
  const loadMessages = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId)
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (error) throw error
    setMessages(data ?? [])
  }, [])

  // ── Cargar reglas de acceso ───────────────────────────────────────────────
  const loadAccessRules = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('conversation_access_rules')
      .select('*')
      .eq('company_id', companyId)
      .eq('service_type', serviceType)
    if (error) throw error
    setAccessRules(data ?? [])
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
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          company_id: params.companyId,
          project_id: params.projectId ?? null,
          cliente_id: params.clienteId,
          cliente_nombre: params.clienteNombre,
          subject: params.subject,
          category: params.category,
          priority: params.priority,
          status: 'abierta',
          service_type: serviceType,
        })
        .select()
        .single()

      if (convErr || !conv) throw convErr

      // Primer mensaje
      await supabase.from('conversation_messages').insert({
        conversation_id: conv.id,
        sender_id: userId,
        sender_type: isCliente ? 'cliente' : 'agent',
        sender_name: params.senderName,
        body: params.firstMessage,
        is_internal_note: false,
      })

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
      const { data: conv, error: convErr } = await supabase
        .from('conversations')
        .insert({
          company_id: params.companyId,
          cliente_id: null,
          cliente_nombre: null,
          subject: params.subject,
          category: params.category,
          priority: 'media',
          status: 'abierta',
          is_internal: true,
          service_type: serviceType,
        })
        .select()
        .single()

      if (convErr || !conv) throw convErr

      await supabase.from('conversation_messages').insert({
        conversation_id: conv.id,
        sender_id: userId,
        sender_type: 'agent',
        sender_name: params.senderName,
        body: params.firstMessage,
        is_internal_note: false,
      })

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
      // 1. Subir adjunto si existe
      let attachmentUrl: string | null = null
      let attachmentName: string | null = null
      let attachmentType: string | null = null
      let attachmentSize: number | null = null

      if (params.attachment) {
        const file = params.attachment
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${params.conversationId}/${Date.now()}_${safeName}`
        const { error: uploadError } = await supabase.storage
          .from('conv-attachments')
          .upload(path, file, { contentType: file.type })
        if (uploadError) throw uploadError
        // Guardamos el path bare; ComunicacionSection / CustomerComunicacion
        // firman vía useSignedUrl en cada render.
        attachmentUrl = path
        attachmentName = file.name
        attachmentType = file.type
        attachmentSize = file.size
      }

      // 2. Insertar mensaje
      const { error } = await supabase.from('conversation_messages').insert({
        conversation_id: params.conversationId,
        sender_id: userId,
        sender_type: isCliente ? 'cliente' : 'agent',
        sender_name: params.senderName,
        body: params.body,
        is_internal_note: params.isInternalNote ?? false,
        ...(attachmentUrl && {
          attachment_url: attachmentUrl,
          attachment_name: attachmentName,
          attachment_type: attachmentType,
          attachment_size: attachmentSize,
        }),
      })
      if (error) throw error

      // 3. Actualizar updated_at de la conversación
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', params.conversationId)
    } finally {
      setSending(false)
    }
  }, [userId, isCliente])

  // ── Actualizar estado/asignación ──────────────────────────────────────────
  const updateConversation = useCallback(async (
    id: string,
    patch: Partial<Pick<Conversation, 'status' | 'assigned_to' | 'assigned_name' | 'priority' | 'closed_at'>>
  ): Promise<void> => {
    const { error } = await supabase
      .from('conversations')
      .update(patch)
      .eq('id', id)
    if (error) throw error
    setConversations(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }, [])

  // ── Cargar asignaciones de la empresa ────────────────────────────────────
  const loadAssignments = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('conversation_assignments')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) return
    setAssignments(data ?? [])
  }, [companyId])

  // ── Asignar conversación a uno o varios usuarios ──────────────────────────
  const assignToUsers = useCallback(async (
    conversationId: string,
    users: { userId: string; userName: string }[],
    assignedBy: { id: string; name: string }
  ): Promise<void> => {
    const rows = users.map(u => ({
      conversation_id: conversationId,
      user_id: u.userId,
      user_name: u.userName,
      assigned_by_id: assignedBy.id,
      assigned_by_name: assignedBy.name,
      seen_at: null,
    }))
    const { error } = await supabase
      .from('conversation_assignments')
      .upsert(rows, { onConflict: 'conversation_id,user_id' })
    if (error) throw error
    await loadAssignments()
  }, [loadAssignments])

  // ── Eliminar una asignación ───────────────────────────────────────────────
  const removeAssignment = useCallback(async (assignmentId: string): Promise<void> => {
    const { error } = await supabase
      .from('conversation_assignments')
      .delete()
      .eq('id', assignmentId)
    if (error) throw error
    setAssignments(prev => prev.filter(a => a.id !== assignmentId))
  }, [])

  // ── Marcar asignación como vista ──────────────────────────────────────────
  const markAssignmentSeen = useCallback(async (conversationId: string, userId: string): Promise<void> => {
    const { error } = await supabase
      .from('conversation_assignments')
      .update({ seen_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .is('seen_at', null)
    if (error) return
    setAssignments(prev =>
      prev.map(a =>
        a.conversation_id === conversationId && a.user_id === userId && !a.seen_at
          ? { ...a, seen_at: new Date().toISOString() }
          : a
      )
    )
  }, [])

  // ── Guardar/actualizar regla de acceso ────────────────────────────────────
  const saveAccessRule = useCallback(async (rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>): Promise<void> => {
    const { error } = await supabase
      .from('conversation_access_rules')
      .upsert(rule, { onConflict: 'company_id,role,service_type' })
    if (error) throw error
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
