// Tipos de cambio MENSUALES (20261008000000).
//
// Una tasa por moneda y mes para toda la empresa, en una dirección explícita:
// «1 USD = 7.750000 GTQ». Los documentos se convierten con la tasa del MES de
// su fecha; si falta, no se contabilizan (quedan en borrador) y el aviso dice
// qué configurar. Cambiar una tasa no toca lo ya publicado. Las tasas diarias
// anteriores se muestran sólo como historia.
import { useMemo, useState } from 'react'
import { notify } from '../shared/Dialog'
import { useTiposCambioQuery } from '../../domain/contabilidad/queries'
import {
  tipoCambioMensualSchema,
  useGuardarTipoCambioMensualMutation,
  useHistorialTipoCambioQuery,
  useMonedaEmpresaQuery,
  useTiposCambioMensualQuery,
} from '../../domain/contabilidad/tiposCambio'
import { formatDateShort, formatNumber, hoyLocalISO } from '../../lib/format'
import { Campo, btnLink, btnPrimario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Moneda base del ledger activo (puede no ser la de la empresa). */
  monedaLedger: string
}

export function TiposCambioMensualSection({ companyId, monedaLedger }: Props) {
  const { puedeCrear, puedeEditar } = usePermisosContabilidad()
  const { data: tasas = [], isError, error } = useTiposCambioMensualQuery(companyId)
  const { data: monedaEmpresa } = useMonedaEmpresaQuery(companyId)
  const [verHistorial, setVerHistorial] = useState(false)
  const historial = useHistorialTipoCambioQuery(companyId, verHistorial)
  const [verDiarias, setVerDiarias] = useState(false)
  const { data: diarias = [] } = useTiposCambioQuery(verDiarias ? companyId : undefined)
  const guardar = useGuardarTipoCambioMensualMutation(companyId)
  const [form, setForm] = useState({ moneda: '', periodo: hoyLocalISO().slice(0, 7), tasa: '' })

  const base = monedaEmpresa ?? '…'
  const existente = useMemo(
    () => tasas.find((t) => t.moneda === form.moneda.trim().toUpperCase() && t.periodo === form.periodo) ?? null,
    [tasas, form.moneda, form.periodo],
  )
  const puede = existente ? puedeEditar : puedeCrear

  async function onGuardar() {
    const parsed = tipoCambioMensualSchema.safeParse({ moneda: form.moneda, periodo: form.periodo, tasa: parseFloat(form.tasa) })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    if (monedaEmpresa && parsed.data.moneda === monedaEmpresa) {
      notify({ variant: 'warning', title: 'Atención', text: `${monedaEmpresa} es la moneda de la empresa; no lleva tasa.` })
      return
    }
    try {
      await guardar.mutateAsync({ ...parsed.data, id: existente?.id ?? null })
      notify({
        variant: 'success',
        title: existente ? 'Tasa actualizada' : 'Tasa registrada',
        text: `1 ${parsed.data.moneda} = ${formatNumber(parsed.data.tasa, 6)} ${base} para ${parsed.data.periodo}.`
          + (existente ? ' Los asientos ya publicados conservan la tasa con que se contabilizaron.' : ''),
      })
      setForm((f) => ({ ...f, tasa: '' }))
    } catch (e) {
      notify({ variant: 'error', title: 'No se guardó la tasa', text: e instanceof Error ? e.message : 'Error desconocido.' })
    }
  }

  return (
    <section aria-labelledby="tc-mensual">
      <h3 id="tc-mensual" style={{ margin: '0 0 4px', fontSize: 15 }}>Tipos de cambio (mensuales)</h3>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Una tasa por moneda y <strong>mes</strong>, para toda la empresa: cuántos <strong>{base}</strong> (moneda de la
        empresa) vale <strong>1</strong> unidad de la otra moneda. Compras, ventas y cobros se convierten con la tasa del
        mes de su fecha. Si falta, el asiento queda en borrador y no se publica hasta registrarla: nunca se usa la de
        otro mes. Cambiar una tasa no recalcula lo ya publicado.
        {monedaEmpresa && monedaLedger !== monedaEmpresa && (
          <> Esta contabilidad lleva sus saldos en {monedaLedger}: su conversión cruza por {monedaEmpresa} con las tasas del mismo mes.</>
        )}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 130px 1fr auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
        <Campo label="Moneda">
          <input aria-label="Moneda de origen" value={form.moneda} maxLength={3} placeholder="USD" style={input}
            onChange={(e) => setForm({ ...form, moneda: e.target.value.toUpperCase() })} />
        </Campo>
        <Campo label="Mes">
          <input aria-label="Mes" type="month" value={form.periodo} style={input}
            onChange={(e) => setForm({ ...form, periodo: e.target.value })} />
        </Campo>
        <Campo label={`1 ${form.moneda || '___'} = ? ${base}`}>
          <input aria-label="Tasa" type="number" min="0" step="0.000001" value={form.tasa} placeholder="7.750000"
            style={{ ...input, textAlign: 'right' }} onChange={(e) => setForm({ ...form, tasa: e.target.value })} />
        </Campo>
        <button type="button" onClick={() => void onGuardar()} disabled={guardar.isPending || !puede} style={btnPrimario}>
          {existente ? 'Cambiar' : 'Registrar'}
        </button>
      </div>
      {existente && (
        <p role="note" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-warning)' }}>
          {existente.moneda} ya tiene tasa para {existente.periodo} ({formatNumber(existente.tasa, 6)}). Cambiarla afecta sólo
          a lo que se contabilice o publique desde ahora con fecha de ese mes; queda registrado quién y cuándo.
        </p>
      )}

      {isError ? (
        <p role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>
          No se pudieron cargar las tasas: {error instanceof Error ? error.message : 'error desconocido'}.
        </p>
      ) : tasas.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Sin tasas mensuales registradas.</p>
      ) : (
        <table aria-label="Tasas mensuales" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
              <th style={{ padding: 6 }}>Mes</th>
              <th style={{ padding: 6 }}>Conversión</th>
              <th style={{ padding: 6 }}>Actualizada</th>
            </tr>
          </thead>
          <tbody>
            {tasas.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                <td style={{ padding: 6, fontWeight: 600 }}>{t.periodo}</td>
                <td style={{ padding: 6, fontVariantNumeric: 'tabular-nums' }}>1 {t.moneda} = {formatNumber(t.tasa, 6)} {t.moneda_base}</td>
                <td style={{ padding: 6, fontSize: 12 }}>{formatDateShort(t.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button type="button" style={btnLink} onClick={() => setVerHistorial((v) => !v)}>
          {verHistorial ? 'Ocultar cambios' : 'Ver cambios'}
        </button>
        <button type="button" style={btnLink} onClick={() => setVerDiarias((v) => !v)}>
          {verDiarias ? 'Ocultar tasas diarias anteriores' : 'Tasas diarias anteriores'}
        </button>
      </div>
      {verHistorial && (
        <ul aria-label="Cambios de tipos de cambio" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
          {(historial.data ?? []).map((h) => (
            <li key={h.id}>
              {formatDateShort(h.ocurrido_at)} · {h.accion} · {h.moneda} {h.periodo}:{' '}
              {h.tasa_anterior != null ? formatNumber(h.tasa_anterior, 6) : '—'} → {h.tasa_nueva != null ? formatNumber(h.tasa_nueva, 6) : '—'}
            </li>
          ))}
          {historial.data?.length === 0 && <li>Sin cambios registrados.</li>}
        </ul>
      )}
      {verDiarias && (
        <div role="note" style={{ marginTop: 6, fontSize: 12 }}>
          <p style={{ margin: '0 0 4px', color: 'var(--at-ink-soft)' }}>
            Historia: estas tasas por día ya <strong>no se usan</strong> para convertir. No se derivan tasas mensuales de ellas.
          </p>
          {diarias.length === 0 ? 'Sin tasas diarias.' : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {diarias.map((d) => <li key={d.id}>{formatDateShort(d.fecha)} · 1 {d.moneda} = {formatNumber(d.tasa, 6)}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
