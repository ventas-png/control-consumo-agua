import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type {
  Conversation,
  ConversationMessage,
  ConversationAccessRule,
  ConversationCategory,
  ConversationPriority,
} from '../types'

interface UseConversationsOptions {
  companyId?: string
  clienteId?: string   // si es rol 'cliente'
  userId?: string      // auth.uid()
  isCliente?: boolean
}

export function useConversations({ companyId, clienteId, userId, isCliente = false }: UseConversationsOptions) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [accessRules, setAccessRules] = useState<ConversationAccessRule[]>([])
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
    if (error) throw error
    setAccessRules(data ?? [])
  }, [companyId])

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

  // ── Enviar mensaje ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (params: {
    conversationId: string
    body: string
    senderName: string
    isInternalNote?: boolean
  }): Promise<void> => {
    if (!userId) return
    setSending(true)
    try {
      const { error } = await supabase.from('conversation_messages').insert({
        conversation_id: params.conversationId,
        sender_id: userId,
        sender_type: isCliente ? 'cliente' : 'agent',
        sender_name: params.senderName,
        body: params.body,
        is_internal_note: params.isInternalNote ?? false,
      })
      if (error) throw error

      // Actualizar updated_at de la conversación
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

  // ── Guardar/actualizar regla de acceso ────────────────────────────────────
  const saveAccessRule = useCallback(async (rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>): Promise<void> => {
    const { error } = await supabase
      .from('conversation_access_rules')
      .upsert(rule, { onConflict: 'company_id,role' })
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
  useEffect(() => {
    if (!companyId && !clienteId) return

    const channel = supabase
      .channel(`conv-list-${companyId ?? clienteId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => { loadConversations() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [companyId, clienteId, loadConversations])

  return {
    conversations,
    messages,
    accessRules,
    activeConversationId,
    loading,
    sending,
    loadConversations,
    loadMessages,
    loadAccessRules,
    createConversation,
    sendMessage,
    updateConversation,
    saveAccessRule,
  }
}
