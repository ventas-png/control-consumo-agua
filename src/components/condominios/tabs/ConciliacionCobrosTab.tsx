import { useState, useMemo } from 'react'
import { notify } from '../../shared/Dialog'
import { supabase } from '../../../lib/supabase'
import { CuotaCondominio, Unidad, ConciliacionCobrosLog } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  conciliaciones: ConciliacionCobrosLog[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
}

const METODOS = ['Transferencia', 'Depósito', 'Cheque', 'Efectivo', 'Tarjeta', 'Otro']

export default function ConciliacionCobrosTab({ cuotas, unidades, conciliaciones, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [subTab, setSubTab] = useState<'pendientes' | 'historial'>('pendientes')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [conciliando, setConciliando] = useState<string | null>(null)
  const [form, setForm] = useState({ monto: '', referencia: '', fecha: new Date().toISOString().slice(0, 10), metodo: 'Transferencia', notas: '' })
  const [saving, setSaving] = useState(false)

  const cuotasPendientes = useMemo(() =>
    cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
      .filter(c => !filtroUnidad || c.unidad_id === filtroUnidad)
      .sort((a, b) => (a.fecha_vencimiento ?? '').localeCompare(b.fecha_vencimiento ?? '')),
    [cuotas, filtroUnidad]
  )

  function iniciarConciliacion(cuota: CuotaCondominio) {
    setConciliando(cuota.id)
    setForm(f => ({ ...f, monto: String(cuota.monto), fecha: new Date().toISOString().slice(0, 10) }))
  }

  function cancelarConciliacion() {
    setConciliando(null)
    setForm({ monto: '', referencia: '', fecha: new Date().toISOString().slice(0, 10), metodo: 'Transferencia', notas: '' })
  }

  async function aplicarConciliacion() {
    const cuota = cuotas.find(c => c.id === conciliando)
    if (!cuota || !form.monto) return
    const montoRecibido = parseFloat(form.monto)
    const diferencia = montoRecibido - cuota.monto
    const tolerancia = 0.01

    setSaving(true)

    // Log de conciliación
    const { error: logError } = await supabase.from('conciliacion_cobros_log').insert({
      company_id: companyId,
      project_id: proyectoId,
      cuota_id: cuota.id,
      unidad_id: cuota.unidad_id,
      monto_cuota: cuota.monto,
      monto_recibido: montoRecibido,
      diferencia,
      referencia_pago: form.referencia.trim() || null,
      fecha_pago: form.fecha,
      metodo_pago: form.metodo,
      notas: form.notas.trim() || null,
      estado: Math.abs(diferencia) <= tolerancia ? 'conciliado' : 'diferencia',
    })

    if (logError) {
      setSaving(false)
      notify({ variant: 'error', title: 'Error', text: logError.message })
      return
    }

    // Actualizar cuota si el monto es suficiente
    if (montoRecibido >= cuota.monto - tolerancia) {
      await supabase.from('cuotas_condominio').update({ estado: 'pagado' }).eq('id', cuota.id)
    } else {
      // Pago parcial: dejar en pendiente con nota
      const { data: existing } = await supabase.from('cuotas_condominio').select('notas').eq('id', cuota.id).single()
      const notaActual = (existing as { notas?: string } | null)?.notas ?? ''
      await supabase.from('cuotas_condominio').update({
        notas: `${notaActual}\nPago parcial: ${moneda} ${montoRecibido.toFixed(2)} (${form.fecha})`.trim()
      }).eq('id', cuota.id)
    }

    setSaving(false)

    if (Math.abs(diferencia) > tolerancia) {
      const diff = diferencia > 0
        ? `Pago en exceso de ${moneda} ${diferencia.toFixed(2)}. Considere aplicar el saldo a otra cuota.`
        : `Pago insuficiente: falta ${moneda} ${Math.abs(diferencia).toFixed(2)}. La cuota permanece pendiente.`
      notify({ variant: 'warning', title: 'Diferencia registrada', text: diff })
    } else {
      notify({ variant: 'success', title: 'Conciliado', text: 'Cuota marcada como pagada.', duration: 1500 })
    }

    cancelarConciliacion()
    onRefresh()
  }

  const totalPendiente = cuotasPendientes.reduce((s, c) => s + c.monto, 0)
  const conciliacionesHoy = conciliaciones.filter(c => c.fecha_pago === new Date().toISOString().slice(0, 10))
  const montoConciliadoHoy = conciliacionesHoy.reduce((s, c) => s + c.monto_recibido, 0)

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 4 }}>Conciliación de Cobros</div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Cuotas pendientes', val: cuotasPendientes.length, color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
          { label: 'Monto pendiente', val: `${moneda} ${totalPendiente.toLocaleString('es', { maximumFractionDigits: 0 })}`, color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
          { label: 'Conciliadas hoy', val: conciliacionesHoy.length, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Cobrado hoy', val: `${moneda} ${montoConciliadoHoy.toLocaleString('es', { maximumFractionDigits: 0 })}`, color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 120px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, background: 'var(--at-chip)', borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
        {(['pendientes', 'historial'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            style={{ padding: '6px 18px', border: 'none', cursor: 'pointer', fontSize: 12,
              background: subTab === t ? 'var(--at-primary)' : 'transparent', color: subTab === t ? 'white' : 'var(--at-ink-2)', fontWeight: subTab === t ? 700 : 400 }}>
            {t === 'pendientes' ? `Pendientes (${cuotasPendientes.length})` : `Historial (${conciliaciones.length})`}
          </button>
        ))}
      </div>

      {subTab === 'pendientes' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
              <option value="">Todas las unidades</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>

          {cuotasPendientes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>Sin cuotas pendientes. ¡Todo al día!</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cuotasPendientes.map(cuota => {
                const unidad = unidades.find(u => u.id === cuota.unidad_id)
                const esConciliando = conciliando === cuota.id
                const vencida = cuota.fecha_vencimiento && cuota.fecha_vencimiento < new Date().toISOString().slice(0, 10)
                return (
                  <div key={cuota.id} style={{ background: 'var(--at-surface)', border: `1px solid ${vencida ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-ink)' }}>{cuota.concepto}</div>
                        <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                          {unidad?.nombre ?? cuota.unidad_id} · Período: {cuota.periodo}
                          {cuota.fecha_vencimiento && ` · Vence: ${cuota.fecha_vencimiento}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, fontSize: 15, color: vencida ? 'var(--at-danger)' : 'var(--at-ink)' }}>
                          {moneda} {cuota.monto.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 10, padding: '1px 8px', borderRadius: 20, background: cuota.estado === 'moroso' ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)', color: cuota.estado === 'moroso' ? 'var(--at-danger)' : 'var(--at-warning)', fontWeight: 600 }}>
                          {cuota.estado}
                        </div>
                      </div>
                      {canCreate && !esConciliando && (
                        <button onClick={() => iniciarConciliacion(cuota)}
                          style={{ padding: '7px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                          Conciliar
                        </button>
                      )}
                    </div>

                    {esConciliando && (
                      <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--at-chip)', background: 'var(--at-surface-2)' }}>
                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink)', margin: '10px 0 8px' }}>Registrar pago</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Monto recibido *</label>
                            <input type="number" min="0" step="0.01" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, boxSizing: 'border-box', marginTop: 2 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Fecha</label>
                            <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, boxSizing: 'border-box', marginTop: 2 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Método</label>
                            <select value={form.metodo} onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))}
                              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, boxSizing: 'border-box', marginTop: 2 }}>
                              {METODOS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Referencia</label>
                            <input value={form.referencia} onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))}
                              placeholder="No. transferencia / cheque"
                              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, boxSizing: 'border-box', marginTop: 2 }} />
                          </div>
                          <div style={{ gridColumn: '2 / -1' }}>
                            <label style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Notas</label>
                            <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--at-line-strong)', fontSize: 12, boxSizing: 'border-box', marginTop: 2 }} />
                          </div>
                        </div>
                        {form.monto && Math.abs(parseFloat(form.monto) - cuota.monto) > 0.01 && (
                          <div style={{ marginTop: 6, fontSize: 11, color: parseFloat(form.monto) < cuota.monto ? 'var(--at-danger)' : 'var(--at-warning)', fontWeight: 600 }}>
                            {parseFloat(form.monto) < cuota.monto
                              ? `⚠️ Pago insuficiente: falta ${moneda} ${(cuota.monto - parseFloat(form.monto)).toFixed(2)}`
                              : `ℹ️ Pago en exceso: ${moneda} ${(parseFloat(form.monto) - cuota.monto).toFixed(2)} de diferencia`}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button onClick={aplicarConciliacion} disabled={saving || !form.monto}
                            style={{ padding: '7px 18px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                            {saving ? 'Aplicando…' : '✓ Aplicar'}
                          </button>
                          <button onClick={cancelarConciliacion}
                            style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {subTab === 'historial' && (
        <div>
          {conciliaciones.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>Sin conciliaciones registradas.</div>
          ) : (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--at-surface-2)' }}>
                    {['Fecha', 'Unidad', 'Concepto', 'Cuota', 'Recibido', 'Diferencia', 'Método', 'Ref.', 'Estado'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--at-ink-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conciliaciones.map((c, i) => {
                    const cuota = cuotas.find(q => q.id === c.cuota_id)
                    const unidad = unidades.find(u => u.id === c.unidad_id)
                    const diff = c.monto_recibido - c.monto_cuota
                    return (
                      <tr key={c.id} style={{ borderTop: i > 0 ? '1px solid var(--at-chip)' : undefined }}>
                        <td style={{ padding: '8px 10px', color: 'var(--at-ink-2)' }}>{c.fecha_pago}</td>
                        <td style={{ padding: '8px 10px' }}>{unidad?.nombre ?? '—'}</td>
                        <td style={{ padding: '8px 10px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cuota?.concepto ?? '—'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{moneda} {c.monto_cuota.toFixed(2)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{moneda} {c.monto_recibido.toFixed(2)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: Math.abs(diff) < 0.01 ? 'var(--at-success)' : diff > 0 ? 'var(--at-warning)' : 'var(--at-danger)', fontWeight: 600 }}>
                          {Math.abs(diff) < 0.01 ? '✓' : diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>{c.metodo_pago}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--at-ink-3)', fontSize: 10 }}>{c.referencia_pago ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                            background: c.estado === 'conciliado' ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
                            color: c.estado === 'conciliado' ? 'var(--at-success)' : 'var(--at-warning)' }}>
                            {c.estado}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
