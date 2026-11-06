import type { ReactNode } from 'react'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { tint } from '../../shared/statusTone'
import type { TicketMantenimiento, EstadoTicket, PrioridadTicket } from '../../../types'

/** Ficha de un ticket de mantenimiento en ventana emergente (a pantalla
 *  completa en el teléfono). La comparten el Kanban (que añade en el pie las
 *  acciones del flujo) y el Gantt (sólo lectura). */

export const COLUMNAS_TICKET: { estado: EstadoTicket; label: string; color: string; bg: string; bgHeader: string }[] = [
  { estado: 'abierto',    label: 'Abierto',    color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)', bgHeader: 'var(--at-chip)' },
  { estado: 'en_proceso', label: 'En proceso', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', bgHeader: 'var(--at-warning-tint)' },
  { estado: 'resuelto',   label: 'Resuelto',   color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', bgHeader: 'var(--at-primary-soft)' },
  { estado: 'cerrado',    label: 'Cerrado',    color: 'var(--at-success)', bg: 'var(--at-success-tint)', bgHeader: 'var(--at-success-tint)' },
]

export const PRIORIDAD_TICKET_CFG: Record<PrioridadTicket, { label: string; color: string; bg: string; order: number }> = {
  urgente: { label: 'Urgente', color: 'var(--at-on-status)', bg: 'var(--at-danger)', order: 0 },
  alta:    { label: 'Alta',    color: 'var(--at-on-status)', bg: 'var(--at-warning)', order: 1 },
  media:   { label: 'Media',   color: 'var(--at-on-status)', bg: 'var(--at-warning)', order: 2 },
  baja:    { label: 'Baja',    color: 'var(--at-ink-2)', bg: 'var(--at-line)', order: 3 },
}

export const TIPO_TICKET_LABEL: Record<TicketMantenimiento['tipo'], string> = { preventivo: '🔩 Preventivo', correctivo: '🔧 Correctivo' }

/** "2026-11-06T15:04:00Z" → "2026-11-06 15:04" (hora local); una fecha sola se deja tal cual. */
export function fechaHora(iso?: string | null) {
  if (!iso) return '—'
  if (iso.length <= 10) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Props {
  ticket: TicketMantenimiento
  moneda: string
  onClose: () => void
  /** Botones que van en el pie después de Cerrar (p. ej. las acciones del flujo). */
  acciones?: ReactNode
  /** Tarjetas de datos que se añaden tras las del ticket (p. ej. inicio/fin/duración en el Gantt). */
  datosExtra?: { label: string; value: string }[]
  /** Aviso destacado al inicio del cuerpo (p. ej. "Vencido"). */
  aviso?: ReactNode
  /** Secciones extra del cuerpo, antes de la línea del flujo. */
  children?: ReactNode
}

export function TicketFichaModal({ ticket, moneda, onClose, acciones, datosExtra = [], aviso, children }: Props) {
  // Sin moneda (Mantenimiento no la recibe) el monto va solo.
  const monto = (n: number) => `${moneda} ${n.toFixed(2)}`.trim()
  const pCfg = PRIORIDAD_TICKET_CFG[ticket.prioridad] ?? PRIORIDAD_TICKET_CFG.media
  const col = COLUMNAS_TICKET.find(c => c.estado === ticket.estado)
  const fotos = ticket.foto_urls?.length ?? 0
  const archivos = ticket.archivo_urls?.length ?? 0
  const datos: { label: string; value: string }[] = [
    { label: 'Estado', value: col?.label ?? ticket.estado },
    { label: 'Prioridad', value: pCfg.label },
    { label: 'Tipo', value: TIPO_TICKET_LABEL[ticket.tipo] ?? ticket.tipo },
    { label: 'Unidad', value: ticket.unidad_nombre ?? 'Área común' },
    { label: 'Asignado a', value: ticket.asignado_a ?? '—' },
    { label: 'Fecha límite', value: ticket.fecha_limite ?? '—' },
    { label: 'Costo estimado', value: ticket.costo_estimado != null ? monto(ticket.costo_estimado) : '—' },
    { label: 'Costo real', value: ticket.costo_real != null ? monto(ticket.costo_real) : '—' },
    { label: 'Creado', value: fechaHora(ticket.created_at) },
    { label: 'Fecha de cierre', value: fechaHora(ticket.fecha_cierre) },
    ...datosExtra,
  ]
  if (fotos || archivos) {
    datos.push({ label: 'Adjuntos', value: [fotos ? `📷 ${fotos} foto${fotos !== 1 ? 's' : ''}` : '', archivos ? `📎 ${archivos} archivo${archivos !== 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') })
  }

  return (
    <EditModal
      title={ticket.titulo}
      subtitle={<span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: pCfg.bg, color: pCfg.color }}>{pCfg.label}</span>
        {col && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: col.bgHeader, color: col.color, border: `1px solid ${tint(col.color, 20)}` }}>{col.label}</span>}
        {ticket.unidad_nombre && <span>📍 {ticket.unidad_nombre}</span>}
        {ticket.asignado_a && <span>👤 {ticket.asignado_a}</span>}
      </span>}
      size="lg"
      fullScreenOnMobile
      onClose={onClose}
      footer={
        <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          {acciones}
        </div>
      }
    >
      {aviso}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px', marginBottom: '12px' }}>
        {datos.map(f => (
          <div key={f.label} style={{ background: 'var(--at-surface-2)', borderRadius: '7px', padding: '8px', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{f.label}</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{f.value}</div>
          </div>
        ))}
      </div>

      {ticket.descripcion && (
        <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', border: '1px solid var(--at-line)', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>Descripción</div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ticket.descripcion}</div>
        </div>
      )}

      {ticket.notas_cierre && (
        <div style={{ background: 'var(--at-success-tint)', borderRadius: '8px', padding: '10px', border: `1px solid ${tint('var(--at-success)', 20)}` }}>
          <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>Notas de cierre</div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ticket.notas_cierre}</div>
        </div>
      )}

      {children}

      {/* Dónde va el ticket dentro del flujo (la etapa actual, resaltada). */}
      <div aria-hidden style={{ marginTop: '12px', fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center' }}>
        {COLUMNAS_TICKET.map((c, i) => (
          <span key={c.estado} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {i > 0 && <span>→</span>}
            <span style={c.estado === ticket.estado
              ? { fontWeight: 700, color: c.color, background: c.bgHeader, border: `1px solid ${tint(c.color, 20)}`, borderRadius: '20px', padding: '1px 8px' }
              : undefined}>
              {c.label}
            </span>
          </span>
        ))}
      </div>
    </EditModal>
  )
}
