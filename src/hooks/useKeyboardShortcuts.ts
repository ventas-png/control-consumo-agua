import { useEffect, useRef } from 'react'

// ============================================================================
// useKeyboardShortcuts — Hook global de atajos de teclado.
// ============================================================================
// Soporta dos tipos de shortcuts:
//
//   1) Single keys con modifier (ej: Cmd+K, Ctrl+K) — manejados por el
//      CommandPalette directamente, no este hook.
//
//   2) Vim-style "leader sequences" (ej: 'g c' para navegar a Clientes).
//      Este hook implementa el patron leader: presionar 'g' entra a un
//      modo donde la siguiente tecla en un timeout corto (1.2s) ejecuta
//      el shortcut. Si la tecla no matchea, se cancela silenciosamente.
//
//   3) Atajos simples sin modifier (ej: '?' para help, '/' para focus
//      buscador) — solo se disparan si el foco no esta en input/textarea.
//
// Ignora eventos cuando el foco esta en un campo editable (input, textarea,
// contenteditable, select) — el usuario esta escribiendo, no navegando.

export interface ShortcutBinding {
  /** Secuencia: 'g c' o '?' o 'g d' */
  sequence: string
  /** Handler cuando matchea */
  handler: (e: KeyboardEvent) => void
  /** Descripcion humana (para el modal de ayuda) */
  description: string
  /** Categoria visual en el modal de ayuda */
  category?: string
}

const LEADER_TIMEOUT_MS = 1200

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

/** Normaliza un evento de teclado a la representacion textual del shortcut */
function keyToToken(e: KeyboardEvent): string {
  // Casos especiales antes de devolver la tecla cruda.
  if (e.key === '?') return '?'
  if (e.key === '/') return '/'
  if (e.key === 'Escape') return 'Escape'
  if (e.key.length === 1) return e.key.toLowerCase()
  return e.key
}

export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  // Stable ref → evita re-attach del listener en cada render del padre.
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  useEffect(() => {
    let leaderActive: string | null = null
    let leaderTimer: ReturnType<typeof setTimeout> | null = null

    function clearLeader() {
      leaderActive = null
      if (leaderTimer) { clearTimeout(leaderTimer); leaderTimer = null }
    }

    function onKey(e: KeyboardEvent) {
      // Ignorar si hay modifier (Cmd+K es del CommandPalette, no de este hook).
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // No interceptar mientras se escribe en campos.
      if (isEditable(e.target)) return

      const token = keyToToken(e)

      // ── Modo leader activo: intentar matchear la 2da tecla ──
      if (leaderActive) {
        const combo = `${leaderActive} ${token}`
        const match = bindingsRef.current.find(b => b.sequence === combo)
        clearLeader()
        if (match) {
          e.preventDefault()
          match.handler(e)
        }
        return
      }

      // ── Atajos simples (sin leader) ──
      const directMatch = bindingsRef.current.find(b => b.sequence === token)
      if (directMatch) {
        e.preventDefault()
        directMatch.handler(e)
        return
      }

      // ── Entrar a modo leader si la tecla es prefijo de algun shortcut ──
      const isLeader = bindingsRef.current.some(b => b.sequence.startsWith(`${token} `))
      if (isLeader) {
        leaderActive = token
        leaderTimer = setTimeout(clearLeader, LEADER_TIMEOUT_MS)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (leaderTimer) clearTimeout(leaderTimer)
    }
  }, [])
}
