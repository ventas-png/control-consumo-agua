import { useMemo, useState, type ReactNode} from 'react'
import type {
  CuotaCondominio, GastoCondominio, TicketMantenimiento, PresupuestoCondominio,
  Visitante, NovedadSeguridad, RondaSeguridad, AnuncioComunidad,
  ReservaAmenidad, BloqueTurno, TareaBloque, Unidad,
} from '../../../types'

interface Props {
  cuotas:        CuotaCondominio[]
  gastos:        GastoCondominio[]
  tickets:       TicketMantenimiento[]
  presupuestos:  PresupuestoCondominio[]
  visitantes:    Visitante[]
  novedades:     NovedadSeguridad[]
  rondas:        RondaSeguridad[]
  anuncios:      AnuncioComunidad[]
  reservas:      ReservaAmenidad[]
  bloques:       BloqueTurno[]
  tareas:        TareaBloque[]
  unidades:      Unidad[]
  moneda:        string
  proyectoNombre?: string
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

function pct(a: number, b: number): string { return b === 0 ? '—' : `${Math.round(a / b * 100)}%` }

function KpiBox({ label, value, sub, color = 'var(--at-ink)', bg = 'var(--at-surface)', border = 'var(--at-line)' }: { label: string; value: string; sub?: string; color?: string; bg?: string; border?: string }) {
  return (
    <div style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: '10px', padding: '13px 15px' }}>
      <div style={{ fontSize: '20px', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginTop: '3px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', paddingBottom: '8px', borderBottom: '2px solid var(--at-line)' }}>
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--at-ink)' }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

