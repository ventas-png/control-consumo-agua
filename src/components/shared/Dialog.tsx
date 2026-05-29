import { useState, useEffect, type ReactNode } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Toast from '@radix-ui/react-toast'

// ============================================================================
// Dialog & toast primitives — Radix-backed reemplazo de SweetAlert2 (F3.2)
// ============================================================================
// API se mantiene en espiritu cercana a Swal.fire para minimizar cambios en
// callsites — confirm() devuelve Promise<{isConfirmed: boolean}> identico al
// shape que esperan los .then() existentes.
//
// Beneficios sobre Swal:
//   - role="alertdialog" + focus trap nativo de Radix (cumple WCAG 2.1)
//   - Escape, click outside, focus return-to-trigger automaticos
//   - Tema sigue CSS vars de la app (Swal injecta su propio CSS)
//   - 9 KB minified vs 50 KB de Swal (bundle reduction futura cuando se
//     elimine sweetalert2 del package.json — no se hace en este PR para
//     no romper los ~240 callsites restantes)
//
// Migracion gradual: este PR cubre los flows criticos (auth, perfil); F3.2b
// migra batches por modulo. Hasta entonces ambos APIs coexisten.
// ============================================================================

// ----------------------------------------------------------------------------
// Confirm — modal con OK/Cancel. Usa AlertDialog (semantica "necesita
// respuesta") en lugar de Dialog normal.
// ----------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string
  text?: string
  /** Default: 'OK' */
  confirmText?: string
  /** Default: 'Cancelar' */
  cancelText?: string
  /** Estilo del boton primario. 'danger' para destructivos (logout, delete) */
  variant?: 'default' | 'danger'
  /** Icono visual a la izquierda del titulo. Solo decorativo (aria-hidden). */
  icon?: 'warning' | 'question' | 'info'
}

interface ConfirmResolver {
  options: ConfirmOptions
  resolve: (value: { isConfirmed: boolean }) => void
}

let pendingConfirm: ConfirmResolver | null = null
const confirmListeners = new Set<(c: ConfirmResolver | null) => void>()

export function confirm(options: ConfirmOptions): Promise<{ isConfirmed: boolean }> {
  return new Promise(resolve => {
    pendingConfirm = { options, resolve }
    confirmListeners.forEach(fn => fn(pendingConfirm))
  })
}

function closePendingConfirm(isConfirmed: boolean) {
  if (!pendingConfirm) return
  const r = pendingConfirm
  pendingConfirm = null
  confirmListeners.forEach(fn => fn(null))
  r.resolve({ isConfirmed })
}

