import { useMemo } from 'react'
import { GastoCondominio, Unidad } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  gastos: GastoCondominio[]
  unidades: Unidad[]
  moneda: string
}

const MESES_L = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function ultimosMeses(n: number): { ym: string; label: string }[] {
  const hoy = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (n - 1 - i), 1)
    return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MESES_L[d.getMonth()] }
  })
}

// Categorías de gasto asociadas a servicios/sostenibilidad
const CAT_SOST = ['servicios', 'limpieza', 'obras'] as const
const CAT_CFG: Record<string, { label: string; color: string; bg: string }> = {
  servicios: { label: 'Agua y Energía', color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  limpieza:  { label: 'Limpieza',        color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  obras:     { label: 'Obras / Mejoras', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
}

export default function DashboardSostenibilidadTab({ gastos, unidades, moneda }: Props) {
  const meses = useMemo(() => ultimosMeses(12), [])

  const gastosActivos = useMemo(() => gastos.filter(g => g.estado !== 'anulado'), [gastos])

  type TendenciaMes = { ym: string; label: string; total: number; servicios: number; limpieza: number; obras: number }

  const tendencia = useMemo(() =>
    meses.map(({ ym, label }): TendenciaMes => {
      const porCat = CAT_SOST.reduce((acc, cat) => {
        acc[cat] = gastosActivos.filter(g => g.fecha?.startsWith(ym) && g.categoria === cat).reduce((s, g) => s + g.monto, 0)
        return acc
      }, {} as Record<string, number>)
      const total = Object.values(porCat).reduce((s, v) => s + v, 0)
      return { ym, label, servicios: porCat['servicios'] ?? 0, limpieza: porCat['limpieza'] ?? 0, obras: porCat['obras'] ?? 0, total }
    })
  , [gastosActivos, meses])

  const totales12m = useMemo(() =>
    CAT_SOST.reduce((acc, cat) => {
      acc[cat] = gastosActivos.filter(g => {
        const ym = g.fecha?.slice(0, 7)
        return ym && meses.some(m => m.ym === ym) && g.categoria === cat
      }).reduce((s, g) => s + g.monto, 0)
      return acc
    }, {} as Record<string, number>)
  , [gastosActivos, meses])

  const totalGeneral = Object.values(totales12m).reduce((s, v) => s + v, 0)
  const promMensual  = totalGeneral / 12

  // Índice de eficiencia: costo por unidad activa
  const unidadesActivas = unidades.filter(u => u.activo).length || 1
  const costoUnitario = promMensual / unidadesActivas

  // Tendencia de variación: último mes vs promedio
  const mesActualData = tendencia[tendencia.length - 1]
  const pctVariacion  = promMensual > 0 ? ((mesActualData.total - promMensual) / promMensual) * 100 : 0

  const maxTend = Math.max(...tendencia.map(t => t.total), 1)

  // Huella de carbono estimada (muy simplificada): 0.15 kg CO₂ por Q de servicio
  const co2Estimado = totales12m['servicios'] * 0.15

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Dashboard de Sostenibilidad</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        Basado en gastos de servicios, limpieza y obras — últimos 12 meses
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Gasto total 12m', val: `${moneda} ${totalGeneral.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
          { label: 'Promedio mensual', val: `${moneda} ${Math.round(promMensual).toLocaleString('es')}`, color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)' },
          { label: 'Costo/unidad/mes', val: `${moneda} ${Math.round(costoUnitario).toLocaleString('es')}`, color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
          { label: 'Variación este mes', val: `${pctVariacion >= 0 ? '+' : ''}${pctVariacion.toFixed(1)}%`, color: Math.abs(pctVariacion) < 10 ? 'var(--at-success)' : pctVariacion > 0 ? 'var(--at-danger)' : 'var(--at-success)', bg: Math.abs(pctVariacion) < 10 ? 'var(--at-success-tint)' : pctVariacion > 0 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)' },
          { label: 'CO₂ estimado 12m', val: `${(co2Estimado / 1000).toFixed(2)} ton`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 110px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Totales por categoría */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {CAT_SOST.map(cat => {
          const cfg = CAT_CFG[cat]
          const val = totales12m[cat]
          const pct = totalGeneral > 0 ? (val / totalGeneral) * 100 : 0
          return (
            <div key={cat} style={{ flex: '1 1 150px', background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{cfg.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: cfg.color, marginTop: 2 }}>{moneda} {val.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 10, color: cfg.color, marginTop: 2 }}>{pct.toFixed(1)}% del total</div>
            </div>
          )
        })}
      </div>

      {/* Gráfica de tendencia apilada */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--at-ink)', marginBottom: 10 }}>Tendencia mensual por categoría</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
          {tendencia.map(t => (
            <div key={t.ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse', height: 100 }}>
                {CAT_SOST.map(cat => {
                  const h = t.total > 0 ? ((t[cat] as number) / maxTend) * 95 : 0
                  return h > 0 ? (
                    <div key={cat} style={{ width: '100%', height: `${h}px`, background: CAT_CFG[cat].color, opacity: 0.8, borderRadius: '0' }} />
                  ) : null
                })}
              </div>
              <div style={{ fontSize: 9, color: 'var(--at-ink-3)', marginTop: 2 }}>{t.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          {CAT_SOST.map(cat => (
            <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
              <span style={{ width: 10, height: 10, background: CAT_CFG[cat].color, opacity: 0.8, borderRadius: 2, display: 'inline-block' }} />
              {CAT_CFG[cat].label}
            </span>
          ))}
        </div>
      </div>

      {/* Tabla mensual — F3.9: migrado a <DataTable> shared (totales 12m en KPIs arriba) */}
      <DataTable<TendenciaMes>
        data={tendencia}
        rowKey="ym"
        pageSize={0}
        defaultSort={{ key: 'ym', direction: 'desc' }}
        emptyState={{ icon: '📊', title: 'Sin datos mensuales' }}
        rowStyle={(t) => t.ym === tendencia[tendencia.length - 1].ym ? { background: 'var(--at-warning-tint)' } : {}}
        columns={[
          { key: 'ym', header: 'Mes', sortable: true,
            accessor: (t) => t.ym,
            render: (t) => {
              const isCurrent = t.ym === tendencia[tendencia.length - 1].ym
              return <span style={{ color: 'var(--at-ink-2)', fontWeight: isCurrent ? 700 : 400 }}>{t.label}</span>
            } },
          ...CAT_SOST.map(c => ({
            key: c,
            header: CAT_CFG[c].label,
            align: 'right' as const,
            sortable: true,
            hideOnMobile: true,
            render: (t: TendenciaMes) => (
              <span style={{ color: (t[c] as number) > 0 ? CAT_CFG[c].color : 'var(--at-line-strong)' }}>
                {(t[c] as number) > 0 ? `${moneda} ${(t[c] as number).toLocaleString('es', { minimumFractionDigits: 2 })}` : '—'}
              </span>
            ),
          })),
          { key: 'total', header: 'Total', align: 'right', sortable: true,
            render: (t) => <span style={{ fontWeight: 700, color: 'var(--at-ink-2)' }}>
              {t.total > 0 ? `${moneda} ${t.total.toLocaleString('es', { minimumFractionDigits: 2 })}` : '—'}
            </span> },
          { key: 'porUnidad', header: 'Por unidad', align: 'right', hideOnMobile: true,
            accessor: (t) => t.total / unidadesActivas,
            render: (t) => <span style={{ color: 'var(--at-accent-hover)' }}>
              {t.total > 0 ? `${moneda} ${(t.total / unidadesActivas).toFixed(2)}` : '—'}
            </span> },
        ] satisfies DataTableColumn<TendenciaMes>[]}
      />

      <div style={{ marginTop: 12, padding: '8px 14px', background: 'var(--at-success-tint)', borderRadius: 8, fontSize: 11, color: 'var(--at-success-strong)' }}>
        🌿 El índice CO₂ es una estimación simplificada basada en el gasto en servicios. Para datos de consumo real de agua y energía, consulta los módulos de Contadores y Servicios de Energía.
      </div>
    </div>
  )
}
