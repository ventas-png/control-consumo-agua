import { useMemo, useState, type CSSProperties } from 'react'
import { GastoCondominio, Unidad } from '../../../types'
import { formatNumber } from '../../../lib/format'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { tint } from '../../shared/statusTone'
import { variacionMismoPeriodo } from '../../../domain/condominios/sostenibilidad'

interface Props {
  gastos: GastoCondominio[]
  unidades: Unidad[]
  moneda: string
}

const MESES_L = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function ultimosMeses(n: number): { ym: string; label: string; etiqueta: string }[] {
  const hoy = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (n - 1 - i), 1)
    return {
      ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: MESES_L[d.getMonth()],
      // Con año: la ventana de 12 meses cruza dos años.
      etiqueta: `${MESES_L[d.getMonth()]} ${d.getFullYear()}`,
    }
  })
}

// Categorías de gasto asociadas a servicios/sostenibilidad
const CAT_SOST = ['servicios', 'limpieza', 'obras'] as const
type CatSost = typeof CAT_SOST[number]
const CAT_CFG: Record<string, { label: string; color: string; bg: string }> = {
  servicios: { label: 'Agua y Energía', color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  limpieza:  { label: 'Limpieza',        color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  obras:     { label: 'Obras / Mejoras', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
}
const esCatSost = (c: string): c is CatSost => (CAT_SOST as readonly string[]).includes(c)

/** Tarjetas que se reparten la fila y bajan a dos por fila en el teléfono. */
const rejillaTarjetas: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10, marginBottom: 14 }

export default function DashboardSostenibilidadTab({ gastos, unidades, moneda }: Props) {
  const meses = useMemo(() => ultimosMeses(12), [])
  const [detalleYm, setDetalleYm] = useState<string | null>(null)

  // Montos con el formato regional de la app (es-GT: 12,345.67). Antes se
  // usaba 'es', que en Guatemala se leía al revés (12.345,67).
  const dinero = (v: number, decimales = 2) => `${moneda}\u00a0${formatNumber(v, decimales)}`

  const gastosActivos = useMemo(() => gastos.filter(g => g.estado !== 'anulado'), [gastos])

  type TendenciaMes = { ym: string; label: string; etiqueta: string; total: number; servicios: number; limpieza: number; obras: number }

  const tendencia = useMemo(() =>
    meses.map(({ ym, label, etiqueta }): TendenciaMes => {
      const porCat = CAT_SOST.reduce((acc, cat) => {
        acc[cat] = gastosActivos.filter(g => g.fecha?.startsWith(ym) && g.categoria === cat).reduce((s, g) => s + g.monto, 0)
        return acc
      }, {} as Record<string, number>)
      const total = Object.values(porCat).reduce((s, v) => s + v, 0)
      return { ym, label, etiqueta, servicios: porCat['servicios'] ?? 0, limpieza: porCat['limpieza'] ?? 0, obras: porCat['obras'] ?? 0, total }
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

  const mesActualData = tendencia[tendencia.length - 1]
  // El mes en curso contra el mismo periodo del mes anterior (del 1 al mismo
  // día). Contra el promedio de meses completos, a mitad de mes siempre salía
  // muy por debajo.
  const variacion = variacionMismoPeriodo(gastosActivos.filter(g => esCatSost(g.categoria)))
  const pctVariacion = variacion.pct
  const periodo = (hasta: string) => `1–${Number(hasta.slice(8, 10))} ${MESES_L[Number(hasta.slice(5, 7)) - 1]}`
  const tonoVariacion = pctVariacion === null ? { color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)' }
    : pctVariacion >= 10 ? { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' }
    : { color: 'var(--at-success)', bg: 'var(--at-success-tint)' }

  const maxTend = Math.max(...tendencia.map(t => t.total), 1)

  // Huella de carbono estimada (muy simplificada): 0.15 kg CO₂ por Q de servicio
  const co2Estimado = totales12m['servicios'] * 0.15

  // Se lee el mes vigente, no una copia.
  const detalle = detalleYm ? tendencia.find(t => t.ym === detalleYm) ?? null : null
  const gastosDetalle = detalle
    ? gastosActivos
      .filter(g => g.fecha?.startsWith(detalle.ym) && esCatSost(g.categoria))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
    : []

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Sostenibilidad · gastos</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        Basado en gastos de servicios, limpieza y obras — últimos 12 meses
      </div>

      {/* KPIs */}
      <div style={rejillaTarjetas}>
        {[
          { label: 'Gasto total 12m', val: dinero(totalGeneral), color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
          { label: 'Promedio mensual', val: dinero(promMensual, 0), color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)' },
          { label: 'Costo/unidad/mes', val: dinero(costoUnitario, 0), color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
          { label: 'Mes en curso vs. mes anterior',
            val: pctVariacion === null ? '—' : `${pctVariacion >= 0 ? '+' : ''}${pctVariacion.toFixed(1)}%`,
            nota: pctVariacion === null
              ? `Sin gastos del ${periodo(variacion.hastaAnterior)} para comparar`
              : `${periodo(variacion.hastaActual)} vs. ${periodo(variacion.hastaAnterior)}`,
            color: tonoVariacion.color, bg: tonoVariacion.bg },
          { label: 'CO₂ estimado 12m', val: `${(co2Estimado / 1000).toFixed(2)}\u00a0ton`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${tint(k.color, 20)}`, borderRadius: 10, padding: '10px 14px', minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2, overflowWrap: 'anywhere' }}>{k.val}</div>
            {k.nota && <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>{k.nota}</div>}
          </div>
        ))}
      </div>

      {/* Totales por categoría */}
      <div style={rejillaTarjetas}>
        {CAT_SOST.map(cat => {
          const cfg = CAT_CFG[cat]
          const val = totales12m[cat]
          const pct = totalGeneral > 0 ? (val / totalGeneral) * 100 : 0
          return (
            <div key={cat} style={{ background: cfg.bg, border: `1px solid ${tint(cfg.color, 20)}`, borderRadius: 10, padding: '10px 14px', minWidth: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{cfg.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: cfg.color, marginTop: 2, overflowWrap: 'anywhere' }}>{dinero(val)}</div>
              <div style={{ fontSize: 10, color: cfg.color, marginTop: 2 }}>{pct.toFixed(1)}% del total</div>
            </div>
          )
        })}
      </div>

      {/* Gráfica de tendencia apilada: cada mes abre su detalle */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--at-ink)', marginBottom: 10 }}>Tendencia mensual por categoría</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120 }}>
          {tendencia.map(t => (
            <button
              key={t.ym}
              type="button"
              onClick={() => setDetalleYm(t.ym)}
              aria-label={`Ver gastos de ${t.etiqueta}: ${dinero(t.total)}`}
              className="cond-barra-fila"
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 0, background: 'none', border: 'none', borderRadius: 4, font: 'inherit', cursor: 'pointer' }}
            >
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column-reverse', height: 100 }}>
                {CAT_SOST.map(cat => {
                  const h = t.total > 0 ? ((t[cat] as number) / maxTend) * 95 : 0
                  return h > 0 ? (
                    <div key={cat} style={{ width: '100%', height: `${h}px`, background: CAT_CFG[cat].color, opacity: 0.8, borderRadius: '0' }} />
                  ) : null
                })}
              </div>
              <div style={{ fontSize: 9, color: 'var(--at-ink-3)', marginTop: 2 }}>{t.label}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px 16px', marginTop: 8, flexWrap: 'wrap' }}>
          {CAT_SOST.map(cat => (
            <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
              <span style={{ width: 10, height: 10, background: CAT_CFG[cat].color, opacity: 0.8, borderRadius: 2, display: 'inline-block' }} />
              {CAT_CFG[cat].label}
            </span>
          ))}
        </div>
      </div>

      {/* Tabla mensual — F3.9: migrado a <DataTable> shared (totales 12m en KPIs arriba).
          En el teléfono quedan Mes y Total; tocar el mes (o «Ver») abre su
          desglose por categoría y los gastos que lo forman. */}
      <DataTable<TendenciaMes>
        data={tendencia}
        rowKey="ym"
        pageSize={0}
        defaultSort={{ key: 'ym', direction: 'desc' }}
        emptyState={{ icon: '📊', title: 'Sin datos mensuales' }}
        rowStyle={(t) => t.ym === tendencia[tendencia.length - 1].ym ? { background: 'var(--at-warning-tint)' } : {}}
        onRowClick={(t) => setDetalleYm(t.ym)}
        columns={[
          { key: 'ym', header: 'Mes', sortable: true,
            accessor: (t) => t.ym,
            render: (t) => {
              const isCurrent = t.ym === tendencia[tendencia.length - 1].ym
              return <span style={{ color: 'var(--at-ink-2)', fontWeight: isCurrent ? 700 : 400, whiteSpace: 'nowrap' }}>{t.etiqueta}</span>
            } },
          ...CAT_SOST.map(c => ({
            key: c,
            header: CAT_CFG[c].label,
            align: 'right' as const,
            sortable: true,
            hideOnMobile: true,
            render: (t: TendenciaMes) => (
              <span style={{ color: (t[c] as number) > 0 ? CAT_CFG[c].color : 'var(--at-line-strong)' }}>
                {(t[c] as number) > 0 ? dinero(t[c] as number) : '—'}
              </span>
            ),
          })),
          { key: 'total', header: 'Total', align: 'right', sortable: true,
            render: (t) => <span style={{ fontWeight: 700, color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>
              {t.total > 0 ? dinero(t.total) : '—'}
            </span> },
          { key: 'porUnidad', header: 'Por unidad', align: 'right', hideOnMobile: true,
            accessor: (t) => t.total / unidadesActivas,
            render: (t) => <span style={{ color: 'var(--at-accent-hover)' }}>
              {t.total > 0 ? dinero(t.total / unidadesActivas) : '—'}
            </span> },
          { key: 'ver', header: '', align: 'right',
            render: (t) => (
              <span onClick={e => e.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => setDetalleYm(t.ym)} aria-label={`Ver gastos de ${t.etiqueta}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<TendenciaMes>[]}
      />

      <div style={{ marginTop: 12, padding: '8px 14px', background: 'var(--at-success-tint)', borderRadius: 8, fontSize: 11, color: 'var(--at-success-strong)' }}>
        🌿 El índice CO₂ es una estimación simplificada basada en el gasto en servicios. Para datos de consumo real de agua y energía, consulta los módulos de Contadores y Servicios de Energía.
      </div>

      {/* Desglose del mes en ventana (pantalla completa en el teléfono): en el
          teléfono la tabla solo muestra el total. */}
      {detalle && (
        <EditModal
          title={`🌿 Gastos de ${detalle.etiqueta}`}
          subtitle={detalle.ym === mesActualData.ym ? 'Mes en curso · servicios, limpieza y obras' : 'Servicios, limpieza y obras'}
          maxWidth="520px"
          fullScreenOnMobile
          onClose={() => setDetalleYm(null)}
          footer={<Button variant="secondary" onClick={() => setDetalleYm(null)}>Cerrar</Button>}
        >
          <div>
            {CAT_SOST.map(cat => (
              <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--at-ink-3)' }}>
                  <span aria-hidden="true" style={{ width: 10, height: 10, background: CAT_CFG[cat].color, opacity: 0.8, borderRadius: 2, display: 'inline-block' }} />
                  {CAT_CFG[cat].label}
                </span>
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {dinero(detalle[cat])}
                  {detalle.total > 0 && <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}> · {((detalle[cat] / detalle.total) * 100).toFixed(0)}%</span>}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
              <strong>Total</strong>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{dinero(detalle.total)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', fontSize: 14 }}>
              <span style={{ color: 'var(--at-ink-3)' }}>Por unidad activa</span>
              <span style={{ color: 'var(--at-accent-hover)', fontVariantNumeric: 'tabular-nums' }}>{dinero(detalle.total / unidadesActivas)}</span>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-3)', margin: '16px 0 4px' }}>Gastos del mes ({gastosDetalle.length})</div>
            {gastosDetalle.length === 0 ? (
              <div style={{ color: 'var(--at-ink-3)', fontSize: 13, padding: '8px 0' }}>Sin gastos de servicios, limpieza u obras este mes.</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {gastosDetalle.map(g => (
                  <li key={g.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{g.concepto}</div>
                      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', overflowWrap: 'anywhere' }}>
                        {[g.fecha, CAT_CFG[g.categoria]?.label, g.proveedor_nombre, g.estado === 'pendiente' ? 'Pendiente de pago' : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{dinero(g.monto)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </EditModal>
      )}
    </div>
  )
}
