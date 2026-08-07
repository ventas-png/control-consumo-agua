import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import { ModalPortal } from '../shared/ModalPortal'

// ============================================================================
// SystemHealthModal — F4.4.3: dashboard de salud del sistema para superadmin.
// ============================================================================
// Consume la edge function /health (F2.8 PR #183) cada 30s y muestra el estado
// de las piezas estructurales (Supabase URL, anon key, service-role key) +
// uptime de la edge function + latencia.
//
// Diseno:
//   - Fetch publico (la edge function /health no requiere JWT).
//   - Intervalo: 30s en foreground; pausa cuando el modal se cierra.
//   - Historial in-memory: ultimos 10 pings para detectar flaps.
//   - Sin persistencia — si el superadmin quiere observabilidad continua usa
//     monitoreo externo (UptimeRobot/Pingdom apuntando al mismo endpoint).
//
// Permisos: la edge function /health es publica (por diseno — la usa el
// monitoreo externo). El modal lo expone solo SuperAdminSection que ya tiene
// gating de role super_admin.

interface Props { onClose: () => void }

interface HealthResponse {
  status: 'ok' | 'degraded'
  timestamp: string
  uptime_ms: number
  checks: {
    supabase_url: boolean
    supabase_anon_key: boolean
    service_role_key: boolean
  }
}

interface PingRecord {
  at: string
  status: 'ok' | 'degraded' | 'error'
  latencyMs: number
  errorMsg?: string
}

const REFRESH_INTERVAL_MS = 30_000
const HISTORY_SIZE = 10

// Lazy lookup: leerlo en cada call permite que los tests stubbeen el env antes
// del primer fetch (al contrario de capturarlo a module-load time).
function getSupabaseUrl(): string | undefined {
  return import.meta.env.VITE_SUPABASE_URL as string | undefined
}

