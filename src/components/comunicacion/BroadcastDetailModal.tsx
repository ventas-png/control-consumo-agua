import type { ReactNode } from 'react'
import type { Broadcast } from '../../types'
import type { BroadcastEmailStats } from '../../domain/comunicacion/broadcasts'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { TARGET_LABELS } from './NuevoComunicadoModal'

// Un comunicado enviado, en ventana emergente: el mensaje completo tal como
// lo recibe el cliente y cómo le fue (lectura en el portal y entrega por
// email). Antes se desplegaba dentro de la tarjeta de la lista.

export function formatBroadcastDate(iso: string) {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function readPct(b: Broadcast): number {
  return b.recipient_count > 0 ? Math.round(((b.read_count ?? 0) / b.recipient_count) * 100) : 0
}

/** Barra de progreso de lectura (también la usa la lista). */
export function ReadBar({ pct, height = 6 }: { pct: number; height?: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Leído en el portal"
      style={{ height, borderRadius: 999, background: 'var(--at-chip)', overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'var(--at-success)', transition: 'width 0.3s ease' }} />
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '12px', padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--at-ink)', marginTop: '2px' }}>{value}</div>
      {hint && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{hint}</div>}
    </div>
  )
}

export function BroadcastDetailModal({ broadcast, emailStats, onClose }: {
  broadcast: Broadcast
  emailStats?: BroadcastEmailStats
  onClose: () => void
}) {
  const pct = readPct(broadcast)
  const read = broadcast.read_count ?? 0

  return (
    <EditModal
      title={broadcast.title}
      subtitle={`${formatBroadcastDate(broadcast.created_at)} · enviado por ${broadcast.sent_by_name}`}
      maxWidth="640px"
      fullScreenOnMobile
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}>
            {TARGET_LABELS[broadcast.target_type]}
          </span>
          {broadcast.send_email && (
            <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: 'var(--at-info-tint)', color: 'var(--at-info-strong)' }}>
              📧 También por email
            </span>
          )}
        </div>

        {/* El mensaje, como lo ve el cliente en su portal */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Mensaje
          </div>
          <div style={{
            background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '12px',
            padding: '14px 16px', fontSize: '14px', color: 'var(--at-ink-2)', lineHeight: 1.65,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {broadcast.body}
          </div>
        </div>
        {/* Cómo le fue */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
          <Metric label="Destinatarios" value={broadcast.recipient_count} />
          <Metric
            label="Leídos en el portal"
            value={`${pct}%`}
            hint={<>{read} de {broadcast.recipient_count}<div style={{ marginTop: '6px' }}><ReadBar pct={pct} /></div></>}
          />
        </div>

        {broadcast.send_email && emailStats && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Entrega por email
            </div>
            {/* Tracking de entrega (com:N4): enviados = aceptados por Gmail;
                abiertos = píxel (cota superior); rebotados = bounce duro. */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <EmailChip label="Enviados" value={emailStats.enviados} tone="success" />
              <EmailChip label="Abiertos" value={emailStats.abiertos} tone="info" />
              {emailStats.pendientes > 0 && <EmailChip label="En cola" value={emailStats.pendientes} tone="warning" />}
              {emailStats.rebotados > 0 && <EmailChip label="Rebotados" value={emailStats.rebotados} tone="danger" />}
              {emailStats.fallidos > 0 && <EmailChip label="Fallidos" value={emailStats.fallidos} tone="danger" />}
            </div>
          </div>
        )}

      </div>
    </EditModal>
  )
}

function EmailChip({ label, value, tone }: { label: string; value: number; tone: 'success' | 'info' | 'warning' | 'danger' }) {
  return (
    <span style={{
      padding: '4px 10px', borderRadius: '999px', fontSize: '12.5px', fontWeight: 600,
      background: `var(--at-${tone}-tint)`, color: `var(--at-${tone}-strong)`,
      border: `1px solid var(--at-${tone}-border)`,
    }}>
      <strong>{value}</strong> {label.toLowerCase()}
    </span>
  )
}
