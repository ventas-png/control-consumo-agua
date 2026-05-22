import { useMemo } from 'react'
import { CuotaCondominio, TicketMantenimiento, GastoCondominio, IncidenteSeguridad } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  gastos: GastoCondominio[]
  incidentes: IncidenteSeguridad[]
  moneda: string
}

function ultimosMeses(n: number): string[] {
  const meses: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    meses.push(d.toISOString().slice(0, 7))
  }
  return meses
}

const MES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function labelMes(ym: string) {
  const [, m] = ym.split('-')
  return MES_LABEL[parseInt(m) - 1]
}

interface BarChartProps {
  datos: { mes: string; val: number }[]
  color: string
  bg: string
  formatVal: (v: number) => string
  height?: number
}

function BarChart({ datos, color, bg: _bg, formatVal, height = 80 }: BarChartProps) {
  const maxVal = Math.max(...datos.map(d => d.val), 1)
  const w = 100 / datos.length

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" height={height} style={{ display: 'block' }}>
        {datos.map((d, i) => {
          const barH = (d.val / maxVal) * (height - 20)
          const x = i * w
          return (
            <g key={d.mes}>
              <rect
                x={`${x + w * 0.1}%`} y={height - 20 - barH}
                width={`${w * 0.8}%`} height={barH}
                rx="3" fill={d.val === 0 ? 'var(--at-line)' : color}
              />
              {d.val > 0 && barH > 14 && (
                <text x={`${x + w / 2}%`} y={height - 23 - barH + 12} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">
                  {formatVal(d.val)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {datos.map(d => (
          <div key={d.mes} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--at-ink-3)' }}>{labelMes(d.mes)}</div>
        ))}
      </div>
      {/* Hover tooltip via title */}
    </div>
  )
}

interface LineChartProps {
  datos: { mes: string; val: number }[]
  color: string
  height?: number
  formatVal: (v: number) => string
}

function LineChart({ datos, color, height = 80, formatVal: _formatVal }: LineChartProps) {
  const maxVal = Math.max(...datos.map(d => d.val), 1)
  const n = datos.length
  if (n < 2) return null

  const pts = datos.map((d, i) => {
    const x = (i / (n - 1)) * 100
    const y = height - 20 - (d.val / maxVal) * (height - 28)
    return { x, y, val: d.val, mes: d.mes }
  })

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area = `${path} L ${pts[pts.length - 1].x} ${height - 20} L 0 ${height - 20} Z`

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#grad-${color.replace('#', '')})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        {datos.map(d => (
          <div key={d.mes} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--at-ink-3)' }}>{labelMes(d.mes)}</div>
        ))}
      </div>
    </div>
  )
}

