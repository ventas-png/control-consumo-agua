import { useMemo, useState } from 'react'
import { notify } from '../shared/Dialog'
import { useCuentasQuery, useMapeoQuery, useTiposCambioQuery } from '../../domain/contabilidad/queries'
import { useGuardarMapeoMutation, useGuardarTipoCambioMutation } from '../../domain/contabilidad/mutations'
import { tipoCambioFormSchema } from '../../domain/contabilidad/schemas'
import { formatDateShort, formatNumber, hoyLocalISO } from '../../lib/format'
import { EVENTOS_MAPEO } from '../../types/contabilidad'
import { Campo, btnPrimario, input , usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
}

/**
 * Configuración del módulo: (1) mapeo evento de negocio → cuenta contable que
 * usan los asientos automáticos (default de empresa; los triggers respetan
 * overrides por proyecto si se insertan con project_id) y (2) tipos de cambio
 * manuales para las monedas distintas a la base.
 */
export function MapeoCuentasTab({ companyId, projectId, monedaBase }: Props) {
  const { puedeCrear } = usePermisosContabilidad()
  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const { data: mapeos = [] } = useMapeoQuery(companyId, projectId)
  const { data: tiposCambio = [] } = useTiposCambioQuery(companyId)
  const guardarMapeo = useGuardarMapeoMutation(companyId)
  const guardarTC = useGuardarTipoCambioMutation(companyId)

  const [tcForm, setTcForm] = useState({ moneda: '', fecha: hoyLocalISO(), tasa: '' })

  const detalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas])
  const mapeoEmpresa = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of mapeos) if (!x.project_id) m.set(x.evento, x.cuenta_id)
    return m
  }, [mapeos])

  const grupos = useMemo(() => {
    const g = new Map<string, typeof EVENTOS_MAPEO[number][]>()
    for (const e of EVENTOS_MAPEO) {
      const arr = g.get(e.grupo) ?? []
      arr.push(e)
      g.set(e.grupo, arr)
    }
    return [...g.entries()]
  }, [])

  async function onCambioMapeo(evento: string, cuentaId: string) {
    if (!cuentaId) return
    try {
      await guardarMapeo.mutateAsync({ evento, cuentaId })
      notify({ variant: 'success', title: 'Guardado', text: 'Mapeo actualizado.' })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar el mapeo.' })
    }
  }

  async function onGuardarTC() {
    const parsed = tipoCambioFormSchema.safeParse({
      moneda: tcForm.moneda,
      fecha: tcForm.fecha,
      tasa: parseFloat(tcForm.tasa),
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    if (parsed.data.moneda === monedaBase) {
      notify({ variant: 'warning', title: 'Atención', text: `${monedaBase} es la moneda base; no necesita tasa.` })
      return
    }
    try {
      await guardarTC.mutateAsync(parsed.data)
      notify({ variant: 'success', title: 'Guardado', text: `Tasa de ${parsed.data.moneda} registrada.` })
      setTcForm({ ...tcForm, tasa: '' })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar la tasa.' })
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.4fr) minmax(280px, 1fr)', gap: 'var(--at-space-5)', alignItems: 'start' }}>
      {/* ── Mapeo evento → cuenta ── */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Cuentas por evento</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Define a qué cuenta va cada evento de negocio. Los asientos automáticos
          (pagos, gastos, facturas, cuotas) usan este mapeo; si falta uno, ese
          evento no se contabiliza.
        </p>
        {grupos.map(([grupo, eventos]) => (
          <div key={grupo} style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--at-ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{grupo}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {eventos.map((e) => (
                <div key={e.evento} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>{e.label}</span>
                  <select
                    value={mapeoEmpresa.get(e.evento) ?? ''}
                    onChange={(ev) => void onCambioMapeo(e.evento, ev.target.value)}
                    style={input}
                    aria-label={`Cuenta para ${e.label}`}
                  >
                    <option value="">— sin mapear —</option>
                    {detalle.map((c) => (
                      <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ── Tipos de cambio ── */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Tipos de cambio</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Unidades de {monedaBase} por 1 unidad de la moneda extranjera. Los
          asientos en otra moneda usan la tasa vigente a la fecha del documento;
          si no hay tasa, el asiento queda en borrador para revisión.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px auto', gap: 8, alignItems: 'end', marginBottom: 12 }}>
          <Campo label="Moneda">
            <input value={tcForm.moneda} onChange={(e) => setTcForm({ ...tcForm, moneda: e.target.value.toUpperCase() })} style={input} placeholder="USD" maxLength={3} />
          </Campo>
          <Campo label="Fecha">
            <input type="date" value={tcForm.fecha} onChange={(e) => setTcForm({ ...tcForm, fecha: e.target.value })} style={input} />
          </Campo>
          <Campo label={`Tasa (${monedaBase})`}>
            <input type="number" min="0" step="0.000001" value={tcForm.tasa} onChange={(e) => setTcForm({ ...tcForm, tasa: e.target.value })} style={{ ...input, textAlign: 'right' }} placeholder="7.85" />
          </Campo>
          <button onClick={() => void onGuardarTC()} disabled={guardarTC.isPending || !puedeCrear} style={btnPrimario}>Agregar</button>
        </div>
        {tiposCambio.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Sin tasas registradas.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6 }}>Moneda</th>
                <th style={{ padding: 6 }}>Vigente desde</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Tasa</th>
              </tr>
            </thead>
            <tbody>
              {tiposCambio.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                  <td style={{ padding: 6, fontWeight: 600 }}>{t.moneda}</td>
                  <td style={{ padding: 6 }}>{formatDateShort(t.fecha)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(t.tasa, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
