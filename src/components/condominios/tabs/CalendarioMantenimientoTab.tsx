import { useState, useMemo } from 'react'
import { TicketMantenimiento, ReservaAmenidad, PlanMantenimiento, InspeccionNormativa, VencimientoExtra } from '../../../types'

interface Props {
  tickets: TicketMantenimiento[]
  reservas: ReservaAmenidad[]
  planesMantenimiento: PlanMantenimiento[]
  inspecciones: InspeccionNormativa[]
  vencimientosExtra: VencimientoExtra[]
}

interface Evento {
  fecha: string
  tipo: 'ticket' | 'reserva' | 'plan' | 'inspeccion' | 'vencimiento'
  label: string
  color: string
  bg: string
}

const TIPO_CFG = {
  ticket:      { color: '#ef4444', bg: '#fef2f2',  icon: '🔧', label: 'Ticket' },
  reserva:     { color: '#1B3B36', bg: '#EEF2EC',  icon: '📅', label: 'Reserva' },
  plan:        { color: '#16a34a', bg: '#dcfce7',  icon: '🗓️', label: 'Plan manto.' },
  inspeccion:  { color: '#d97706', bg: '#fef3c7',  icon: '🔍', label: 'Inspección' },
  vencimiento: { color: '#9C5733', bg: '#FAF1EA',  icon: '⚠️', label: 'Vencimiento' },
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export default function CalendarioMantenimientoTab({ tickets, reservas, planesMantenimiento, inspecciones, vencimientosExtra }: Props) {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth()) // 0-indexed
  const [filtros, setFiltros] = useState<Set<Evento['tipo']>>(new Set(['ticket', 'reserva', 'plan', 'inspeccion', 'vencimiento']))
  const [diaDetalle, setDiaDetalle] = useState<string | null>(null)

  function toggleFiltro(tipo: Evento['tipo']) {
    setFiltros(prev => {
      const next = new Set(prev)
      next.has(tipo) ? next.delete(tipo) : next.add(tipo)
      return next
    })
  }

  const eventos: Evento[] = useMemo(() => {
    const list: Evento[] = []

    tickets.forEach(t => {
      const fecha = t.fecha_limite ?? t.created_at?.slice(0, 10)
      if (fecha) list.push({ fecha: fecha.slice(0, 10), tipo: 'ticket', label: t.titulo, color: TIPO_CFG.ticket.color, bg: TIPO_CFG.ticket.bg })
    })

    reservas.forEach(r => {
      list.push({ fecha: r.fecha, tipo: 'reserva', label: `${r.amenidad_nombre ?? 'Amenidad'} — ${r.hora_inicio}`, color: TIPO_CFG.reserva.color, bg: TIPO_CFG.reserva.bg })
    })

    planesMantenimiento.forEach(p => {
      const fecha = p.proxima_ejecucion ?? p.created_at?.slice(0, 10)
      if (fecha) list.push({ fecha: fecha.slice(0, 10), tipo: 'plan', label: p.equipo, color: TIPO_CFG.plan.color, bg: TIPO_CFG.plan.bg })
    })

    inspecciones.forEach(i => {
      if (i.fecha_proxima) list.push({ fecha: i.fecha_proxima, tipo: 'inspeccion', label: String(i.tipo), color: TIPO_CFG.inspeccion.color, bg: TIPO_CFG.inspeccion.bg })
    })

    vencimientosExtra.forEach(v => {
      list.push({ fecha: v.fecha_vencimiento, tipo: 'vencimiento', label: v.titulo, color: TIPO_CFG.vencimiento.color, bg: TIPO_CFG.vencimiento.bg })
    })

    return list
  }, [tickets, reservas, planesMantenimiento, inspecciones, vencimientosExtra])

  const eventosFiltrados = useMemo(() =>
    eventos.filter(e => filtros.has(e.tipo))
  , [eventos, filtros])

  const eventosPorDia = useMemo(() => {
    const map: Record<string, Evento[]> = {}
    eventosFiltrados.forEach(e => {
      if (!map[e.fecha]) map[e.fecha] = []
      map[e.fecha].push(e)
    })
    return map
  }, [eventosFiltrados])

  // Calendar grid
  const primerDia = new Date(anio, mes, 1).getDay()
  const diasEnMes = new Date(anio, mes + 1, 0).getDate()
  const celdas: (number | null)[] = [
    ...Array(primerDia).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ]
  while (celdas.length % 7 !== 0) celdas.push(null)

  function navMes(delta: number) {
    const d = new Date(anio, mes + delta, 1)
    setAnio(d.getFullYear())
    setMes(d.getMonth())
    setDiaDetalle(null)
  }

  function fechaDia(dia: number): string {
    return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  }

  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  const detalleEventos = diaDetalle ? (eventosPorDia[diaDetalle] ?? []) : []

  const totalMes = useMemo(() => {
    const prefix = `${anio}-${String(mes + 1).padStart(2, '0')}`
    return eventosFiltrados.filter(e => e.fecha.startsWith(prefix)).length
  }, [eventosFiltrados, anio, mes])

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F' }}>Calendario de Mantenimiento</div>
          <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>{totalMes} evento{totalMes !== 1 ? 's' : ''} este mes</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navMes(-1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #C7C2B0', background: '#fff', cursor: 'pointer', fontSize: 14 }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#15291F', minWidth: 140, textAlign: 'center' }}>{MESES[mes]} {anio}</span>
          <button onClick={() => navMes(1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #C7C2B0', background: '#fff', cursor: 'pointer', fontSize: 14 }}>›</button>
          <button onClick={() => { setAnio(hoy.getFullYear()); setMes(hoy.getMonth()); setDiaDetalle(null) }}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #C7C2B0', background: '#fff', cursor: 'pointer', fontSize: 12 }}>
            Hoy
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {(Object.entries(TIPO_CFG) as [Evento['tipo'], typeof TIPO_CFG[keyof typeof TIPO_CFG]][]).map(([tipo, cfg]) => {
          const activo = filtros.has(tipo)
          return (
            <button key={tipo} onClick={() => toggleFiltro(tipo)}
              style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${cfg.color}44`, fontSize: 11, cursor: 'pointer',
                background: activo ? cfg.bg : '#FAF7EF',
                color: activo ? cfg.color : '#7E9389', fontWeight: activo ? 600 : 400 }}>
              {cfg.icon} {cfg.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: diaDetalle ? '1fr 280px' : '1fr', gap: 14 }}>
        {/* Calendario */}
        <div style={{ background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, overflow: 'hidden' }}>
          {/* Días semana header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#FAF7EF' }}>
            {DIAS_SEMANA.map(d => (
              <div key={d} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#7E9389' }}>{d}</div>
            ))}
          </div>

          {/* Celdas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {celdas.map((dia, i) => {
              const fecha = dia ? fechaDia(dia) : ''
              const evs = dia ? (eventosPorDia[fecha] ?? []) : []
              const esHoy = fecha === hoyStr
              const seleccionado = fecha === diaDetalle
              return (
                <div key={i}
                  onClick={() => dia && setDiaDetalle(seleccionado ? null : fecha)}
                  style={{
                    minHeight: 72, padding: '4px 6px', borderTop: '1px solid #EAE6D8',
                    borderRight: (i + 1) % 7 !== 0 ? '1px solid #EAE6D8' : undefined,
                    background: seleccionado ? '#EEF2EC' : esHoy ? '#fefce8' : dia ? '#fff' : '#FAF7EF',
                    cursor: dia ? 'pointer' : 'default',
                  }}>
                  {dia && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: esHoy ? 800 : 500,
                        width: 22, height: 22, borderRadius: '50%',
                        background: esHoy ? '#1B3B36' : undefined,
                        color: esHoy ? '#fff' : '#3E5A4C',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                        {dia}
                      </div>
                      {evs.slice(0, 3).map((ev, j) => (
                        <div key={j} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 4, background: ev.bg,
                          color: ev.color, marginBottom: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 600 }}>
                          {ev.label}
                        </div>
                      ))}
                      {evs.length > 3 && (
                        <div style={{ fontSize: 9, color: '#7E9389', paddingLeft: 4 }}>+{evs.length - 3} más</div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Panel de detalle */}
        {diaDetalle && (
          <div style={{ background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F' }}>
                {new Date(diaDetalle + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <button onClick={() => setDiaDetalle(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#7E9389' }}>×</button>
            </div>
            {detalleEventos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#7E9389', fontSize: 12 }}>Sin eventos</div>
            ) : (
              detalleEventos.map((ev, i) => {
                const cfg = TIPO_CFG[ev.tipo]
                return (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10,
                    padding: '8px 10px', background: ev.bg, borderRadius: 8, border: `1px solid ${ev.color}22` }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>{cfg.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: ev.color }}>{cfg.label}</div>
                      <div style={{ fontSize: 12, color: '#3E5A4C', marginTop: 2 }}>{ev.label}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Leyenda de conteos del mes */}
      <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(Object.entries(TIPO_CFG) as [Evento['tipo'], typeof TIPO_CFG[keyof typeof TIPO_CFG]][]).map(([tipo, cfg]) => {
          const prefix = `${anio}-${String(mes + 1).padStart(2, '0')}`
          const count = eventosFiltrados.filter(e => e.tipo === tipo && e.fecha.startsWith(prefix)).length
          if (count === 0) return null
          return (
            <span key={tipo} style={{ padding: '4px 12px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 600 }}>
              {cfg.icon} {cfg.label}: {count}
            </span>
          )
        })}
      </div>
    </div>
  )
}
