import { useState, useMemo } from 'react'
import { notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { TicketMantenimiento, EstadoTicket, PrioridadTicket } from '../../../types'

interface Props {
  tickets: TicketMantenimiento[]
  proyectoId: string
  companyId: string
  moneda: string
  canEdit: boolean
  onRefresh: () => void
}

const COLUMNAS: { estado: EstadoTicket; label: string; color: string; bg: string; bgHeader: string }[] = [
  { estado: 'abierto',    label: 'Abierto',    color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)', bgHeader: 'var(--at-chip)' },
  { estado: 'en_proceso', label: 'En proceso', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', bgHeader: 'var(--at-warning-tint)' },
  { estado: 'resuelto',   label: 'Resuelto',   color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', bgHeader: 'var(--at-primary-soft)' },
  { estado: 'cerrado',    label: 'Cerrado',    color: 'var(--at-success)', bg: 'var(--at-success-tint)', bgHeader: 'var(--at-success-tint)' },
]

const PRIORIDAD_CFG: Record<PrioridadTicket, { label: string; color: string; bg: string; order: number }> = {
  urgente: { label: 'Urgente', color: 'var(--at-on-status)', bg: 'var(--at-danger)', order: 0 },
  alta:    { label: 'Alta',    color: 'var(--at-on-status)', bg: 'var(--at-warning)', order: 1 },
  media:   { label: 'Media',   color: 'var(--at-on-status)', bg: 'var(--at-warning)', order: 2 },
  baja:    { label: 'Baja',    color: 'var(--at-ink-2)', bg: 'var(--at-line)', order: 3 },
}

const SIGUIENTE: Partial<Record<EstadoTicket, EstadoTicket>> = {
  abierto: 'en_proceso',
  en_proceso: 'resuelto',
  resuelto: 'cerrado',
}
const ANTERIOR: Partial<Record<EstadoTicket, EstadoTicket>> = {
  en_proceso: 'abierto',
  resuelto: 'en_proceso',
  cerrado: 'resuelto',
}

export default function KanbanTicketsTab({ tickets, proyectoId: _proyectoId, companyId: _companyId, moneda, canEdit, onRefresh }: Props) {
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadTicket | ''>('')
  const [filtroTecnico, setFiltroTecnico] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [moviendo, setMoviendo] = useState<string | null>(null)

  const tecnicos = useMemo(() => {
    const set = new Set<string>()
    tickets.forEach(t => { if (t.asignado_a) set.add(t.asignado_a) })
    return Array.from(set).sort()
  }, [tickets])

  const ticketsFiltrados = useMemo(() => tickets.filter(t => {
    if (filtroPrioridad && t.prioridad !== filtroPrioridad) return false
    if (filtroTecnico && t.asignado_a !== filtroTecnico) return false
    return true
  }), [tickets, filtroPrioridad, filtroTecnico])

  const porColumna = useMemo(() => {
    const m: Record<EstadoTicket, TicketMantenimiento[]> = { abierto: [], en_proceso: [], resuelto: [], cerrado: [] }
    ticketsFiltrados.forEach(t => { if (m[t.estado]) m[t.estado].push(t) })
    Object.values(m).forEach(arr => arr.sort((a, b) => PRIORIDAD_CFG[a.prioridad].order - PRIORIDAD_CFG[b.prioridad].order))
    return m
  }, [ticketsFiltrados])

  async function moverTicket(ticket: TicketMantenimiento, nuevoEstado: EstadoTicket) {
    setMoviendo(ticket.id)
    const updates: Partial<TicketMantenimiento> = { estado: nuevoEstado }
    if (nuevoEstado === 'cerrado') {
      const result = await openPromptDialog({
        title: 'Cerrar ticket',
        fields: [{
          name: 'notas',
          label: 'Notas de cierre (opcional)',
          control: 'textarea',
          rows: 4,
          placeholder: 'Descripción de la solución...',
          autoFocus: true,
        }],
        submitText: 'Cerrar ticket',
      })
      if (!result) { setMoviendo(null); return }
      updates.notas_cierre = result.notas || null
      updates.fecha_cierre = new Date().toISOString()
      if (ticket.costo_estimado) {
        const costoResult = await openPromptDialog({
          title: 'Costo real',
          fields: [{
            name: 'costoReal',
            label: `Costo estimado: ${moneda} ${ticket.costo_estimado}`,
            type: 'number',
            placeholder: '0.00',
            min: 0,
            step: 0.01,
            autoFocus: true,
          }],
          submitText: 'Confirmar',
        })
        if (costoResult) updates.costo_real = costoResult.costoReal ? parseFloat(costoResult.costoReal) : null
      }
    }
    const { error } = await updateCondominioRow('tickets_mantenimiento', ticket.id, updates)
    setMoviendo(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const totalAbiertos = porColumna.abierto.length + porColumna.en_proceso.length
  const totalUrgentes = tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado').length

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Kanban de Tickets</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
            {totalAbiertos} activos · {totalUrgentes > 0 && <span style={{ color: 'var(--at-danger)', fontWeight: 700 }}>{totalUrgentes} urgentes · </span>}
            {tickets.filter(t => t.estado === 'cerrado').length} cerrados
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value as PrioridadTicket | '')}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
            <option value="">Todas las prioridades</option>
            {(Object.keys(PRIORIDAD_CFG) as PrioridadTicket[]).map(p => (
              <option key={p} value={p}>{PRIORIDAD_CFG[p].label}</option>
            ))}
          </select>
          {tecnicos.length > 0 && (
            <select value={filtroTecnico} onChange={e => setFiltroTecnico(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
              <option value="">Todos los técnicos</option>
              {tecnicos.map(t => <option key={t} value={t}>{t.slice(0, 20)}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Kanban board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, minWidth: 800, overflowX: 'auto' }}>
        {COLUMNAS.map(col => (
          <div key={col.estado} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Column header */}
            <div style={{ background: col.bgHeader, border: `1px solid ${col.color}33`, borderRadius: '10px 10px 0 0', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: col.color }}>{col.label}</span>
              <span style={{ background: col.color, color: 'white', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
                {porColumna[col.estado].length}
              </span>
            </div>

            {/* Cards */}
            <div style={{ background: col.bg, border: `1px solid ${col.color}22`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 8, minHeight: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porColumna[col.estado].length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--at-line-strong)', fontSize: 12 }}>Sin tickets</div>
              ) : (
                porColumna[col.estado].map(ticket => {
                  const pCfg = PRIORIDAD_CFG[ticket.prioridad]
                  const exp = expandido === ticket.id
                  const isMoving = moviendo === ticket.id
                  return (
                    <div key={ticket.id}
                      style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', opacity: isMoving ? 0.6 : 1, transition: 'box-shadow 0.15s', boxShadow: exp ? '0 2px 8px rgba(0,0,0,0.1)' : undefined }}
                      onClick={() => setExpandido(exp ? null : ticket.id)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink)', flex: 1, lineHeight: 1.3 }}>{ticket.titulo}</div>
                        <span style={{ padding: '1px 7px', borderRadius: 20, background: pCfg.bg, color: pCfg.color, fontSize: 10, fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>{pCfg.label}</span>
                      </div>

                      {ticket.unidad_nombre && (
                        <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 3 }}>📍 {ticket.unidad_nombre}</div>
                      )}

                      {ticket.asignado_a && (
                        <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 3 }}>👤 {ticket.asignado_a.slice(0, 25)}</div>
                      )}

                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>
                        {ticket.tipo === 'preventivo' ? '🔩' : '🔧'} {ticket.tipo}
                        {ticket.fecha_limite && ` · ⏰ ${ticket.fecha_limite}`}
                      </div>

                      {exp && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--at-chip)' }}>
                          {ticket.descripcion && (
                            <div style={{ fontSize: 11, color: 'var(--at-ink-2)', marginBottom: 8 }}>{ticket.descripcion}</div>
                          )}
                          {ticket.costo_estimado != null && (
                            <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 8 }}>
                              Est.: <strong>{moneda} {ticket.costo_estimado.toFixed(2)}</strong>
                              {ticket.costo_real != null && <> · Real: <strong style={{ color: 'var(--at-ink)' }}>{moneda} {ticket.costo_real.toFixed(2)}</strong></>}
                            </div>
                          )}
                          {canEdit && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                              {ANTERIOR[ticket.estado] && (
                                <button onClick={() => moverTicket(ticket, ANTERIOR[ticket.estado]!)} disabled={isMoving}
                                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--at-line-strong)', background: 'var(--at-surface-2)', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
                                  ← Retroceder
                                </button>
                              )}
                              {SIGUIENTE[ticket.estado] && (
                                <button onClick={() => moverTicket(ticket, SIGUIENTE[ticket.estado]!)} disabled={isMoving}
                                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: `1px solid ${col.color}`, background: col.bgHeader, cursor: 'pointer', color: col.color, fontWeight: 600 }}>
                                  {ticket.estado === 'resuelto' ? '✅ Cerrar' : '→ Avanzar'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Summary footer */}
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(Object.keys(PRIORIDAD_CFG) as PrioridadTicket[]).map(p => {
          const count = tickets.filter(t => t.prioridad === p && t.estado !== 'cerrado').length
          if (count === 0) return null
          const cfg = PRIORIDAD_CFG[p]
          return (
            <span key={p} style={{ padding: '4px 12px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 600 }}>
              {cfg.label}: {count} activos
            </span>
          )
        })}
      </div>
    </div>
  )
}
