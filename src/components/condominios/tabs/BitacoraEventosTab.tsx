import { useMemo, useState } from 'react'
import {
  Visitante, TicketMantenimiento, IncidenteSeguridad,
  AnuncioComunidad, OrdenCompra, AsambleaDigital,
  GastoCondominio, CuotaCondominio,
} from '../../../types'

interface Props {
  visitantes: Visitante[]
  tickets: TicketMantenimiento[]
  incidentes: IncidenteSeguridad[]
  anuncios: AnuncioComunidad[]
  ordenesCompra: OrdenCompra[]
  asambleas: AsambleaDigital[]
  gastos: GastoCondominio[]
  cuotas: CuotaCondominio[]
  moneda: string
}

type TipoEvento = 'visitante' | 'ticket' | 'incidente' | 'anuncio' | 'orden_compra' | 'asamblea' | 'gasto' | 'cuota'

const TIPO_CFG: Record<TipoEvento, { label: string; icon: string; color: string; bg: string }> = {
  visitante:    { label: 'Visitante',    icon: '🚪', color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  ticket:       { label: 'Ticket',       icon: '🔧', color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
  incidente:    { label: 'Incidente',    icon: '🚨', color: '#ef4444', bg: '#fef2f2' },
  anuncio:      { label: 'Anuncio',      icon: '📢', color: 'var(--at-primary-hover)', bg: 'var(--at-primary-tint)' },
  orden_compra: { label: 'Orden compra', icon: '🛒', color: '#d97706', bg: '#fef3c7' },
  asamblea:     { label: 'Asamblea',     icon: '🖥️', color: '#16a34a', bg: '#dcfce7' },
  gasto:        { label: 'Gasto',        icon: '💸', color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
  cuota:        { label: 'Cuota',        icon: '💳', color: 'var(--at-ink)', bg: 'var(--at-surface-2)' },
}

interface Evento {
  id: string
  tipo: TipoEvento
  fecha: string
  titulo: string
  subtitulo: string
  detalle?: string
  badge?: string
  badgeColor?: string
}

function toFecha(s: string | null | undefined): string {
  if (!s) return ''
  return s.slice(0, 10)
}

export default function BitacoraEventosTab({ visitantes, tickets, incidentes, anuncios, ordenesCompra, asambleas, gastos, cuotas, moneda }: Props) {
  const [filtroTipo, setFiltroTipo] = useState<TipoEvento | ''>('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [pagina, setPagina] = useState(1)
  const POR_PAGINA = 30

  const eventos: Evento[] = useMemo(() => {
    const list: Evento[] = []

    visitantes.forEach(v => list.push({
      id: `vis-${v.id}`, tipo: 'visitante',
      fecha: v.hora_entrada?.slice(0, 10) ?? '',
      titulo: `Visita: ${v.nombre}`,
      subtitulo: v.motivo ?? 'Sin motivo registrado',
      detalle: v.hora_salida ? `Salida: ${v.hora_salida.slice(11, 16)}` : 'Sin salida registrada',
    }))

    tickets.forEach(t => list.push({
      id: `tkt-${t.id}`, tipo: 'ticket',
      fecha: toFecha(t.created_at),
      titulo: t.titulo,
      subtitulo: `${t.tipo === 'preventivo' ? 'Preventivo' : 'Correctivo'} · ${t.prioridad}`,
      badge: t.estado,
      badgeColor: t.estado === 'resuelto' || t.estado === 'cerrado' ? '#16a34a' : t.estado === 'en_proceso' ? '#d97706' : 'var(--at-ink-3)',
    }))

    incidentes.forEach(i => list.push({
      id: `inc-${i.id}`, tipo: 'incidente',
      fecha: toFecha(i.fecha),
      titulo: `Incidente: ${i.tipo}`,
      subtitulo: i.area ?? i.descripcion?.slice(0, 60) ?? '',
      badge: i.estado,
      badgeColor: '#ef4444',
    }))

    anuncios.forEach(a => list.push({
      id: `ann-${a.id}`, tipo: 'anuncio',
      fecha: toFecha(a.created_at),
      titulo: a.titulo,
      subtitulo: a.tipo ?? 'aviso',
      detalle: a.contenido?.slice(0, 80) + (a.contenido?.length > 80 ? '…' : ''),
    }))

    ordenesCompra.forEach(o => list.push({
      id: `oc-${o.id}`, tipo: 'orden_compra',
      fecha: toFecha(o.created_at),
      titulo: `OC-${String(o.correlativo ?? 0).padStart(4, '0')}: ${o.concepto}`,
      subtitulo: o.proveedor_nombre,
      badge: o.estado,
      badgeColor: o.estado === 'recibida' ? '#16a34a' : o.estado === 'cancelada' ? '#ef4444' : '#d97706',
      detalle: o.monto_estimado != null ? `${moneda} ${o.monto_estimado.toLocaleString('es', { maximumFractionDigits: 0 })}` : undefined,
    }))

    asambleas.forEach(a => list.push({
      id: `asm-${a.id}`, tipo: 'asamblea',
      fecha: a.fecha_hora?.slice(0, 10) ?? '',
      titulo: a.titulo,
      subtitulo: a.modalidad,
      badge: a.estado,
      badgeColor: a.estado === 'finalizada' ? '#16a34a' : a.estado === 'en_curso' ? '#d97706' : 'var(--at-primary)',
    }))

    gastos.filter(g => g.estado !== 'anulado').forEach(g => list.push({
      id: `gst-${g.id}`, tipo: 'gasto',
      fecha: toFecha(g.fecha),
      titulo: g.concepto,
      subtitulo: g.categoria,
      detalle: `${moneda} ${g.monto.toLocaleString('es', { maximumFractionDigits: 0 })}`,
    }))

    cuotas.filter(c => c.estado === 'pagado').forEach(c => list.push({
      id: `cuo-${c.id}`, tipo: 'cuota',
      fecha: toFecha(c.created_at),
      titulo: `Cuota pagada: ${c.concepto}`,
      subtitulo: `Período: ${c.periodo}`,
      detalle: `${moneda} ${c.monto.toLocaleString('es', { maximumFractionDigits: 0 })}`,
    }))

    return list.sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [visitantes, tickets, incidentes, anuncios, ordenesCompra, asambleas, gastos, cuotas, moneda])

  const filtrados = useMemo(() => eventos.filter(e => {
    if (filtroTipo && e.tipo !== filtroTipo) return false
    if (fechaDesde && e.fecha < fechaDesde) return false
    if (fechaHasta && e.fecha > fechaHasta) return false
    return true
  }), [eventos, filtroTipo, fechaDesde, fechaHasta])

  const totalPaginas = Math.ceil(filtrados.length / POR_PAGINA)
  const pagItems = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  const conteoPorTipo = useMemo(() => {
    const m: Partial<Record<TipoEvento, number>> = {}
    filtrados.forEach(e => { m[e.tipo] = (m[e.tipo] ?? 0) + 1 })
    return m
  }, [filtrados])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 4 }}>Bitácora de Eventos</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        {filtrados.length} eventos · Feed cronológico de toda la actividad del condominio
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value as TipoEvento | ''); setPagina(1) }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_CFG) as TipoEvento[]).map(t => (
            <option key={t} value={t}>{TIPO_CFG[t].icon} {TIPO_CFG[t].label} ({conteoPorTipo[t] ?? 0})</option>
          ))}
        </select>
        <input type="date" value={fechaDesde} onChange={e => { setFechaDesde(e.target.value); setPagina(1) }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12 }} />
        <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>—</span>
        <input type="date" value={fechaHasta} onChange={e => { setFechaHasta(e.target.value); setPagina(1) }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12 }} />
        {(filtroTipo || fechaDesde || fechaHasta) && (
          <button onClick={() => { setFiltroTipo(''); setFechaDesde(''); setFechaHasta(''); setPagina(1) }}
            style={{ padding: '6px 12px', background: 'var(--at-chip)', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: 'var(--at-ink-2)' }}>
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Tipo pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(Object.entries(TIPO_CFG) as [TipoEvento, typeof TIPO_CFG[TipoEvento]][]).map(([tipo, cfg]) => (
          <div key={tipo} onClick={() => { setFiltroTipo(filtroTipo === tipo ? '' : tipo); setPagina(1) }}
            style={{ padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: filtroTipo === tipo ? cfg.bg : 'var(--at-surface-2)',
              color: filtroTipo === tipo ? cfg.color : 'var(--at-ink-3)',
              border: `1px solid ${filtroTipo === tipo ? cfg.color : 'var(--at-line)'}` }}>
            {cfg.icon} {cfg.label}
            {(conteoPorTipo[tipo] ?? 0) > 0 && <span style={{ marginLeft: 4, fontWeight: 800 }}>{conteoPorTipo[tipo]}</span>}
          </div>
        ))}
      </div>

      {/* Timeline */}
      {pagItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>No hay eventos con los filtros aplicados.</div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 18, top: 0, bottom: 0, width: 2, background: 'var(--at-line)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {pagItems.map((e, idx) => {
              const cfg = TIPO_CFG[e.tipo]
              const prevFecha = idx > 0 ? pagItems[idx - 1].fecha : null
              const showDateSep = !prevFecha || prevFecha !== e.fecha
              return (
                <div key={e.id}>
                  {showDateSep && (
                    <div style={{ paddingLeft: 44, paddingTop: idx === 0 ? 0 : 16, paddingBottom: 6, fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>
                      {e.fecha ? new Date(e.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) : 'Sin fecha'}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, paddingBottom: 6 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--at-surface)', border: `2px solid ${cfg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, zIndex: 1, boxShadow: `0 0 0 2px ${cfg.color}22` }}>
                      {cfg.icon}
                    </div>
                    <div style={{ flex: 1, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px', marginBottom: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink)' }}>{e.titulo}</div>
                          {e.subtitulo && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 1 }}>{e.subtitulo}</div>}
                          {e.detalle && <div style={{ fontSize: 11, color: 'var(--at-ink-2)', marginTop: 2 }}>{e.detalle}</div>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 10, fontWeight: 600 }}>{cfg.label}</span>
                          {e.badge && <span style={{ fontSize: 10, color: e.badgeColor ?? 'var(--at-ink-3)', fontWeight: 600 }}>{e.badge}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
          <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--at-line-strong)', cursor: pagina === 1 ? 'default' : 'pointer', background: 'var(--at-surface)', color: pagina === 1 ? 'var(--at-line-strong)' : 'var(--at-ink-2)', fontSize: 12 }}>
            ← Ant.
          </button>
          <span style={{ padding: '6px 14px', fontSize: 12, color: 'var(--at-ink-3)' }}>Pág. {pagina} de {totalPaginas}</span>
          <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--at-line-strong)', cursor: pagina === totalPaginas ? 'default' : 'pointer', background: 'var(--at-surface)', color: pagina === totalPaginas ? 'var(--at-line-strong)' : 'var(--at-ink-2)', fontSize: 12 }}>
            Sig. →
          </button>
        </div>
      )}
    </div>
  )
}
