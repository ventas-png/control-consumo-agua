import { type CSSProperties } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ShortcutBinding } from '../../hooks/useKeyboardShortcuts'

// ============================================================================
// KeyboardShortcutsHelp — Modal listando todos los atajos disponibles.
// ============================================================================
// Se abre al presionar '?'. Agrupa los shortcuts por categoria.

interface Props {
  open: boolean
  onClose: () => void
  bindings: ShortcutBinding[]
  /** Atajo Cmd+K se documenta aparte porque no es del hook */
  showCommandPaletteHint?: boolean
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

/** Renderiza el contenido de la secuencia como elementos <kbd> separados */
function renderSequence(sequence: string): React.ReactNode {
  const parts = sequence.split(' ')
  return parts.map((p, i) => (
    <span key={i}>
      <kbd style={kbdStyle}>{p === '?' ? '?' : p === '/' ? '/' : p.toUpperCase()}</kbd>
      {i < parts.length - 1 && <span style={{ margin: '0 4px', color: 'var(--at-ink-3)' }}>luego</span>}
    </span>
  ))
}

export function KeyboardShortcutsHelp({ open, onClose, bindings, showCommandPaletteHint = true }: Props) {
  // Agrupar por categoria preservando orden de aparicion
  const byCategory = new Map<string, ShortcutBinding[]>()
  for (const b of bindings) {
    const cat = b.category ?? 'General'
    const list = byCategory.get(cat) ?? []
    list.push(b)
    byCategory.set(cat, list)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content aria-label="Atajos de teclado" style={contentStyle}>
          <div style={headerStyle}>
            <Dialog.Title style={titleStyle}>⌨️ Atajos de teclado</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Cerrar" style={closeBtnStyle}>✕</button>
            </Dialog.Close>
          </div>

          <div style={{ padding: '8px 20px 18px', overflowY: 'auto', maxHeight: 'calc(70vh - 80px)' }}>
            {showCommandPaletteHint && (
              <Section title="Acciones rapidas">
                <Row description="Abrir paleta de comandos (buscar y navegar)">
                  <kbd style={kbdStyle}>{isMac() ? '⌘' : 'Ctrl'}</kbd>
                  <span style={{ margin: '0 2px', color: 'var(--at-ink-3)' }}>+</span>
                  <kbd style={kbdStyle}>K</kbd>
                </Row>
              </Section>
            )}

            {[...byCategory.entries()].map(([cat, list]) => (
              <Section key={cat} title={cat}>
                {list.map(b => (
                  <Row key={b.sequence} description={b.description}>
                    {renderSequence(b.sequence)}
                  </Row>
                ))}
              </Section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{
        fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ description, children }: { description: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 8px', borderRadius: '6px',
    }}>
      <span style={{ fontSize: '13px', color: 'var(--at-ink)' }}>{description}</span>
      <span style={{ display: 'flex', alignItems: 'center' }}>{children}</span>
    </div>
  )
}

// ───── Styles ─────────────────────────────────────────────────────────────
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.4)',
  zIndex: 9998,
  animation: 'at-dialog-overlay-in 120ms ease-out',
}

const contentStyle: CSSProperties = {
  position: 'fixed', top: '12vh', left: '50%',
  transform: 'translateX(-50%)',
  background: 'var(--at-surface)',
  borderRadius: '14px',
  width: 'min(560px, calc(100vw - 32px))',
  maxHeight: '70vh', overflow: 'hidden',
  boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
  zIndex: 9999,
  display: 'flex', flexDirection: 'column',
  animation: 'at-dialog-content-in 160ms ease-out',
}

const headerStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 20px',
  borderBottom: '1.5px solid var(--at-line)',
}

const titleStyle: CSSProperties = {
  margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)',
}

const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none',
  color: 'var(--at-ink-3)', fontSize: '16px',
  cursor: 'pointer', padding: '4px 8px', borderRadius: '6px',
}

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  minWidth: '20px', height: '22px',
  fontSize: '11px', fontWeight: 600,
  padding: '0 6px', lineHeight: '22px', textAlign: 'center',
  border: '1px solid var(--at-line-strong)', borderRadius: '5px',
  color: 'var(--at-ink-2)', fontFamily: 'inherit',
  background: 'var(--at-surface-2)',
  boxShadow: '0 1px 0 var(--at-line)',
}
