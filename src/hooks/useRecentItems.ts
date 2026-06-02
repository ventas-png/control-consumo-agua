import { useCallback, useEffect, useState } from 'react'

// ============================================================================
// useRecentItems — Lista LRU pequena persistida en localStorage.
// ============================================================================
// Util para mantener "ultimos N usados" de cualquier coleccion identificada
// por string id: secciones del CommandPalette, busquedas recientes, archivos
// abiertos, etc.
//
// Garantias:
//   - Si el id ya esta en la lista, se mueve al frente (no se duplica).
//   - La lista nunca excede `maxItems` (default 5).
//   - localStorage es opcional: si no esta disponible (SSR, private mode),
//     la lista vive solo en memoria del componente.
//   - Cambios entre tabs del browser se sincronizan via `storage` event.

export interface UseRecentItemsOptions {
  /** Maximo de items a retener. Default 5. */
  maxItems?: number
}

export interface UseRecentItemsApi {
  /** Lista de ids ordenada del mas reciente al mas antiguo. */
  recent: string[]
  /** Agrega id al frente (o lo promueve si ya existia). */
  push: (id: string) => void
  /** Quita un id de la lista. */
  remove: (id: string) => void
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
    // Quota llena, modo privado, etc — fail silently.
  }
}

export function useRecentItems(
  storageKey: string,
  options: UseRecentItemsOptions = {},
): UseRecentItemsApi {
  const { maxItems = 5 } = options
  const [recent, setRecent] = useState<string[]>(() => readFromStorage(storageKey).slice(0, maxItems))

  // Persistir cada cambio.
  useEffect(() => {
    writeToStorage(storageKey, recent)
  }, [storageKey, recent])

  // Sincronizar entre tabs del browser.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey) return
      setRecent(readFromStorage(storageKey).slice(0, maxItems))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageKey, maxItems])

  const push = useCallback((id: string) => {
    setRecent(prev => {
      const next = [id, ...prev.filter(x => x !== id)]
      return next.slice(0, maxItems)
    })
  }, [maxItems])

  const remove = useCallback((id: string) => {
    setRecent(prev => prev.filter(x => x !== id))
  }, [])

  const clear = useCallback(() => setRecent([]), [])

  return { recent, push, remove, clear }
}