export default function GraficasTendenciasTab({ cuotas, tickets, gastos, incidentes, moneda }: Props) {
  const meses = useMemo(() => ultimosMeses(12), [])

  const tasaCobro = useMemo(() => meses.map(mes => {
    const del = cuotas.filter(c => c.periodo === mes)
    const pag = del.filter(c => c.estado === 'pagado').length
    return { mes, val: del.length > 0 ? Math.round((pag / del.length) * 100) : 0 }
  }), [cuotas, meses])

  const mora = useMemo(() => meses.map(mes => {
    const val = cuotas.filter(c => c.periodo === mes && (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < mes + '-31').length
    return { mes, val }
  }), [cuotas, meses])

  const gastosM = useMemo(() => meses.map(mes => ({
    mes,
    val: gastos.filter(g => g.fecha?.startsWith(mes)).reduce((s, g) => s + g.monto, 0),
  })), [gastos, meses])

  const ticketsM = useMemo(() => meses.map(mes => ({
    mes,
    val: tickets.filter(t => t.created_at?.startsWith(mes)).length,
  })), [tickets, meses])

  const incidentesM = useMemo(() => meses.map(mes => ({
    mes,
    val: incidentes.filter(i => i.fecha?.startsWith(mes)).length,
  })), [incidentes, meses])

  const promedioTasa = Math.round(tasaCobro.reduce((s, d) => s + d.val, 0) / tasaCobro.length)
  const totalGastos12 = gastosM.reduce((s, d) => s + d.val, 0)
  const totalTickets12 = ticketsM.reduce((s, d) => s + d.val, 0)
  const totalIncidentes12 = incidentesM.reduce((s, d) => s + d.val, 0)

  const tendenciaTasa = tasaCobro[11].val - tasaCobro[0].val
  const tendenciaGastos = gastosM[11].val - gastosM[10].val

  type Card = { titulo: string; subtitulo: string; color: string; bg: string; resumen: string; tendencia?: number; tipo: 'bar' | 'line'; datos: { mes: string; val: number }[]; fmt: (v: number) => string }

  const graficas: Card[] = [
    {
      titulo: 'Tasa de cobro mensual', subtitulo: `Promedio 12m: ${promedioTasa}%`,
      color: promedioTasa >= 80 ? 'var(--at-success)' : 'var(--at-warning)', bg: promedioTasa >= 80 ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
      resumen: `${promedioTasa}%`,
      tendencia: tendenciaTasa,
      tipo: 'line', datos: tasaCobro, fmt: v => `${v}%`,
    },
    {
      titulo: 'Cuotas en mora por período', subtitulo: 'Pendientes/morosas al vencer',
      color: 'var(--at-danger)', bg: 'var(--at-danger-tint)',
      resumen: `${mora[11].val} este mes`,
      tipo: 'bar', datos: mora, fmt: v => String(v),
    },
    {
      titulo: `Gastos mensuales (${moneda})`, subtitulo: `Total 12m: ${moneda} ${totalGastos12.toLocaleString('es', { maximumFractionDigits: 0 })}`,
      color: 'var(--at-primary)', bg: 'var(--at-primary-tint)',
      resumen: `${moneda} ${gastosM[11].val.toLocaleString('es', { maximumFractionDigits: 0 })}`,
      tendencia: tendenciaGastos,
      tipo: 'bar', datos: gastosM, fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)),
    },
    {
      titulo: 'Tickets abiertos por mes', subtitulo: `Total 12m: ${totalTickets12} tickets`,
      color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)',
      resumen: `${ticketsM[11].val} este mes`,
      tipo: 'bar', datos: ticketsM, fmt: v => String(v),
    },
    {
      titulo: 'Incidentes de seguridad', subtitulo: `Total 12m: ${totalIncidentes12} incidentes`,
      color: 'var(--at-danger)', bg: 'var(--at-danger-tint)',
      resumen: `${incidentesM[11].val} este mes`,
      tipo: 'bar', datos: incidentesM, fmt: v => String(v),
    },
    {
      titulo: 'Tendencia de cobro (línea)', subtitulo: 'Evolución % cobrado por período',
      color: 'var(--at-primary-hover)', bg: 'var(--at-primary-tint)',
      resumen: tendenciaTasa >= 0 ? `↑ ${tendenciaTasa}pp vs hace 12m` : `↓ ${Math.abs(tendenciaTasa)}pp vs hace 12m`,
      tipo: 'line', datos: tasaCobro, fmt: v => `${v}%`,
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--at-ink)' }}>Tendencias — últimos 12 meses</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 16 }}>Datos actualizados en tiempo real desde el sistema</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {graficas.map(g => (
          <div key={g.titulo} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--at-ink)' }}>{g.titulo}</div>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{g.subtitulo}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: g.color }}>{g.resumen}</div>
                {g.tendencia !== undefined && (
                  <div style={{ fontSize: 10, color: g.tendencia >= 0 ? 'var(--at-success)' : 'var(--at-danger)', fontWeight: 600 }}>
                    {g.tendencia >= 0 ? '↑' : '↓'} {Math.abs(g.tendencia)} vs inicio
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              {g.tipo === 'bar'
                ? <BarChart datos={g.datos} color={g.color} bg={g.bg} formatVal={g.fmt} />
                : <LineChart datos={g.datos} color={g.color} formatVal={g.fmt} />
              }
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, padding: '8px 14px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 11, color: 'var(--at-ink-3)' }}>
        📊 Las gráficas muestran los últimos 12 meses. La tasa de cobro se calcula sobre cuotas del período; los gastos e incidentes sobre fecha de registro.
      </div>
    </div>
  )
}
