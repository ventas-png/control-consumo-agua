import { useEffect, useState } from 'react'
import type { CommandItem } from '../components/shared/CommandPalette'

// ============================================================================
// commandRegistry — Patron de registro centralizado para CommandPalette global.
// ============================================================================
// El palette global vive en App.tsx y agrega los comandos top-level (secciones
// del sidebar). Componentes hijos (ej: CondominiosSection con sus 191 tabs)
// usan `registerCommands(...)` en un useEffect para agregar sus comandos
// mientras estan montados, y los quitan al desmontar.
//
// Esto evita tener varios CommandPalette compitiendo por el shortcut Cmd+K
// y le da al usuario UNA caja de busqueda con todo lo navegable desde
// cualquier vista.
//
// API:
//   registerCommands(commands) → cleanup()
//   useRegisteredCommands() → CommandItem[]

let items: CommandItem[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/**
 * Registra comandos en el palette global. Retorna funcion de cleanup que
 * elimina solo los comandos registrados por este call (matching por id).
 * Llamar dentro de useEffect para asociarlo al lifecycle del componente.
 */
export function registerCommands(commands: CommandItem[]): () => void {
  if (commands.length === 0) return () => {}
  const ids = new Set(commands.map(c => c.id))
  items = [...items.filter(c => !ids.has(c.id)), ...commands]
  emit()
  return () => {
    items = items.filter(c => !ids.has(c.id))
    emit()
  }
}

/** Snapshot reactivo de los comandos registrados. */
export function useRegisteredCommands(): CommandItem[] {
  const [snapshot, setSnapshot] = useState<CommandItem[]>(items)
  useEffect(() => {
    const fn = () => setSnapshot(items)
    listeners.add(fn)
    fn()
    return () => { listeners.delete(fn) }
  }, [])
  return snapshot
}

/** Solo para tests: limpia el registro entre cases. */
export function __resetCommandRegistry() {
  items = []
  emit()
}
