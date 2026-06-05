import { useEffect, useState } from 'react'
import { notify } from '../shared/Dialog'
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

// com:N9/N10 — Centro de preferencias de canal del usuario. Lee/guarda la fila
// propia de notification_preferences (RLS la acota a auth.uid()). El dispatcher
// respetará estas preferencias en un follow-up de coordinación (Sesión A).
export function NotificationPreferencesPanel({ userId, companyId, lockInApp = false }: Props) {
  const { data, isLoading } = useNotificationPreferencesQuery(userId)
  const save = useSaveNotificationPreferencesMutation()

  const [draft, setDraft] = useState<NotificationPreferenceMap>(defaultPreferenceMap())

  // Sincroniza el borrador local cuando llegan/actualizan las preferencias.
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])

  const dirty = !!data && NOTIFICATION_CHANNELS.some((ch) => draft[ch] !== data[ch])

  function toggle(channel: NotificationChannel) {
    if (channel === 'in_app' && lockInApp) return
    setDraft((d) => ({ ...d, [channel]: !d[channel] }))
  }

  async function handleSave() {
    try {
      await save.mutateAsync({ userId, companyId, preferences: draft })
      notify({ variant: 'success', title: 'Preferencias guardadas', duration: 1500 })
    } catch {
      notify({ variant: 'error', title: 'Error', text: 'No se pudieron guardar tus preferencias.' })
    }
  }

  return (
    <div style={{ maxWidth: '560px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>
          Preferencias de notificación
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Elige por qué canales quieres recibir comunicados y avisos.
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>
          Cargando…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {NOTIFICATION_CHANNELS.map((channel) => {
            const meta = CHANNEL_META[channel]
            const enabled = draft[channel]
            const locked = channel === 'in_app' && lockInApp
            return (
              <label
                key={channel}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '14px 16px',
                  background: 'var(--at-surface)',
                  border: '1px solid var(--at-line)',
                  borderRadius: '12px',
                  cursor: locked ? 'default' : 'pointer',
                  opacity: locked ? 0.75 : 1,
                }}
              >
                <span style={{ fontSize: '22px', flexShrink: 0 }}>{meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--at-ink)' }}>
                    {meta.label}
                    {locked && (
                      <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>
                        (siempre activo)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    {meta.description}
                  </div>
                </div>
                {/* Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${meta.label}: ${enabled ? 'activado' : 'desactivado'}`}
                  disabled={locked}
                  onClick={() => toggle(channel)}
                  style={{
                    position: 'relative', width: '44px', height: '24px', flexShrink: 0,
                    borderRadius: '999px', border: 'none',
                    background: enabled ? 'var(--at-primary)' : 'var(--at-line-strong)',
                    cursor: locked ? 'default' : 'pointer',
                    transition: 'background 0.15s ease', padding: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute', top: '2px', left: enabled ? '22px' : '2px',
                      width: '20px', height: '20px', borderRadius: '50%',
                      background: 'white', transition: 'left 0.15s ease',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                </button>
              </label>
            )
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button
              onClick={handleSave}
              disabled={!dirty || save.isPending}
              style={{
                padding: '9px 20px', border: 'none', borderRadius: '9px',
                background: (!dirty || save.isPending) ? 'var(--at-ink-3)' : 'var(--at-primary)',
                color: 'white', fontWeight: 700, fontSize: '13.5px',
                cursor: (!dirty || save.isPending) ? 'not-allowed' : 'pointer',
              }}
            >
              {save.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
