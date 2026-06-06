// domain/comunicacion/conversations.ts — Lecturas de conversaciones (comunicación
// interna/cliente). T7 follow-up: baja el acceso directo a Supabase que vivía en
// App.tsx para el badge de "comunicaciones sin leer".
import { supabase } from '../../lib/supabase'

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
