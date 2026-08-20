import { useMemo, useState } from 'react'
import type {
  BloqueTurno, TareaBloque, RevisionTarea,
  RondaSeguridad, VisitaControl, PersonalCondominio,
} from '../../../types'
import { hoyLocalISO, sumarDiasCalendario, diaLocalDeInstante } from '../../../lib/format'

interface Props {
  bloques:       BloqueTurno[]
  tareas:        TareaBloque[]
  revisiones:    RevisionTarea[]
  rondas:        RondaSeguridad[]
  visitasControl: VisitaControl[]
  personal:      PersonalCondominio[]
}

type Periodo = '7' | '30' | '90'

function scoreColor(s: number): string {
  if (s >= 90) return 'var(--at-success)'
  if (s >= 70) return 'var(--at-warning)'
  return 'var(--at-danger)'
}

function scoreBg(s: number): string {
  if (s >= 90) return 'var(--at-success-tint)'
  if (s >= 70) return 'var(--at-warning-tint)'
  return 'var(--at-danger-tint)'
}

function medalla(rank: number): string {
  if (rank === 0) return '🥇'
  if (rank === 1) return '🥈'
  if (rank === 2) return '🥉'
  return `#${rank + 1}`
}

export function DesempenoPersonalTab({ bloques, tareas, revisiones, rondas, visitasControl, personal }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('30')
  const [filtroCargo, setFiltroCargo] = useState('')

  // Corte de calendario: `bloques.fecha` es una columna `date`, así que el
  // límite debe ser un día LOCAL. Con `toISOString().slice(0,10)` era el día
  // UTC y en GMT-6 recortaba el período por una punta.
  const cutoff = useMemo(
    () => sumarDiasCalendario(hoyLocalISO(), -parseInt(periodo)) ?? hoyLocalISO(),
    [periodo],
  )

  const bloquesEnPeriodo = useMemo(() =>
    bloques.filter(b => b.fecha >= cutoff), [bloques, cutoff])

  // `rondas_seguridad.inicio` es timestamptz, no una fecha de calendario:
  // `slice(0, 10)` tomaba su día UTC y en GMT-6 una ronda de la noche entraba
  // en el período por el día equivocado. Se compara por su día LOCAL.
  // (`bloques.fecha` sí es `date` y se compara tal cual, arriba.)
  const rondasEnPeriodo = useMemo(
    () => rondas.filter(r => (diaLocalDeInstante(r.inicio) ?? '') >= cutoff),
    [rondas, cutoff],
  )

  const cargos = useMemo(() => {
    const set = new Set(personal.map(p => p.cargo))
    return Array.from(set).sort()
  }, [personal])

  const stats = useMemo(() => {
    return personal
      .filter(p => p.estado !== 'inactivo')
      .filter(p => !filtroCargo || p.cargo === filtroCargo)
      .map(p => {
        const misBloques = bloquesEnPeriodo.filter(b => b.personal_id === p.id)
        const cerrados   = misBloques.filter(b => b.estado === 'completado' || b.estado === 'incompleto')
        const completados = misBloques.filter(b => b.estado === 'completado')
        const puntajes   = cerrados.map(b => b.puntaje_completitud ?? 0).filter(n => n > 0)
        const avgScore   = puntajes.length ? Math.round(puntajes.reduce((a, n) => a + n, 0) / puntajes.length) : 0

        // tareas de sus bloques
        const bloqueIds = new Set(misBloques.map(b => b.id))
        const misTareas = tareas.filter(t => bloqueIds.has(t.bloque_id))
        const tareaCompletadas = misTareas.filter(t => t.estado === 'completada').length
        const tareaObservacion = misTareas.filter(t => t.estado === 'con_observacion').length
        const tareaOmitidas    = misTareas.filter(t => t.estado === 'omitida').length

        // revisiones de sus tareas
        const tareaIds = new Set(misTareas.map(t => t.id))
        const misRevisiones = revisiones.filter(r => tareaIds.has(r.tarea_id))
        const aprobadas  = misRevisiones.filter(r => r.estado === 'aprobado').length
        const rechazadas = misRevisiones.filter(r => r.estado === 'rechazado').length
        const tasaAprobacion = misRevisiones.length ? Math.round(aprobadas / misRevisiones.length * 100) : null

        // rondas (guardia)
        const misRondas = rondasEnPeriodo.filter(r => r.guardia_id === p.id)
        const rondasCompletadas = misRondas.filter(r => r.estado === 'completada').length

        // visitas de control de sus rondas
        const rondaIds = new Set(misRondas.map(r => r.id))
        const misVisitas  = visitasControl.filter(v => rondaIds.has(v.ronda_id))
        const visitasOk   = misVisitas.filter(v => v.estado === 'ok').length
        const visitasNov  = misVisitas.filter(v => v.estado === 'novedad').length

        return {
          persona: p,
          bloquesTotal: misBloques.length,
          bloquesCompletados: completados.length,
          bloquesCerrados: cerrados.length,
          avgScore,
          tareaTotal: misTareas.length,
          tareaCompletadas,
          tareaObservacion,
          tareaOmitidas,
          aprobadas,
          rechazadas,
          tasaAprobacion,
          rondasTotal: misRondas.length,
          rondasCompletadas,
          visitasOk,
          visitasNov,
          tieneActividad: misBloques.length > 0 || misRondas.length > 0,
        }
      })
      .filter(s => s.tieneActividad)
      .sort((a, b) => {
        const sa = a.avgScore || (a.rondasCompletadas > 0 ? Math.round(a.rondasCompletadas / Math.max(a.rondasTotal, 1) * 100) : 0)
        const sb = b.avgScore || (b.rondasCompletadas > 0 ? Math.round(b.rondasCompletadas / Math.max(b.rondasTotal, 1) * 100) : 0)
        return sb - sa
      })
  }, [personal, filtroCargo, bloquesEnPeriodo, tareas, revisiones, rondasEnPeriodo, visitasControl])

  const totalBloques    = bloquesEnPeriodo.filter(b => b.estado === 'completado' || b.estado === 'incompleto').length
  const avgGlobal       = stats.length ? Math.round(stats.reduce((a, s) => a + s.avgScore, 0) / stats.length) : 0
  const rondasTotal     = rondasEnPeriodo.length

  return (
    <div>
      {/* Header + filtros */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 3px', fontSize: '17px', fontWeight: 800, color: 'var(--at-ink)' }}>Desempeño del Personal</h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>Rendimiento por colaborador en el período seleccionado</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(['7', '30', '90'] as Periodo[]).map(p => (
            <button key={p} onClick={() => setPeriodo(p)}
              style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid',
                borderColor: periodo === p ? 'var(--at-primary)' : 'var(--at-line)',
                background: periodo === p ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                color: periodo === p ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
              {p === '7' ? 'Última semana' : p === '30' ? 'Último mes' : 'Últimos 3 meses'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Personal activo',      value: String(stats.length),           color: 'var(--at-primary)' },
          { label: 'Puntaje promedio',      value: avgGlobal ? `${avgGlobal}%` : '—', color: scoreColor(avgGlobal) },
          { label: 'Turnos evaluados',      value: String(totalBloques),            color: 'var(--at-primary-hover)' },
          { label: 'Rondas realizadas',     value: String(rondasTotal),             color: 'var(--at-accent-hover)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ fontSize: '24px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginTop: '2px' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtro cargo */}
      {cargos.length > 1 && (
        <div style={{ marginBottom: '16px', display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          <button onClick={() => setFiltroCargo('')}
            style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid',
              borderColor: !filtroCargo ? 'var(--at-primary)' : 'var(--at-line)',
              background: !filtroCargo ? 'var(--at-primary-tint)' : 'var(--at-surface)',
              color: !filtroCargo ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            Todos los cargos
          </button>
          {cargos.map(c => (
            <button key={c} onClick={() => setFiltroCargo(c)}
              style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: '1.5px solid',
                borderColor: filtroCargo === c ? 'var(--at-primary)' : 'var(--at-line)',
                background: filtroCargo === c ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                color: filtroCargo === c ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
              {c.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {stats.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '42px', marginBottom: '12px' }}>📊</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)', fontSize: '14px' }}>Sin datos de desempeño en este período</p>
          <p style={{ fontSize: '13px' }}>Los datos aparecen una vez que el personal registre turnos o rondas.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {stats.map((s, i) => {
            const score = s.avgScore || (s.rondasTotal > 0 ? Math.round(s.rondasCompletadas / s.rondasTotal * 100) : 0)
            return (
              <div key={s.persona.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${i < 3 ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '14px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* Rank + nombre */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '200px', flex: 1 }}>
                    <div style={{ fontSize: '24px', flexShrink: 0 }}>{typeof medalla(i) === 'string' && medalla(i).startsWith('#') ? <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '8px', padding: '4px 8px' }}>{medalla(i)}</span> : medalla(i)}</div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-ink)' }}>{s.persona.nombre}</div>
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '1px' }}>{s.persona.cargo.replace(/_/g, ' ')} · Turno {s.persona.turno}</div>
                    </div>
                  </div>

                  {/* Score */}
                  {score > 0 && (
                    <div style={{ background: scoreBg(score), border: `1.5px solid ${scoreColor(score)}33`, borderRadius: '12px', padding: '10px 18px', textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontSize: '26px', fontWeight: 900, color: scoreColor(score), lineHeight: 1 }}>{score}%</div>
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>puntaje</div>
                    </div>
                  )}

                  {/* Métricas */}
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', flex: 2 }}>
                    {s.bloquesCerrados > 0 && (
                      <div style={{ minWidth: '110px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Turnos</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>✅ {s.bloquesCompletados}</span>
                          {s.bloquesCerrados > s.bloquesCompletados && <span style={{ fontSize: '12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>⚠ {s.bloquesCerrados - s.bloquesCompletados}</span>}
                        </div>
                      </div>
                    )}
                    {s.tareaTotal > 0 && (
                      <div style={{ minWidth: '140px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Tareas ({s.tareaTotal})</div>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>✅ {s.tareaCompletadas}</span>
                          {s.tareaObservacion > 0 && <span style={{ fontSize: '12px', background: 'var(--at-warning-tint)', color: 'var(--at-warning)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>⚠ {s.tareaObservacion}</span>}
                          {s.tareaOmitidas > 0 && <span style={{ fontSize: '12px', background: 'var(--at-surface-2)', color: 'var(--at-ink-3)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>⏭ {s.tareaOmitidas}</span>}
                        </div>
                      </div>
                    )}
                    {s.tasaAprobacion !== null && (
                      <div style={{ minWidth: '110px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Revisión admin</div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <span style={{ fontSize: '12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>👍 {s.aprobadas}</span>
                          {s.rechazadas > 0 && <span style={{ fontSize: '12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>👎 {s.rechazadas}</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: scoreColor(s.tasaAprobacion), marginTop: '3px', fontWeight: 700 }}>{s.tasaAprobacion}% aprobación</div>
                      </div>
                    )}
                    {s.rondasTotal > 0 && (
                      <div style={{ minWidth: '110px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Rondas</div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <span style={{ fontSize: '12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>✅ {s.rondasCompletadas}</span>
                          {s.rondasTotal > s.rondasCompletadas && <span style={{ fontSize: '12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', borderRadius: '6px', padding: '2px 7px', fontWeight: 700 }}>❌ {s.rondasTotal - s.rondasCompletadas}</span>}
                        </div>
                        {(s.visitasOk + s.visitasNov) > 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px' }}>
                            {s.visitasOk} pts ok · {s.visitasNov > 0 ? `${s.visitasNov} novedades` : '0 novedades'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {score > 0 && (
                  <div style={{ marginTop: '12px', background: 'var(--at-chip)', borderRadius: '6px', height: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${score}%`, height: '100%', background: `linear-gradient(90deg,${scoreColor(score)},${scoreColor(score)}aa)`, borderRadius: '6px', transition: 'width 0.6s ease' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
