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
    if (max === 0 || val === 0) return '#f1f5f9'
    const pct = val / max
    if (pct > 0.75) return '#16a34a'
    if (pct > 0.5)  return '#65a30d'
    if (pct > 0.25) return '#ca8a04'
    return '#fde68a'
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>Utilización de Amenidades</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
        {amenidades.length} amenidades · {reservas.length} reservas totales
      </div>

      {amenidades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
          No hay amenidades configuradas.
        </div>
      ) : (
        <>
          {/* Ranking rápido */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>Ranking de Uso</div>
            {stats.map(s => (
              <div key={s.am.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.am.nombre}</span>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b' }}>
                    <span>✅ {s.confirmadas} conf.</span>
                    <span style={{ color: '#ef4444' }}>❌ {s.canceladas} canc.</span>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{s.total} total</span>
                  </div>
                </div>
                <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4 }}>
                  <div style={{ height: 8, borderRadius: 4, width: `${(s.total / maxTotal) * 100}%`,
                    background: s.total === maxTotal ? '#2563eb' : '#93c5fd' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Cards por amenidad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {stats.map(s => (
              <div key={s.am.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 2 }}>{s.am.nombre}</div>
                {s.am.capacidad_max && (
                  <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 10 }}>Capacidad máx: {s.am.capacidad_max} · Horario: {s.am.horario_inicio ?? '—'}–{s.am.horario_fin ?? '—'}</div>
                )}

                {/* KPIs de la amenidad */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Reservas', val: String(s.total), color: '#2563eb', bg: '#eff6ff' },
                    { label: 'Tasa cancel.', val: `${Math.round(s.tasaCancelacion * 100)}%`, color: s.tasaCancelacion > 0.2 ? '#ef4444' : '#16a34a', bg: s.tasaCancelacion > 0.2 ? '#fef2f2' : '#dcfce7' },
                    { label: 'Invitados', val: String(s.totalInvitados), color: '#7c3aed', bg: '#f5f3ff' },
                    ...(s.depositos > 0 ? [{ label: 'Depósitos', val: `${moneda} ${s.depositos.toLocaleString('es')}`, color: '#16a34a', bg: '#dcfce7' }] : []),
                  ].map(k => (
                    <div key={k.label} style={{ flex: '1 1 70px', background: k.bg, borderRadius: 8, padding: '6px 10px', border: `1px solid ${k.color}22` }}>
                      <div style={{ fontSize: 9, color: '#6b7280' }}>{k.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: k.color }}>{k.val}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>
                  📍 Día pico: {DIAS_SEMANA[s.diaPico]} · ⏰ Hora pico: {s.horaPico}
                </div>

                {/* Heatmap días de semana */}
                <div style={{ fontWeight: 600, fontSize: 10, color: '#64748b', marginBottom: 4 }}>Reservas por día de semana</div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  {DIAS_SEMANA.map((d, i) => (
                    <div key={d} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ height: 32, borderRadius: 4, background: heatmapColor(s.porDia[i], maxPorDia),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, color: s.porDia[i] > 0 ? '#374151' : '#d1d5db' }}>
                        {s.porDia[i] > 0 ? s.porDia[i] : ''}
                      </div>
                      <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>{d}</div>
                    </div>
                  ))}
                </div>

                {/* Heatmap horas */}
                {Object.keys(s.porHora).length > 0 && (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 10, color: '#64748b', marginBottom: 4 }}>Por hora de inicio</div>
                    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {Object.entries(s.porHora).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, cnt]) => (
                        <div key={h} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                          background: heatmapColor(cnt as number, Math.max(...Object.values(s.porHora))),
                          color: '#374151' }}>
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
