import { useMemo } from 'react'
import { Amenidad, ReservaAmenidad } from '../../../types'

interface Props {
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  moneda: string
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export default function UtilizacionAmenidadesTab({ amenidades, reservas, moneda }: Props) {
  const stats = useMemo(() => {
    return amenidades.map(am => {
      const rs = reservas.filter(r => r.amenidad_id === am.id)
      const confirmadas = rs.filter(r => r.estado === 'confirmada')
      const canceladas  = rs.filter(r => r.estado === 'cancelada')
      const totalInvitados = rs.reduce((s, r) => s + (r.num_invitados ?? 0), 0)
      const depositos = confirmadas.filter(r => r.deposito_pagado).length * (am.monto_deposito ?? 0)

      // Frecuencia por día de semana
      const porDia = Array(7).fill(0)
      rs.forEach(r => { porDia[new Date(r.fecha + 'T12:00:00').getDay()]++ })

      // Frecuencia por hora (de hora_inicio)
      const porHora: Record<number, number> = {}
      rs.forEach(r => {
        const h = parseInt(r.hora_inicio.slice(0, 2))
        porHora[h] = (porHora[h] ?? 0) + 1
      })

      const diaPico = porDia.indexOf(Math.max(...porDia))
      const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]

      // Tasa de ocupación estimada (reservas confirmadas / días en el último mes con capacidad)
      return {
        am, total: rs.length, confirmadas: confirmadas.length, canceladas: canceladas.length,
        totalInvitados, depositos, porDia, porHora, diaPico,
        horaPico: horaPico ? `${horaPico[0]}:00` : '—',
        tasaCancelacion: rs.length > 0 ? canceladas.length / rs.length : 0,
      }
    }).sort((a, b) => b.total - a.total)
  }, [amenidades, reservas])

  const maxTotal = Math.max(...stats.map(s => s.total), 1)
  const maxPorDia = Math.max(...stats.flatMap(s => s.porDia), 1)

  function heatmapColor(val: number, max: number): string {
    if (max === 0 || val === 0) return 'var(--at-chip)'
    const pct = val / max
    if (pct > 0.75) return 'var(--at-success)'
    if (pct > 0.5)  return '#65a30d'
    if (pct > 0.25) return '#ca8a04'
    return 'var(--at-warning-border)'
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Utilización de Amenidades</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 16 }}>
        {amenidades.length} amenidades · {reservas.length} reservas totales
      </div>

      {amenidades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>
          No hay amenidades configuradas.
        </div>
      ) : (
        <>
          {/* Ranking rápido */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 10 }}>Ranking de Uso</div>
            {stats.map(s => (
              <div key={s.am.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)' }}>{s.am.nombre}</span>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--at-ink-3)' }}>
                    <span>✅ {s.confirmadas} conf.</span>
                    <span style={{ color: 'var(--at-danger)' }}>❌ {s.canceladas} canc.</span>
                    <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{s.total} total</span>
                  </div>
                </div>
                <div style={{ height: 8, background: 'var(--at-chip)', borderRadius: 4 }}>
                  <div style={{ height: 8, borderRadius: 4, width: `${(s.total / maxTotal) * 100}%`,
                    background: s.total === maxTotal ? 'var(--at-primary)' : 'var(--at-accent-2)' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Cards por amenidad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {stats.map(s => (
              <div key={s.am.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)', marginBottom: 2 }}>{s.am.nombre}</div>
                {s.am.capacidad_max && (
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 10 }}>Capacidad máx: {s.am.capacidad_max} · Horario: {s.am.horario_inicio ?? '—'}–{s.am.horario_fin ?? '—'}</div>
                )}

                {/* KPIs de la amenidad */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Reservas', val: String(s.total), color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
                    { label: 'Tasa cancel.', val: `${Math.round(s.tasaCancelacion * 100)}%`, color: s.tasaCancelacion > 0.2 ? 'var(--at-danger)' : 'var(--at-success)', bg: s.tasaCancelacion > 0.2 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)' },
                    { label: 'Invitados', val: String(s.totalInvitados), color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
                    ...(s.depositos > 0 ? [{ label: 'Depósitos', val: `${moneda} ${s.depositos.toLocaleString('es')}`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' }] : []),
                  ].map(k => (
                    <div key={k.label} style={{ flex: '1 1 70px', background: k.bg, borderRadius: 8, padding: '6px 10px', border: `1px solid ${k.color}22` }}>
                      <div style={{ fontSize: 9, color: 'var(--at-ink-3)' }}>{k.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: k.color }}>{k.val}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 8, fontWeight: 600 }}>
                  📍 Día pico: {DIAS_SEMANA[s.diaPico]} · ⏰ Hora pico: {s.horaPico}
                </div>

                {/* Heatmap días de semana */}
                <div style={{ fontWeight: 600, fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Reservas por día de semana</div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  {DIAS_SEMANA.map((d, i) => (
                    <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ height: 32, borderRadius: 4, background: heatmapColor(s.porDia[i], maxPorDia),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, color: s.porDia[i] > 0 ? 'var(--at-ink-2)' : 'var(--at-line-strong)' }}>
                        {s.porDia[i] > 0 ? s.porDia[i] : ''}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--at-ink-3)', marginTop: 2 }}>{d}</div>
                    </div>
                  ))}
                </div>

                {/* Heatmap horas */}
                {Object.keys(s.porHora).length > 0 && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Por hora de inicio</div>
                    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {Object.entries(s.porHora).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, cnt]) => (
                        <div key={h} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                          background: heatmapColor(cnt as number, Math.max(...Object.values(s.porHora))),
                          color: 'var(--at-ink-2)' }}>
                          {h}:00 ({cnt})
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
