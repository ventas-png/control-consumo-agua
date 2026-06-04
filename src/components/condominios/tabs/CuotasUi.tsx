// T4 · cond:C4 — Presentación compartida de la Cuota de condominio para la UI.
// Badge del estado canónico (`cuota_estado`) y desglose monto + mora =
// total_a_pagar. Espejo de cobros/facturaUi.tsx (agua), pero SIN IVA (la cuota de
// mantenimiento no es factura comercial gravada — ver la migración 180000). La
// FUENTE DE VERDAD del estado/cálculo es businessCondominios.ts; aquí solo
// formateamos (tokens --at-* del tema, como el resto de condominios).
import type { CSSProperties } from 'react'
import {
  normalizarEstadoCuota,
  type EstadoCuotaCanonico,
} from '../../../lib/businessCondominios'

interface EstadoStyle {
  label: string
  icon: string
  bg: string
  color: string
}

// Estilos por estado canónico (mismos tokens/íconos que facturaUi.tsx de agua,
// para coherencia visual entre módulos). normalizarEstadoCuota mapea los legacy
// ('pagado'/'moroso').
const ESTADO_CUOTA_STYLE: Record<EstadoCuotaCanonico, EstadoStyle> = {
  pendiente: { label: 'Pendiente', icon: '⏳', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  emitida: { label: 'Emitida', icon: '📤', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  pagada: { label: 'Pagada', icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  vencida: { label: 'Vencida', icon: '⚠️', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  anulada: { label: 'Anulada', icon: '🚫', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

/** Badge del estado canónico de la Cuota. Acepta el estado crudo (lo normaliza). */
export function CuotaEstadoBadge({ estado, style }: { estado?: string | null; style?: CSSProperties }) {
  const s = ESTADO_CUOTA_STYLE[normalizarEstadoCuota(estado)]
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: '20px',
        fontSize: '11.5px',
        fontWeight: 700,
        background: s.bg,
        color: s.color,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {s.icon} {s.label}
    </span>
  )
}

/**
 * Desglose monto + mora = total a pagar de una cuota (SIN IVA). `moraMonto`
 * persistido por el cron (cond:C6); `totalAPagar` el snapshot persistido. Si la
 * cuota aún no tiene snapshot (sin emitir), cae a `monto (+ mora)` para no mostrar
 * ceros engañosos. Solo muestra la línea de mora cuando hay recargo.
 */
export function CuotaDesglose({
  monto,
  moraMonto,
  totalAPagar,
  moneda,
  style,
}: {
  monto: number
  moraMonto?: number | null
  totalAPagar?: number | null
  moneda: string
  style?: CSSProperties
}) {
  const base = Number.isFinite(monto) ? monto : 0
  const mora = Number.isFinite(moraMonto as number) ? (moraMonto as number) : 0
  const total = totalAPagar != null && Number.isFinite(totalAPagar) ? totalAPagar : base + mora

  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '2px 0' }
  const lbl: CSSProperties = { color: 'var(--at-ink-3)' }
  const val: CSSProperties = { fontWeight: 600, color: 'var(--at-ink)' }

  return (
    <div
      style={{
        background: 'var(--at-surface-2)',
        borderRadius: '10px',
        padding: '12px 14px',
        border: '1px solid var(--at-line)',
        ...style,
      }}
    >
      <div style={row}>
        <span style={lbl}>Monto</span>
        <span style={val}>{moneda} {base.toFixed(2)}</span>
      </div>
      {mora > 0 && (
        <div style={row}>
          <span style={{ ...lbl, color: 'var(--at-danger)' }}>Mora</span>
          <span style={{ ...val, color: 'var(--at-danger)' }}>{moneda} {mora.toFixed(2)}</span>
        </div>
      )}
      <div style={{ ...row, borderTop: '1px solid var(--at-line)', marginTop: '6px', paddingTop: '8px' }}>
        <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>Total a pagar</span>
        <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-primary-hover)' }}>{moneda} {total.toFixed(2)}</span>
      </div>
    </div>
  )
}
