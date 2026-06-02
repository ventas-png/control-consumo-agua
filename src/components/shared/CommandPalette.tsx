import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

// F3.14: Command palette (Cmd+K / Ctrl+K) para búsqueda global de tabs.
// Inspirado en el patrón de Linear/Notion/Slack. Aborda el gap "B1
// Navegación de 191 tabs sin búsqueda" del design critique.
//
// API minimalista para que cualquier vista pueda integrar su propio
// command palette pasando items + callback de selección. La lógica de
// shortcut keyboard, focus management, y filtrado fuzzy queda
// encapsulada acá.

export interface CommandItem {
  id: string
  label: string
  /** Icono opcional (emoji o ReactNode). */
  icon?: ReactNode
  /** Sub-grupo opcional para agrupar visualmente (ej: 'Cobranza', 'Operaciones'). */
  group?: string
  /** Hint adicional para fuzzy match (ej: alias en otro idioma o sinónimos). */
  keywords?: string
  /** Acción al seleccionar el item. */
  onSelect: () => void
}

export interface CommandPaletteProps {
  items: CommandItem[]
  /** Placeholder del input. Default: 'Buscar tab o acción...'. */
  placeholder?: string
  /** Modifier para abrir: 'meta' (Cmd) o 'ctrl'. Default detecta OS. */
  shortcut?: 'meta' | 'ctrl'
  /** Tecla. Default 'k'. */
  shortcutKey?: string
  /**
   * Si true, el palette NO registra su keyboard listener global y queda
   * controlado externamente via `open` + `onOpenChange`. Util cuando se
   * monta como hijo de otro palette que ya tiene el shortcut, o cuando
   * el caller quiere abrirlo desde un boton/evento custom.
   */
  disableShortcut?: boolean
  /** Modo controlado: estado open viene del caller. */
  open?: boolean
  /** Modo controlado: callback de cambio de estado. */
  onOpenChange?: (open: boolean) => void
}

/** Normaliza un string para fuzzy match (lowercase, sin acentos). */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Match score: items que empiezan con la query van primero, luego contains. */
function score(item: CommandItem, query: string): number {
  if (!query) return 1
  const q = normalize(query)
  const label = normalize(item.label)
  const keywords = item.keywords ? normalize(item.keywords) : ''
  const group = item.group ? normalize(item.group) : ''
  if (label.startsWith(q)) return 100
  if (label.includes(q)) return 80
  if (keywords.includes(q)) return 60
  if (group.includes(q)) return 50
  // Fuzzy: chars en orden
  let i = 0, j = 0, hits = 0
  while (i < label.length && j < q.length) {
    if (label[i] === q[j]) { hits++; j++ }
    i++
  }
  if (j === q.length) return 30 + hits
  return 0
}

