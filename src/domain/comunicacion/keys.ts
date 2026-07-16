// com (T2) — Query keys del dominio "comunicacion".
// Convención de src/domain/README.md: `all` raíz + una función por entidad que
// añade el scope (companyId/userId), normalizando ausencia a null.

export const comunicacionKeys = {
  all: ['comunicacion'] as const,
  /** Preferencias de canal del usuario (com:N9/N10). */
  notificationPreferences: (userId?: string) =>
    [...comunicacionKeys.all, 'notification-preferences', userId ?? null] as const,
  /** Usuarios del equipo (staff) de una empresa, para asignación. */
  teamUsers: (companyId?: string) =>
    [...comunicacionKeys.all, 'team-users', companyId ?? null] as const,
  /** Estatus (metadata, sin token) de la config de WhatsApp del tenant. */
  whatsappEstatus: (companyId?: string) =>
    [...comunicacionKeys.all, 'whatsapp-estatus', companyId ?? null] as const,
}
