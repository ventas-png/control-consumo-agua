import { useCallback, useEffect, useState } from 'react'

// ============================================================================
// usePinnedItems — Lista pinneada (favoritos) persistida en localStorage.
// ============================================================================
// Hermano de useRecentItems pero con semantica distinta:
//   - useRecentItems es LRU: promueve al frente y rota.
//   - usePinnedItems es estable: preserva el orden de insercion. Pin agrega
//     al frente (mas recientemente pinneado primero), Unpin remueve. NO se
//     reordena por uso — el usuario explicitamente pinea para fijar.
//
// El cap (`maxItems`, default 3) evita que la lista crezca sin limites y
// rompa el layout del palette. Si esta lleno y se intenta agregar otro, el
// mas viejo se descarta silenciosamente (FIFO al cap).

export interface UsePinnedItemsOptions {
  /** Maximo de items pinneados. Default 3. */
  maxItems?: number
}

export interface UsePinnedItemsApi {
  /** Lista de ids pinneados, mas recientemente pinneado primero. */
  pinned: string[]
  /** True si el id esta pinneado. */
  isPinned: (id: string) => boolean
  /** Agrega id al frente. Si ya esta, no hace nada (no promueve). */
  pin: (id: string) => void
  /** Quita id de la lista. */
  unpin: (id: string) => void
  /** Toggle entre pin/unpin. */
  togglePin: (id: string) => void
  /** Vacia la lista. */
  clear: () => void
}

function readFromStorage(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function writeToStorage(key: string, value: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Fail silently (quota, private mode, etc).
  }
}

export function usePinnedItems(
  storageKey: string,
  options: UsePinnedItemsOptions = {},
): UsePinnedItemsApi {
  const { maxItems = 3 } = options
  const [pinned, setPinned] = useState<string[]>(() => readFromStorage(storageKey).slice(0, maxItems))

  useEffect(() => {
    writeToStorage(storageKey, pinned)
  }, [storageKey, pinned])

  useEffect(() => {
    if (typeof window === 'undefined') return
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey) return
      setPinned(readFromStorage(storageKey).slice(0, maxItems))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageKey, maxItems])

  const isPinned = useCallback((id: string) => pinned.includes(id), [pinned])

  const pin = useCallback((id: string) => {
    setPinned(prev => {
      if (prev.includes(id)) return prev
      const next = [id, ...prev]
      return next.slice(0, maxItems)
    })
  }, [maxItems])

  const unpin = useCallback((id: string) => {
    setPinned(prev => prev.filter(x => x !== id))
  }, [])

  const togglePin = useCallback((id: string) => {
    setPinned(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      const next = [id, ...prev]
      return next.slice(0, maxItems)
    })
  }, [maxItems])

  const clear = useCallback(() => setPinned([]), [])

  return { pinned, isPinned, pin, unpin, togglePin, clear }
}
