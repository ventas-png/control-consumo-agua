// com (T2) — Tipos del dominio "comunicacion".
//
// Canales que el usuario gestiona desde la UI de preferencias (com:N9/N10). El
// orquestador admite además 'push', pero hoy no se expone en la UI; mantenemos
// la lista de UI separada del CHECK de la tabla para no acoplar la una a la otra.

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'whatsapp'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

/** Fila cruda de public.notification_preferences. */
export interface NotificationPreferenceRow {
  user_id: string
  channel: string
  enabled: boolean
  company_id: string | null
}

/** Mapa canal → habilitado. Ausencia de canal = habilitado (modelo opt-out). */
export type NotificationPreferenceMap = Record<NotificationChannel, boolean>

/** Etiquetas + descripción de cada canal para la UI. */
export const CHANNEL_META: Record<NotificationChannel, { label: string; description: string; icon: string }> = {
  in_app: {
    label: 'En la app',
    description: 'Notificaciones en la campana dentro de la plataforma.',
    icon: '🔔',
  },
  email: {
    label: 'Correo electrónico',
    description: 'Comunicados y avisos enviados a tu correo registrado.',
    icon: '✉️',
  },
  whatsapp: {
    label: 'WhatsApp',
    description: 'Mensajes por WhatsApp (cuando esté disponible para tu empresa).',
    icon: '💬',
  },
}

/** Default opt-out: todos los canales habilitados si el usuario no guardó nada. */
export function defaultPreferenceMap(): NotificationPreferenceMap {
  return { in_app: true, email: true, whatsapp: true }
}

/** Construye el mapa a partir de las filas guardadas (ausencia = habilitado). */
export function rowsToPreferenceMap(rows: NotificationPreferenceRow[]): NotificationPreferenceMap {
  const map = defaultPreferenceMap()
  for (const r of rows) {
    if (r.channel in map) {
      map[r.channel as NotificationChannel] = r.enabled
    }
  }
  return map
}
