import { useState, useCallback, useMemo } from 'react'

// ============================================================================
// useBulkSelection — hook generico para selecciones multi-row
// ============================================================================
// Reemplaza el patron ad-hoc `useState<Set<string>>(new Set())` + helpers
// inline que esta repetido en 10+ tabs. Centraliza la logica de:
//
//   - Toggle individual (toggle)
//   - Toggle all (selecciona todos los items filtrados visibles)
//   - Select many / select inverse
//   - Clear
//   - Derived: count, isAllSelected, hasSelection, selectedItems
//
// La fuente de verdad es siempre el Set<id>. Items y getId se pasan por
// argument para que el hook calcule isAllSelected vs los items visibles
// (no contra TODOS los items del modulo). Esto permite "select all" que
// solo selecciona los filtrados.

export interface BulkSelectionApi<T> {
  /** Set inmutable de IDs seleccionados */
  selected: Set<string>
  /** Items derivados — los que matchean selected */
  selectedItems: T[]
  /** Conteo de seleccionados */
  count: number
  /** True si el item esta seleccionado */
  isSelected: (id: string) => boolean
  /** True si TODOS los items visibles estan seleccionados (y hay >= 1) */
  isAllSelected: boolean
  /** True si count > 0 (mas conveniente que count > 0 inline) */
  hasSelection: boolean
  /** Toggle un solo id */
  toggle: (id: string) => void
  /** Toggle todos los visibles: si todos seleccionados → clear; sino → select all */
  toggleAll: () => void
  /** Agrega N ids al set (sin eliminar otros) */
  selectMany: (ids: string[]) => void
  /** Invierte la seleccion contra los items visibles */
  invert: () => void
  /** Limpia toda la seleccion */
  clear: () => void
}

export function useBulkSelection<T>(
  items: T[],
  getId: (item: T) => string,
): BulkSelectionApi<T> {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const visibleIds = useMemo(() => items.map(getId), [items, getId])

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const isAllSelected = useMemo(() => {
    if (visibleIds.length === 0) return false
    return visibleIds.every(id => selected.has(id))
  }, [visibleIds, selected])

  const selectedItems = useMemo(
    () => items.filter(item => selected.has(getId(item))),
    [items, selected, getId],
  )

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id))
      if (allVisibleSelected) {
        // Quitar solo los visibles, preservar selecciones de paginas no visibles
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      return new Set([...prev, ...visibleIds])
    })
  }, [visibleIds])

  const selectMany = useCallback((ids: string[]) => {
    setSelected(prev => new Set([...prev, ...ids]))
  }, [])

  const invert = useCallback(() => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of visibleIds) {
        if (next.has(id)) next.delete(id); else next.add(id)
      }
      return next
    })
  }, [visibleIds])

  const clear = useCallback(() => setSelected(new Set()), [])

  return {
    selected,
    selectedItems,
    count: selected.size,
    isSelected,
    isAllSelected,
    hasSelection: selected.size > 0,
    toggle,
    toggleAll,
    selectMany,
    invert,
    clear,
  }
}
