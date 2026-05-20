import { useState, useMemo } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
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
  { estado: 'abierto',    label: 'Abierto',    color: '#7E9389', bg: '#FAF7EF', bgHeader: '#EAE6D8' },
  { estado: 'en_proceso', label: 'En proceso', color: '#d97706', bg: '#fffbeb', bgHeader: '#fef3c7' },
  { estado: 'resuelto',   label: 'Resuelto',   color: '#1B3B36', bg: '#EEF2EC', bgHeader: '#D9E2DC' },
  { estado: 'cerrado',    label: 'Cerrado',    color: '#16a34a', bg: '#f0fdf4', bgHeader: '#dcfce7' },
]

const PRIORIDAD_CFG: Record<PrioridadTicket, { label: string; color: string; bg: string; order: number }> = {
  urgente: { label: 'Urgente', color: '#fff', bg: '#ef4444', order: 0 },
  alta:    { label: 'Alta',    color: '#fff', bg: '#f97316', order: 1 },
  media:   { label: 'Media',   color: '#fff', bg: '#d97706', order: 2 },
  baja:    { label: 'Baja',    color: '#3E5A4C', bg: '#E1DDD0', order: 3 },
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
      const { value: notas } = await Swal.fire({
        title: 'Cerrar ticket', input: 'textarea',
        inputLabel: 'Notas de cierre (opcional)', inputPlaceholder: 'Descripción de la solución...',
        showCancelButton: true, confirmButtonText: 'Cerrar ticket', cancelButtonText: 'Cancelar', confirmButtonColor: '#16a34a',
      })
      if (notas === undefined) { setMoviendo(null); return }
      updates.notas_cierre = notas || null
      updates.fecha_cierre = new Date().toISOString()
      if (ticket.costo_estimado) {
        const { value: costoReal } = await Swal.fire({
          title: 'Costo real', input: 'number',
          inputLabel: `Costo estimado: ${moneda} ${ticket.costo_estimado}`,
          inputPlaceholder: '0.00', showCancelButton: true, confirmButtonText: 'Confirmar', confirmButtonColor: '#16a34a',
        })
        if (costoReal !== undefined) updates.costo_real = costoReal ? parseFloat(costoReal as string) : null
      }
    }
    const { error } = await supabase.from('tickets_mantenimiento').update(updates).eq('id', ticket.id)
    setMoviendo(null)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#1B3B36' })
    onRefresh()
  }

  const totalAbiertos = porColumna.abierto.length + porColumna.en_proceso.length
  const totalUrgentes = tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado').length

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F' }}>Kanban de Tickets</div>
          <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>
            {totalAbiertos} activos · {totalUrgentes > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>{totalUrgentes} urgentes · </span>}
            {tickets.filter(t => t.estado === 'cerrado').length} cerrados
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value as PrioridadTicket | '')}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: '#fff' }}>
            <option value="">Todas las prioridades</option>
            {(Object.keys(PRIORIDAD_CFG) as PrioridadTicket[]).map(p => (
              <option key={p} value={p}>{PRIORIDAD_CFG[p].label}</option>
            ))}
          </select>
          {tecnicos.length > 0 && (
            <select value={filtroTecnico} onChange={e => setFiltroTecnico(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: '#fff' }}>
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
              <span style={{ background: col.color, color: '#fff', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
                {porColumna[col.estado].length}
              </span>
            </div>

            {/* Cards */}
            <div style={{ background: col.bg, border: `1px solid ${col.color}22`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 8, minHeight: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porColumna[col.estado].length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#C7C2B0', fontSize: 12 }}>Sin tickets</div>
              ) : (
                porColumna[col.estado].map(ticket => {
                  const pCfg = PRIORIDAD_CFG[ticket.prioridad]
                  const exp = expandido === ticket.id
                  const isMoving = moviendo === ticket.id
                  return (
                    <div key={ticket.id}
                      style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', opacity: isMoving ? 0.6 : 1, transition: 'box-shadow 0.15s', boxShadow: exp ? '0 2px 8px rgba(0,0,0,0.1)' : undefined }}
                      onClick={() => setExpandido(exp ? null : ticket.id)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: '#15291F', flex: 1, lineHeight: 1.3 }}>{ticket.titulo}</div>
                        <span style={{ padding: '1px 7px', borderRadius: 20, background: pCfg.bg, color: pCfg.color, fontSize: 10, fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>{pCfg.label}</span>
                      </div>

                      {ticket.unidad_nombre && (
                        <div style={{ fontSize: 10, color: '#7E9389', marginBottom: 3 }}>📍 {ticket.unidad_nombre}</div>
                      )}

                      {ticket.asignado_a && (
                        <div style={{ fontSize: 10, color: '#7E9389', marginBottom: 3 }}>👤 {ticket.asignado_a.slice(0, 25)}</div>
                      )}

                      <div style={{ fontSize: 10, color: '#7E9389' }}>
                        {ticket.tipo === 'preventivo' ? '🔩' : '🔧'} {ticket.tipo}
                        {ticket.fecha_limite && ` · ⏰ ${ticket.fecha_limite}`}
                      </div>

                      {exp && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--at-chip)' }}>
                          {ticket.descripcion && (
                            <div style={{ fontSize: 11, color: '#3E5A4C', marginBottom: 8 }}>{ticket.descripcion}</div>
                          )}
                          {ticket.costo_estimado != null && (
                            <div style={{ fontSize: 11, color: '#7E9389', marginBottom: 8 }}>
                              Est.: <strong>{moneda} {ticket.costo_estimado.toFixed(2)}</strong>
                              {ticket.costo_real != null && <> · Real: <strong style={{ color: '#15291F' }}>{moneda} {ticket.costo_real.toFixed(2)}</strong></>}
                            </div>
                          )}
                          {canEdit && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                              {ANTERIOR[ticket.estado] && (
                                <button onClick={() => moverTicket(ticket, ANTERIOR[ticket.estado]!)} disabled={isMoving}
                                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--at-line-strong)', background: '#FAF7EF', cursor: 'pointer', color: '#7E9389' }}>
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
