import { useState, useMemo } from 'react'
import { notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { TicketMantenimiento, EstadoTicket, PrioridadTicket } from '../../../types'
import { tint } from '../../shared/statusTone'

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

const TIPO_LABEL: Record<TicketMantenimiento['tipo'], string> = { preventivo: '🔩 Preventivo', correctivo: '🔧 Correctivo' }

/** "2026-11-06T15:04:00Z" → "2026-11-06 15:04" (hora local); una fecha sola se deja tal cual. */
function fechaHora(iso?: string | null) {
  if (!iso) return '—'
  if (iso.length <= 10) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function KanbanTicketsTab({ tickets, proyectoId: _proyectoId, companyId: _companyId, moneda, canEdit, onRefresh }: Props) {
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadTicket | ''>('')
  const [filtroTecnico, setFiltroTecnico] = useState('')
  // La ficha se guarda por id (no por objeto) para que siga a la fila recargada
  // tras mover el ticket de columna sin cerrarse.
  const [detalleId, setDetalleId] = useState<string | null>(null)
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

  const detalle = useMemo(() => (detalleId ? tickets.find(t => t.id === detalleId) ?? null : null), [tickets, detalleId])
  const cerrarDetalle = () => setDetalleId(null)

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
          <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value as PrioridadTicket | '')} aria-label="Prioridad"
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
            <option value="">Todas las prioridades</option>
            {(Object.keys(PRIORIDAD_CFG) as PrioridadTicket[]).map(p => (
              <option key={p} value={p}>{PRIORIDAD_CFG[p].label}</option>
            ))}
          </select>
          {tecnicos.length > 0 && (
            <select value={filtroTecnico} onChange={e => setFiltroTecnico(e.target.value)} aria-label="Técnico"
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
              <option value="">Todos los técnicos</option>
              {tecnicos.map(t => <option key={t} value={t}>{t.slice(0, 20)}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Tablero: 4 columnas en escritorio, 2 en tableta y una sola en el
          teléfono (las etapas una debajo de otra; `.at-kanban-board` en
          index.css). Antes pedía 800px de ancho y se desplazaba de lado. */}
      <div className="at-kanban-board">
        {COLUMNAS.map(col => (
          <div key={col.estado} style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
            {/* Column header */}
            <div style={{ background: col.bgHeader, border: `1px solid ${tint(col.color, 20)}`, borderRadius: '10px 10px 0 0', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: col.color }}>{col.label}</span>
              <span style={{ background: col.color, color: 'white', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
                {porColumna[col.estado].length}
              </span>
            </div>

            {/* Tarjetas: cada una abre la ficha en ventana (antes se expandía
                en sitio, con las acciones apretadas dentro de la columna). */}
            <div style={{ background: col.bg, border: `1px solid ${tint(col.color, 13)}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 8, minHeight: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {porColumna[col.estado].length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--at-line-strong)', fontSize: 12 }}>Sin tickets</div>
              ) : (
                porColumna[col.estado].map(ticket => {
                  const pCfg = PRIORIDAD_CFG[ticket.prioridad]
                  const abierto = detalleId === ticket.id
                  const isMoving = moviendo === ticket.id
                  return (
                    <div key={ticket.id} role="button" tabIndex={0} aria-label={ticket.titulo}
                      onClick={() => setDetalleId(ticket.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetalleId(ticket.id) } }}
                      style={{ background: 'var(--at-surface)', border: `1px solid ${abierto ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', opacity: isMoving ? 0.6 : 1, transition: 'box-shadow 0.15s', boxShadow: abierto ? '0 2px 8px rgba(0,0,0,0.1)' : undefined }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink)', flex: 1, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{ticket.titulo}</div>
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

      {/* Ficha del ticket en ventana: a pantalla completa en el teléfono. Las
          acciones del flujo (retroceder / avanzar / cerrar) van en el pie; el
          cierre sigue pidiendo notas y costo real con PromptDialog, que se
          pinta encima de la ventana. */}
      {detalle && (() => {
        const pCfg = PRIORIDAD_CFG[detalle.prioridad]
        const col = COLUMNAS.find(c => c.estado === detalle.estado)
        const isMoving = moviendo === detalle.id
        const anterior = ANTERIOR[detalle.estado]
        const siguiente = SIGUIENTE[detalle.estado]
        const fotos = detalle.foto_urls?.length ?? 0
        const archivos = detalle.archivo_urls?.length ?? 0
        const datos: { label: string; value: string }[] = [
          { label: 'Estado', value: col?.label ?? detalle.estado },
          { label: 'Prioridad', value: pCfg.label },
          { label: 'Tipo', value: TIPO_LABEL[detalle.tipo] ?? detalle.tipo },
          { label: 'Unidad', value: detalle.unidad_nombre ?? '—' },
          { label: 'Asignado a', value: detalle.asignado_a ?? '—' },
          { label: 'Fecha límite', value: detalle.fecha_limite ?? '—' },
          { label: 'Costo estimado', value: detalle.costo_estimado != null ? `${moneda} ${detalle.costo_estimado.toFixed(2)}` : '—' },
          { label: 'Costo real', value: detalle.costo_real != null ? `${moneda} ${detalle.costo_real.toFixed(2)}` : '—' },
          { label: 'Creado', value: fechaHora(detalle.created_at) },
          { label: 'Fecha de cierre', value: fechaHora(detalle.fecha_cierre) },
        ]
        if (fotos || archivos) {
          datos.push({ label: 'Adjuntos', value: [fotos ? `📷 ${fotos} foto${fotos !== 1 ? 's' : ''}` : '', archivos ? `📎 ${archivos} archivo${archivos !== 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') })
        }
        return (
          <EditModal
            title={detalle.titulo}
            subtitle={<span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: pCfg.bg, color: pCfg.color }}>{pCfg.label}</span>
              {col && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: col.bgHeader, color: col.color, border: `1px solid ${tint(col.color, 20)}` }}>{col.label}</span>}
              {detalle.unidad_nombre && <span>📍 {detalle.unidad_nombre}</span>}
              {detalle.asignado_a && <span>👤 {detalle.asignado_a}</span>}
            </span>}
            size="lg"
            fullScreenOnMobile
            onClose={cerrarDetalle}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
                <Button variant="secondary" onClick={cerrarDetalle}>Cerrar</Button>
                {canEdit && anterior && (
                  <Button variant="secondary" disabled={isMoving} onClick={() => moverTicket(detalle, anterior)}
                    title={`Regresar a ${COLUMNAS.find(c => c.estado === anterior)?.label}`}>
                    ← Retroceder
                  </Button>
                )}
                {canEdit && siguiente && (
                  <Button disabled={isMoving} onClick={() => moverTicket(detalle, siguiente)}
                    title={`Pasar a ${COLUMNAS.find(c => c.estado === siguiente)?.label}`}>
                    {detalle.estado === 'resuelto' ? '✅ Cerrar ticket' : '→ Avanzar'}
                  </Button>
                )}
              </div>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {datos.map(f => (
                <div key={f.label} style={{ background: 'var(--at-surface-2)', borderRadius: '7px', padding: '8px', border: '1px solid var(--at-line)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{f.label}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{f.value}</div>
                </div>
              ))}
            </div>

            {detalle.descripcion && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', border: '1px solid var(--at-line)', marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>Descripción</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detalle.descripcion}</div>
              </div>
            )}

            {detalle.notas_cierre && (
              <div style={{ background: 'var(--at-success-tint)', borderRadius: '8px', padding: '10px', border: `1px solid ${tint('var(--at-success)', 20)}` }}>
                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>Notas de cierre</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detalle.notas_cierre}</div>
              </div>
            )}

            {/* Dónde va el ticket dentro del flujo (la etapa actual, resaltada). */}
            <div aria-hidden style={{ marginTop: '12px', fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', flexWrap: 'wrap', gap: '4px 6px', alignItems: 'center' }}>
              {COLUMNAS.map((c, i) => (
                <span key={c.estado} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {i > 0 && <span>→</span>}
                  <span style={c.estado === detalle.estado
                    ? { fontWeight: 700, color: c.color, background: c.bgHeader, border: `1px solid ${tint(c.color, 20)}`, borderRadius: '20px', padding: '1px 8px' }
                    : undefined}>
                    {c.label}
                  </span>
                </span>
              ))}
            </div>
          </EditModal>
        )
      })()}
    </div>
  )
}
