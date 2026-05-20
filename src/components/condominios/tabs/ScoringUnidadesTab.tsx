import { useMemo } from 'react'
import { CuotaCondominio, InfraccionCondominio, SancionCondominio, Unidad } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  infracciones: InfraccionCondominio[]
  sanciones: SancionCondominio[]
  unidades: Unidad[]
  moneda: string
}

interface ScoreUnidad {
  unidad: Unidad
  score: number
  grado: 'A' | 'B' | 'C' | 'D'
  cuotasPagadas: number
  cuotasMorosas: number
  infracciones: number
  sancionesVigentes: number
  detalle: string[]
}

function calcScore(
  unidad: Unidad,
  cuotas: CuotaCondominio[],
  infracciones: InfraccionCondominio[],
  sanciones: SancionCondominio[],
  hoy: string
): ScoreUnidad {
  const cuotasU = cuotas.filter(c => c.unidad_id === unidad.id)
  const pagadas = cuotasU.filter(c => c.estado === 'pagado').length
  const morosas = cuotasU.filter(c => (c.estado === 'moroso' || c.estado === 'pendiente') && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
  const infraccionesU = infracciones.filter(i => i.unidad_id === unidad.id)
  const sancionesU = sanciones.filter(s => s.unidad_id === unidad.id && s.estado !== 'pagado' && s.estado !== 'anulado')

  let score = 100
  const detalle: string[] = []

  // Cuotas pagadas: hasta +20 bonus (pero no suben de 100)
  const bonus = Math.min(pagadas * 2, 20)
  if (bonus > 0) detalle.push(`+${bonus} cuotas al día`)

  // Cuotas morosas: -8 c/u
  if (morosas.length > 0) {
    score -= morosas.length * 8
    detalle.push(`-${morosas.length * 8} mora (${morosas.length} cuotas)`)
  }

  // Infracciones: -10 c/u
  if (infraccionesU.length > 0) {
    score -= infraccionesU.length * 10
    detalle.push(`-${infraccionesU.length * 10} infracciones`)
  }

  // Sanciones vigentes: -12 c/u
  if (sancionesU.length > 0) {
    score -= sancionesU.length * 12
    detalle.push(`-${sancionesU.length * 12} sanciones vigentes`)
  }

  score = Math.max(0, Math.min(100, score))
  const grado: 'A' | 'B' | 'C' | 'D' = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'

  return {
    unidad, score, grado,
    cuotasPagadas: pagadas,
    cuotasMorosas: morosas.length,
    infracciones: infraccionesU.length,
    sancionesVigentes: sancionesU.length,
    detalle,
  }
}

const GRADO_CFG = {
  A: { color: '#16a34a', bg: '#dcfce7', label: 'Excelente' },
  B: { color: '#65a30d', bg: '#ecfccb', label: 'Bueno' },
  C: { color: '#d97706', bg: '#fef3c7', label: 'Regular' },
  D: { color: '#ef4444', bg: '#fef2f2', label: 'Riesgo alto' },
}

export default function ScoringUnidadesTab({ cuotas, infracciones, sanciones, unidades, moneda }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)

  const scores = useMemo(() =>
    unidades
      .map(u => calcScore(u, cuotas, infracciones, sanciones, hoy))
      .sort((a, b) => a.score - b.score),
    [unidades, cuotas, infracciones, sanciones, hoy]
  )

  const distribucion = useMemo(() => ({
    A: scores.filter(s => s.grado === 'A').length,
    B: scores.filter(s => s.grado === 'B').length,
    C: scores.filter(s => s.grado === 'C').length,
    D: scores.filter(s => s.grado === 'D').length,
  }), [scores])

  const promedio = scores.length > 0 ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0
  const enRiesgo = distribucion.C + distribucion.D
  const montoEnRiesgo = scores
    .filter(s => s.grado === 'C' || s.grado === 'D')
    .reduce((sum, s) => sum + cuotas.filter(c => c.unidad_id === s.unidad.id && c.estado !== 'pagado').reduce((ss, c) => ss + c.monto, 0), 0)

  if (unidades.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: '#7E9389', paddingTop: 60 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🎯</div>
        No hay unidades en este proyecto
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: '#EEF2EC', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#102622' }}>{promedio}</div>
          <div style={{ fontSize: 11, color: '#102622', fontWeight: 600 }}>Puntaje promedio del condominio</div>
        </div>
        <div style={{ background: '#dcfce7', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a' }}>{distribucion.A + distribucion.B}</div>
          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Unidades grado A / B</div>
        </div>
        <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{enRiesgo}</div>
          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Unidades en riesgo (C / D)</div>
        </div>
        <div style={{ background: '#fff7ed', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#ea580c' }}>{moneda} {montoEnRiesgo.toLocaleString('es', { maximumFractionDigits: 0 })}</div>
          <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 600 }}>Monto en riesgo (C / D)</div>
        </div>
      </div>

      {/* Distribución */}
      <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Distribución de puntajes</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {(['A', 'B', 'C', 'D'] as const).map(g => {
            const cfg = GRADO_CFG[g]
            const n = distribucion[g]
            return (
              <div key={g} style={{ background: cfg.bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 900, color: cfg.color }}>{g}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: cfg.color }}>{n}</div>
                <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
                <div style={{ fontSize: 10, color: '#7E9389' }}>
                  {g === 'A' ? '80–100' : g === 'B' ? '60–79' : g === 'C' ? '40–59' : '0–39'} pts
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Ranking */}
      <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Ranking completo — de mayor a menor riesgo</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {scores.map((s, i) => {
            const cfg = GRADO_CFG[s.grado]
            return (
              <div key={s.unidad.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#FAF7EF', borderRadius: 8 }}>
                <div style={{ width: 22, color: '#7E9389', fontSize: 11, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: cfg.color, flexShrink: 0 }}>{s.grado}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#15291F' }}>{s.unidad.nombre}</div>
                  <div style={{ fontSize: 10, color: '#7E9389' }}>
                    {s.detalle.length > 0 ? s.detalle.join(' · ') : 'Sin observaciones'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: cfg.color }}>{s.score}</div>
                  <div style={{ fontSize: 10, color: '#7E9389' }}>pts</div>
                </div>
                {/* Mini barra */}
                <div style={{ width: 60, background: '#E1DDD0', borderRadius: 4, height: 6, flexShrink: 0 }}>
                  <div style={{ height: '100%', background: cfg.color, width: `${s.score}%`, borderRadius: 4 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: 12, padding: '10px 14px', background: '#FAF7EF', borderRadius: 8, fontSize: 11, color: '#7E9389' }}>
        Algoritmo: base 100 pts · −8 por cuota morosa · −10 por infracción · −12 por sanción vigente. El puntaje se actualiza en tiempo real con los datos del sistema.
        <span style={{ display: 'none' }}>{moneda}</span>
      </div>
    </div>
  )
}
