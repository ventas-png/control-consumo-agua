import { useMemo } from 'react'
import type { RegistroCalidad } from '../../types'
import { serieTendencia } from '../../lib/calidadTendencia'

// serv:S25 — Mini-gráfico de tendencia de cumplimiento (sparkline SVG, mismo
// patrón liviano que GraficasTendenciasTab). Cada punto es un análisis; el color
// del punto indica cumple_total (verde) vs no cumple (rojo).

const HEIGHT = 120

const fmtFecha = (f: string) =>
  new Date(f).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })

export function CalidadTendencia({ registros }: { registros: RegistroCalidad[] }) {
  const serie = useMemo(() => serieTendencia(registros), [registros])
  if (serie.length < 2) return null // hace falta ≥2 puntos para una tendencia

  const n = serie.length
  const pts = serie.map((d, i) => ({
    x: (i / (n - 1)) * 100,
    y: HEIGHT - 24 - (d.pct / 100) * (HEIGHT - 36),
    cumple: d.cumple,
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area = `${path} L ${pts[n - 1].x} ${HEIGHT - 24} L 0 ${HEIGHT - 24} Z`

  return (
    <div style={{ marginBottom: 16, padding: 16, background: 'var(--at-surface-2)', borderRadius: 12, border: '1px solid var(--at-line)' }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
        📈 Tendencia de cumplimiento <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}>({n} análisis)</span>
      </div>
      <svg width="100%" height={HEIGHT} viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" style={{ display: 'block' }} role="img" aria-label={`Tendencia de cumplimiento de calidad, ${n} análisis`}>
        <defs>
          <linearGradient id="grad-calidad-tendencia" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--at-primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--at-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#grad-calidad-tendencia)" />
        <path d={path} fill="none" stroke="var(--at-primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.8" fill={p.cumple ? 'var(--at-success)' : 'var(--at-danger)'} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--at-ink-3)' }}>
        <span>{fmtFecha(serie[0].fecha)}</span>
        <span>{fmtFecha(serie[n - 1].fecha)}</span>
      </div>
    </div>
  )
}
