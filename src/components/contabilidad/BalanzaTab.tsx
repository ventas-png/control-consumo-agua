import { useMemo, useState } from 'react'
import { useBalanzaQuery, useCuentasQuery } from '../../domain/contabilidad/queries'
import { balanzaConRollups, type BalanzaNodo } from '../../domain/contabilidad/arbol'
import { exportarExcel } from '../condominios/exportUtils'
import { formatCurrency } from '../../lib/format'
import { EmptyState } from '../shared'
import { btnSecundario, input } from './ui'
import { RevaluacionFxModal } from './RevaluacionFxModal'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
}

function periodoActual(): string {
  return new Date().toISOString().slice(0, 7)
}

export function BalanzaTab({ companyId, projectId, monedaBase }: Props) {
  const [periodo, setPeriodo] = useState(periodoActual())
  const [showRevaluacion, setShowRevaluacion] = useState(false)

  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const { data: filas = [], isLoading } = useBalanzaQuery(companyId, projectId, periodo)

  const nodos = useMemo(() => balanzaConRollups(cuentas, filas), [cuentas, filas])

  const totales = useMemo(() => {
    // Solo cuentas de detalle (los rollups duplicarían).
    const detalle = nodos.filter((n) => !n.esRollup)
    return {
      cargos: detalle.reduce((s, n) => s + n.cargos, 0),
      abonos: detalle.reduce((s, n) => s + n.abonos, 0),
    }
  }, [nodos])

  function exportar() {
    exportarExcel(`balanza-${periodo}${projectId ? '-proyecto' : '-empresa'}.xlsx`, [
      {
        name: `Balanza ${periodo}`,
        headers: ['Código', 'Cuenta', 'Saldo inicial', 'Cargos', 'Abonos', 'Saldo final', 'Saldo moneda origen'],
        rows: nodos.map((n) => [
          n.cuenta.codigo,
          n.cuenta.nombre,
          n.saldo_inicial,
          n.cargos,
          n.abonos,
          n.saldo_final,
          n.saldo_final_origen !== null && n.cuenta.moneda
            ? `${n.saldo_final_origen} ${n.cuenta.moneda}`
            : '',
        ]),
      },
    ])
  }

  const saldo = (n: number) => (
    <span style={{ fontVariantNumeric: 'tabular-nums', color: n < 0 ? 'var(--at-danger)' : 'var(--at-ink)' }}>
      {formatCurrency(n, monedaBase)}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ ...input, width: 150 }} aria-label="Periodo" />
        <span style={{ flex: 1 }} />
        <button onClick={() => setShowRevaluacion(true)} style={btnSecundario} title="Revaluar saldos en moneda extranjera contra 3301">
          💱 Revaluar FX
        </button>
        <button onClick={exportar} disabled={nodos.length === 0} style={btnSecundario}>Exportar Excel</button>
      </div>

      {showRevaluacion && (
        <RevaluacionFxModal projectId={projectId} monedaBase={monedaBase} onClose={() => setShowRevaluacion(false)} />
      )}

      {isLoading ? (
        <p style={{ color: 'var(--at-ink-soft)' }}>Cargando balanza…</p>
      ) : nodos.length === 0 ? (
        <EmptyState
          title="Sin movimientos en este periodo"
          description="La balanza se construye desde las pólizas publicadas. Registra los saldos iniciales (asiento de apertura) en la pestaña Pólizas para arrancar."
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Cuenta</th>
                <th style={{ padding: 6 }}>Saldo inicial</th>
                <th style={{ padding: 6 }}>Cargos</th>
                <th style={{ padding: 6 }}>Abonos</th>
                <th style={{ padding: 6 }}>Saldo final</th>
                <th style={{ padding: 6 }}>Moneda origen</th>
              </tr>
            </thead>
            <tbody>
              {nodos.map((n: BalanzaNodo) => (
                <tr key={n.cuenta.id} style={{ borderBottom: '1px solid var(--at-line)', background: n.esRollup ? 'var(--at-surface-2)' : undefined }}>
                  <td style={{ padding: 6, paddingLeft: 6 + (n.cuenta.nivel - 1) * 16, fontWeight: n.esRollup ? 700 : 400, fontFamily: 'var(--at-mono, monospace)' }}>
                    {n.cuenta.codigo} — {n.cuenta.nombre}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{saldo(n.saldo_inicial)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{saldo(n.cargos)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{saldo(n.abonos)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 600 }}>{saldo(n.saldo_final)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontSize: 12, color: 'var(--at-ink-soft)' }}>
                    {n.saldo_final_origen !== null && n.cuenta.moneda
                      ? formatCurrency(n.saldo_final_origen, n.cuenta.moneda)
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>
                <td style={{ padding: 6, textAlign: 'right' }}>Totales del periodo</td>
                <td />
                <td style={{ padding: 6, textAlign: 'right' }}>{saldo(totales.cargos)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{saldo(totales.abonos)}</td>
                <td colSpan={2} style={{ padding: 6, fontSize: 11, color: totales.cargos === totales.abonos ? 'var(--at-success)' : 'var(--at-danger)', textAlign: 'right' }}>
                  {totales.cargos === totales.abonos ? '✓ cuadrada' : '⚠ descuadre'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: 0 }}>
        Saldos en {monedaBase} (moneda base). El saldo final = saldo inicial + cargos − abonos
        (signo según naturaleza: los negativos indican saldo contrario a la naturaleza de la cuenta).
      </p>
    </div>
  )
}
