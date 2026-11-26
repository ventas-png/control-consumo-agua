// Estado de cuenta › Antigüedad de saldos: cuánto debe cada residente y qué tan
// viejo es. Sale de los LIBROS (las mismas líneas publicadas que el estado de
// cuenta), así que su total es el saldo de la cuenta por cobrar de la balanza.
// El reparto por tramos lo hace el servidor (PEPS); aquí solo se suma el pie.
import { useMemo, useState } from 'react'
import { useCxcAntiguedadQuery } from '../../domain/contabilidad/queries'
import { exportarExcel } from '../condominios/exportUtils'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
import { TRAMOS_ANTIGUEDAD_CXC, type AntiguedadCxcFila } from '../../types/contabilidad'
import { Campo, btnLink, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
  /** Abre el estado de cuenta de la fila (unidad si la tiene; si no, el auxiliar). */
  onVerEstado?: (fila: AntiguedadCxcFila) => void
}

const CLAVES = [...TRAMOS_ANTIGUEDAD_CXC.map((t) => t.clave), 'sin_asignar', 'total'] as const
type Clave = (typeof CLAVES)[number]

/** Pie de la tabla: la suma de cada columna, a centavos. */
export function totalesAntiguedad(filas: readonly AntiguedadCxcFila[]): Record<Clave, number> {
  const t = Object.fromEntries(CLAVES.map((c) => [c, 0])) as Record<Clave, number>
  for (const f of filas) for (const c of CLAVES) t[c] += Number(f[c]) || 0
  for (const c of CLAVES) t[c] = Math.round(t[c] * 100) / 100
  return t
}

