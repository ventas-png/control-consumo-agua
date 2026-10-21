import { useEffect, useState } from 'react'
import { notify } from '../shared/Dialog'
import { Skeleton } from '../shared/Skeleton'
import {
  useNotificationPreferencesQuery,
} from '../../domain/comunicacion/queries'
import { useSaveNotificationPreferencesMutation } from '../../domain/comunicacion/mutations'
import {
  CHANNEL_META,
  NOTIFICATION_CHANNELS,
  defaultPreferenceMap,
  type NotificationChannel,
  type NotificationPreferenceMap,
} from '../../domain/comunicacion/schemas'

interface Props {
  userId: string
  companyId?: string | null
  /** in_app no se puede desactivar: es la campana base de la app. */
  lockInApp?: boolean
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Cómo se lee cada canal dentro de una frase ("…en la app y por correo"). */
const CHANNEL_PHRASE: Record<NotificationChannel, string> = {
  in_app: 'en la app',
  email: 'por correo',
  whatsapp: 'por WhatsApp',
}

function listaHumana(partes: string[]): string {
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

// com:N9/N10 — Centro de preferencias de canal del usuario. Lee/guarda la fila
// propia de notification_preferences (RLS la acota a auth.uid()). El dispatcher
// respetará estas preferencias en un follow-up de coordinación (Sesión A).
//
// Cada interruptor se guarda al tocarlo, como en los ajustes del teléfono: con
// el botón "Guardar cambios" de antes era fácil cambiar algo, salir y perderlo.
// Mientras un guardado está en curso los interruptores esperan, así dos toques
// seguidos no compiten; si falla, el canal vuelve a como estaba.
export function NotificationPreferencesPanel({ userId, companyId, lockInApp = false }: Props) {
  const { data, isLoading } = useNotificationPreferencesQuery(userId)
  const save = useSaveNotificationPreferencesMutation()

  const [draft, setDraft] = useState<NotificationPreferenceMap>(defaultPreferenceMap())
  const [status, setStatus] = useState<SaveStatus>('idle')

  // Sincroniza el estado local cuando llegan/actualizan las preferencias.
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])

  async function toggle(channel: NotificationChannel) {
    if ((channel === 'in_app' && lockInApp) || save.isPending) return
    const before = draft[channel]
    const next = { ...draft, [channel]: !before }
    setDraft(next)
    setStatus('saving')
    try {
      await save.mutateAsync({ userId, companyId, preferences: next })
      setStatus('saved')
    } catch {
      setDraft(d => ({ ...d, [channel]: before }))
      setStatus('error')
      notify({ variant: 'error', title: 'Error', text: 'No se pudo guardar el cambio. Inténtalo de nuevo.' })
    }
  }

  const activos = NOTIFICATION_CHANNELS.filter(ch => draft[ch])
  const summary = activos.length === 0
    ? 'No recibirás avisos por ningún canal.'
    : activos.length === 1
      ? `Solo recibirás avisos ${CHANNEL_PHRASE[activos[0]]}.`
      : `Recibirás avisos ${listaHumana(activos.map(ch => CHANNEL_PHRASE[ch]))}.`

  return (
    <div style={{ maxWidth: '600px', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--at-ink)' }}>
            Notificaciones
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Elige por qué canales quieres recibir comunicados y avisos.
          </p>
        </div>
        <SaveIndicator status={status} />
      </div>

      <div style={{
        background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px',
        overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {isLoading ? (
          <div aria-busy="true" aria-label="Cargando preferencias">
            {NOTIFICATION_CHANNELS.map(ch => (
              <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', borderBottom: '1px solid var(--at-line)' }}>
                <Skeleton width={40} height={40} radius={12} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  <Skeleton width="35%" height={14} />
                  <Skeleton width="70%" height={12} />
                </div>
                <Skeleton width={50} height={30} radius={999} />
              </div>
            ))}
          </div>
        ) : (
          NOTIFICATION_CHANNELS.map((channel, i) => {
            const meta = CHANNEL_META[channel]
            const enabled = draft[channel]
            const locked = channel === 'in_app' && lockInApp
            const busy = save.isPending
            return (
              <label
                key={channel}
                className={locked ? undefined : 'conv-row'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '16px',
                  background: 'var(--at-surface)',
                  borderBottom: i < NOTIFICATION_CHANNELS.length - 1 ? '1px solid var(--at-line)' : 'none',
                  cursor: locked || busy ? 'default' : 'pointer',
                }}
              >
                <span aria-hidden="true" style={{
                  width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px',
                  background: enabled ? 'var(--at-primary-tint)' : 'var(--at-chip)',
                  filter: enabled ? 'none' : 'grayscale(0.6)',
                  transition: 'background 0.15s ease',
                }}>
                  {meta.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '14.5px', fontWeight: 700, color: 'var(--at-ink)' }}>
                    {meta.label}
                    {locked && (
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', padding: '1px 8px', borderRadius: '999px' }}>
                        🔒 Siempre activo
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    {meta.description}
                  </span>
                </span>
                <Switch
                  checked={enabled}
                  disabled={locked || busy}
                  label={meta.label}
                  onToggle={() => toggle(channel)}
                />
              </label>
            )
          })
        )}
      </div>

      {!isLoading && (
        <p aria-live="polite" style={{ margin: '12px 2px 0', fontSize: '13px', color: 'var(--at-ink-2)' }}>
          {summary}
        </p>
      )}
    </div>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  const text = status === 'saving' ? 'Guardando…' : status === 'saved' ? '✓ Cambios guardados' : 'No se guardó'
  const color = status === 'error' ? 'var(--at-danger-strong)' : status === 'saved' ? 'var(--at-success-strong)' : 'var(--at-ink-3)'
  return (
    <span role="status" style={{ fontSize: '12.5px', fontWeight: 600, color, whiteSpace: 'nowrap', paddingTop: '4px' }}>
      {text}
    </span>
  )
}

function Switch({ checked, disabled, label, onToggle }: {
  checked: boolean
  disabled: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: ${checked ? 'activado' : 'desactivado'}`}
      disabled={disabled}
      onClick={onToggle}
      style={{
        position: 'relative', width: '50px', height: '30px', flexShrink: 0,
        borderRadius: '999px', border: 'none', padding: 0,
        background: checked ? 'var(--at-primary)' : 'var(--at-line-strong)',
        opacity: disabled && !checked ? 0.6 : 1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s ease',
      }}
    >
      <span
        style={{
          position: 'absolute', top: '3px', left: checked ? '23px' : '3px',
          width: '24px', height: '24px', borderRadius: '50%',
          // Blanca en los dos temas: con --at-surface, en oscuro la perilla se
          // perdía contra el riel apagado.
          background: 'white', transition: 'left 0.15s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  )
}
