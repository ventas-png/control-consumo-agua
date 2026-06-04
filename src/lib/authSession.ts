// agua:A9 — Persistencia de la sesión de usuario extraída de useAuth.ts
// (responsabilidades mezcladas). Encapsula el (de)serializado de UserSession en
// sessionStorage, incluyendo la (re)hidratación del Set de `permissions` y la
// validación de expiración. No se usa localStorage para la sesión: evita robo
// vía XSS (solo se limpia una clave legacy heredada de versiones previas).

import type { UserSession } from '../types'

const SESSION_KEY = 'userSession'
const LEGACY_CACHED_SESSION_KEY = 'cached_session'

export function getStoredSession(): UserSession | null {
  try {
    const data = sessionStorage.getItem(SESSION_KEY)
    if (!data) return null
    const parsed = JSON.parse(data) as UserSession & { permissions?: string[] | Set<string> }
    if (new Date() >= new Date(parsed.expires_at)) return null
    // permissions serializa como array; rehidratar a Set
    if (Array.isArray(parsed.permissions)) {
      parsed.permissions = new Set(parsed.permissions) as Set<string>
    }
    return parsed as UserSession
  } catch {
    return null
  }
}

export function storeSession(session: UserSession): void {
  const serializable = {
    ...session,
    permissions: session.permissions ? [...session.permissions] : undefined,
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(serializable))
  // Seguridad: ya no se guarda la sesión en localStorage para evitar robo vía XSS
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
  // Limpia sesiones cacheadas legacy de versiones anteriores
  localStorage.removeItem(LEGACY_CACHED_SESSION_KEY)
}
