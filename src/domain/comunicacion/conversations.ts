// domain/comunicacion/conversations.ts — acceso a datos de conversaciones
// (comunicación interna/cliente).
//
// T7/PR3 #1 (Parte C): baja a la capa de dominio todo el CRUD que vivía inline
// en useConversations (selects, inserts, updates, upserts, deletes + el upload
// del adjunto a Storage). El hook conserva lo que es de su capa: los canales
// Realtime, el estado local y la orquestación (reload tras escribir, updates
// optimistas).
import { supabase } from '../../lib/supabase'
import type {
  Conversation,
  ConversationMessage,
  ConversationAccessRule,
  ConversationAssignment,
  ConversationCategory,
  ConversationPriority,
  ConversationServiceType,
} from '../../types'

/**
 * Conteo de conversaciones abiertas de la empresa (badge de la topbar). Usa el
 * estimado `planned` (barato; evita COUNT(*) cada 60s sobre toda la tabla).
 * Degrada a 0 si no hay dato.
 */
export async function fetchOpenConversationsCount(companyId: string): Promise<number> {
  const { count } = await supabase
    .from('conversations')
    .select('id', { count: 'planned', head: true })
    .eq('company_id', companyId)
    .eq('status', 'abierta')
  return count ?? 0
}

export interface FetchConversationsOptions {
  companyId?: string
  clienteId?: string
  isCliente: boolean
  serviceType: ConversationServiceType
}

/**
 * Lista de conversaciones, la más reciente primero. Si es cliente filtra por
 * cliente_id; si no, por company_id. Siempre acota por service_type. Lanza si
 * falla (el hook lo envuelve en su try/finally del loading).
 */
export async function fetchConversations(opts: FetchConversationsOptions): Promise<Conversation[]> {
  let query = supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (opts.isCliente && opts.clienteId) {
    query = query.eq('cliente_id', opts.clienteId)
  } else if (opts.companyId) {
    query = query.eq('company_id', opts.companyId)
  }

  query = query.eq('service_type', opts.serviceType)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Conversation[]
}

/** Mensajes de una conversación, en orden cronológico. Lanza si falla. */
export async function fetchConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ConversationMessage[]
}

/** Reglas de acceso de la empresa para un service_type. Lanza si falla. */
export async function fetchAccessRules(
  companyId: string,
  serviceType: ConversationServiceType,
): Promise<ConversationAccessRule[]> {
  const { data, error } = await supabase
    .from('conversation_access_rules')
    .select('*')
    .eq('company_id', companyId)
    .eq('service_type', serviceType)
  if (error) throw error
  return (data ?? []) as ConversationAccessRule[]
}

/** Contexto del actor que escribe (de la sesión/rol actual). */
export interface ConversationActor {
  userId?: string
  isCliente: boolean
  serviceType: ConversationServiceType
}

export interface CreateConversationInput {
  subject: string
  category: ConversationCategory
  priority: ConversationPriority
  clienteId: string
  clienteNombre: string
  companyId: string
  projectId?: string
  firstMessage: string
  senderName: string
}

/** Crea una conversación de cliente + su primer mensaje. Devuelve la fila. */
export async function createConversationWithFirstMessage(
  params: CreateConversationInput,
  actor: ConversationActor,
): Promise<Conversation> {
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
      service_type: actor.serviceType,
    })
    .select()
    .single()

  if (convErr || !conv) throw convErr

  await supabase.from('conversation_messages').insert({
    conversation_id: conv.id,
    sender_id: actor.userId,
    sender_type: actor.isCliente ? 'cliente' : 'agent',
    sender_name: params.senderName,
    body: params.firstMessage,
    is_internal_note: false,
  })

  return conv as Conversation
}

export interface CreateInternalConversationInput {
  subject: string
  category: ConversationCategory
  firstMessage: string
  senderName: string
  companyId: string
}

/** Crea una conversación interna (equipo) + su primer mensaje. Devuelve la fila. */
export async function createInternalConversation(
  params: CreateInternalConversationInput,
  actor: { userId?: string; serviceType: ConversationServiceType },
): Promise<Conversation> {
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
      service_type: actor.serviceType,
    })
    .select()
    .single()

  if (convErr || !conv) throw convErr

  await supabase.from('conversation_messages').insert({
    conversation_id: conv.id,
    sender_id: actor.userId,
    sender_type: 'agent',
    sender_name: params.senderName,
    body: params.firstMessage,
    is_internal_note: false,
  })

  return conv as Conversation
}

export interface SendMessageInput {
  conversationId: string
  body: string
  senderName: string
  isInternalNote?: boolean
  attachment?: File
}

/**
 * Envía un mensaje: sube el adjunto a Storage (si hay), inserta el mensaje y
 * refresca updated_at de la conversación. Guarda el path bare del adjunto;
 * ComunicacionSection / CustomerComunicacion lo firman vía useSignedUrl en cada
 * render. Lanza si falla el upload o el insert.
 */
export async function sendConversationMessage(
  params: SendMessageInput,
  actor: { userId: string; isCliente: boolean },
): Promise<void> {
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
    attachmentUrl = path
    attachmentName = file.name
    attachmentType = file.type
    attachmentSize = file.size
  }

  // 2. Insertar mensaje
  const { error } = await supabase.from('conversation_messages').insert({
    conversation_id: params.conversationId,
    sender_id: actor.userId,
    sender_type: actor.isCliente ? 'cliente' : 'agent',
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
}

/** Actualiza estado/asignación/prioridad de una conversación. Lanza si falla. */
export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'status' | 'assigned_to' | 'assigned_name' | 'priority' | 'closed_at'>>,
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

/**
 * Asignaciones de la empresa, en orden de creación. Degrada a `null` si falla
 * (el hook conserva el estado previo, igual que antes).
 */
export async function fetchAssignments(): Promise<ConversationAssignment[] | null> {
  const { data, error } = await supabase
    .from('conversation_assignments')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) return null
  return (data ?? []) as ConversationAssignment[]
}

/** Asigna una conversación a uno o varios usuarios (upsert idempotente). Lanza si falla. */
export async function assignConversationToUsers(
  conversationId: string,
  users: { userId: string; userName: string }[],
  assignedBy: { id: string; name: string },
): Promise<void> {
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
}

/** Elimina una asignación. Lanza si falla. */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase
    .from('conversation_assignments')
    .delete()
    .eq('id', assignmentId)
  if (error) throw error
}

/**
 * Marca la asignación (conversación + usuario) como vista, solo si aún no lo
 * estaba. Devuelve `true` si se aplicó; el hook usa eso para decidir el update
 * optimista (degrada en silencio si falla, igual que antes).
 */
export async function markAssignmentSeen(
  conversationId: string,
  userId: string,
  seenAt: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('conversation_assignments')
    .update({ seen_at: seenAt })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .is('seen_at', null)
  return !error
}

/** Crea/actualiza una regla de acceso (upsert por company_id,role,service_type). Lanza si falla. */
export async function saveAccessRule(
  rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>,
): Promise<void> {
  const { error } = await supabase
    .from('conversation_access_rules')
    .upsert(rule, { onConflict: 'company_id,role,service_type' })
  if (error) throw error
}