export function CommandPalette({
  items,
  placeholder = 'Buscar tab o acción...',
  shortcut,
  shortcutKey = 'k',
  disableShortcut = false,
  open: openProp,
  onOpenChange,
}: CommandPaletteProps) {
  const [openInternal, setOpenInternal] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : openInternal
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next
    if (isControlled) {
      onOpenChange?.(value)
    } else {
      setOpenInternal(value)
    }
  }

  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Detectar OS para shortcut default
  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    [],
  )
  const usedShortcut = shortcut ?? (isMac ? 'meta' : 'ctrl')

  // Refs para evitar stale closure en el listener global (open/onOpenChange
  // pueden cambiar entre renders; el listener solo se re-attachea cuando
  // cambian el shortcut o el flag de disable).
  const openRef = useRef(open)
  openRef.current = open
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  // Global keyboard listener — solo cuando no esta deshabilitado.
  useEffect(() => {
    if (disableShortcut) return
    function onKey(e: KeyboardEvent) {
      const modifier = usedShortcut === 'meta' ? e.metaKey : e.ctrlKey
      if (modifier && e.key.toLowerCase() === shortcutKey.toLowerCase()) {
        e.preventDefault()
        const next = !openRef.current
        if (isControlled) {
          onOpenChangeRef.current?.(next)
        } else {
          setOpenInternal(next)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [usedShortcut, shortcutKey, disableShortcut, isControlled])

  // Items filtrados + ordenados por score
  const filtered = useMemo(() => {
    const scored = items
      .map(item => ({ item, score: score(item, query) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.map(x => x.item)
  }, [items, query])

  // Reset selection cuando cambia query
  useEffect(() => { setSelectedIdx(0) }, [query])

  // Reset state al cerrar
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelectedIdx(0)
    }
  }, [open])

  // Scroll item activo a la vista
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx, open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[selectedIdx]
      if (item) {
        item.onSelect()
        setOpen(false)
      }
    }
  }

  function handleSelect(item: CommandItem) {
    item.onSelect()
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => setOpen(o)}>
      <Dialog.Portal>
        <Dialog.Overlay style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 9998,
          animation: 'at-dialog-overlay-in 120ms ease-out',
        }} />
        <Dialog.Content
          aria-label="Búsqueda de tabs y acciones"
          style={{
            position: 'fixed', top: '12vh', left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--at-surface)',
            borderRadius: '14px',
            width: 'min(640px, calc(100vw - 32px))',
            maxHeight: '70vh', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
            zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            animation: 'at-dialog-content-in 160ms ease-out',
          }}
          onKeyDown={handleKeyDown}
        >
          <Dialog.Title style={{ position: 'absolute', left: -9999, top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
            Búsqueda
          </Dialog.Title>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '14px 18px', borderBottom: '1.5px solid var(--at-line)',
          }}>
            <span aria-hidden="true" style={{ fontSize: '18px', opacity: 0.6 }}>🔍</span>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={placeholder}
              autoFocus
              aria-label="Buscar"
              aria-controls="cmdk-list"
              aria-activedescendant={filtered[selectedIdx] ? `cmdk-item-${filtered[selectedIdx].id}` : undefined}
              style={{
                flex: 1, border: 'none', outline: 'none',
                background: 'transparent', fontSize: '15px',
                color: 'var(--at-ink)',
              }}
            />
            <kbd style={{
              fontSize: '11px', padding: '3px 7px',
              border: '1px solid var(--at-line)', borderRadius: '5px',
              color: 'var(--at-ink-3)', fontFamily: 'inherit',
              background: 'var(--at-surface-2)',
            }}>
              ESC
            </kbd>
          </div>
          <div
            ref={listRef}
            id="cmdk-list"
            role="listbox"
            aria-label="Resultados de búsqueda"
            style={{ overflowY: 'auto', flex: 1, padding: '6px' }}
          >
            {filtered.length === 0 ? (
              <div style={{
                padding: '32px 18px', textAlign: 'center',
                color: 'var(--at-ink-3)', fontSize: '14px',
              }}>
                Sin resultados para "{query}"
              </div>
            ) : (
              filtered.map((item, idx) => {
                const isSelected = idx === selectedIdx
                return (
                  <button
                    key={item.id}
                    id={`cmdk-item-${item.id}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      width: '100%', padding: '10px 14px',
                      background: isSelected ? 'var(--at-primary-tint)' : 'transparent',
                      border: 'none', borderRadius: '8px',
                      textAlign: 'left', cursor: 'pointer',
                      color: 'var(--at-ink)', fontSize: '14px',
                      fontFamily: 'inherit',
                    }}
                  >
                    {item.icon && (
                      <span aria-hidden="true" style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>
                        {item.icon}
                      </span>
                    )}
                    <span style={{ flex: 1, fontWeight: isSelected ? 600 : 400 }}>{item.label}</span>
                    {item.group && (
                      <span style={{
                        fontSize: '11px', color: 'var(--at-ink-3)',
                        background: 'var(--at-chip)',
                        padding: '2px 7px', borderRadius: '4px',
                        fontWeight: 500,
                      }}>
                        {item.group}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
          <div style={{
            display: 'flex', gap: '14px', justifyContent: 'flex-end',
            padding: '8px 14px',
            borderTop: '1.5px solid var(--at-line)',
            fontSize: '11px', color: 'var(--at-ink-3)',
          }}>
            <span><kbd style={kbdStyle}>↑↓</kbd> navegar</span>
            <span><kbd style={kbdStyle}>↵</kbd> abrir</span>
            <span><kbd style={kbdStyle}>{usedShortcut === 'meta' ? '⌘' : 'Ctrl'}+{shortcutKey.toUpperCase()}</kbd> abrir/cerrar</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const kbdStyle: React.CSSProperties = {
  fontSize: '10px', padding: '1px 5px',
  border: '1px solid var(--at-line)', borderRadius: '4px',
  color: 'var(--at-ink-3)', fontFamily: 'inherit',
  background: 'var(--at-surface-2)',
  marginRight: '4px',
}