function ConfirmRoot() {
  const [pending, setPending] = useState<ConfirmResolver | null>(pendingConfirm)
  useEffect(() => {
    confirmListeners.add(setPending)
    return () => { confirmListeners.delete(setPending) }
  }, [])

  if (!pending) return null
  const { options } = pending
  const iconMap = { warning: '⚠️', question: '❓', info: 'ℹ️' } as const
  const isDanger = options.variant === 'danger'

  return (
    <AlertDialog.Root open={true} onOpenChange={(open) => { if (!open) closePendingConfirm(false) }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 9998,
          animation: 'at-dialog-overlay-in 120ms ease-out',
        }} />
        <AlertDialog.Content
          aria-describedby={options.text ? 'at-confirm-desc' : undefined}
          style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--at-surface)',
            borderRadius: '16px',
            padding: '24px 28px',
            maxWidth: '440px', width: 'calc(100vw - 32px)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
            zIndex: 9999,
            animation: 'at-dialog-content-in 160ms ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: options.text ? '16px' : '20px' }}>
            {options.icon && (
              <span aria-hidden="true" style={{ fontSize: '24px', lineHeight: 1, flexShrink: 0 }}>{iconMap[options.icon]}</span>
            )}
            <AlertDialog.Title style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)', lineHeight: 1.3 }}>
              {options.title}
            </AlertDialog.Title>
          </div>
          {options.text && (
            <AlertDialog.Description id="at-confirm-desc" style={{
              margin: '0 0 22px', fontSize: '14px', color: 'var(--at-ink-2)', lineHeight: 1.5,
            }}>
              {options.text}
            </AlertDialog.Description>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                onClick={() => closePendingConfirm(false)}
                style={{
                  padding: '9px 18px', borderRadius: '10px',
                  border: '1.5px solid var(--at-line)', background: 'var(--at-surface)',
                  color: 'var(--at-ink-2)', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                {options.cancelText ?? 'Cancelar'}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={() => closePendingConfirm(true)}
                style={{
                  padding: '9px 18px', borderRadius: '10px', border: 'none',
                  background: isDanger ? 'var(--at-danger)' : 'var(--at-primary)',
                  color: 'white', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                }}
                autoFocus
              >
                {options.confirmText ?? 'OK'}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

// ----------------------------------------------------------------------------
// Notify — toast no-bloqueante para success/error/info. Usa Radix Toast con
// region="status" + aria-live="polite" para que screen readers lo anuncien.
// ----------------------------------------------------------------------------

export interface NotifyOptions {
  title: string
  text?: string
  variant?: 'success' | 'error' | 'info' | 'warning'
  /** Default 3500ms. 0 = no auto-dismiss (require click) */
  duration?: number
}

interface NotifyEntry {
  id: number
  options: NotifyOptions
}

let notifyIdCounter = 0
let activeNotifications: NotifyEntry[] = []
const notifyListeners = new Set<(items: NotifyEntry[]) => void>()

export function notify(options: NotifyOptions): void {
  const entry: NotifyEntry = { id: ++notifyIdCounter, options }
  activeNotifications = [...activeNotifications, entry]
  notifyListeners.forEach(fn => fn(activeNotifications))
}

function removeNotify(id: number) {
  activeNotifications = activeNotifications.filter(e => e.id !== id)
  notifyListeners.forEach(fn => fn(activeNotifications))
}

function NotifyRoot() {
  const [items, setItems] = useState<NotifyEntry[]>(activeNotifications)
  useEffect(() => {
    notifyListeners.add(setItems)
    return () => { notifyListeners.delete(setItems) }
  }, [])

  const variantStyle = {
    success: { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', color: 'var(--at-success)', icon: '✅' },
    error:   { bg: 'var(--at-danger-tint)',  border: 'var(--at-danger-border)',  color: 'var(--at-danger)',  icon: '⚠️' },
    warning: { bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', icon: '⚠️' },
    info:    { bg: 'var(--at-primary-tint, rgba(27,59,54,.08))', border: 'var(--at-primary-soft, rgba(27,59,54,.2))', color: 'var(--at-primary-hover, var(--at-primary))', icon: 'ℹ️' },
  } as const

  return (
    <Toast.Provider swipeDirection="right" duration={3500}>
      {items.map(entry => {
        const v = variantStyle[entry.options.variant ?? 'info']
        const dur = entry.options.duration ?? 3500
        return (
          <Toast.Root
            key={entry.id}
            duration={dur > 0 ? dur : Infinity}
            onOpenChange={(open) => { if (!open) removeNotify(entry.id) }}
            style={{
              background: 'var(--at-surface)',
              border: `1.5px solid ${v.border}`,
              borderLeft: `4px solid ${v.color}`,
              borderRadius: '12px',
              padding: '14px 18px',
              boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              minWidth: '280px', maxWidth: '380px',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>{v.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Toast.Title style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>
                {entry.options.title}
              </Toast.Title>
              {entry.options.text && (
                <Toast.Description style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.4 }}>
                  {entry.options.text}
                </Toast.Description>
              )}
            </div>
            <Toast.Close aria-label="Cerrar notificación" style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: 'var(--at-ink-3)', fontSize: '16px', lineHeight: 1, flexShrink: 0,
            }}>×</Toast.Close>
          </Toast.Root>
        )
      })}
      <Toast.Viewport style={{
        position: 'fixed', bottom: 20, right: 20,
        display: 'flex', flexDirection: 'column', gap: '10px',
        listStyle: 'none', zIndex: 9997,
      }} />
    </Toast.Provider>
  )
}

// ----------------------------------------------------------------------------
// DialogProvider — montar UNA vez en main.tsx (raiz del arbol). Renderiza el
// Confirm singleton + el Toast Viewport.
// ----------------------------------------------------------------------------

export function DialogProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ConfirmRoot />
      <NotifyRoot />
      <style>{`
        @keyframes at-dialog-overlay-in {
          from { opacity: 0 }
          to   { opacity: 1 }
        }
        @keyframes at-dialog-content-in {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>
  )
}
