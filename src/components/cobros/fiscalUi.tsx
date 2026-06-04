// serv:S11 — Presentación del ESTATUS DE TIMBRADO (documento fiscal FEL/CFDI)
// para la UI de cobros. El badge del *ciclo fiscal* del comprobante
// (`documentos_fiscales.estado`) es DISTINTO del badge del estado de la Factura
// (`facturaUi.tsx`, ciclo de cobro): este refleja borrador/por_timbrar/timbrado/
// rechazado/cancelado. La FUENTE DE VERDAD del estado es businessFiscal.ts; aquí
// solo formateamos (tokens --at-* del tema, como el resto de cobros).
import type { CSSProperties } from 'react'
import { normalizarEstadoFiscal } from '../../lib/businessFiscal'
import type { EstadoFiscal, DocumentoFiscal } from '../../types/fiscal'

interface EstadoStyle {
  label: string
  icon: string
  bg: string
  color: string
}

const ESTADO_FISCAL_STYLE: Record<EstadoFiscal, EstadoStyle> = {
  borrador: { label: 'Borrador', icon: '📝', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  por_timbrar: { label: 'Por timbrar', icon: '⏱️', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  timbrado: { label: 'Timbrado', icon: '🧾', bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  rechazado: { label: 'Rechazado', icon: '⛔', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  cancelado: { label: 'Cancelado', icon: '🚫', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

/**
 * Badge del estatus de timbrado del comprobante. Acepta el estado crudo (lo
 * normaliza). Devuelve `null` cuando no hay documento todavía (sin emitir al PAC)
 * para no añadir ruido visual a facturas que aún no se han intentado timbrar.
 */
export function TimbradoEstadoBadge({
  estado,
  style,
}: {
  estado?: string | null
  style?: CSSProperties
}) {
  if (estado == null) return null
  const s = ESTADO_FISCAL_STYLE[normalizarEstadoFiscal(estado)]
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
 * Datos fiscales del comprobante timbrado (UUID/serie/número/autorización). Solo
 * se muestran cuando hay documento en estado 'timbrado' con identificadores. En
 * GT el dato relevante es el número de autorización; en MX, el UUID (folio
 * fiscal). Mostramos ambos cuando existen.
 */
export function TimbradoDatos({
  documento,
  style,
}: {
  documento?: Pick<
    DocumentoFiscal,
    'estado' | 'uuid_fiscal' | 'serie' | 'numero' | 'numero_autorizacion'
  > | null
  style?: CSSProperties
}) {
  if (!documento || normalizarEstadoFiscal(documento.estado) !== 'timbrado') return null
  const { uuid_fiscal, serie, numero, numero_autorizacion } = documento
  if (!uuid_fiscal && !serie && !numero && !numero_autorizacion) return null

  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px', padding: '1px 0' }
  const lbl: CSSProperties = { color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }
  const val: CSSProperties = { fontWeight: 600, color: 'var(--at-ink)', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'right' }

  return (
    <div
      style={{
        background: 'var(--at-success-tint)',
        border: '1px solid var(--at-success-border)',
        borderRadius: '10px',
        padding: '10px 12px',
        ...style,
      }}
    >
      {(serie || numero) && (
        <div style={row}>
          <span style={lbl}>Serie / Número</span>
          <span style={val}>{[serie, numero].filter(Boolean).join('-') || '—'}</span>
        </div>
      )}
      {numero_autorizacion && (
        <div style={row}>
          <span style={lbl}>Autorización</span>
          <span style={val}>{numero_autorizacion}</span>
        </div>
      )}
      {uuid_fiscal && (
        <div style={row}>
          <span style={lbl}>UUID</span>
          <span style={val}>{uuid_fiscal}</span>
        </div>
      )}
    </div>
  )
}
