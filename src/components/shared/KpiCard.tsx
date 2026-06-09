import { type ReactNode } from 'react'
import { Skeleton } from './Skeleton'
import { Sparkline } from './Sparkline'

interface Props {
  /** Etiqueta corta arriba ("Consumo del Período"). */
  label: string
  /** Valor principal — número, string formateado o cualquier ReactNode. */
  value: ReactNode
  /** Sufijo pequeño bajo el valor — unidad ("m³", "Q"), badge, etc. */
  unit?: ReactNode
  /** Emoji o icono grande a la derecha. */
  icon?: ReactNode
  /** Fondo gradiente — pasar como string CSS o usar variantes predefinidas. */
  gradient?: string
  /** Si está cargando, muestra Skeleton en lugar del valor. */
  loading?: boolean
  /** onClick opcional para hacer la card interactiva. */
  onClick?: () => void
  /** Serie de tendencia para el sparkline de fondo (≥2 puntos). */
  sparkline?: number[]
  /** Variación vs período anterior, en %. Positivo ↑, negativo ↓. */
  delta?: number
  /** Texto del delta (ej. "vs mes anterior"). */
  deltaLabel?: ReactNode
}

/**
 * KPI card reusable — reemplaza patrones repetidos en AdminDashboardStats,
 * DashboardSection, CondominiosDashboard y CustomerPortal. Misma altura,
 * misma tipografía, mismo skeleton state.
 *
 *   <KpiCard
 *     label="Consumo del Período"
 *     value={consumoTotal.toFixed(2)}
 *     unit="m³"
 *     icon="💧"
 *     gradient="linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))"
 *     sparkline={[12, 18, 15, 22, 19, 25]}
 *     delta={8}
 *     deltaLabel="vs mes anterior"
 *     loading={isLoading}
 *   />
 */
export function KpiCard({ label, value, unit, icon, gradient, loading = false, onClick, sparkline, delta, deltaLabel }: Props) {
  const isInteractive = !!onClick
  const hasSpark = !!sparkline && sparkline.length > 1
  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      style={{
        background: gradient ?? 'var(--at-primary)',
        color: 'white',
        padding: '20px 22px',
        borderRadius: '16px',
        boxShadow: 'var(--at-elevation-3)',
        cursor: isInteractive ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'transform var(--at-motion-base) var(--at-ease-standard), box-shadow var(--at-motion-base) var(--at-ease-standard)',
      }}
      onMouseEnter={e => {
        if (!isInteractive) return
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--at-elevation-4)'
      }}
      onMouseLeave={e => {
        if (!isInteractive) return
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'var(--at-elevation-3)'
      }}
    >
      {/* Sparkline decorativo al fondo (bajo el contenido, no interactivo). */}
      {hasSpark && (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 46, opacity: 0.5, pointerEvents: 'none' }}
        >
          <Sparkline data={sparkline!} color="#FFFFFF" height={46} ariaLabel={`Tendencia de ${label}`} />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--at-space-3)', position: 'relative' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, opacity: 0.92 }}>{label}</div>
        {icon && <div style={{ fontSize: '24px', opacity: 0.9 }}>{icon}</div>}
      </div>
      <div style={{ position: 'relative' }}>
        {loading ? (
          <Skeleton onDark width={120} height={32} radius={8} />
        ) : (
          <div style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
        )}
        {(unit || (delta != null && !loading)) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--at-space-2)', marginTop: 'var(--at-space-1)', flexWrap: 'wrap' }}>
            {unit && <div style={{ fontSize: '12px', opacity: 0.85 }}>{unit}</div>}
            {delta != null && !loading && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.18)',
                  color: '#fff',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                <span aria-hidden="true">{delta >= 0 ? '↑' : '↓'}</span>
                {Math.abs(delta)}%
                {deltaLabel && <span style={{ fontWeight: 500, opacity: 0.85 }}>{deltaLabel}</span>}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
