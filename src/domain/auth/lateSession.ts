// Recuperación de login tardío. El login de la UI corre signInWithPassword
// contra un timeout (Promise.race) que NO cancela la petición subyacente: si
// la respuesta llega después del corte, supabase-js igual guarda la sesión y
// el usuario quedaría autenticado viendo un mensaje de error (incidente
// 2026-06-12: tres logins con 200 OK en ~0.2 s server-side que el navegador
// nunca procesó por pérdida de la respuesta / candado entre pestañas).
//
// waitForLateSession reintenta una verificación de sesión con gracia corta.
// Cada intento corre contra su propio timeout porque getSession() puede
// colgarse en el mismo candado del navegador que atascó el login.

export interface LateSessionOpts {
  /** Verificaciones totales (la primera es inmediata). */
  attempts?: number
  /** Espera entre verificaciones, en ms. */
  delayMs?: number
  /** Tope por verificación antes de abandonarla, en ms. */
  attemptTimeoutMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Espera a que la sesión "tardía" aparezca. `getSession` debe resolver con la
 * sesión si ya existe o null si aún no; errores y cuelgues cuentan como null
 * en ese intento (nunca lanza).
 */
export async function waitForLateSession<T>(
  getSession: () => Promise<T | null>,
  { attempts = 3, delayMs = 1500, attemptTimeoutMs = 3000 }: LateSessionOpts = {},
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs)
    const session = await Promise.race([
      getSession().catch(() => null),
      sleep(attemptTimeoutMs).then(() => null),
    ])
    if (session) return session
  }
  return null
}
