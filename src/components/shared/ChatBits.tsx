import { initials } from '../../lib/chatFormat'

// Piezas visuales comunes a todos los chats de la app (Centro de Comunicación,
// portal del cliente y los hilos de condominios), para que se vean iguales.

/** Círculo con las iniciales de quien escribe. */
export function Avatar({ name, size = 28, tone = 'accent' }: { name?: string | null; size?: number; tone?: 'accent' | 'primary' }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700,
      background: tone === 'primary' ? 'var(--at-primary-soft)' : 'var(--at-accent-tint)',
      color: tone === 'primary' ? 'var(--at-primary-hover)' : 'var(--at-accent-dark)',
    }}>
      {initials(name)}
    </span>
  )
}

/** Separador de día entre mensajes ("Hoy", "Ayer", "14 de octubre"). */
export function DaySeparator({ label }: { label: string }) {
  return (
    <div role="separator" style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 2px' }}>
      <span style={{
        fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)',
        background: 'var(--at-surface)', border: '1px solid var(--at-line)',
        padding: '3px 10px', borderRadius: '999px',
      }}>
        {label}
      </span>
    </div>
  )
}