export function SystemHealthModal({ onClose }: Props) {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const [history, setHistory] = useState<PingRecord[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Ref al body de mounted-ness para evitar setState sobre componente
  // desmontado cuando la respuesta llega tarde.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const fetchHealth = useCallback(async () => {
    const baseUrl = getSupabaseUrl()
    if (!baseUrl) {
      setError('VITE_SUPABASE_URL no configurada en build.')
      setLoading(false)
      return
    }
    const t0 = performance.now()
    try {
      const res = await fetch(`${baseUrl}/functions/v1/health`, { method: 'GET' })
      const latencyMs = Math.round(performance.now() - t0)
      if (!mountedRef.current) return
      setLastLatencyMs(latencyMs)
      const data: HealthResponse = await res.json()
      setHealth(data)
      setError(null)
      setHistory(prev => [
        { at: new Date().toISOString(), status: data.status, latencyMs },
        ...prev,
      ].slice(0, HISTORY_SIZE))
    } catch (e: unknown) {
      const latencyMs = Math.round(performance.now() - t0)
      if (!mountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setLastLatencyMs(latencyMs)
      setHistory(prev => {
        const rec: PingRecord = { at: new Date().toISOString(), status: 'error', latencyMs, errorMsg: msg }
        return [rec, ...prev].slice(0, HISTORY_SIZE)
      })
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHealth()
    if (!autoRefresh) return
    const id = setInterval(() => { void fetchHealth() }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchHealth, autoRefresh])

  const overall: 'ok' | 'degraded' | 'error' =
    error ? 'error' : health?.status === 'ok' ? 'ok' : 'degraded'

  return (
    <ModalPortal>
    <div
      style={overlayStyle}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={modalStyle} role="dialog" aria-labelledby="health-title">
        <div style={headerStyle}>
          <div>
            <div id="health-title" style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>
              🩺 Salud del sistema
            </div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              Endpoint público: <code style={codeStyle}>/functions/v1/health</code> · refresh cada {REFRESH_INTERVAL_MS / 1000}s
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={closeBtnStyle}>×</button>
        </div>

        {/* Status global */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <StatusDot variant={overall} large />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: statusColor(overall) }}>
                {overall === 'ok' ? 'Operativo' : overall === 'degraded' ? 'Degradado' : 'Sin respuesta'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                {loading ? 'Verificando…' :
                  error ? `Error: ${error}` :
                  health ? `Verificado a las ${formatTime(health.timestamp)}` : ''}
              </div>
            </div>
            <button
              onClick={() => { void fetchHealth() }}
              disabled={loading}
              style={refreshBtnStyle}
              aria-label="Refrescar ahora"
            >
              {loading ? '…' : '↻'}
            </button>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <Stat label="Latencia" value={lastLatencyMs != null ? `${lastLatencyMs} ms` : '—'} />
            <Stat label="Uptime edge" value={health ? formatUptime(health.uptime_ms) : '—'} />
            <Stat label="Auto-refresh" value={autoRefresh ? 'Activo' : 'Pausado'} onClick={() => setAutoRefresh(a => !a)} />
          </div>
        </div>

        {/* Checks */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={sectionTitleStyle}>Variables de entorno</div>
          {health ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '8px' }}>
              <CheckItem label="SUPABASE_URL" ok={health.checks.supabase_url} />
              <CheckItem label="SUPABASE_ANON_KEY" ok={health.checks.supabase_anon_key} />
              <CheckItem label="SERVICE_ROLE_KEY" ok={health.checks.service_role_key} />
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '8px' }}>
              {loading ? 'Cargando…' : 'Sin respuesta del endpoint /health.'}
            </div>
          )}
        </div>

        {/* Historial */}
        <div style={{ padding: '16px 24px', flex: 1, overflowY: 'auto' }}>
          <div style={sectionTitleStyle}>Historial reciente ({history.length})</div>
          {history.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '8px' }}>Aún no hay datos.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '8px' }}>
              <thead>
                <tr style={{ color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' }}>
                  <th style={thStyle}>Hora</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}>Latencia</th>
                  <th style={thStyle}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--at-chip)' }}>
                    <td style={tdStyle}>{formatTime(h.at)}</td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <StatusDot variant={h.status} />
                        <span style={{ color: statusColor(h.status), fontWeight: 600 }}>
                          {h.status === 'ok' ? 'OK' : h.status === 'degraded' ? 'Degradado' : 'Error'}
                        </span>
                      </span>
                    </td>
                    <td style={tdStyle}>{h.latencyMs} ms</td>
                    <td style={{ ...tdStyle, color: 'var(--at-ink-3)', fontFamily: 'monospace', fontSize: '11px' }}>
                      {h.errorMsg ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const interactive = Boolean(onClick)
  return (
    <button
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      disabled={!interactive}
      style={{
        background: 'var(--at-surface-2)',
        border: '1px solid var(--at-line)',
        borderRadius: '8px',
        padding: '10px 12px',
        textAlign: 'left',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)', marginTop: '2px' }}>{value}</div>
    </button>
  )
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 12px', borderRadius: '8px',
      background: ok ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
      border: `1px solid ${ok ? 'var(--at-success-border)' : 'var(--at-danger-border)'}`,
    }}>
      <span style={{ fontSize: '14px' }} aria-hidden="true">{ok ? '✓' : '✗'}</span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: ok ? 'var(--at-success)' : 'var(--at-danger)' }}>
        {label}
      </span>
    </div>
  )
}

function StatusDot({ variant, large = false }: { variant: 'ok' | 'degraded' | 'error'; large?: boolean }) {
  const size = large ? '12px' : '8px'
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        background: statusColor(variant),
        boxShadow: variant === 'ok' && large ? `0 0 0 4px ${statusColor(variant)}33` : undefined,
      }}
    />
  )
}

function statusColor(variant: 'ok' | 'degraded' | 'error'): string {
  return variant === 'ok' ? 'var(--at-success)' :
         variant === 'degraded' ? 'var(--at-warning)' :
                                  'var(--at-danger)'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

// ───── Styles ─────
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
}
const modalStyle: CSSProperties = {
  background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '720px',
  boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
  display: 'flex', flexDirection: 'column', maxHeight: '90vh',
}
const headerStyle: CSSProperties = {
  padding: '20px 24px 14px', borderBottom: '1px solid var(--at-line)',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px',
  color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
}
const refreshBtnStyle: CSSProperties = {
  padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--at-line-strong)',
  background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', fontSize: '14px',
  cursor: 'pointer', fontWeight: 700, minWidth: '40px',
}
const sectionTitleStyle: CSSProperties = {
  fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}
const thStyle: CSSProperties = { padding: '8px 6px', fontSize: '10px', fontWeight: 700 }
const tdStyle: CSSProperties = { padding: '8px 6px', verticalAlign: 'top', color: 'var(--at-ink-2)' }
const codeStyle: CSSProperties = {
  background: 'var(--at-chip)', padding: '1px 6px', borderRadius: '4px',
  fontFamily: 'monospace', fontSize: '11px',
}
