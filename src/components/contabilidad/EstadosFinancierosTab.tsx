import { useMemo, useState } from 'react'
import { FilterChips } from '../shared/FilterChips'
import { confirm, notify } from '../shared/Dialog'
import {
  useBalanceGeneralQuery,
  useCierresAnualesQuery,
  useEstadoResultadosQuery,
  useFlujoEfectivoQuery,
} from '../../domain/eeff/queries'
import { useCierreAnualMutation } from '../../domain/eeff/mutations'
import { compararPyG, rangoAnterior, resumirBalance, resumirPyG, type PyGComparadaFila } from '../../domain/eeff/calculos'
import { exportarExcel } from '../condominios/exportUtils'
import { generarReporteAsamblea } from './reporteAsamblea'
import { formatCurrency } from '../../lib/format'
import type { Proyecto } from '../../types'
import { btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  proyectos: Proyecto[]
  monedaBase: string
}

type Vista = 'pyg' | 'balance' | 'flujo'

function periodoActual(): string {
  return new Date().toISOString().slice(0, 7)
}

export function EstadosFinancierosTab({ companyId, proyectos, monedaBase }: Props) {
  const [vista, setVista] = useState<Vista>('pyg')
  const [projectId, setProjectId] = useState('')
  const [periodo, setPeriodo] = useState(periodoActual())
  const [desde, setDesde] = useState(`${new Date().getFullYear()}-01`)

  const [comparar, setComparar] = useState(false)

  const pid = projectId || null
  const { data: pygFilas = [], isLoading: cargandoPyG } = useEstadoResultadosQuery(companyId, pid, desde, periodo)
  // Comparativo vs periodo anterior (pendiente Fase 5): mismo P&L sobre el
  // rango inmediato anterior de la misma longitud; solo consulta al activarlo.
  const rangoAnt = useMemo(() => rangoAnterior(desde, periodo), [desde, periodo])
  const { data: pygAntFilas = [] } = useEstadoResultadosQuery(
    comparar ? companyId : undefined, pid, rangoAnt.desde, rangoAnt.hasta,
  )
  const { data: balanceFilas = [], isLoading: cargandoBalance } = useBalanceGeneralQuery(companyId, pid, periodo)
  const { data: flujoFilas = [], isLoading: cargandoFlujo } = useFlujoEfectivoQuery(companyId, pid, periodo)
  const { data: cierres = [] } = useCierresAnualesQuery(companyId)
  const cierre = useCierreAnualMutation()

  const pygBase = useMemo(() => resumirPyG(pygFilas), [pygFilas])
  const pygComp = useMemo(
    () => (comparar ? compararPyG(pygFilas, pygAntFilas) : null),
    [comparar, pygFilas, pygAntFilas],
  )
  const pyg = pygComp ?? pygBase
  const balance = useMemo(() => resumirBalance(balanceFilas), [balanceFilas])

  const anioCerrable = new Date().getFullYear() - 1
  const anioCerrado = cierres.some((c) => c.anio === anioCerrable)

  const fmt = (n: number) => formatCurrency(n, monedaBase)
  const nCols = pygComp ? 4 : 2

  function exportar() {
    if (vista === 'pyg') {
      const colsComp = (f: PyGComparadaFila | null, tot?: [number, number]) =>
        pygComp ? (f ? [f.montoAnterior, f.variacion] : tot ? [tot[0], tot[1]] : ['', '']) : []
      exportarExcel(`estado-resultados-${desde}-a-${periodo}.xlsx`, [{
        name: 'Estado de resultados',
        headers: [
          'Código', 'Cuenta', 'Tipo', `Monto (${monedaBase})`,
          ...(pygComp ? [`Anterior (${rangoAnt.desde} a ${rangoAnt.hasta})`, 'Variación'] : []),
        ],
        rows: [
          ...pyg.ingresos.map((f) => [f.codigo, f.nombre, 'Ingreso', f.monto, ...colsComp(f as PyGComparadaFila)]),
          ['', 'Total ingresos', '', pyg.totalIngresos, ...colsComp(null, pygComp ? [pygComp.totalIngresosAnterior, pyg.totalIngresos - pygComp.totalIngresosAnterior] : undefined)],
          ...pyg.gastos.map((f) => [f.codigo, f.nombre, 'Gasto', f.monto, ...colsComp(f as PyGComparadaFila)]),
          ['', 'Total gastos', '', pyg.totalGastos, ...colsComp(null, pygComp ? [pygComp.totalGastosAnterior, pyg.totalGastos - pygComp.totalGastosAnterior] : undefined)],
          ['', 'RESULTADO', '', pyg.resultado, ...colsComp(null, pygComp ? [pygComp.resultadoAnterior, pyg.resultado - pygComp.resultadoAnterior] : undefined)],
        ],
      }])
    } else if (vista === 'balance') {
      exportarExcel(`balance-general-${periodo}.xlsx`, [{
        name: 'Balance general',
        headers: ['Código', 'Cuenta', 'Tipo', `Saldo (${monedaBase})`],
        rows: [
          ...balance.activo.map((f) => [f.codigo, f.nombre, 'Activo', f.saldo]),
          ['', 'Total activo', '', balance.totalActivo],
          ...balance.pasivo.map((f) => [f.codigo, f.nombre, 'Pasivo', f.saldo]),
          ['', 'Total pasivo', '', balance.totalPasivo],
          ...balance.capital.map((f) => [f.codigo, f.nombre, 'Capital', f.saldo]),
          ['', 'Total capital', '', balance.totalCapital],
        ],
      }])
    } else {
      exportarExcel(`flujo-efectivo-${periodo}.xlsx`, [{
        name: 'Flujo de efectivo',
        headers: ['Código', 'Cuenta', 'Saldo inicial', 'Entradas', 'Salidas', 'Saldo final'],
        rows: flujoFilas.map((f) => [f.codigo, f.nombre, f.saldo_inicial, f.entradas, f.salidas, f.saldo_final]),
      }])
    }
  }

  async function onCierreAnual() {
    const { isConfirmed } = await confirm({
      title: `¿Cerrar el ejercicio ${anioCerrable}?`,
      text: 'Se publica el asiento que salda todos los ingresos y gastos del año contra 3201 Resultado del ejercicio. Esta operación se hace una sola vez por año (revertirla requiere anular la póliza de cierre).',
      confirmText: 'Cerrar ejercicio',
      variant: 'danger',
    })
    if (!isConfirmed) return
    try {
      await cierre.mutateAsync(anioCerrable)
      notify({ variant: 'success', title: 'Ejercicio cerrado', text: `El cierre ${anioCerrable} quedó publicado.` })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo cerrar el ejercicio.' })
    }
  }

  const th: React.CSSProperties = { padding: 6, fontSize: 11, color: 'var(--at-ink-soft)', borderBottom: '1px solid var(--at-line)' }
  const td: React.CSSProperties = { padding: 6, borderBottom: '1px solid var(--at-line)' }
  const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
  const totalRow: React.CSSProperties = { fontWeight: 700, background: 'var(--at-surface-2)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <FilterChips<Vista>
          options={[
            { value: 'pyg', label: 'Estado de resultados' },
            { value: 'balance', label: 'Balance general' },
            { value: 'flujo', label: 'Flujo de efectivo' },
          ]}
          value={vista}
          onChange={setVista}
          ariaLabel="Estado financiero"
        />
        <span style={{ flex: 1 }} />
        {vista === 'pyg' && (
          <>
            <label style={{ fontSize: 12, color: 'var(--at-ink-soft)', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
              Comparar con periodo anterior
            </label>
            <label style={{ fontSize: 12, color: 'var(--at-ink-soft)', display: 'flex', gap: 6, alignItems: 'center' }}>
              Desde
              <input type="month" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ ...input, width: 140 }} />
            </label>
          </>
        )}
        <label style={{ fontSize: 12, color: 'var(--at-ink-soft)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {vista === 'pyg' ? 'Hasta' : 'Al cierre de'}
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ ...input, width: 140 }} />
        </label>
        {proyectos.length > 1 && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...input, width: 190 }} aria-label="Proyecto">
            <option value="">Toda la empresa</option>
            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        )}
        <button
          onClick={() => generarReporteAsamblea({
            entidadNombre: proyectos.find((p) => p.id === projectId)?.nombre ?? 'Toda la empresa',
            desde, hasta: periodo, monedaBase,
            pyg: pygBase, balance, flujo: flujoFilas,
          })}
          style={btnSecundario}
          title="PDF con resumen ejecutivo, estado de resultados, balance y flujo del periodo"
        >
          📄 Informe asamblea
        </button>
        <button onClick={exportar} style={btnSecundario}>Exportar Excel</button>
        {!anioCerrado && (
          <button onClick={() => void onCierreAnual()} disabled={cierre.isPending} style={btnPrimario}>
            Cerrar ejercicio {anioCerrable}
          </button>
        )}
      </div>

      {vista === 'pyg' && (
        cargandoPyG ? <p style={{ color: 'var(--at-ink-soft)' }}>Cargando…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={th}>Cuenta</th>
                <th style={{ ...th, textAlign: 'right' }}>Monto ({monedaBase})</th>
                {pygComp && <th style={{ ...th, textAlign: 'right' }}>Anterior ({rangoAnt.desde} a {rangoAnt.hasta})</th>}
                {pygComp && <th style={{ ...th, textAlign: 'right' }}>Variación</th>}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={nCols} style={{ ...td, fontWeight: 700, color: 'var(--at-ink-soft)' }}>INGRESOS</td></tr>
              {pyg.ingresos.map((f) => (
                <tr key={f.cuenta_id}>
                  <td style={{ ...td, paddingLeft: 20, fontFamily: 'var(--at-mono, monospace)' }}>{f.codigo} — {f.nombre}</td>
                  <td style={tdNum}>{fmt(f.monto)}</td>
                  {pygComp && <CeldasComparativo fila={f as PyGComparadaFila} fmt={fmt} tdNum={tdNum} />}
                </tr>
              ))}
              <tr style={totalRow}>
                <td style={td}>Total ingresos</td><td style={tdNum}>{fmt(pyg.totalIngresos)}</td>
                {pygComp && <td style={tdNum}>{fmt(pygComp.totalIngresosAnterior)}</td>}
                {pygComp && <td style={tdNum}>{fmt(pyg.totalIngresos - pygComp.totalIngresosAnterior)}</td>}
              </tr>
              <tr><td colSpan={nCols} style={{ ...td, fontWeight: 700, color: 'var(--at-ink-soft)' }}>GASTOS</td></tr>
              {pyg.gastos.map((f) => (
                <tr key={f.cuenta_id}>
                  <td style={{ ...td, paddingLeft: 20, fontFamily: 'var(--at-mono, monospace)' }}>{f.codigo} — {f.nombre}</td>
                  <td style={tdNum}>{fmt(f.monto)}</td>
                  {pygComp && <CeldasComparativo fila={f as PyGComparadaFila} fmt={fmt} tdNum={tdNum} />}
                </tr>
              ))}
              <tr style={totalRow}>
                <td style={td}>Total gastos</td><td style={tdNum}>{fmt(pyg.totalGastos)}</td>
                {pygComp && <td style={tdNum}>{fmt(pygComp.totalGastosAnterior)}</td>}
                {pygComp && <td style={tdNum}>{fmt(pyg.totalGastos - pygComp.totalGastosAnterior)}</td>}
              </tr>
              <tr style={{ ...totalRow, color: pyg.resultado >= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
                <td style={td}>{pyg.resultado >= 0 ? 'UTILIDAD' : 'PÉRDIDA'} DEL PERIODO</td>
                <td style={tdNum}>{fmt(pyg.resultado)}</td>
                {pygComp && <td style={tdNum}>{fmt(pygComp.resultadoAnterior)}</td>}
                {pygComp && <td style={tdNum}>{fmt(pyg.resultado - pygComp.resultadoAnterior)}</td>}
              </tr>
            </tbody>
          </table>
        )
      )}

      {vista === 'balance' && (
        cargandoBalance ? <p style={{ color: 'var(--at-ink-soft)' }}>Cargando…</p> : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={th}>Cuenta</th>
                  <th style={{ ...th, textAlign: 'right' }}>Saldo ({monedaBase})</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['ACTIVO', balance.activo, balance.totalActivo],
                  ['PASIVO', balance.pasivo, balance.totalPasivo],
                  ['CAPITAL', balance.capital, balance.totalCapital],
                ] as const).map(([titulo, filas, total]) => (
                  <FragmentoBalance key={titulo} titulo={titulo} filas={filas} total={total} fmt={fmt} td={td} tdNum={tdNum} totalRow={totalRow} />
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, fontWeight: 700, color: balance.descuadre === 0 ? 'var(--at-success)' : 'var(--at-danger)', margin: 0 }}>
              {balance.descuadre === 0
                ? `✓ Cuadrado: Activo ${fmt(balance.totalActivo)} = Pasivo ${fmt(balance.totalPasivo)} + Capital ${fmt(balance.totalCapital)}`
                : `⚠ Descuadre de ${fmt(balance.descuadre)}`}
            </p>
          </>
        )
      )}

      {vista === 'flujo' && (
        cargandoFlujo ? <p style={{ color: 'var(--at-ink-soft)' }}>Cargando…</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'right' }}>
                <th style={{ ...th, textAlign: 'left' }}>Cuenta de efectivo</th>
                <th style={th}>Saldo inicial</th>
                <th style={th}>Entradas</th>
                <th style={th}>Salidas</th>
                <th style={th}>Saldo final</th>
              </tr>
            </thead>
            <tbody>
              {flujoFilas.map((f) => (
                <tr key={f.cuenta_id}>
                  <td style={{ ...td, fontFamily: 'var(--at-mono, monospace)' }}>{f.codigo} — {f.nombre}</td>
                  <td style={tdNum}>{fmt(f.saldo_inicial)}</td>
                  <td style={{ ...tdNum, color: 'var(--at-success)' }}>{fmt(f.entradas)}</td>
                  <td style={{ ...tdNum, color: 'var(--at-danger)' }}>{fmt(f.salidas)}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{fmt(f.saldo_final)}</td>
                </tr>
              ))}
              {flujoFilas.length > 0 && (
                <tr style={totalRow}>
                  <td style={td}>Total efectivo</td>
                  <td style={tdNum}>{fmt(flujoFilas.reduce((s, f) => s + f.saldo_inicial, 0))}</td>
                  <td style={tdNum}>{fmt(flujoFilas.reduce((s, f) => s + f.entradas, 0))}</td>
                  <td style={tdNum}>{fmt(flujoFilas.reduce((s, f) => s + f.salidas, 0))}</td>
                  <td style={tdNum}>{fmt(flujoFilas.reduce((s, f) => s + f.saldo_final, 0))}</td>
                </tr>
              )}
              {flujoFilas.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-soft)' }}>Sin cuentas de efectivo con movimiento.</td></tr>
              )}
            </tbody>
          </table>
        )
      )}

      {cierres.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: 0 }}>
          Ejercicios cerrados: {cierres.map((c) => c.anio).join(', ')}.
        </p>
      )}
    </div>
  )
}

