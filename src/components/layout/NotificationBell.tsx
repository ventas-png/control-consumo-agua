import { useState, useLayoutEffect, useRef, useMemo } from 'react'
import type { UserNotification } from '../../types'
import { useNotifications } from '../../hooks/useNotifications'
import { calcularPosicion } from './notificationBellPos'
import {
  GROUP_META,
  groupCounts,
  groupOf,
  resumenNoLeidas,
  type NotificationGroup,
} from '../../domain/comunicacion/notificationCatalog'

interface Props {
  userId?: string
  /**
   * Destino de la notificación (`user_notifications.seccion`), tal cual viene de
   * la BD. Cada contenedor lo traduce a lo suyo —el Topbar a un AppSection, el
   * portal del residente a uno de sus tabs— porque los productores escriben
   * secciones de ambos mundos ('comunicacion', 'anuncios', 'paquetes'…) y sólo
   * el contenedor sabe cuáles puede abrir.
   */
  onNavigate: (seccion: string) => void
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
  // null = "Todo". Al filtrar por un grupo se conserva el orden cronológico.
  const [filtro, setFiltro] = useState<NotificationGroup | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<ReturnType<typeof calcularPosicion> | null>(null)

  const grupos = useMemo(() => groupCounts(items), [items])
  const resumen = useMemo(() => resumenNoLeidas(items), [items])
  const visibles = useMemo(
    () => (filtro ? items.filter(n => groupOf(n.tipo) === filtro) : items),
    [items, filtro],
  )

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
    if (n.seccion) onNavigate(n.seccion)
    setOpen(false)
  }

  // El resumen va también en el botón: con la campana cerrada, el número solo
  // dice "hay 4 cosas", no si son mensajes o solicitudes.
  const etiqueta = unread > 0 ? `Notificaciones: ${resumen}` : 'Notificaciones'

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={botonRef}
        onClick={() => setOpen(o => !o)}
        aria-label={etiqueta}
        title={etiqueta}
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
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--at-line)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>Notificaciones</span>
                {unread > 0 && (
                  <button onClick={() => void marcarTodas()} style={{ border: 'none', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
                    Marcar todas
                  </button>
                )}
              </div>
              {/* Qué hay de nuevo, antes de leer un solo título. */}
              {resumen && (
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '3px' }}>
                  {resumen}
                </div>
              )}
            </div>

            {/* Filtros por categoría. Con una sola categoría no aportan nada. */}
            {grupos.length > 1 && (
              <div style={{
                display: 'flex', gap: '6px', padding: '9px 12px', flexShrink: 0,
                overflowX: 'auto', borderBottom: '1px solid var(--at-chip)',
              }}>
                {([null, ...grupos.map(g => g.group)] as (NotificationGroup | null)[]).map(g => {
                  const activo = filtro === g
                  const conteo = g === null ? unread : (grupos.find(x => x.group === g)?.unread ?? 0)
                  const texto = g === null ? 'Todo' : `${GROUP_META[g].icon} ${GROUP_META[g].label}`
                  return (
                    <button
                      key={g ?? '__todo'}
                      onClick={() => setFiltro(g)}
                      aria-pressed={activo}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0,
                        padding: '4px 10px', borderRadius: '999px', cursor: 'pointer',
                        fontSize: '11.5px', fontWeight: 600, whiteSpace: 'nowrap',
                        border: `1px solid ${activo ? 'var(--at-primary)' : 'var(--at-line)'}`,
                        background: activo ? 'var(--at-primary-soft)' : 'var(--at-surface-2)',
                        color: activo ? 'var(--at-primary)' : 'var(--at-ink-2)',
                      }}
                    >
                      {texto}
                      {conteo > 0 && (
                        <span style={{
                          minWidth: '15px', height: '15px', padding: '0 3px', boxSizing: 'border-box',
                          borderRadius: '8px', background: 'var(--at-danger)', color: 'white',
                          fontSize: '9.5px', fontWeight: 700,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}>{conteo > 9 ? '9+' : conteo}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            <div style={{ maxHeight: '380px', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
              {visibles.length === 0 && (
                <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>
                  {filtro ? `No tienes ${GROUP_META[filtro].label}` : 'No tienes notificaciones'}
                </div>
              )}
              {visibles.map(n => {
                const meta = GROUP_META[groupOf(n.tipo)]
                return (
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
                      {/* El icono dice de qué es el aviso sin leer el título. */}
                      <span aria-hidden style={{ fontSize: '15px', lineHeight: '18px', flexShrink: 0 }}>{meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>{n.titulo}</div>
                        {n.cuerpo && <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '2px' }}>{n.cuerpo}</div>}
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>{tiempoRelativo(n.created_at)}</div>
                      </div>
                      {!n.leido && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--at-primary)', flexShrink: 0, marginTop: '5px' }} />}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
