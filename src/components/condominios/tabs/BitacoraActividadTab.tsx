import { useMemo, useState } from 'react'
import { Button } from '../../shared/Button'
import {
  CuotaCondominio, Visitante, TicketMantenimiento, ReservaAmenidad,
  AnuncioComunidad, ConciliacionCobrosLog, FondoReservaMovimiento, Unidad,
  InfraccionCondominio, SugerenciaCondominio,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  visitantes: Visitante[]
  tickets: TicketMantenimiento[]
  reservas: ReservaAmenidad[]
  anuncios: AnuncioComunidad[]
  conciliaciones: ConciliacionCobrosLog[]
  fondoReservaMovs: FondoReservaMovimiento[]
  infracciones: InfraccionCondominio[]
  sugerencias: SugerenciaCondominio[]
  unidades: Unidad[]
  moneda: string
}

type TipoEvento = 'cuota' | 'visitante' | 'ticket' | 'reserva' | 'anuncio' | 'conciliacion' | 'fondo' | 'infraccion' | 'sugerencia'

interface Evento {
  id: string
  tipo: TipoEvento
  titulo: string
  detalle: string
  fecha: string
  unidad?: string
  badge?: string
  badgeColor?: string
}

const TIPO_CFG: Record<TipoEvento, { icon: string; color: string; bg: string; label: string }> = {
  cuota:        { icon: '💳', color: 'var(--at-primary)', bg: 'var(--at-primary-tint)',  label: 'Cuota' },
  visitante:    { icon: '🚪', color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)',  label: 'Visitante' },
  ticket:       { icon: '🔧', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)',  label: 'Ticket' },
  reserva:      { icon: '🏊', color: 'var(--at-primary-hover)', bg: 'var(--at-primary-tint)',  label: 'Reserva' },
  anuncio:      { icon: '📢', color: 'var(--at-success)', bg: 'var(--at-success-tint)',  label: 'Anuncio' },
  conciliacion: { icon: '🔄', color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)',  label: 'Conciliación' },
  fondo:        { icon: '🏦', color: 'var(--at-success-strong)', bg: 'var(--at-success-tint)',  label: 'Fondo' },
  infraccion:   { icon: '⚖️', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)',  label: 'Infracción' },
  sugerencia:   { icon: '💡', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)',  label: 'Sugerencia' },
}

const TODOS: TipoEvento[] = ['cuota', 'visitante', 'ticket', 'reserva', 'anuncio', 'conciliacion', 'fondo', 'infraccion', 'sugerencia']

function fechaEvento(iso: string): string {
  return iso.slice(0, 10)
}

