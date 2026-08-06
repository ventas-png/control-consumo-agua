import { hoyLocalISO } from '../../../lib/format'
import { useMemo } from 'react'
import { CuotaCondominio, Unidad } from '../../../types'
import { useCarteraMorosidadQuery, bandaRiesgo, type BandaRiesgo } from '../../../domain/cobros/morosidad'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  moneda: string
  companyId?: string
  projectId?: string | null
}

const BANDA_META: Record<BandaRiesgo, { label: string; color: string; bg: string }> = {
  alto:  { label: 'Riesgo alto',  color: 'var(--at-danger)',  bg: 'var(--at-danger-tint)' },
  medio: { label: 'Riesgo medio', color: 'var(--at-warning-strong, var(--at-warning))', bg: 'var(--at-warning-tint)' },
  bajo:  { label: 'Riesgo bajo',  color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
}

function diasVencido(fechaVenc: string): number {
  return Math.floor((Date.now() - new Date(fechaVenc).getTime()) / 86400000)
}

export default function AnalisisCarteraTab({ cuotas, unidades, moneda, companyId, projectId }: Props) {
  const hoy = hoyLocalISO()

  const vencidas = cuotas.filter(c =>
    (c.estado === 'pendiente' || c.estado === 'moroso') &&
    c.fecha_vencimiento && c.fecha_vencimiento < hoy
  )

  const buckets = useMemo(() => {
    const b: Record<string, CuotaCondominio[]> = { '1-30': [], '31-60': [], '61-90': [], '+90': [] }
    vencidas.forEach(c => {
      const d = diasVencido(c.fecha_vencimiento!)
      if (d <= 30) b['1-30'].push(c)
      else if (d <= 60) b['31-60'].push(c)
      else if (d <= 90) b['61-90'].push(c)
      else b['+90'].push(c)
    })
    return b
  }, [vencidas])

  const porUnidad = useMemo(() => {
    const map: Record<string, { unidad_nombre: string; monto: number; cuotas: number; maxDias: number }> = {}
    vencidas.forEach(c => {
      const uid = c.unidad_id ?? 'sin_unidad'
      const nombre = c.unidad_nombre ?? unidades.find(u => u.id === uid)?.nombre ?? 'Sin unidad'
      if (!map[uid]) map[uid] = { unidad_nombre: nombre, monto: 0, cuotas: 0, maxDias: 0 }
      map[uid].monto += c.monto ?? 0
      map[uid].cuotas += 1
      map[uid].maxDias = Math.max(map[uid].maxDias, diasVencido(c.fecha_vencimiento!))
    })
    return Object.values(map).sort((a, b) => b.monto - a.monto).slice(0, 15)
  }, [vencidas, unidades])

  const totalVencido = vencidas.reduce((s, c) => s + (c.monto ?? 0), 0)

  const BUCKET_CFG = [
    { key: '1-30',  label: '1 – 30 días',      color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
    { key: '31-60', label: '31 – 60 días',     color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
    { key: '61-90', label: '61 – 90 días',     color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
    { key: '+90',   label: 'Más de 90 días',   color: 'var(--at-danger-strong)', bg: 'var(--at-danger-border)' },
  ] as const

  const maxBucket = Math.max(...BUCKET_CFG.map(b => buckets[b.key].reduce((s, c) => s + (c.monto ?? 0), 0)), 1)

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: 'var(--at-danger-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-danger)' }}>{moneda} {totalVencido.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-danger)', fontWeight: 600 }}>Cartera vencida total</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--at-warning)' }}>{vencidas.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)', fontWeight: 600 }}>Cuotas sin cobrar</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--at-warning)' }}>{porUnidad.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)', fontWeight: 600 }}>Unidades con mora</div>
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--at-success)' }}>
            {cuotas.length > 0 ? Math.round((vencidas.length / cuotas.length) * 100) : 0}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--at-success)', fontWeight: 600 }}>% de cuotas vencidas</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Aging buckets */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Antigüedad de la cartera vencida</div>
          {vencidas.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '30px 0', fontSize: 13 }}>Sin cartera vencida</div>
          ) : BUCKET_CFG.map(b => {
            const monto = buckets[b.key].reduce((s, c) => s + (c.monto ?? 0), 0)
            return (
              <div key={b.key} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '2px 8px', background: b.bg, color: b.color, borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{b.label}</span>
                    <span style={{ color: 'var(--at-ink-3)' }}>{buckets[b.key].length} cuotas</span>
                  </span>
                  <span style={{ fontWeight: 700, color: b.color }}>{moneda} {monto.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ background: 'var(--at-chip)', borderRadius: 4, height: 8 }}>
                  <div style={{ height: '100%', background: b.color, width: `${(monto / maxBucket) * 100}%`, borderRadius: 4 }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Top deudores */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Principales unidades morosas</div>
          {porUnidad.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '30px 0', fontSize: 13 }}>Sin morosidad registrada</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {porUnidad.map((u, i) => (
                <div key={u.unidad_nombre} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--at-surface-2)', borderRadius: 8 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? 'var(--at-danger-tint)' : 'var(--at-chip)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: i < 3 ? 'var(--at-danger)' : 'var(--at-ink-3)', flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.unidad_nombre}</div>
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{u.cuotas} cuotas · {u.maxDias}d máx.</div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--at-danger)', flexShrink: 0 }}>{moneda} {u.monto.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* D2 — Priorización de cobranza por RIESGO (server-side, con score) */}
      <PriorizacionRiesgo companyId={companyId} projectId={projectId} unidades={unidades} moneda={moneda} />
    </div>
  )
}

// ── Panel de priorización por score de morosidad (RPC cartera_morosidad) ──────
function PriorizacionRiesgo({ companyId, projectId, unidades, moneda }: {
  companyId?: string
  projectId?: string | null
  unidades: Unidad[]
  moneda: string
}) {
  const { data: filas = [], isLoading } = useCarteraMorosidadQuery(companyId, projectId)
  const nombreUnidad = useMemo(() => {
    const m = new Map(unidades.map(u => [u.id, u.nombre]))
    return (id: string) => m.get(id) ?? 'Sin unidad'
  }, [unidades])

  if (!companyId) return null

  return (
    <div style={{ marginTop: 16, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Priorización de cobranza por riesgo</div>
        <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>score 0–100 · deuda +90d, atraso y reincidencia</div>
      </div>
      {isLoading ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '24px 0', fontSize: 13 }}>Calculando riesgo…</div>
      ) : filas.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '24px 0', fontSize: 13 }}>Sin unidades en riesgo — cartera al día.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--at-ink-3)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Unidad</th>
                <th style={{ padding: 6 }}>Riesgo</th>
                <th style={{ padding: 6 }}>Vencido</th>
                <th style={{ padding: 6 }}>+90d</th>
                <th style={{ padding: 6 }}>Atraso máx.</th>
                <th style={{ padding: 6 }}>Reincidencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.slice(0, 20).map(f => {
                const banda = BANDA_META[bandaRiesgo(f.score)]
                return (
                  <tr key={f.unidad_id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                    <td style={{ padding: 6, fontWeight: 600, color: 'var(--at-ink)' }}>{nombreUnidad(f.unidad_id)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 800, color: banda.color, background: banda.bg }}>
                        {f.score} · {banda.label.replace('Riesgo ', '')}
                      </span>
                    </td>
                    <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{moneda} {f.total_vencido.toLocaleString('es', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: f.bucket_90_plus > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                      {moneda} {f.bucket_90_plus.toLocaleString('es', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{f.dias_atraso_max}d</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{f.periodos_morosos} períodos</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
