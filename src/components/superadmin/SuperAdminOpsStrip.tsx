import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatDateTime, formatDateShort, hoyLocalISO, dateLocalISO, parseFecha } from '../../lib/format'
import { minutosDesde } from './metricsHelpers'
import { superadminKeys } from '../../domain/superadmin/keys'
import type { MrrTrendPoint } from '../../domain/superadmin/queries'

// ============================================================================
// SuperAdminOpsStrip — franja de estado operativo del dashboard superadmin.
// ============================================================================
// Tres indicadores + refresh manual:
//   · Frescura de la MV (refreshed_at; el cron refresca cada 15 min).
//   · Snapshot diario de la serie de MRR (cron 00:10 UTC).
//   · Salud de la edge function /health (ping único al montar; el detalle vive
//     en SystemHealthModal — endpoint público por diseño, igual que el modal).
// Los umbrales son advertencia operativa, no incidente confirmado.

type Semaforo = 'success' | 'warning' | 'danger' | 'neutral'

const DOT_COLOR: Record<Semaforo, string> = {
  success: 'var(--at-success)',
  warning: 'var(--at-warning)',
  danger: 'var(--at-danger)',
  neutral: 'var(--at-ink-3)',
}

interface Props {
  refreshedAt: string | null | undefined
  serie: MrrTrendPoint[]
  isFetching: boolean
  onShowHealth: () => void
}

export function SuperAdminOpsStrip({ refreshedAt, serie, isFetching, onShowHealth }: Props) {
  const queryClient = useQueryClient()
  const [health, setHealth] = useState<'ok' | 'degraded' | 'error' | 'loading'>('loading')

  // Ping único al montar (el auto-refresh de 30s vive en SystemHealthModal).
  useEffect(() => {
    const controller = new AbortController()
    const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
    if (!baseUrl) { setHealth('error'); return }
    fetch(`${baseUrl}/functions/v1/health`, { method: 'GET', signal: controller.signal })
      .then(res => res.json())
      .then((data: { status?: string }) => setHealth(data.status === 'ok' ? 'ok' : 'degraded'))
      .catch(() => { if (!controller.signal.aborted) setHealth('error') })
    return () => controller.abort()
  }, [])

  // ── Frescura de la MV (cron cada 15 min) ──────────────────────────────────
  const minutos = minutosDesde(refreshedAt)
  const frescuraTone: Semaforo = minutos === null ? 'neutral' : minutos <= 20 ? 'success' : minutos <= 45 ? 'warning' : 'danger'
  const frescuraLabel = minutos === null
    ? 'Frescura: sin datos'
    : minutos <= 1
      ? 'Datos al minuto'
      : `Datos de hace ${minutos} min${frescuraTone === 'danger' ? ' · refresh atrasado' : ''}`

  // ── Snapshot diario de la serie ───────────────────────────────────────────
  const lastDay = serie.length > 0 ? serie[serie.length - 1].day : null
  let snapshotTone: Semaforo = 'neutral'
  let snapshotLabel = 'Sin snapshots aún'
  if (lastDay) {
    const hoy = hoyLocalISO()
    const ayer = dateLocalISO(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const dia = dateLocalISO(parseFecha(lastDay))
    const alDia = dia >= ayer
    snapshotTone = alDia ? 'success' : 'warning'
    // dia > hoy pasa cada noche en husos negativos (day = current_date en UTC):
    // se reporta como "hoy" en vez de mostrar una fecha futura.
    snapshotLabel = dia >= hoy
      ? 'Snapshot diario: hoy'
      : `Snapshot diario: ${formatDateShort(lastDay)}${alDia ? '' : ' · atrasado'}`
  }

  const healthTone: Semaforo = health === 'ok' ? 'success' : health === 'loading' ? 'neutral' : health === 'degraded' ? 'warning' : 'danger'
  const healthLabel = health === 'loading' ? 'Salud: verificando…'
    : health === 'ok' ? 'Sistema operativo'
      : health === 'degraded' ? 'Sistema degradado'
        : 'Salud: sin respuesta'

  return (
    <div style={{
      background: 'var(--at-surface)', borderRadius: '14px', padding: '10px 14px',
      border: '1px solid var(--at-line)',
      display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
    }}>
      <Pill tone={frescuraTone} title={`MV mv_superadmin_plataforma · cron cada 15 min · último refresh ${refreshedAt ? formatDateTime(refreshedAt) : '—'}`}>
        {frescuraLabel}
      </Pill>
      <Pill tone={snapshotTone} title="Serie diaria de MRR (platform_metrics_daily) · cron 00:10 UTC">
        {snapshotLabel}
      </Pill>
      <Pill tone={healthTone} onClick={onShowHealth} title="Ver el detalle de salud de la infraestructura (edge function /health)">
        {healthLabel}
      </Pill>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {isFetching && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>actualizando…</span>}
        <button
          onClick={() => { void queryClient.invalidateQueries({ queryKey: superadminKeys.all }) }}
          style={{
            padding: '8px 14px', minHeight: 36, borderRadius: '8px',
            border: '1px solid var(--at-line)', background: 'var(--at-surface)',
            color: 'var(--at-ink-2)', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
          }}
        >
          ↻ Actualizar
        </button>
      </div>
    </div>
  )
}

function Pill({ tone, title, onClick, children }: {
  tone: Semaforo
  title: string
  onClick?: () => void
  children: ReactNode
}) {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '7px',
    padding: '7px 12px', minHeight: 32, borderRadius: 999,
    background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
    fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)',
  }
  const dot = (
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: DOT_COLOR[tone], flexShrink: 0 }} />
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} style={{ ...base, cursor: 'pointer' }}>
        {dot}{children}
      </button>
    )
  }
  return <span title={title} style={base}>{dot}{children}</span>
}
