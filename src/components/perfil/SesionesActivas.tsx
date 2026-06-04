import { useMemo, type CSSProperties } from 'react'
import { describeUserAgent } from '../../lib/userAgent'
import { useMisSesionesQuery, type SesionActiva } from '../../domain/sesiones/queries'
import { useRevocarSesionMutation, useRevocarOtrasSesionesMutation } from '../../domain/sesiones/mutations'
import { useFormato } from '../../hooks/useFormato'

// plat:P9 — Lista de sesiones activas del usuario (dispositivos con sesión
// abierta) con acción de cierre. Se monta dentro de una <Card> en PerfilSection.
// La lógica vive en el dominio (src/domain/sesiones) + el parser puro de UA.

function tiempoRelativo(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const min = Math.floor((Date.now() - t) / 60000)
  if (min < 1) return 'hace instantes'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

function ultimaActividad(s: SesionActiva): string {
  return tiempoRelativo(s.refreshed_at ?? s.updated_at ?? s.created_at)
}

const hintStyle: CSSProperties = { fontSize: '13px', color: 'var(--at-ink-3)', padding: '8px 0' }
const linkBtnStyle: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '13px' }
const badgeStyle: CSSProperties = { marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', background: 'var(--at-chip)', padding: '1px 7px', borderRadius: '8px' }
const mfaBadgeStyle: CSSProperties = { marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: '#10b981', background: 'var(--at-chip)', padding: '1px 7px', borderRadius: '8px' }
const dangerBtnStyle: CSSProperties = { border: '1px solid var(--at-danger)', background: 'transparent', color: 'var(--at-danger)', fontWeight: 600, fontSize: '13px', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', flexShrink: 0 }
const errStyle: CSSProperties = { fontSize: '12px', color: 'var(--at-danger)', marginTop: '8px' }

function rowStyle(current: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
    border: '1px solid var(--at-line)', borderRadius: '10px',
    background: current ? 'var(--at-primary-soft)' : 'var(--at-surface)',
  }
}

export function SesionesActivas() {
  const { data: sesiones = [], isLoading, isError, refetch } = useMisSesionesQuery()
  const { formatFechaHora } = useFormato()  // plat:P18 — hora absoluta en la tz del usuario
  const revocar = useRevocarSesionMutation()
  const revocarOtras = useRevocarOtrasSesionesMutation()

  const otras = useMemo(() => sesiones.filter(s => !s.is_current).length, [sesiones])

  if (isLoading) return <div style={hintStyle}>Cargando tus sesiones…</div>
  if (isError) {
    return (
      <div style={hintStyle}>
        No se pudieron cargar las sesiones.{' '}
        <button style={linkBtnStyle} onClick={() => void refetch()}>Reintentar</button>
      </div>
    )
  }
  if (sesiones.length === 0) return <div style={hintStyle}>No hay sesiones activas.</div>

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: 0, marginBottom: '14px', lineHeight: 1.5 }}>
        Dispositivos donde tu cuenta tiene la sesión abierta. Si no reconoces alguno, ciérralo.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {sesiones.map(s => {
          const d = describeUserAgent(s.user_agent)
          return (
            <div key={s.id} style={rowStyle(s.is_current)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--at-ink)' }}>
                  {d.etiqueta}
                  {s.is_current && <span style={badgeStyle}>Esta sesión</span>}
                  {s.aal === 'aal2' && <span style={mfaBadgeStyle}>2FA</span>}
                </div>
                <div
                  style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px' }}
                  title={formatFechaHora(s.refreshed_at ?? s.updated_at ?? s.created_at)}
                >
                  {s.ip ? `IP ${s.ip} · ` : ''}última actividad {ultimaActividad(s)}
                </div>
              </div>
              {!s.is_current && (
                <button
                  onClick={() => revocar.mutate(s.id)}
                  disabled={revocar.isPending}
                  style={dangerBtnStyle}
                >
                  {revocar.isPending ? '…' : 'Cerrar'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {otras > 0 && (
        <button
          onClick={() => revocarOtras.mutate()}
          disabled={revocarOtras.isPending}
          style={{ ...dangerBtnStyle, marginTop: '16px', width: '100%', padding: '10px' }}
        >
          {revocarOtras.isPending ? 'Cerrando…' : `Cerrar las demás sesiones (${otras})`}
        </button>
      )}

      {(revocar.isError || revocarOtras.isError) && (
        <div style={errStyle}>No se pudo cerrar la sesión. Intenta de nuevo.</div>
      )}
    </div>
  )
}
