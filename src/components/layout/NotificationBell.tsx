import { useState, useLayoutEffect, useRef } from 'react'
import type { AppSection, UserNotification } from '../../types'
import { useNotifications } from '../../hooks/useNotifications'

interface Props {
  userId?: string
  onNavigate: (section: AppSection) => void
}

const ANCHO_PANEL = 340
const MARGEN = 8

/**
 * Coloca el panel sin que se salga de la pantalla.
 *
 * Antes era `position: absolute; right: 0; width: 340px`, es decir, anclado al
 * borde derecho de la campana y creciendo hacia la izquierda. En un teléfono la
 * campana está a unos 200px del borde, así que un panel de 340px empezaba en
 * -140 y la mitad quedaba fuera de la pantalla. `max-width` no lo arregla: el
 * problema no es el ancho, es de qué lado crece.
 *
 * Se mantiene la alineación a la derecha del icono cuando cabe, y si no cabe se
 * empuja hasta el margen. Con `position: fixed` el cálculo es contra el
 * viewport; el portal scrollea el documento, así que aquí no hay ningún
 * contenedor con scroll que atrape el fixed (ver MOBILE.md).
 */
export function calcularPosicion(ancla: DOMRect, vw: number, vh: number) {
  const width = Math.min(ANCHO_PANEL, vw - MARGEN * 2)
  const derecha = ancla.right - width
  const left = Math.min(Math.max(MARGEN, derecha), vw - width - MARGEN)
  const top = ancla.bottom + MARGEN
  // Con `fixed` el panel ya no alarga la página: si no se acota, un aparato
  // bajito lo cortaría por abajo en vez de por la izquierda.
  return { top, left, width, maxHeight: Math.max(0, vh - top - MARGEN) }
}

function tiempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}

export function NotificationBell({ userId, onNavigate }: Props) {
  const { items, unread, marcarLeida, marcarTodas } = useNotifications(userId)
  const [open, setOpen] = useState(false)
  const botonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<ReturnType<typeof calcularPosicion> | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const colocar = () => {
      const el = botonRef.current
      if (el) setPos(calcularPosicion(el.getBoundingClientRect(), window.innerWidth, window.innerHeight))
    }
    colocar()
    window.addEventListener('resize', colocar)
    // `true` para capturar también el scroll de cualquier contenedor intermedio.
    window.addEventListener('scroll', colocar, true)
    return () => {
      window.removeEventListener('resize', colocar)
      window.removeEventListener('scroll', colocar, true)
    }
  }, [open])

  function onItemClick(n: UserNotification) {
    if (!n.leido) void marcarLeida(n.id)
    if (n.seccion) onNavigate(n.seccion as AppSection)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={botonRef}
        onClick={() => setOpen(o => !o)}
        aria-label="Notificaciones"
        title="Notificaciones"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '34px', height: '34px', flexShrink: 0,
          border: '1px solid var(--at-line)', background: 'var(--at-surface-2)',
          borderRadius: '9px', cursor: 'pointer', color: 'var(--at-ink-2)', position: 'relative',
        }}
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: '-5px', right: '-5px',
            minWidth: '17px', height: '17px', padding: '0 4px', boxSizing: 'border-box',
            background: 'var(--at-danger)', color: 'white', borderRadius: '10px',
            fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--at-surface)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && pos && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            maxHeight: pos.maxHeight, display: 'flex', flexDirection: 'column',
            background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)', zIndex: 61, overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--at-line)', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>Notificaciones</span>
              {unread > 0 && (
                <button onClick={() => void marcarTodas()} style={{ border: 'none', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
                  Marcar todas
                </button>
              )}
            </div>
            <div style={{ maxHeight: '380px', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
              {items.length === 0 && (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>
                  No tienes notificaciones
                </div>
              )}
              {items.map(n => (
                <button
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                    padding: '12px 16px', borderBottom: '1px solid var(--at-chip)',
                    background: n.leido ? 'var(--at-surface)' : 'var(--at-primary-soft)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    {!n.leido && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--at-primary)', flexShrink: 0, marginTop: '5px' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>{n.titulo}</div>
                      {n.cuerpo && <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '2px' }}>{n.cuerpo}</div>}
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>{tiempoRelativo(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
