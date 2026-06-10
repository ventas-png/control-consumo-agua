import { useMemo, useState } from 'react'
import { EditModal } from '../shared'
import { notify } from '../shared/Dialog'
import { useCuentasQuery } from '../../domain/contabilidad/queries'
import { useCrearAsientoBorradorMutation, usePublicarAsientoMutation } from '../../domain/contabilidad/mutations'
import { convertirMontoBase, round2, type AsientoLineaFormInput } from '../../domain/contabilidad/schemas'
import { formatCurrency } from '../../lib/format'
import type { Proyecto } from '../../types'
import { Campo, btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  proyectos: Proyecto[]
  monedaBase: string
  onClose: () => void
}

/**
 * Partidas de arranque: captura los saldos iniciales de las cuentas de detalle
 * a una fecha de corte y genera el asiento de APERTURA. El lado (debe/haber)
 * se deriva de la naturaleza de cada cuenta; la diferencia puede ajustarse a
 * Resultados acumulados (3101) con un clic. Solo puede existir una apertura
 * publicada por empresa+proyecto (índice único en BD).
 */
export function AperturaSaldosModal({ companyId, proyectos, monedaBase, onClose }: Props) {
  const { data: cuentas = [] } = useCuentasQuery(companyId)
  const crear = useCrearAsientoBorradorMutation(companyId)
  const publicar = usePublicarAsientoMutation()

  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [projectId, setProjectId] = useState('')
  const [saldos, setSaldos] = useState<Record<string, { monto: string; tipo_cambio: string }>>({})
  const [guardando, setGuardando] = useState(false)

  const detalle = useMemo(
    () => cuentas.filter((c) => c.es_detalle && c.activa).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es')),
    [cuentas],
  )
  const ctaResultados = useMemo(() => detalle.find((c) => c.codigo === '3101'), [detalle])

  function montoBaseDe(cuentaId: string): number {
    const c = detalle.find((x) => x.id === cuentaId)
    const s = saldos[cuentaId]
    if (!c || !s) return 0
    const monto = parseFloat(s.monto) || 0
    if (c.moneda && c.moneda !== monedaBase) {
      return convertirMontoBase(monto, parseFloat(s.tipo_cambio) || 0)
    }
    return monto
  }

  // Naturaleza deudora → saldo inicial al debe; acreedora → al haber.
  const totales = useMemo(() => {
    let debe = 0
    let haber = 0
    for (const c of detalle) {
      const m = montoBaseDe(c.id)
      if (m === 0) continue
      if (c.naturaleza === 'deudora') debe += m
      else haber += m
    }
    return { debe: round2(debe), haber: round2(haber), diferencia: round2(debe - haber) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalle, saldos, monedaBase])

  async function guardar(ajustarDiferencia: boolean) {
    const lineas: AsientoLineaFormInput[] = []
    for (const c of detalle) {
      const m = montoBaseDe(c.id)
      if (m === 0) continue
      const s = saldos[c.id]
      const esFx = !!c.moneda && c.moneda !== monedaBase
      lineas.push({
        cuenta_id: c.id,
        descripcion: 'Saldo inicial',
        debe: c.naturaleza === 'deudora' ? m : 0,
        haber: c.naturaleza === 'acreedora' ? m : 0,
        moneda_origen: esFx ? c.moneda : null,
        monto_origen: esFx ? parseFloat(s?.monto ?? '0') || 0 : null,
        tipo_cambio: esFx ? parseFloat(s?.tipo_cambio ?? '0') || 0 : null,
      })
    }
    if (lineas.length === 0) {
      notify({ variant: 'warning', title: 'Atención', text: 'Captura al menos un saldo inicial.' })
      return
    }
    if (totales.diferencia !== 0) {
      if (!ajustarDiferencia || !ctaResultados) {
        notify({
          variant: 'warning',
          title: 'Apertura descuadrada',
          text: `Diferencia de ${formatCurrency(totales.diferencia, monedaBase)}. Usa "Ajustar contra Resultados acumulados" o corrige los saldos.`,
        })
        return
      }
      lineas.push({
        cuenta_id: ctaResultados.id,
        descripcion: 'Ajuste de apertura',
        debe: totales.diferencia < 0 ? -totales.diferencia : 0,
        haber: totales.diferencia > 0 ? totales.diferencia : 0,
        moneda_origen: null,
        monto_origen: null,
        tipo_cambio: null,
      })
    }

    setGuardando(true)
    try {
      const asiento = await crear.mutateAsync({
        fecha,
        tipo: 'apertura',
        concepto: 'Asiento de apertura — saldos iniciales',
        project_id: projectId || null,
        lineas,
        moneda_base: monedaBase,
      })
      await publicar.mutateAsync(asiento.id)
      notify({ variant: 'success', title: 'Apertura registrada', text: 'Los saldos iniciales quedaron publicados.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo registrar la apertura.' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <EditModal
      title="Saldos iniciales (asiento de apertura)"
      subtitle="Captura el saldo de cada cuenta a la fecha de corte. El lado se deriva de la naturaleza de la cuenta."
      onClose={onClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: totales.diferencia === 0 ? 'var(--at-success)' : 'var(--at-warning)' }}>
            Debe {formatCurrency(totales.debe, monedaBase)} · Haber {formatCurrency(totales.haber, monedaBase)}
            {totales.diferencia !== 0 && ` · diferencia ${formatCurrency(totales.diferencia, monedaBase)}`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnSecundario}>Cancelar</button>
            {totales.diferencia !== 0 && ctaResultados && (
              <button onClick={() => void guardar(true)} disabled={guardando} style={btnSecundario}>
                Ajustar contra Resultados acumulados
              </button>
            )}
            <button onClick={() => void guardar(false)} disabled={guardando} style={btnPrimario}>
              Registrar apertura
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10 }}>
          <Campo label="Fecha de corte">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
          </Campo>
          <Campo label="Ámbito">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={input}>
              <option value="">Toda la empresa</option>
              {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
              <th style={{ padding: 6 }}>Cuenta</th>
              <th style={{ padding: 6, width: 90 }}>Lado</th>
              <th style={{ padding: 6, width: 140, textAlign: 'right' }}>Saldo inicial</th>
              <th style={{ padding: 6, width: 120, textAlign: 'right' }}>T. cambio</th>
              <th style={{ padding: 6, width: 130, textAlign: 'right' }}>En {monedaBase}</th>
            </tr>
          </thead>
          <tbody>
            {detalle.map((c) => {
              const s = saldos[c.id] ?? { monto: '', tipo_cambio: '' }
              const esFx = !!c.moneda && c.moneda !== monedaBase
              const base = montoBaseDe(c.id)
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                  <td style={{ padding: 6, fontFamily: 'var(--at-mono, monospace)' }}>
                    {c.codigo} — {c.nombre}{esFx ? ` (${c.moneda})` : ''}
                  </td>
                  <td style={{ padding: 6, fontSize: 11, color: 'var(--at-ink-soft)' }}>
                    {c.naturaleza === 'deudora' ? 'Debe' : 'Haber'}
                  </td>
                  <td style={{ padding: 6 }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={s.monto}
                      onChange={(e) => setSaldos((prev) => ({ ...prev, [c.id]: { ...s, monto: e.target.value } }))}
                      style={{ ...input, width: '100%', textAlign: 'right' }}
                      placeholder="0.00"
                    />
                  </td>
                  <td style={{ padding: 6 }}>
                    {esFx ? (
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={s.tipo_cambio}
                        onChange={(e) => setSaldos((prev) => ({ ...prev, [c.id]: { ...s, tipo_cambio: e.target.value } }))}
                        style={{ ...input, width: '100%', textAlign: 'right' }}
                        placeholder={`1 ${c.moneda} = ? ${monedaBase}`}
                      />
                    ) : (
                      <span style={{ color: 'var(--at-ink-soft)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: base > 0 ? 'var(--at-ink)' : 'var(--at-ink-soft)' }}>
                    {base > 0 ? formatCurrency(base, monedaBase) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </EditModal>
  )
}
