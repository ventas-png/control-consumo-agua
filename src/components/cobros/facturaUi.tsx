// T4 · agua:C4 — Presentación compartida de la Factura para la UI de cobros.
// Mapas de estilo del estado y desglose subtotal + IVA + mora = total. La FUENTE
// DE VERDAD del estado/cálculo es business.ts; aquí solo formateamos.
import type { CSSProperties } from 'react'
import { normalizarEstadoFactura, type EstadoFactura } from '../../lib/business'
import type { FacturaRow } from '../../domain/facturacion/queries'

interface EstadoStyle {
  label: string
  icon: string
  bg: string
  color: string
}

// Estilos por estado canónico (usa los tokens --at-* del tema, como el resto del
// módulo de cobros). normalizarEstadoFactura mapea los legacy ('pagado'/'mora').
const ESTADO_STYLE: Record<EstadoFactura, EstadoStyle> = {
  pendiente: { label: 'Pendiente', icon: '⏳', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  emitida: { label: 'Emitida', icon: '📤', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  pagada: { label: 'Pagada', icon: '✅', bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  vencida: { label: 'Vencida', icon: '⚠️', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  anulada: { label: 'Anulada', icon: '🚫', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

/** Badge del estado de la Factura. Acepta el estado crudo (lo normaliza). */
export function FacturaEstadoBadge({ estado, style }: { estado?: string | null; style?: CSSProperties }) {
  const s = ESTADO_STYLE[normalizarEstadoFactura(estado)]
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '12px',
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
 * Desglose subtotal + IVA + mora = total a pagar a partir de la proyección de
 * Factura. Si la factura aún no tiene snapshot persistido (sin emitir), cae al
 * subtotal (`monto_calculado`) para no mostrar ceros engañosos.
 */
export function FacturaDesglose({ factura, moneda }: { factura: FacturaRow; moneda: string }) {
  const subtotal = factura.monto_calculado ?? 0
  const ivaMonto = factura.iva_monto ?? 0
  const moraMonto = factura.mora_monto ?? 0
  const total = factura.total_a_pagar ?? subtotal + ivaMonto + moraMonto

  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '2px 0' }
  const lbl: CSSProperties = { color: 'var(--at-ink-3)' }
  const val: CSSProperties = { fontWeight: 600, color: 'var(--at-ink)' }

  return (
    <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px 14px', border: '1px solid var(--at-line)' }}>
      <div style={row}>
        <span style={lbl}>Subtotal</span>
        <span style={val}>{moneda} {subtotal.toFixed(2)}</span>
      </div>
      <div style={row}>
        <span style={lbl}>
          IVA{factura.iva_tasa != null ? ` (${(factura.iva_tasa * 100).toFixed(factura.iva_tasa * 100 % 1 === 0 ? 0 : 2)}%)` : ''}
        </span>
        <span style={val}>{moneda} {ivaMonto.toFixed(2)}</span>
      </div>
      {moraMonto > 0 && (
        <div style={row}>
          <span style={{ ...lbl, color: 'var(--at-danger)' }}>Mora</span>
          <span style={{ ...val, color: 'var(--at-danger)' }}>{moneda} {moraMonto.toFixed(2)}</span>
        </div>
      )}
      <div style={{ ...row, borderTop: '1px solid var(--at-line)', marginTop: '6px', paddingTop: '8px' }}>
        <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>Total a pagar</span>
        <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-primary-hover)' }}>{moneda} {total.toFixed(2)}</span>
      </div>
    </div>
  )
}
