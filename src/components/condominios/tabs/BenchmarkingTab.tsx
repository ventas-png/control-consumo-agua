// condominios (D4) — Benchmarking entre los proyectos del tenant. Consume la MV
// (get_kpis_tenant_mensual, C1) vía useKpisTenantMensualQuery y compara el
// desempeño de cada condominio: tasa de cobranza, mora, consumo, gasto.
import { useMemo } from 'react'
import type { Proyecto } from '../../../types'
import { formatCurrency } from '../../../lib/format'
import { useKpisTenantMensualQuery, rangoUltimosMeses } from '../../../domain/analitica/queries'
import { benchmarkPorProyecto, medianaTasaCobranza } from '../../../domain/analitica/benchmarking'

interface Props {
  companyId?: string
  proyectos: Proyecto[]
  moneda: string
}

export function BenchmarkingTab({ companyId, proyectos, moneda }: Props) {
  const { desde, hasta } = useMemo(() => rangoUltimosMeses(6), [])
  const { data: filas = [], isLoading } = useKpisTenantMensualQuery(companyId, desde, hasta)

  const nombres = useMemo(() => new Map(proyectos.map(p => [p.id, p.nombre])), [proyectos])
  const bench = useMemo(() => benchmarkPorProyecto(filas, nombres), [filas, nombres])
  const mediana = useMemo(() => medianaTasaCobranza(bench), [bench])
  const maxCobranza = Math.max(...bench.map(b => b.tasaCobranza), mediana, 0.01)

  if (!companyId) return null

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700, color: 'var(--at-ink)' }}>Comparativo entre condominios</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-3)' }}>
          Desempeño de los últimos 6 meses por proyecto · {desde} a {hasta}
        </p>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--at-ink-3)', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>Cargando comparativo…</div>
      ) : bench.length === 0 ? (
        <div style={{ color: 'var(--at-ink-3)', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>
          Sin datos de proyectos todavía. El comparativo se llena a medida que hay cuotas o recibos emitidos.
        </div>
      ) : (
        <>
          {/* Barras de tasa de cobranza por proyecto vs mediana del portafolio */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: 14 }}>
              <span>Tasa de cobranza por condominio</span>
              <span>Mediana del portafolio: {Math.round(mediana * 100)}%</span>
            </div>
            {bench.map(p => {
              const sobreMediana = p.tasaCobranza >= mediana
              const color = p.tasaCobranza >= 0.8 ? 'var(--at-success)' : p.tasaCobranza >= 0.6 ? 'var(--at-warning)' : 'var(--at-danger)'
              return (
                <div key={p.project_id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--at-ink-2)', fontWeight: 600 }}>{p.nombre}</span>
                    <span style={{ fontWeight: 700, color }}>
                      {Math.round(p.tasaCobranza * 100)}%
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: sobreMediana ? 'var(--at-success)' : 'var(--at-danger)' }}>
                        {sobreMediana ? '▲' : '▼'}
                      </span>
                    </span>
                  </div>
                  <div style={{ position: 'relative', background: 'var(--at-chip)', borderRadius: 4, height: 10 }}>
                    <div style={{ height: '100%', width: `${(p.tasaCobranza / maxCobranza) * 100}%`, background: color, borderRadius: 4 }} />
                    {/* marca de la mediana */}
                    <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${(mediana / maxCobranza) * 100}%`, width: 2, background: 'var(--at-ink-3)' }} title={`Mediana ${Math.round(mediana * 100)}%`} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Tabla comparativa */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'right', color: 'var(--at-ink-3)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                  <th style={{ padding: 6, textAlign: 'left' }}>Condominio</th>
                  <th style={{ padding: 6 }}>Emitido</th>
                  <th style={{ padding: 6 }}>Cobrado</th>
                  <th style={{ padding: 6 }}>Cobranza</th>
                  <th style={{ padding: 6 }}>Cuotas en mora</th>
                  <th style={{ padding: 6 }}>Consumo m³</th>
                  <th style={{ padding: 6 }}>Gasto</th>
                </tr>
              </thead>
              <tbody>
                {bench.map(p => (
                  <tr key={p.project_id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                    <td style={{ padding: 6, fontWeight: 600, color: 'var(--at-ink)' }}>{p.nombre}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(p.emitido, moneda)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(p.cobrado, moneda)}</td>
                    <td style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>{Math.round(p.tasaCobranza * 100)}%</td>
                    <td style={{ padding: 6, textAlign: 'right', color: p.morosas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{p.morosas}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{p.consumoM3.toLocaleString('es')}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(p.gastos, moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
