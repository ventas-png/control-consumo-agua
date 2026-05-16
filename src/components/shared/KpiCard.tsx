import { type ReactNode } from 'react'
import { Skeleton } from './Skeleton'

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
 *     gradient="linear-gradient(135deg, #0ea5e9, #0284c7)"
 *     loading={isLoading}
 *   />
 */
export function KpiCard({ label, value, unit, icon, gradient, loading = false, onClick }: Props) {
  const isInteractive = !!onClick
  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      style={{
        background: gradient ?? '#0ea5e9',
        color: 'white',
        padding: '20px 22px',
        borderRadius: '16px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        cursor: isInteractive ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'transform 0.15s',
      }}
      onMouseEnter={e => { if (isInteractive) e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { if (isInteractive) e.currentTarget.style.transform = 'translateY(0)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, opacity: 0.92 }}>{label}</div>
        {icon && <div style={{ fontSize: '24px', opacity: 0.9 }}>{icon}</div>}
      </div>
      <div>
        {loading ? (
          <Skeleton onDark width={120} height={32} radius={8} />
        ) : (
          <div style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
        )}
        {unit && (
          <div style={{ fontSize: '12px', opacity: 0.85, marginTop: '4px' }}>{unit}</div>
        )}
      </div>
    </div>
  )
}
