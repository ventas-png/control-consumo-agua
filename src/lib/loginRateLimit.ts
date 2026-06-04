// agua:A9 — Rate-limiting de login extraído de useAuth.ts (responsabilidades
// mezcladas). Lógica pura sobre sessionStorage: cuenta intentos fallidos y
// bloquea temporalmente tras MAX_LOGIN_ATTEMPTS. No depende de React ni de
// Supabase, así que es trivialmente testeable de forma aislada.

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 60_000 // 1 minuto
const STORAGE_KEY = 'login_failures'

interface LoginFailures { count: number; lockedUntil: number }

function getLoginFailures(): LoginFailures {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { count: 0, lockedUntil: 0 }
    return JSON.parse(raw) as LoginFailures
  } catch { return { count: 0, lockedUntil: 0 } }
}

export function recordLoginFailure(): void {
  const f = getLoginFailures()
  f.count += 1
  if (f.count >= MAX_LOGIN_ATTEMPTS) {
    f.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(f))
}

export function clearLoginFailures(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

/**
 * Devuelve el mensaje de bloqueo si el usuario superó el máximo de intentos y
 * el lockout sigue vigente; `null` si puede intentar. Como efecto colateral,
 * limpia el contador cuando el lockout ya expiró (auto-reset).
 */
export function getLoginLockoutMessage(): string | null {
  const f = getLoginFailures()
  if (f.count >= MAX_LOGIN_ATTEMPTS && Date.now() < f.lockedUntil) {
    const secsLeft = Math.ceil((f.lockedUntil - Date.now()) / 1000)
    return `Demasiados intentos fallidos. Intente en ${secsLeft} segundos.`
  }
  if (f.count >= MAX_LOGIN_ATTEMPTS && Date.now() >= f.lockedUntil) {
    clearLoginFailures()
  }
  return null
}