export default function BitacoraActividadTab({
  cuotas, visitantes, tickets, reservas, anuncios,
  conciliaciones, fondoReservaMovs, infracciones, sugerencias, moneda,
}: Props) {
  const [filtro, setFiltro] = useState<TipoEvento | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)
  const POR_PAG = 30

  const eventos = useMemo((): Evento[] => {
    const list: Evento[] = []

    cuotas.forEach(c => list.push({
      id: `cuota-${c.id}`, tipo: 'cuota',
      titulo: `Cuota ${c.concepto ?? 'mantenimiento'} — ${c.unidad_nombre ?? ''}`,
      detalle: `${moneda} ${c.monto.toFixed(2)} · ${c.estado}`,
      fecha: fechaEvento(c.created_at),
      unidad: c.unidad_nombre,
      badge: c.estado,
      badgeColor: c.estado === 'pagado' ? 'var(--at-success)' : c.estado === 'moroso' ? 'var(--at-danger)' : 'var(--at-warning)',
    }))

    visitantes.forEach(v => list.push({
      id: `vis-${v.id}`, tipo: 'visitante',
      titulo: `Visitante: ${v.nombre}`,
      detalle: `${v.motivo ?? '—'} · entrada ${v.hora_entrada?.slice(11, 16) ?? ''}`,
      fecha: fechaEvento(v.hora_entrada ?? v.created_at),
      unidad: v.unidad_nombre,
    }))

    tickets.forEach(t => list.push({
      id: `tkt-${t.id}`, tipo: 'ticket',
      titulo: t.titulo,
      detalle: `${t.tipo} · ${t.prioridad} · ${t.estado}`,
      fecha: fechaEvento(t.created_at),
      unidad: t.unidad_nombre,
      badge: t.prioridad,
      badgeColor: t.prioridad === 'urgente' ? 'var(--at-danger)' : t.prioridad === 'alta' ? 'var(--at-warning)' : 'var(--at-ink-3)',
    }))

    reservas.forEach(r => list.push({
      id: `res-${r.id}`, tipo: 'reserva',
      titulo: `Reserva: ${r.amenidad_nombre ?? 'Amenidad'}`,
      detalle: `${r.fecha} ${r.hora_inicio}–${r.hora_fin} · ${r.estado}`,
      fecha: fechaEvento(r.created_at),
      unidad: r.unidad_nombre,
      badge: r.estado,
      badgeColor: r.estado === 'confirmada' ? 'var(--at-success)' : r.estado === 'cancelada' ? 'var(--at-danger)' : 'var(--at-warning)',
    }))

    anuncios.forEach(a => list.push({
      id: `anun-${a.id}`, tipo: 'anuncio',
      titulo: a.titulo,
      detalle: a.tipo,
      fecha: fechaEvento(a.created_at),
      badge: a.tipo,
      badgeColor: a.tipo === 'urgente' ? 'var(--at-danger)' : 'var(--at-success)',
    }))

    conciliaciones.forEach(c => list.push({
      id: `conc-${c.id}`, tipo: 'conciliacion',
      titulo: `Conciliación de cuota`,
      detalle: `Recibido ${moneda} ${c.monto_recibido.toFixed(2)} · ${c.estado}`,
      fecha: fechaEvento(c.fecha_pago),
      badge: c.estado,
      badgeColor: c.estado === 'conciliado' ? 'var(--at-success)' : 'var(--at-danger)',
    }))

    fondoReservaMovs.forEach(m => list.push({
      id: `fondo-${m.id}`, tipo: 'fondo',
      titulo: m.concepto,
      detalle: `${m.tipo} · ${moneda} ${m.monto.toFixed(2)}`,
      fecha: fechaEvento(m.fecha),
      badge: m.tipo,
      badgeColor: m.tipo === 'retiro' ? 'var(--at-danger)' : 'var(--at-success)',
    }))

    infracciones.forEach(i => list.push({
      id: `inf-${i.id}`, tipo: 'infraccion',
      titulo: `Infracción: ${i.tipo}`,
      detalle: i.descripcion.slice(0, 80),
      fecha: fechaEvento(i.fecha_infraccion),
      unidad: i.unidad_nombre,
      badge: i.estado,
      badgeColor: i.estado === 'resuelta' ? 'var(--at-success)' : i.estado === 'anulada' ? 'var(--at-ink-3)' : 'var(--at-danger)',
    }))

    sugerencias.forEach(s => list.push({
      id: `sug-${s.id}`, tipo: 'sugerencia',
      titulo: s.titulo,
      detalle: `${s.categoria} · ${s.estado}`,
      fecha: fechaEvento(s.created_at),
      unidad: s.unidad_nombre,
      badge: s.estado,
      badgeColor: s.estado === 'respondida' ? 'var(--at-success)' : 'var(--at-warning)',
    }))

    return list.sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [cuotas, visitantes, tickets, reservas, anuncios, conciliaciones, fondoReservaMovs, infracciones, sugerencias, moneda])

  const filtrados = useMemo(() => {
    let r = filtro === 'todos' ? eventos : eventos.filter(e => e.tipo === filtro)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      r = r.filter(e => e.titulo.toLowerCase().includes(q) || e.detalle.toLowerCase().includes(q) || (e.unidad ?? '').toLowerCase().includes(q))
    }
    return r
  }, [eventos, filtro, busqueda])

  const paginas = Math.ceil(filtrados.length / POR_PAG)
  const pagActual = filtrados.slice(pagina * POR_PAG, (pagina + 1) * POR_PAG)

  const conteosPorTipo = useMemo(() =>
    TODOS.reduce((acc, t) => { acc[t] = eventos.filter(e => e.tipo === t).length; return acc }, {} as Record<TipoEvento, number>)
  , [eventos])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Bitácora de Actividad</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        {eventos.length.toLocaleString('es')} eventos registrados en el sistema
      </div>

      {/* Filtros de tipo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={() => { setFiltro('todos'); setPagina(0) }}
          style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--at-line-strong)', fontSize: 11, cursor: 'pointer',
            background: filtro === 'todos' ? 'var(--at-ink)' : 'var(--at-surface-2)', color: filtro === 'todos' ? 'white' : 'var(--at-ink-2)', fontWeight: filtro === 'todos' ? 700 : 400 }}>
          Todos ({eventos.length})
        </button>
        {TODOS.map(t => {
          const cfg = TIPO_CFG[t]
          const activo = filtro === t
          return (
            <button key={t} onClick={() => { setFiltro(t); setPagina(0) }}
              style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${cfg.color}44`, fontSize: 11, cursor: 'pointer',
                background: activo ? cfg.color : cfg.bg, color: activo ? 'white' : cfg.color, fontWeight: activo ? 700 : 400 }}>
              {cfg.icon} {cfg.label} ({conteosPorTipo[t]})
            </button>
          )
        })}
      </div>

      {/* Búsqueda */}
      <div style={{ marginBottom: 12 }}>
        <input value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(0) }}
          placeholder="Buscar en bitácora..." style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
      </div>

      {/* Lista de eventos */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
        {pagActual.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin eventos.</div>
        ) : (
          pagActual.map((ev, i) => {
            const cfg = TIPO_CFG[ev.tipo]
            return (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                borderBottom: i < pagActual.length - 1 ? '1px solid var(--at-chip)' : undefined }}>
                {/* Ícono */}
                <div style={{ width: 32, height: 32, borderRadius: 8, background: cfg.bg, border: `1px solid ${cfg.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  {cfg.icon}
                </div>
                {/* Contenido */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)' }}>{ev.titulo}</span>
                    {ev.badge && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: ev.badgeColor ?? 'var(--at-ink-3)', background: `${ev.badgeColor}1a`, padding: '1px 6px', borderRadius: 10, border: `1px solid ${ev.badgeColor}33` }}>
                        {ev.badge}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 1 }}>
                    {ev.detalle}
                    {ev.unidad && <span style={{ marginLeft: 6, color: cfg.color, fontWeight: 600 }}>· {ev.unidad}</span>}
                  </div>
                </div>
                {/* Fecha */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{ev.fecha}</div>
                  <div style={{ fontSize: 9, color: cfg.color, fontWeight: 700, marginTop: 1 }}>{cfg.label}</div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Paginación */}
      {paginas > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center' }}>
          <Button variant="secondary" size="sm" onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0} style={{ padding: '4px 12px', fontSize: 12 }}>
            ‹ Ant.
          </Button>
          <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Pág. {pagina + 1} / {paginas} · {filtrados.length} eventos</span>
          <Button variant="secondary" size="sm" onClick={() => setPagina(p => Math.min(paginas - 1, p + 1))} disabled={pagina === paginas - 1} style={{ padding: '4px 12px', fontSize: 12 }}>
            Sig. ›
          </Button>
        </div>
      )}
    </div>
  )
}
