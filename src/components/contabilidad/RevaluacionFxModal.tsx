// Revaluación FX periódica (pendiente declarado de Fase 5): previsualiza y
// aplica el ajuste de los saldos en moneda extranjera contra 3301 Diferencial
// cambiario, a la tasa vigente de conta_tipos_cambio. El cálculo y el asiento
// viven en el RPC conta_revaluar_fx (idempotente por cuenta+fecha).
import { useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useRevaluarFxMutation } from '../../domain/contabilidad/mutations'
import { formatCurrency } from '../../lib/format'
import {
  REVALUACION_RESULTADO_LABELS,
  type RevaluacionFxFila,
  type RevaluacionFxResultado,
} from '../../types/contabilidad'
import { Campo, btnPrimario, btnSecundario, input } from './ui'

const RESULTADO_COLOR: Record<RevaluacionFxResultado, { bg: string; color: string }> = {
  previsualizacion: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  ajustado:         { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  ya_revaluado:     { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  sin_cambio:       { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  sin_tasa:         { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function RevaluacionFxModal({ monedaBase, onClose }: { monedaBase: string; onClose: () => void }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [filas, setFilas] = useState<RevaluacionFxFila[] | null>(null)
  const [aplicado, setAplicado] = useState(false)
  const revaluar = useRevaluarFxMutation()

  async function ejecutar(aplicar: boolean) {
    try {
      const data = await revaluar.mutateAsync({ fecha, aplicar })
      setFilas(data ?? [])
      setAplicado(aplicar)
      if (aplicar) {
        const ajustadas = (data ?? []).filter((f) => f.resultado === 'ajustado').length
        notify({
          variant: 'success',
          title: 'Revaluación aplicada',
          text: ajustadas > 0
            ? `${ajustadas} cuenta(s) ajustada(s) contra 3301 Diferencial cambiario.`
            : 'No hubo ajustes que aplicar.',
          duration: 2600,
        })
      }
    } catch (err) {
      notify({
        variant: 'error',
        title: 'Error al revaluar',
        text: err instanceof Error ? err.message : 'Intente de nuevo.',
      })
    }
  }

  const ajustables = (filas ?? []).some((f) => f.resultado === 'previsualizacion')

  return (
    <EditModal title="Revaluación de moneda extranjera (FX)" onClose={onClose} maxWidth="860px">
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        Compara el saldo en libros ({monedaBase}) de cada cuenta con moneda propia contra su saldo en
        moneda origen a la tasa vigente de la fecha, y genera el asiento de ajuste contra{' '}
        <strong>3301 Diferencial cambiario</strong>. Las cuentas sin tipo de cambio registrado no se
        ajustan: capture la tasa en la pestaña Mapeo.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Campo label="Fecha de revaluación">
          <input
            type="date"
            style={input}
            value={fecha}
            max={hoyISO()}
            onChange={(e) => { setFecha(e.target.value); setFilas(null); setAplicado(false) }}
          />
        </Campo>
        <button
          style={btnSecundario}
          disabled={revaluar.isPending || !fecha}
          onClick={() => void ejecutar(false)}
        >
          {revaluar.isPending ? 'Calculando…' : '🔍 Previsualizar'}
        </button>
        <button
          style={{ ...btnPrimario, opacity: ajustables && !aplicado ? 1 : 0.5 }}
          disabled={revaluar.isPending || !ajustables || aplicado}
          onClick={() => void ejecutar(true)}
        >
          ✓ Aplicar ajustes
        </button>
      </div>

      {filas !== null && (
        filas.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)', padding: '12px 0' }}>
            No hay cuentas con moneda extranjera en el catálogo. Marque la moneda (p. ej. USD) en las
            sub-cuentas de banco/caja correspondientes desde el Catálogo de cuentas.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--at-line)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Cuenta</th>
                  <th style={{ padding: '8px 6px' }}>Saldo origen</th>
                  <th style={{ padding: '8px 6px' }}>Tasa</th>
                  <th style={{ padding: '8px 6px' }}>Saldo libro</th>
                  <th style={{ padding: '8px 6px' }}>Revaluado</th>
                  <th style={{ padding: '8px 6px' }}>Ajuste</th>
                  <th style={{ textAlign: 'center', padding: '8px 6px' }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const rc = RESULTADO_COLOR[f.resultado]
                  return (
                    <tr key={f.cuenta_id} style={{ borderBottom: '1px solid var(--at-chip)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '8px 6px' }}>
                        <span style={{ fontWeight: 600 }}>{f.codigo}</span>
                        <span style={{ color: 'var(--at-ink-3)' }}> · {f.nombre}</span>
                      </td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(f.saldo_origen, f.moneda)}
                      </td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>
                        {f.tasa ?? '—'}
                      </td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(f.saldo_libro, monedaBase)}
                      </td>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>
                        {f.saldo_revaluado !== null ? formatCurrency(f.saldo_revaluado, monedaBase) : '—'}
                      </td>
                      <td style={{
                        padding: '8px 6px', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                        color: (f.ajuste ?? 0) < 0 ? 'var(--at-danger)' : (f.ajuste ?? 0) > 0 ? 'var(--at-success-strong)' : 'var(--at-ink-3)',
                      }}>
                        {f.ajuste !== null ? formatCurrency(f.ajuste, monedaBase) : '—'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                        <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700, background: rc.bg, color: rc.color, whiteSpace: 'nowrap' }}>
                          {REVALUACION_RESULTADO_LABELS[f.resultado]}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </EditModal>
  )
}
