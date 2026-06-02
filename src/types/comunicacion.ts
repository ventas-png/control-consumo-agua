// agua:A6 / cond:C9 — Tipos del Centro de Comunicación + Difusión masiva.
// Extraído del monolito `src/types/index.ts` siguiendo el patrón de
// `src/types/agua.ts`. El barrel re-exporta para preservar imports existentes.

// ── Centro de Comunicación ─────────────────────────────────────────────────

export type ConversationStatus =
  | 'abierta'
  | 'en_progreso'
  | 'esperando_cliente'
  | 'resuelta'
  | 'cerrada';

export type ConversationServiceType = 'agua' | 'condominios';
export type ConversationCategory =
  | 'general' | 'pagos' | 'tecnico' | 'calidad'        // agua
  | 'mantenimiento' | 'finanzas' | 'convivencia';       // condominios
export type ConversationPriority = 'baja' | 'media' | 'alta' | 'urgente';

export const AGUA_CATEGORIES: ConversationCategory[] = ['general', 'pagos', 'tecnico', 'calidad'];
export const CONDOMINIOS_CATEGORIES: ConversationCategory[] = ['general', 'mantenimiento', 'finanzas', 'convivencia'];

export interface Conversation {
  id: string;
  company_id: string;
  project_id?: string | null;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  is_internal?: boolean;
  service_type?: ConversationServiceType;
  subject: string;
  category: ConversationCategory;
  priority: ConversationPriority;
  status: ConversationStatus;
  assigned_to?: string | null;
  assigned_name?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  // join opcional (último mensaje)
  last_message?: string | null;
  unread_count?: number;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_type: 'cliente' | 'agent';
  sender_name?: string | null;
  body: string;
  is_internal_note: boolean;
  read_at?: string | null;
  created_at: string;
  // Adjuntos (imagen o documento)
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
}

export interface ConversationAccessRule {
  id: string;
  company_id: string;
  role: string;
  service_type: ConversationServiceType;
  can_view_all: boolean;
  can_respond: boolean;
  can_assign: boolean;
  categories: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationAssignment {
  id: string;
  conversation_id: string;
  user_id: string;
  user_name: string;
  assigned_by_id: string;
  assigned_by_name: string;
  seen_at: string | null;
  created_at: string;
}
// ── Difusión (mensajes masivos) ───────────────────────────────────────────────

export type BroadcastTargetType = 'todos' | 'proyecto' | 'unidades' | 'clientes'

export interface Broadcast {
  id: string
  company_id: string
  title: string
  body: string
  sent_by_id: string
  sent_by_name: string
  target_type: BroadcastTargetType
  target_ids: string[]
  recipient_count: number
  send_email: boolean
  created_at: string
  // join optional — calculado en query
  read_count?: number
}

export interface BroadcastRecipient {
  id: string
  broadcast_id: string
  cliente_id: string
  read_at: string | null
  email_sent: boolean
  email_error: string | null
  created_at: string
  // join opcional
  broadcast?: Broadcast
}
