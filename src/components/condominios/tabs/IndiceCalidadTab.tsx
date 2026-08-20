import { hoyLocalISO, mesLocalISO, sumarDiasCalendario } from '../../../lib/format'
import { useMemo } from 'react'
import {
  CuotaCondominio, TicketMantenimiento, IncidenteSeguridad,
  Encuesta, PolizaSeguro, ContratoProveedor, PlanMantenimiento,
  SugerenciaCondominio, Unidad,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  incidentes: IncidenteSeguridad[]
  encuestas: Encuesta[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  planesMantenimiento: PlanMantenimiento[]
  sugerencias: SugerenciaCondominio[]
  unidades: Unidad[]
  moneda: string
}

function mesActual() { return mesLocalISO() }
function hace30Dias() { return sumarDiasCalendario(hoyLocalISO(), -30) ?? hoyLocalISO() }
function hoy() { return hoyLocalISO() }

function semaforo(score: number): { color: string; bg: string; label: string; emoji: string } {
  if (score >= 80) return { color: 'var(--at-success)', bg: 'var(--at-success-tint)', label: 'Excelente', emoji: '🟢' }
  if (score >= 60) return { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', label: 'Regular',   emoji: '🟡' }
  return              { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', label: 'Deficiente', emoji: '🔴' }
}

interface SubIndice {
  nombre: string
  descripcion: string
  score: number
  peso: number
  componentes: { label: string; valor: string; positivo: boolean }[]
}

export default function IndiceCalidadTab({ cuotas, tickets, incidentes, encuestas, polizas, contratosProveedores, planesMantenimiento, sugerencias, unidades }: Props) {
  const mes = mesActual()
  const h30 = hace30Dias()
  const hd = hoy()

  const subIndices: SubIndice[] = useMemo(() => {
    // ── 1. COBRO (30 pts) ────────────────────────────────────────────────────
    const cuotasMes = cuotas.filter(c => c.periodo === mes)
    const tasaCobro = cuotasMes.length > 0
      ? Math.round((cuotasMes.filter(c => c.estado === 'pagado').length / cuotasMes.length) * 100)
      : 0
    const morosos = cuotas.filter(c => c.estado === 'moroso').length
    const scoreCobro = Math.max(0, Math.round(tasaCobro * 0.8 + (morosos === 0 ? 20 : Math.max(0, 20 - morosos * 2))))

    // ── 2. MANTENIMIENTO (25 pts) ────────────────────────────────────────────
    const ticketsAbiertos = tickets.filter(t => t.estado === 'abierto').length
    const ticketsUrgentes = tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado' && t.estado !== 'resuelto').length
    const planesVencidos = planesMantenimiento.filter(p => p.proxima_ejecucion && p.proxima_ejecucion < hd).length
    const ticketScore = Math.max(0, 50 - ticketsAbiertos * 4 - ticketsUrgentes * 8)
    const planScore = Math.max(0, 50 - planesVencidos * 10)
    const scoreManto = Math.round((ticketScore + planScore) / 100 * 100)

    // ── 3. SEGURIDAD (20 pts) ────────────────────────────────────────────────
    const incidentes30 = incidentes.filter(i => i.fecha && i.fecha >= h30).length
    const polizasVencidas = polizas.filter(p => p.fecha_vencimiento && p.fecha_vencimiento < hd).length
    const incScore = Math.max(0, 70 - incidentes30 * 10)
    const polScore = Math.max(0, 30 - polizasVencidas * 10)
    const scoreSeguridad = Math.round((incScore + polScore) / 100 * 100)

    // ── 4. SATISFACCIÓN (15 pts) ─────────────────────────────────────────────
    const encuestasActivas = encuestas.filter(e => e.estado === 'activa').length
    const sugAbiertas = sugerencias.filter(s => s.estado === 'pendiente' || s.estado === 'en_revision').length
    const encScore = encuestasActivas > 0 ? 60 : 20
    const sugScore = Math.max(0, 40 - sugAbiertas * 5)
    const scoreSatisfaccion = Math.round((encScore + sugScore) / 100 * 100)

    // ── 5. CUMPLIMIENTO (10 pts) ─────────────────────────────────────────────
    const contratosVencidos = contratosProveedores.filter(c => c.estado === 'vencido').length
    const unidadesSinDatos = unidades.filter(u => !u.nombre).length
    const contScore = Math.max(0, 60 - contratosVencidos * 15)
    const datScore = Math.max(0, 40 - unidadesSinDatos * 5)
    const scoreCumplimiento = Math.round((contScore + datScore) / 100 * 100)

    return [
      {
        nombre: 'Cobro de cuotas',
        descripcion: 'Tasa de cobro del período + control de morosos',
        score: scoreCobro,
        peso: 30,
        componentes: [
          { label: `Tasa de cobro (${mes})`, valor: `${tasaCobro}%`, positivo: tasaCobro >= 80 },
          { label: 'Unidades morosas', valor: String(morosos), positivo: morosos === 0 },
          { label: 'Cuotas pendientes período actual', valor: String(cuotasMes.filter(c => c.estado === 'pendiente').length), positivo: false },
        ],
      },
      {
        nombre: 'Mantenimiento',
        descripcion: 'Tickets abiertos, urgentes y planes vencidos',
        score: scoreManto,
        peso: 25,
        componentes: [
          { label: 'Tickets abiertos', valor: String(ticketsAbiertos), positivo: ticketsAbiertos === 0 },
          { label: 'Urgentes sin resolver', valor: String(ticketsUrgentes), positivo: ticketsUrgentes === 0 },
          { label: 'Planes vencidos', valor: String(planesVencidos), positivo: planesVencidos === 0 },
        ],
      },
      {
        nombre: 'Seguridad',
        descripcion: 'Incidentes en 30 días + pólizas vigentes',
        score: scoreSeguridad,
        peso: 20,
        componentes: [
          { label: 'Incidentes (últimos 30d)', valor: String(incidentes30), positivo: incidentes30 === 0 },
          { label: 'Pólizas vencidas', valor: String(polizasVencidas), positivo: polizasVencidas === 0 },
          { label: 'Pólizas vigentes', valor: String(polizas.filter(p => p.estado === 'vigente').length), positivo: true },
        ],
      },
      {
        nombre: 'Satisfacción',
        descripcion: 'Encuestas activas + sugerencias pendientes',
        score: scoreSatisfaccion,
        peso: 15,
        componentes: [
          { label: 'Encuestas activas', valor: String(encuestasActivas), positivo: encuestasActivas > 0 },
          { label: 'Sugerencias abiertas', valor: String(sugAbiertas), positivo: sugAbiertas === 0 },
          { label: 'Sugerencias respondidas', valor: String(sugerencias.filter(s => s.estado === 'respondida' || s.estado === 'archivada').length), positivo: true },
        ],
      },
      {
        nombre: 'Cumplimiento',
        descripcion: 'Contratos vigentes + datos completos',
        score: scoreCumplimiento,
        peso: 10,
        componentes: [
          { label: 'Contratos vencidos', valor: String(contratosVencidos), positivo: contratosVencidos === 0 },
          { label: 'Contratos activos', valor: String(contratosProveedores.filter(c => c.estado === 'activo').length), positivo: true },
          { label: 'Unidades registradas', valor: String(unidades.length), positivo: true },
        ],
      },
    ]
  }, [cuotas, tickets, incidentes, encuestas, polizas, contratosProveedores, planesMantenimiento, sugerencias, unidades, mes, h30, hd])

  const scoreGlobal = useMemo(() =>
    Math.round(subIndices.reduce((sum, s) => sum + (s.score * s.peso) / 100, 0)),
    [subIndices]
  )

  const semGlobal = semaforo(scoreGlobal)

  // Gauge SVG
  const gaugeAngle = (scoreGlobal / 100) * 180
  const r = 60
  const cx = 80, cy = 80
  const x1 = cx + r * Math.cos(Math.PI)
  const y1 = cy + r * Math.sin(Math.PI)
  const x2 = cx + r * Math.cos((gaugeAngle / 180) * Math.PI + Math.PI)
  const y2 = cy + r * Math.sin((gaugeAngle / 180) * Math.PI + Math.PI)
  const largeArc = gaugeAngle > 90 ? 1 : 0

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 4 }}>Índice de Calidad Operativa</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 16 }}>Score compuesto ponderado de 5 dimensiones clave</div>

      {/* Score global */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ background: semGlobal.bg, border: `2px solid ${semGlobal.color}`, borderRadius: 16, padding: '20px 32px', textAlign: 'center', minWidth: 160 }}>
          <svg width="160" height="90" viewBox="0 0 160 90" style={{ display: 'block', margin: '0 auto' }}>
            <path d={`M ${x1} ${y1} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`} fill="none" stroke="var(--at-line)" strokeWidth="12" strokeLinecap="round" />
            {scoreGlobal > 0 && (
              <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`} fill="none" stroke={semGlobal.color} strokeWidth="12" strokeLinecap="round" />
            )}
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="26" fontWeight="800" fill={semGlobal.color}>{scoreGlobal}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--at-ink-3)">/ 100</text>
          </svg>
          <div style={{ fontSize: 16, fontWeight: 800, color: semGlobal.color }}>{semGlobal.emoji} {semGlobal.label}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>Score global</div>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          {subIndices.map(s => {
            const sem = semaforo(s.score)
            const barW = `${s.score}%`
            return (
              <div key={s.nombre} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)' }}>{s.nombre}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: sem.color }}>{s.score}/100 <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>×{s.peso}%</span></span>
                </div>
                <div style={{ background: 'var(--at-chip)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                  <div style={{ height: 10, borderRadius: 6, width: barW, background: sem.color, transition: 'width 0.4s' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {subIndices.map(s => {
          const sem = semaforo(s.score)
          return (
            <div key={s.nombre} style={{ background: 'var(--at-surface)', border: `1px solid ${sem.color}33`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)' }}>{s.nombre}</div>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{s.descripcion}</div>
                </div>
                <div style={{ background: sem.bg, color: sem.color, borderRadius: 8, padding: '4px 10px', fontWeight: 800, fontSize: 16 }}>{s.score}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {s.componentes.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: i < s.componentes.length - 1 ? '1px solid var(--at-chip)' : undefined }}>
                    <span style={{ color: 'var(--at-ink-3)' }}>{c.label}</span>
                    <span style={{ fontWeight: 700, color: c.positivo ? 'var(--at-success)' : 'var(--at-danger)' }}>{c.valor}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 14, padding: '8px 14px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 11, color: 'var(--at-ink-3)' }}>
        ℹ️ El índice es calculado en tiempo real sobre los datos actuales. Pesos: Cobro 30% · Mantenimiento 25% · Seguridad 20% · Satisfacción 15% · Cumplimiento 10%.
      </div>
    </div>
  )
}