export function ReporteConsolidadoTab({
  cuotas, gastos, tickets, presupuestos,
  visitantes, novedades, rondas,
  anuncios, reservas, bloques, tareas,
  unidades, moneda, proyectoNombre,
}: Props) {
  const hoy     = new Date()
  const [mes, setMes]   = useState(hoy.getMonth())
  const [anio, setAnio] = useState(hoy.getFullYear())

  const periodo = useMemo(() => {
    const desde = `${anio}-${String(mes + 1).padStart(2, '0')}-01`
    const hasta  = new Date(anio, mes + 1, 0).toISOString().slice(0, 10)
    return { desde, hasta, label: `${MESES[mes]} ${anio}` }
  }, [mes, anio])

  // ── Financiero ────────────────────────────────────────────────────────────
  const cuotasPeriodo  = cuotas.filter(c => (c.fecha_vencimiento ?? c.created_at.slice(0,10)) >= periodo.desde && (c.fecha_vencimiento ?? c.created_at.slice(0,10)) <= periodo.hasta)
  const cobrado        = cuotasPeriodo.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const pendiente      = cuotasPeriodo.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
  const morosos        = cuotasPeriodo.filter(c => c.estado === 'moroso').length
  const gastosPeriodo  = gastos.filter(g => g.fecha >= periodo.desde && g.fecha <= periodo.hasta)
  const totalGastos    = gastosPeriodo.reduce((s, g) => s + g.monto, 0)
  const gastosXCat     = gastosPeriodo.reduce<Record<string, number>>((acc, g) => { acc[g.categoria] = (acc[g.categoria] ?? 0) + g.monto; return acc }, {})
  const presupuestoPeriodo = presupuestos.filter(p => p.anio === anio).reduce((s, p) => s + p.monto_presupuestado, 0) / 12

  // ── Mantenimiento ─────────────────────────────────────────────────────────
  const ticketsPeriodo = tickets.filter(t => t.created_at.slice(0,10) >= periodo.desde && t.created_at.slice(0,10) <= periodo.hasta)
  const ticketsCerrados = ticketsPeriodo.filter(t => t.estado === 'resuelto' || t.estado === 'cerrado')
  const ticketsAbiertos = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso')
  const ticketsUrgentes = ticketsPeriodo.filter(t => t.prioridad === 'urgente' || t.prioridad === 'alta')
  const tiempoResolucion = ticketsCerrados.filter(t => t.fecha_cierre).map(t => {
    const dias = Math.ceil((new Date(t.fecha_cierre!).getTime() - new Date(t.created_at).getTime()) / 86400000)
    return dias
  })
  const avgResolucion = tiempoResolucion.length ? Math.round(tiempoResolucion.reduce((a, n) => a + n, 0) / tiempoResolucion.length) : 0

  // ── Personal / Turnos ─────────────────────────────────────────────────────
  const bloquesPeriodo    = bloques.filter(b => b.fecha >= periodo.desde && b.fecha <= periodo.hasta)
  const bloquesCerrados   = bloquesPeriodo.filter(b => b.estado === 'completado' || b.estado === 'incompleto')
  const puntajes          = bloquesCerrados.map(b => b.puntaje_completitud ?? 0).filter(n => n > 0)
  const avgPuntaje        = puntajes.length ? Math.round(puntajes.reduce((a, n) => a + n, 0) / puntajes.length) : 0
  const bloqueIds         = new Set(bloquesPeriodo.map(b => b.id))
  const tareasPeriodo     = tareas.filter(t => bloqueIds.has(t.bloque_id))
  const tareasCompletadas = tareasPeriodo.filter(t => t.estado === 'completada').length

  // ── Seguridad ─────────────────────────────────────────────────────────────
  const rondasPeriodo     = rondas.filter(r => r.inicio.slice(0,10) >= periodo.desde && r.inicio.slice(0,10) <= periodo.hasta)
  const rondasCompletadas = rondasPeriodo.filter(r => r.estado === 'completada').length
  const visitantesPeriodo = visitantes.filter(v => v.hora_entrada.slice(0,10) >= periodo.desde && v.hora_entrada.slice(0,10) <= periodo.hasta)
  const novedadesPeriodo  = novedades.filter(n => n.created_at.slice(0,10) >= periodo.desde && n.created_at.slice(0,10) <= periodo.hasta)

  // ── Comunidad ─────────────────────────────────────────────────────────────
  const anunciosPeriodo   = anuncios.filter(a => a.created_at.slice(0,10) >= periodo.desde && a.created_at.slice(0,10) <= periodo.hasta)
  const reservasPeriodo   = reservas.filter(r => r.fecha >= periodo.desde && r.fecha <= periodo.hasta && r.estado !== 'cancelada')
  const reservasCanceladas = reservas.filter(r => r.fecha >= periodo.desde && r.fecha <= periodo.hasta && r.estado === 'cancelada').length

  // ── Ocupación ─────────────────────────────────────────────────────────────
  const totalUnidades     = unidades.length
  const ocupadas          = unidades.filter(u => u.estado_ocupacional === 'habitado').length
  const tasaOcupacion     = totalUnidades ? Math.round(ocupadas / totalUnidades * 100) : 0

  function imprimir() {
    window.print()
  }

  const aniosDisp = Array.from({ length: 3 }, (_, i) => hoy.getFullYear() - i)

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px', flexWrap: 'wrap', gap: '12px' }} className="no-print">
        <div>
          <h2 style={{ margin: '0 0 3px', fontSize: '17px', fontWeight: 800, color: 'var(--at-ink)' }}>Reporte Ejecutivo Consolidado</h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>Vista integrada de todos los módulos del condominio</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={mes} onChange={e => setMes(parseInt(e.target.value))}
            style={{ padding: '7px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface-2)', fontWeight: 600 }}>
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={anio} onChange={e => setAnio(parseInt(e.target.value))}
            style={{ padding: '7px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface-2)', fontWeight: 600 }}>
            {aniosDisp.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={imprimir}
            style={{ padding: '7px 16px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
            🖨️ Imprimir / PDF
          </button>
        </div>
      </div>

      {/* Reporte */}
      <div id="reporte-ejecutivo">
        {/* Encabezado imprimible */}
        <div style={{ background: 'linear-gradient(135deg,var(--at-ink-deep),var(--at-primary-hover))', borderRadius: '16px', padding: '22px 26px', marginBottom: '26px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '13px', opacity: 0.75, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Informe Ejecutivo Mensual</div>
            <div style={{ fontSize: '24px', fontWeight: 900, marginTop: '4px' }}>{proyectoNombre ?? 'Condominio'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '22px', fontWeight: 800 }}>{periodo.label}</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>Generado: {new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>

        {/* 1. Resumen general */}
        <Section title="Resumen General" icon="📊">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px,1fr))', gap: '10px' }}>
            <KpiBox label="Unidades totales"   value={String(totalUnidades)} sub={`${ocupadas} ocupadas`} />
            <KpiBox label="Tasa ocupación"     value={`${tasaOcupacion}%`} color={tasaOcupacion > 85 ? '#16a34a' : '#d97706'} />
            <KpiBox label="Cobrado"             value={fmt(cobrado, moneda)} color='#16a34a' bg='#f0fdf4' border='#86efac' />
            <KpiBox label="Pendiente"           value={fmt(pendiente, moneda)} color={pendiente > 0 ? '#dc2626' : '#16a34a'} bg={pendiente > 0 ? '#fef2f2' : '#f0fdf4'} border={pendiente > 0 ? '#fecaca' : '#86efac'} />
            <KpiBox label="Tickets abiertos"   value={String(ticketsAbiertos.length)} color={ticketsAbiertos.length > 5 ? '#dc2626' : '#d97706'} />
            <KpiBox label="Rondas realizadas"  value={String(rondasCompletadas)} sub={`de ${rondasPeriodo.length}`} />
          </div>
        </Section>

        {/* 2. Financiero */}
        <Section title="Financiero" icon="💰">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px,1fr))', gap: '10px', marginBottom: '14px' }}>
            <KpiBox label="Cobrado período"      value={fmt(cobrado, moneda)}    color='#16a34a' bg='#f0fdf4' border='#86efac' />
            <KpiBox label="Pendiente período"    value={fmt(pendiente, moneda)}  color={pendiente > 0 ? '#dc2626' : '#16a34a'} />
            <KpiBox label="Cuotas morosas"       value={String(morosos)}          color={morosos > 0 ? '#dc2626' : '#16a34a'} />
            <KpiBox label="Total gastos"         value={fmt(totalGastos, moneda)} color='#9C5733' />
            <KpiBox label="Ppto. mensual est."   value={presupuestoPeriodo > 0 ? fmt(presupuestoPeriodo, moneda) : '—'} sub='Pro-rata anual' />
            <KpiBox label="% Cobrado vs ppto."   value={presupuestoPeriodo > 0 ? pct(cobrado, presupuestoPeriodo) : '—'} color={cobrado >= presupuestoPeriodo ? '#16a34a' : '#dc2626'} />
          </div>
          {Object.keys(gastosXCat).length > 0 && (
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>Gastos por categoría</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                {Object.entries(gastosXCat).sort((a,b) => b[1]-a[1]).map(([cat, monto]) => (
                  <div key={cat} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '8px', padding: '5px 10px', fontSize: '12px' }}>
                    <span style={{ color: 'var(--at-ink-3)' }}>{cat.replace(/_/g, ' ')}: </span>
                    <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{fmt(monto, moneda)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* 3. Mantenimiento */}
        <Section title="Mantenimiento" icon="🔧">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px,1fr))', gap: '10px' }}>
            <KpiBox label="Tickets abiertos"   value={String(ticketsPeriodo.length)}    sub='en el período' />
            <KpiBox label="Resueltos"          value={String(ticketsCerrados.length)}   color='#16a34a' bg='#f0fdf4' border='#86efac' sub={pct(ticketsCerrados.length, ticketsPeriodo.length) + ' resolución'} />
            <KpiBox label="Alta/Urgente"       value={String(ticketsUrgentes.length)}   color={ticketsUrgentes.length > 0 ? '#dc2626' : '#16a34a'} />
            <KpiBox label="Aún abiertos"       value={String(ticketsAbiertos.length)}   color={ticketsAbiertos.length > 3 ? '#dc2626' : '#d97706'} sub='acumulados' />
            <KpiBox label="Tiempo prom. res."  value={avgResolucion > 0 ? `${avgResolucion}d` : '—'} sub='días hábiles' />
          </div>
        </Section>

        {/* 4. Personal & Operaciones */}
        <Section title="Personal & Operaciones" icon="👥">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px,1fr))', gap: '10px' }}>
            <KpiBox label="Turnos registrados" value={String(bloquesPeriodo.length)} />
            <KpiBox label="Turnos evaluados"   value={String(bloquesCerrados.length)} sub={pct(bloquesCerrados.length, bloquesPeriodo.length) + ' evaluados'} />
            <KpiBox label="Puntaje promedio"   value={avgPuntaje > 0 ? `${avgPuntaje}%` : '—'} color={avgPuntaje >= 90 ? '#16a34a' : avgPuntaje >= 70 ? '#d97706' : '#dc2626'} />
            <KpiBox label="Tareas completadas" value={String(tareasCompletadas)} sub={`de ${tareasPeriodo.length} asignadas`} />
            <KpiBox label="% completitud"      value={tareasPeriodo.length ? pct(tareasCompletadas, tareasPeriodo.length) : '—'} color={tareasCompletadas / Math.max(tareasPeriodo.length,1) >= 0.9 ? '#16a34a' : '#d97706'} />
          </div>
        </Section>

        {/* 5. Seguridad */}
        <Section title="Seguridad & Accesos" icon="🛡️">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px,1fr))', gap: '10px' }}>
            <KpiBox label="Rondas realizadas"   value={String(rondasPeriodo.length)} />
            <KpiBox label="Rondas completadas"  value={String(rondasCompletadas)} color='#16a34a' bg='#f0fdf4' border='#86efac' sub={pct(rondasCompletadas, rondasPeriodo.length)} />
            <KpiBox label="Visitantes"          value={String(visitantesPeriodo.length)} sub='registrados' />
            <KpiBox label="Novedades"           value={String(novedadesPeriodo.length)} color={novedadesPeriodo.length > 3 ? '#dc2626' : novedadesPeriodo.length > 0 ? '#d97706' : '#16a34a'} />
          </div>
        </Section>

        {/* 6. Comunidad */}
        <Section title="Comunidad & Amenidades" icon="🏘️">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px,1fr))', gap: '10px' }}>
            <KpiBox label="Anuncios publicados"  value={String(anunciosPeriodo.length)} />
            <KpiBox label="Reservas realizadas"  value={String(reservasPeriodo.length)} sub={`${reservasCanceladas} canceladas`} />
            <KpiBox label="Uso de amenidades"    value={reservasPeriodo.length > 0 ? `${reservasPeriodo.length}` : '—'} color='#9C5733' />
          </div>
        </Section>

        {/* Footer */}
        <div style={{ borderTop: '1.5px solid var(--at-line)', paddingTop: '14px', marginTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--at-ink-3)', flexWrap: 'wrap', gap: '6px' }}>
          <span>Reporte: {periodo.label} — {proyectoNombre ?? 'Condominio'}</span>
          <span>Generado automáticamente · {new Date().toLocaleString('es')}</span>
        </div>
      </div>
    </div>
  )
}
