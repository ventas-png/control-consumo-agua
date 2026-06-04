import { createContext, useContext, type ReactNode } from 'react'
import type { UserSession } from '../../types'

// agua:A3 — Sesión del usuario autenticado (auth/tenant) vía Context, para dejar
// de drillear `currentUser` por props a través de App.tsx hacia cada Section.
//
// El provider monta SOLO el árbol autenticado de App (después del guard
// `if (!currentUser) return <login>` y de las ramas de portal de `cliente`), así
// que dentro del provider `currentUser` SIEMPRE es no-nulo. `useSession()` por
// tanto devuelve un `UserSession` no-nulo y lanza si se usa fuera del provider
// (fail loud: un componente que necesita sesión no debería renderizarse sin ella).
//
// Los portales de cliente (CustomerPortal/CondominiosClientPortal) y la pantalla
// de onboarding se renderizan FUERA de este provider y siguen recibiendo
// `currentUser` por prop — no consumen `useSession()`.
const SessionContext = createContext<UserSession | null>(null)

export function SessionProvider({ value, children }: { value: UserSession; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Usuario autenticado actual. Lanza si se usa fuera de un <SessionProvider>. */
export function useSession(): UserSession {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession debe usarse dentro de <SessionProvider> (árbol autenticado).')
  }
  return ctx
}
