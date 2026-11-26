// Depreciación mensual de activos fijos: previsualiza y aplica la cuota del mes
// en línea recta. El cálculo y las pólizas viven en el RPC
// conta_depreciar_activos (una póliza por activo y mes, idempotente): volver a
// aplicar el mismo mes no duplica nada.
import { useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useDepreciarActivosMutation } from '../../domain/contabilidad/mutations'
import { formatCurrency, mesLocalISO } from '../../lib/format'
import {
  DEPRECIACION_RESULTADO_LABELS,
  type DepreciacionFila,
  type DepreciacionResultado,
} from '../../types/contabilidad'
import { Campo, btnPrimario, btnSecundario, input } from './ui'

const RESULTADO_COLOR: Record<DepreciacionResultado, { bg: string; color: string }> = {
  previsualizacion:      { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  aplicado:              { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  ya_depreciado:         { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  no_iniciado:           { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  totalmente_depreciado: { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  sin_cambio:            { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  sin_cuentas:           { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  reversado:             { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  error:                 { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

/** Suma de la cuota del mes de las filas que se depreciarían (o se depreciaron) en esta corrida. */
export function totalDepreciacion(filas: DepreciacionFila[], resultado: DepreciacionResultado): number {
  return Math.round(
    filas.filter((f) => f.resultado === resultado).reduce((s, f) => s + f.depreciacion, 0) * 100,
  ) / 100
}

interface Props {
  projectId: string | null
  monedaBase: string
  /** Aplicar exige «Crear» y «Cambiar estado»; sin ellos el modal solo previsualiza. */
  puedeAplicar: boolean
  onClose: () => void
}

export function DepreciacionActivosModal({ projectId, monedaBase, puedeAplicar, onClose }: Props) {
  const [periodo, setPeriodo] = useState(mesLocalISO())
  const [filas, setFilas] = useState<DepreciacionFila[] | null>(null)
  const [aplicado, setAplicado] = useState(false)
  const depreciar = useDepreciarActivosMutation()

  async function ejecutar(aplicar: boolean) {
    try {
      const data = (await depreciar.mutateAsync({ periodo, aplicar, projectId })) ?? []
      setFilas(data)
      setAplicado(aplicar)
      if (aplicar) {
        const hechos = data.filter((f) => f.resultado === 'aplicado').length
        const fallidos = data.filter((f) => f.resultado === 'error' || f.resultado === 'sin_cuentas').length
        notify({
          variant: fallidos > 0 ? 'warning' : 'success',
          title: 'Depreciación aplicada',
          text: `${hechos} activo(s) depreciado(s) por ${formatCurrency(totalDepreciacion(data, 'aplicado'), monedaBase)}.`
            + (fallidos > 0 ? ` ${fallidos} quedaron sin depreciar: revise la columna Estado.` : ''),
          duration: 3200,
        })
      }
    } catch (err) {
      notify({
        variant: 'error',
        title: 'No se pudo depreciar',
        text: err instanceof Error ? err.message : 'Intente de nuevo.',
      })
    }
  }

  const pendientes = (filas ?? []).some((f) => f.resultado === 'previsualizacion')
  const atrasados = (filas ?? []).filter((f) => f.meses_previos_sin_depreciar > 0)
  const totalMes = filas ? totalDepreciacion(filas, aplicado ? 'aplicado' : 'previsualizacion') : 0

  return (
    <EditModal title="Depreciación mensual de activos fijos" onClose={onClose} maxWidth="920px">
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        Calcula la cuota del mes en <strong>línea recta</strong>: (costo − valor residual) ÷ vida útil, a partir del
        mes siguiente al alta. Genera <strong>una póliza por activo</strong> con fecha del último día del mes
        (gasto por depreciación contra depreciación acumulada). Aplicar dos veces el mismo mes no duplica nada.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Campo label="Mes a depreciar">
          <input
            type="month"
            aria-label="Mes a depreciar"
            style={input}
            value={periodo}
            max={mesLocalISO()}
            onChange={(e) => { setPeriodo(e.target.value); setFilas(null); setAplicado(false) }}
          />
        </Campo>
        <button
          style={btnSecundario}
          disabled={depreciar.isPending || !periodo}
          onClick={() => void ejecutar(false)}
        >
          {depreciar.isPending ? 'Calculando…' : '🔍 Previsualizar'}
        </button>
        {puedeAplicar && (
          <button
            style={{ ...btnPrimario, opacity: pendientes && !aplicado ? 1 : 0.5 }}
            disabled={depreciar.isPending || !pendientes || aplicado}
            onClick={() => void ejecutar(true)}
          >
            ✓ Aplicar depreciación
          </button>
        )}
      </div>

      {!puedeAplicar && (
        <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: '0 0 12px' }}>
          Solo puede previsualizar. Aplicar la depreciación requiere los permisos «Crear» y «Cambiar estado» de Contabilidad.
        </p>
      )}

      {filas !== null && atrasados.length > 0 && (
        <div role="alert" style={{ background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
          {atrasados.length} activo(s) tienen meses anteriores sin depreciar. Este proceso solo registra el mes elegido:
          aplique primero los meses atrasados, del más antiguo al más reciente.
        </div>
      )}

      {filas !== null && (
        filas.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)', padding: '12px 0' }}>
            No hay activos fijos vigentes en este libro. Se dan de alta al registrar una recepción con destino «Activo fijo».
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--at-line)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Activo</th>
                  <th style={{ padding: '8px 6px' }}>Costo</th>
                  <th style={{ padding: '8px 6px' }}>Vida útil</th>
                  <th style={{ padding: '8px 6px' }}>Acumulada antes</th>
                  <th style={{ padding: '8px 6px' }}>Cuota del mes</th>
                  <th style={{ padding: '8px 6px' }}>Valor en libros</th>
                  <th style={{ textAlign: 'center', padding: '8px 6px' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const rc = RESULTADO_COLOR[f.resultado] ?? RESULTADO_COLOR.error
                  return (
                    <tr key={f.activo_id} style={{ borderBottom: '1px solid var(--at-chip)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '8px 6px' }}>
                        <span style={{ fontWeight: 600 }}>{f.codigo}</span>
                        <span style={{ color: 'var(--at-ink-3)' }}> · {f.nombre}</span>
                        {f.motivo && (
                          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{f.motivo}</div>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(f.costo, monedaBase)}</td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{f.vida_util_meses} m</td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(f.acumulada_antes, monedaBase)}</td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {f.depreciacion > 0 ? formatCurrency(f.depreciacion, monedaBase) : '—'}
                      </td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(f.valor_en_libros, monedaBase)}</td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700, background: rc.bg, color: rc.color, whiteSpace: 'nowrap' }}>
                          {DEPRECIACION_RESULTADO_LABELS[f.resultado] ?? f.resultado}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--at-line)', textAlign: 'right', fontWeight: 700 }}>
                  <td colSpan={4} style={{ textAlign: 'left', padding: '8px 6px' }}>
                    {aplicado ? 'Total depreciado en esta corrida' : 'Total por depreciar'}
                  </td>
                  <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(totalMes, monedaBase)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </EditModal>
  )
}
