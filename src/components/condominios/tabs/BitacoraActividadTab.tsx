import { useMemo, useState } from 'react'
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
  cuota:        { icon: '💳', color: '#1B3B36', bg: '#EEF2EC',  label: 'Cuota' },
  visitante:    { icon: '🚪', color: '#9C5733', bg: '#FAF1EA',  label: 'Visitante' },
  ticket:       { icon: '🔧', color: '#d97706', bg: '#fef3c7',  label: 'Ticket' },
  reserva:      { icon: '🏊', color: '#102622', bg: '#EEF2EC',  label: 'Reserva' },
  anuncio:      { icon: '📢', color: '#16a34a', bg: '#dcfce7',  label: 'Anuncio' },
  conciliacion: { icon: '🔄', color: '#3E5A4C', bg: '#FAF7EF',  label: 'Conciliación' },
  fondo:        { icon: '🏦', color: '#059669', bg: '#d1fae5',  label: 'Fondo' },
  infraccion:   { icon: '⚖️', color: '#ef4444', bg: '#fef2f2',  label: 'Infracción' },
  sugerencia:   { icon: '💡', color: '#f59e0b', bg: '#fffbeb',  label: 'Sugerencia' },
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
      badgeColor: c.estado === 'pagado' ? '#16a34a' : c.estado === 'moroso' ? '#ef4444' : '#d97706',
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
      badgeColor: t.prioridad === 'urgente' ? '#ef4444' : t.prioridad === 'alta' ? '#d97706' : '#7E9389',
    }))

    reservas.forEach(r => list.push({
      id: `res-${r.id}`, tipo: 'reserva',
      titulo: `Reserva: ${r.amenidad_nombre ?? 'Amenidad'}`,
      detalle: `${r.fecha} ${r.hora_inicio}–${r.hora_fin} · ${r.estado}`,
      fecha: fechaEvento(r.created_at),
      unidad: r.unidad_nombre,
      badge: r.estado,
      badgeColor: r.estado === 'confirmada' ? '#16a34a' : r.estado === 'cancelada' ? '#ef4444' : '#d97706',
    }))

    anuncios.forEach(a => list.push({
      id: `anun-${a.id}`, tipo: 'anuncio',
      titulo: a.titulo,
      detalle: a.tipo,
      fecha: fechaEvento(a.created_at),
      badge: a.tipo,
      badgeColor: a.tipo === 'urgente' ? '#ef4444' : '#16a34a',
    }))

    conciliaciones.forEach(c => list.push({
      id: `conc-${c.id}`, tipo: 'conciliacion',
      titulo: `Conciliación de cuota`,
      detalle: `Recibido ${moneda} ${c.monto_recibido.toFixed(2)} · ${c.estado}`,
      fecha: fechaEvento(c.fecha_pago),
      badge: c.estado,
      badgeColor: c.estado === 'conciliado' ? '#16a34a' : '#ef4444',
    }))

    fondoReservaMovs.forEach(m => list.push({
      id: `fondo-${m.id}`, tipo: 'fondo',
      titulo: m.concepto,
      detalle: `${m.tipo} · ${moneda} ${m.monto.toFixed(2)}`,
      fecha: fechaEvento(m.fecha),
      badge: m.tipo,
      badgeColor: m.tipo === 'retiro' ? '#ef4444' : '#16a34a',
    }))

    infracciones.forEach(i => list.push({
      id: `inf-${i.id}`, tipo: 'infraccion',
      titulo: `Infracción: ${i.tipo}`,
      detalle: i.descripcion.slice(0, 80),
      fecha: fechaEvento(i.fecha_infraccion),
      unidad: i.unidad_nombre,
      badge: i.estado,
      badgeColor: i.estado === 'resuelta' ? '#16a34a' : i.estado === 'anulada' ? '#7E9389' : '#ef4444',
    }))

    sugerencias.forEach(s => list.push({
      id: `sug-${s.id}`, tipo: 'sugerencia',
      titulo: s.titulo,
      detalle: `${s.categoria} · ${s.estado}`,
      fecha: fechaEvento(s.created_at),
      unidad: s.unidad_nombre,
      badge: s.estado,
      badgeColor: s.estado === 'respondida' ? '#16a34a' : '#d97706',
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
      <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F', marginBottom: 2 }}>Bitácora de Actividad</div>
      <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 14 }}>
        {eventos.length.toLocaleString('es')} eventos registrados en el sistema
      </div>

      {/* Filtros de tipo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={() => { setFiltro('todos'); setPagina(0) }}
          style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--at-line-strong)', fontSize: 11, cursor: 'pointer',
            background: filtro === 'todos' ? '#15291F' : '#FAF7EF', color: filtro === 'todos' ? '#fff' : '#3E5A4C', fontWeight: filtro === 'todos' ? 700 : 400 }}>
          Todos ({eventos.length})
        </button>
        {TODOS.map(t => {
          const cfg = TIPO_CFG[t]
          const activo = filtro === t
          return (
            <button key={t} onClick={() => { setFiltro(t); setPagina(0) }}
              style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${cfg.color}44`, fontSize: 11, cursor: 'pointer',
                background: activo ? cfg.color : cfg.bg, color: activo ? '#fff' : cfg.color, fontWeight: activo ? 700 : 400 }}>
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
      <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
        {pagActual.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#7E9389', fontSize: 12 }}>Sin eventos.</div>
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#15291F' }}>{ev.titulo}</span>
                    {ev.badge && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: ev.badgeColor ?? '#7E9389', background: `${ev.badgeColor}1a`, padding: '1px 6px', borderRadius: 10, border: `1px solid ${ev.badgeColor}33` }}>
                        {ev.badge}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#7E9389', marginTop: 1 }}>
                    {ev.detalle}
                    {ev.unidad && <span style={{ marginLeft: 6, color: cfg.color, fontWeight: 600 }}>· {ev.unidad}</span>}
                  </div>
                </div>
                {/* Fecha */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#7E9389' }}>{ev.fecha}</div>
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
          <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: pagina === 0 ? 'not-allowed' : 'pointer', background: '#fff', opacity: pagina === 0 ? 0.4 : 1 }}>
            ‹ Ant.
          </button>
          <span style={{ fontSize: 11, color: '#7E9389' }}>Pág. {pagina + 1} / {paginas} · {filtrados.length} eventos</span>
          <button onClick={() => setPagina(p => Math.min(paginas - 1, p + 1))} disabled={pagina === paginas - 1}
            style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: pagina === paginas - 1 ? 'not-allowed' : 'pointer', background: '#fff', opacity: pagina === paginas - 1 ? 0.4 : 1 }}>
            Sig. ›
          </button>
        </div>
      )}
    </div>
  )
}
