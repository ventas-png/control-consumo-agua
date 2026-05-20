import { useMemo } from 'react'
import { Visitante, Unidad } from '../../../types'

interface Props {
  visitantes: Visitante[]
  unidades: Unidad[]
}

const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
const MESES_L = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function labelMes(ym: string): string {
  const [, m] = ym.split('-')
  return MESES_L[parseInt(m) - 1]
}

export default function AnalisisVisitantesTab({ visitantes, unidades }: Props) {
  const stats = useMemo(() => {
    // Horas pico (de hora_entrada)
    const porHora: number[] = Array(24).fill(0)
    const porDiaSemana: number[] = Array(7).fill(0)
    const porUnidad: Record<string, number> = {}
    const porNombre: Record<string, number> = {}
    const porMes: Record<string, number> = {}

    visitantes.forEach(v => {
      if (v.hora_entrada) {
        const d = new Date(v.hora_entrada)
        porHora[d.getHours()]++
        porDiaSemana[d.getDay()]++
        const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        porMes[mes] = (porMes[mes] ?? 0) + 1
      }
      if (v.unidad_id) porUnidad[v.unidad_id] = (porUnidad[v.unidad_id] ?? 0) + 1
      if (v.nombre) {
        const key = v.nombre.trim().toLowerCase()
        porNombre[key] = (porNombre[key] ?? 0) + 1
      }
    })

    const topUnidades = Object.entries(porUnidad)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([uid, cnt]) => ({ uid, nombre: unidades.find(u => u.id === uid)?.nombre ?? uid, cnt }))

    const visitantesFrecuentes = Object.entries(porNombre)
      .filter(([, cnt]) => cnt > 1)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)

    const mesesOrdenados = Object.keys(porMes).sort()
    const tendenciaMes = mesesOrdenados.slice(-6).map(m => ({ mes: m, cnt: porMes[m] }))

    const promDuracion = visitantes
      .filter(v => v.hora_entrada && v.hora_salida)
      .map(v => (new Date(v.hora_salida!).getTime() - new Date(v.hora_entrada).getTime()) / 60000)
      .reduce((s, d, _, arr) => s + d / arr.length, 0)

    const conPlaca = visitantes.filter(v => v.placa_vehiculo).length

    return { porHora, porDiaSemana, topUnidades, visitantesFrecuentes, tendenciaMes, promDuracion, conPlaca }
  }, [visitantes, unidades])

  const maxHora = Math.max(...stats.porHora, 1)
  const maxDia  = Math.max(...stats.porDiaSemana, 1)
  const maxTend = Math.max(...stats.tendenciaMes.map(m => m.cnt), 1)

  function heatColor(val: number, max: number): string {
    if (val === 0) return '#EAE6D8'
    const p = val / max
    if (p > 0.75) return '#102622'
    if (p > 0.5)  return '#1B3B36'
    if (p > 0.25) return '#577B69'
    return '#C2D2CA'
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F', marginBottom: 2 }}>Análisis de Visitantes</div>
      <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 14 }}>
        {visitantes.length} registros de visita
      </div>

      {visitantes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#7E9389', fontSize: 13 }}>Sin registros de visitantes.</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Total visitas', val: String(visitantes.length), color: '#1B3B36', bg: '#EEF2EC' },
              { label: 'Visitantes únicos', val: String(new Set(visitantes.map(v => v.nombre?.toLowerCase())).size), color: '#9C5733', bg: '#FAF1EA' },
              { label: 'Visitas recurrentes', val: String(stats.visitantesFrecuentes.length), color: '#d97706', bg: '#fef3c7' },
              { label: 'Con vehículo', val: String(stats.conPlaca), color: '#16a34a', bg: '#dcfce7' },
              { label: 'Duración prom.', val: stats.promDuracion > 0 ? `${Math.round(stats.promDuracion)} min` : '—', color: '#3E5A4C', bg: '#FAF7EF' },
            ].map(k => (
              <div key={k.label} style={{ flex: '1 1 100px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#7E9389' }}>{k.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {/* Horas pico */}
            <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>Horas de mayor afluencia</div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
                {stats.porHora.map((cnt, h) => (
                  <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '100%', height: `${(cnt / maxHora) * 70}px`, background: heatColor(cnt, maxHora),
                      borderRadius: '2px 2px 0 0', minHeight: cnt > 0 ? 2 : 0 }}
                      title={`${h}:00 — ${cnt} visitas`} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: '#7E9389' }}>
                <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
              <div style={{ fontSize: 11, color: '#7E9389', marginTop: 6 }}>
                Hora pico: <strong>{stats.porHora.indexOf(Math.max(...stats.porHora))}:00</strong> ({Math.max(...stats.porHora)} visitas)
              </div>
            </div>

            {/* Días de semana */}
            <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>Visitas por día de semana</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 80 }}>
                {DIAS.map((d, i) => (
                  <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', height: `${(stats.porDiaSemana[i] / maxDia) * 70}px`,
                      background: heatColor(stats.porDiaSemana[i], maxDia),
                      borderRadius: '3px 3px 0 0', minHeight: stats.porDiaSemana[i] > 0 ? 3 : 0 }}
                      title={`${d}: ${stats.porDiaSemana[i]} visitas`} />
                    <div style={{ fontSize: 10, color: '#7E9389', textAlign: 'center' }}>{d}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#7E9389', marginTop: 4 }}>
                Día pico: <strong>{DIAS[stats.porDiaSemana.indexOf(Math.max(...stats.porDiaSemana))]}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            {/* Tendencia mensual */}
            <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>Tendencia últimos 6 meses</div>
              {stats.tendenciaMes.length === 0 ? (
                <div style={{ fontSize: 12, color: '#7E9389' }}>Sin datos suficientes</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 70 }}>
                    {stats.tendenciaMes.map(m => (
                      <div key={m.mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: '100%', height: `${(m.cnt / maxTend) * 60}px`, background: '#1B3B36', opacity: 0.75, borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    {stats.tendenciaMes.map(m => (
                      <div key={m.mes} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#7E9389' }}>{labelMes(m.mes)}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#1B3B36' }}>{m.cnt}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Top unidades */}
            <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>Unidades más visitadas</div>
              {stats.topUnidades.slice(0, 6).map((u, i) => (
                <div key={u.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#1B3B36', color: '#fff',
                      fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, color: '#3E5A4C' }}>{u.nombre}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1B3B36' }}>{u.cnt}</span>
                </div>
              ))}
            </div>

            {/* Visitantes frecuentes */}
            <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>Visitantes frecuentes</div>
              {stats.visitantesFrecuentes.length === 0 ? (
                <div style={{ fontSize: 12, color: '#7E9389' }}>Sin visitantes recurrentes</div>
              ) : (
                stats.visitantesFrecuentes.slice(0, 6).map(([nombre, cnt], i) => (
                  <div key={nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#3E5A4C', textTransform: 'capitalize', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i === 0 ? '⭐ ' : ''}{nombre}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#9C5733', flexShrink: 0 }}>{cnt} visitas</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