function FragmentoBalance({ titulo, filas, total, fmt, td, tdNum, totalRow }: {
  titulo: string
  filas: { cuenta_id: string | null; codigo: string; nombre: string; saldo: number }[]
  total: number
  fmt: (n: number) => string
  td: React.CSSProperties
  tdNum: React.CSSProperties
  totalRow: React.CSSProperties
}) {
  return (
    <>
      <tr><td colSpan={2} style={{ ...td, fontWeight: 700, color: 'var(--at-ink-soft)' }}>{titulo}</td></tr>
      {filas.map((f) => (
        <tr key={f.cuenta_id ?? f.codigo}>
          <td style={{ ...td, paddingLeft: 20, fontFamily: 'var(--at-mono, monospace)', fontStyle: f.cuenta_id ? undefined : 'italic' }}>
            {f.cuenta_id ? `${f.codigo} — ` : ''}{f.nombre}
          </td>
          <td style={tdNum}>{fmt(f.saldo)}</td>
        </tr>
      ))}
      <tr style={totalRow}><td style={td}>Total {titulo.toLowerCase()}</td><td style={tdNum}>{fmt(total)}</td></tr>
    </>
  )
}

function CeldasComparativo({ fila, fmt, tdNum }: {
  fila: PyGComparadaFila
  fmt: (n: number) => string
  tdNum: React.CSSProperties
}) {
  // Verde = movimiento favorable: ingresos que suben o gastos que bajan.
  const favorable = (fila.tipo === 'ingreso') === (fila.variacion >= 0)
  return (
    <>
      <td style={tdNum}>{fmt(fila.montoAnterior)}</td>
      <td style={{ ...tdNum, color: fila.variacion === 0 ? undefined : favorable ? 'var(--at-success)' : 'var(--at-danger)' }}>
        {fmt(fila.variacion)}
        {fila.variacionPct !== null && (
          <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.8 }}>
            ({fila.variacionPct > 0 ? '+' : ''}{fila.variacionPct.toFixed(1)}%)
          </span>
        )}
      </td>
    </>
  )
}