export function AntiguedadCxcPanel({ companyId, projectId, monedaBase, onVerEstado }: Props) {
  const [corte, setCorte] = useState(hoyLocalISO())
  const consulta = useCxcAntiguedadQuery(companyId, projectId, corte)
  const filas = useMemo(() => consulta.data ?? [], [consulta.data])
  const totales = useMemo(() => totalesAntiguedad(filas), [filas])
  // «Sin asignar» casi siempre es cero: la columna solo aparece cuando explica algo.
  const haySinAsignar = filas.some((f) => Number(f.sin_asignar) !== 0)
  const dinero = (v: number) => formatCurrency(v, monedaBase)
  const vencido = totales.d1_30 + totales.d31_60 + totales.d61_90 + totales.d90_mas

  function exportar() {
    exportarExcel(`antiguedad-saldos-por-cobrar-${corte}.xlsx`, [{
      name: 'Antigüedad',
      headers: ['Auxiliar', 'Código', 'Unidad', ...TRAMOS_ANTIGUEDAD_CXC.map((t) => t.label), 'Sin asignar', 'Total', 'Vence desde'],
      rows: filas.map((f) => [
        f.cliente_nombre ?? 'Sin auxiliar', f.codigo_auxiliar ?? '', f.unidad_nombre ?? '',
        ...TRAMOS_ANTIGUEDAD_CXC.map((t) => Number(f[t.clave])), Number(f.sin_asignar), Number(f.total),
        f.vencimiento_mas_antiguo ?? '',
      ]),
    }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        Lo que cada residente debe según los <strong>libros</strong> (pólizas publicadas), repartido por días de vencido.
        Los abonos se aplican primero a los cargos más antiguos. El total coincide con la cuenta por cobrar de la balanza.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Campo label="Al corte">
          <input type="date" value={corte} max={hoyLocalISO()} onChange={(e) => setCorte(e.target.value || hoyLocalISO())} style={input} />
        </Campo>
        <button type="button" onClick={exportar} disabled={filas.length === 0} style={btnSecundario}>Exportar Excel</button>
        {filas.length > 0 && (
          <span style={{ fontSize: 13 }}>
            Por cobrar <strong>{dinero(totales.total)}</strong> · vencido <strong style={{ color: vencido > 0 ? 'var(--at-danger)' : undefined }}>{dinero(vencido)}</strong>
          </span>
        )}
      </div>

      {consulta.isError ? (
        <div role="alert" style={{ border: '1px solid var(--at-danger)', borderRadius: 12, padding: 16 }}>
          <strong>No se pudo calcular la antigüedad de saldos.</strong>
          <p style={{ margin: '6px 0 10px', fontSize: 13 }}>
            {consulta.error instanceof Error ? consulta.error.message : 'Error desconocido.'}
          </p>
          <button type="button" style={btnSecundario} onClick={() => void consulta.refetch()}>Reintentar</button>
        </div>
      ) : consulta.isLoading ? (
        <p role="status" style={{ margin: 0 }}>Calculando antigüedad de saldos…</p>
      ) : filas.length === 0 ? (
        <div role="status" style={{ border: '1px dashed var(--at-line)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <strong>Sin saldos por cobrar al {formatDateShort(corte)}</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--at-ink-soft)' }}>
            Aparecen aquí los cargos contabilizados por tipo de cargo (cuotas, mora y cargos adicionales) que sigan sin cobrarse.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'right', borderBottom: '2px solid var(--at-line)' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Auxiliar · unidad</th>
                {TRAMOS_ANTIGUEDAD_CXC.map((t) => <th key={t.clave} style={{ padding: 6 }}>{t.label}</th>)}
                {haySinAsignar && <th style={{ padding: 6 }} title="Lo que no corresponde a un cargo: negativo = pagó de más">Sin asignar</th>}
                <th style={{ padding: 6 }}>Total</th>
                <th style={{ padding: 6 }} aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.cliente_id ?? '-'}:${f.unidad_id ?? '-'}`} style={{ borderBottom: '1px solid var(--at-line)', textAlign: 'right' }}>
                  <td style={{ padding: 6, textAlign: 'left' }}>
                    <div style={{ fontWeight: 600 }}>{f.cliente_nombre ?? 'Sin auxiliar'}</div>
                    <div style={{ color: 'var(--at-ink-soft)', fontSize: 12 }}>
                      {[f.unidad_nombre, f.codigo_auxiliar].filter(Boolean).join(' · ') || '—'}
                      {f.vencimiento_mas_antiguo ? ` · vence desde ${formatDateShort(f.vencimiento_mas_antiguo)}` : ''}
                    </div>
                  </td>
                  {TRAMOS_ANTIGUEDAD_CXC.map((t) => {
                    const v = Number(f[t.clave])
                    return (
                      <td key={t.clave} style={{ padding: 6, whiteSpace: 'nowrap', color: v === 0 ? 'var(--at-ink-soft)' : t.clave === 'd90_mas' ? 'var(--at-danger)' : undefined }}>
                        {v === 0 ? '—' : dinero(v)}
                      </td>
                    )
                  })}
                  {haySinAsignar && (
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{Number(f.sin_asignar) === 0 ? '—' : dinero(Number(f.sin_asignar))}</td>
                  )}
                  <td style={{ padding: 6, whiteSpace: 'nowrap', fontWeight: 700 }}>{dinero(Number(f.total))}</td>
                  <td style={{ padding: 6 }}>
                    {onVerEstado && (f.unidad_id || f.cliente_id) && (
                      <button type="button" style={btnLink} onClick={() => onVerEstado(f)}>Ver estado</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--at-line)', textAlign: 'right' }}>
                <td style={{ padding: 6 }}>Totales ({filas.length})</td>
                {TRAMOS_ANTIGUEDAD_CXC.map((t) => <td key={t.clave} style={{ padding: 6, whiteSpace: 'nowrap' }}>{dinero(totales[t.clave])}</td>)}
                {haySinAsignar && <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{dinero(totales.sin_asignar)}</td>}
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{dinero(totales.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {haySinAsignar && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
          «Sin asignar» es la parte del saldo que no corresponde a un cargo: en negativo, el residente tiene abonos de más en su cuenta por cobrar.
        </p>
      )}
    </div>
  )
}
