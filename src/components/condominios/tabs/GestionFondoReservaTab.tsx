import { useState, useMemo } from 'react'
import { notify } from '../../shared/Dialog'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { FondoReservaMovimiento } from '../../../types'

interface Props {
  movimientos: FondoReservaMovimiento[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
}

type TipoMov = 'aportacion' | 'retiro' | 'rendimiento' | 'ajuste'

const TIPO_CFG: Record<TipoMov, { label: string; color: string; bg: string; signo: 1 | -1 }> = {
  aportacion:  { label: 'Aportación',  color: 'var(--at-success)', bg: 'var(--at-success-tint)', signo:  1 },
  rendimiento: { label: 'Rendimiento', color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', signo:  1 },
  retiro:      { label: 'Retiro',      color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', signo: -1 },
  ajuste:      { label: 'Ajuste',      color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', signo:  1 },
}

const MESES_L = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export default function GestionFondoReservaTab({ movimientos, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    tipo: 'aportacion' as TipoMov,
    concepto: '',
    monto: '',
    fecha: new Date().toISOString().slice(0, 10),
    referencia: '',
    notas: '',
  })

  // Historial con saldo acumulado
  const historial = useMemo(() => {
    const sorted = [...movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha))
    let saldo = 0
    return sorted.map(m => {
      saldo += TIPO_CFG[m.tipo as TipoMov]?.signo === 1 ? m.monto : -m.monto
      return { ...m, saldoAcum: saldo }
    }).reverse()
  }, [movimientos])

  const saldoActual = historial[0]?.saldoAcum ?? 0

  // Tendencia mensual (últimos 12 meses)
  const tendencia = useMemo(() => {
    const hoy = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - (5 - i), 1)
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const ingresos = movimientos
        .filter(m => m.fecha.startsWith(mes) && (m.tipo === 'aportacion' || m.tipo === 'rendimiento'))
        .reduce((s, m) => s + m.monto, 0)
      const egresos = movimientos
        .filter(m => m.fecha.startsWith(mes) && m.tipo === 'retiro')
        .reduce((s, m) => s + m.monto, 0)
      return { mes, label: MESES_L[d.getMonth()], ingresos, egresos }
    })
  }, [movimientos])

  const maxTend = Math.max(...tendencia.map(t => Math.max(t.ingresos, t.egresos)), 1)

  async function guardar() {
    if (!form.concepto.trim() || !form.monto || parseFloat(form.monto) <= 0) {
      notify({ variant: 'warning', title: 'Datos requeridos', text: 'Completa concepto y monto.' })
      return
    }
    setSaving(true)
    const { error } = await createCondominioRow('fondo_reserva', {
      company_id: companyId, project_id: proyectoId,
      tipo: form.tipo, concepto: form.concepto.trim(),
      monto: parseFloat(form.monto), fecha: form.fecha,
      referencia: form.referencia.trim() || null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ tipo: 'aportacion', concepto: '', monto: '', fecha: new Date().toISOString().slice(0, 10), referencia: '', notas: '' })
    onRefresh()
  }

  const mesActual = new Date().toISOString().slice(0, 7)
  const aportacionesMes = movimientos.filter(m => m.fecha.startsWith(mesActual) && m.tipo === 'aportacion').reduce((s, m) => s + m.monto, 0)
  const retirosMes = movimientos.filter(m => m.fecha.startsWith(mesActual) && m.tipo === 'retiro').reduce((s, m) => s + m.monto, 0)

  const INPUT = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, background: 'var(--at-surface)', outline: 'none' }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Fondo de Reserva</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>{movimientos.length} movimientos registrados</div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Saldo actual', val: `${moneda} ${saldoActual.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: saldoActual >= 0 ? 'var(--at-success)' : 'var(--at-danger)', bg: saldoActual >= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)' },
          { label: 'Aportaciones este mes', val: `${moneda} ${aportacionesMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Retiros este mes', val: `${moneda} ${retirosMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: retirosMes > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', bg: retirosMes > 0 ? 'var(--at-danger-tint)' : 'var(--at-surface-2)' },
          { label: 'Total movimientos', val: String(movimientos.length), color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 130px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14 }}>
        {/* Formulario */}
        {canCreate && (
          <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Nuevo movimiento</div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Tipo</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(Object.entries(TIPO_CFG) as [TipoMov, typeof TIPO_CFG[TipoMov]][]).map(([t, cfg]) => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, tipo: t }))}
                    style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${cfg.color}44`, fontSize: 11, cursor: 'pointer',
                      background: form.tipo === t ? cfg.bg : 'var(--at-surface)', color: cfg.color, fontWeight: form.tipo === t ? 700 : 400 }}>
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {[
              { label: 'Concepto *', key: 'concepto', type: 'text', placeholder: 'Ej: Aportación mensual unidades' },
              { label: 'Monto *', key: 'monto', type: 'number', placeholder: '0.00' },
              { label: 'Fecha *', key: 'fecha', type: 'date', placeholder: '' },
              { label: 'Referencia', key: 'referencia', type: 'text', placeholder: 'No. cheque / transferencia' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input type={f.type} value={(form as Record<string, string>)[f.key]} placeholder={f.placeholder}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={INPUT} />
              </div>
            ))}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Notas</label>
              <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                rows={2} style={{ ...INPUT, resize: 'vertical' }} placeholder="Observaciones opcionales" />
            </div>

            <button onClick={guardar} disabled={saving}
              style={{ width: '100%', padding: '9px 0', background: TIPO_CFG[form.tipo].color, color: 'white',
                border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : `+ Registrar ${TIPO_CFG[form.tipo].label}`}
            </button>
          </div>
        )}

        {/* Panel derecho */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Tendencia */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 10 }}>Movimientos últimos 6 meses</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 80 }}>
              {tendencia.map(t => (
                <div key={t.mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: 65 }}>
                    <div style={{ flex: 1, background: 'var(--at-success)', opacity: 0.8, borderRadius: '2px 2px 0 0', height: `${(t.ingresos / maxTend) * 60}px`, minHeight: t.ingresos > 0 ? 2 : 0 }} />
                    <div style={{ flex: 1, background: 'var(--at-danger)', opacity: 0.7, borderRadius: '2px 2px 0 0', height: `${(t.egresos / maxTend) * 60}px`, minHeight: t.egresos > 0 ? 2 : 0 }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--at-ink-3)' }}>{t.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10 }}>
              <span style={{ color: 'var(--at-success)', fontWeight: 600 }}>■ Entradas</span>
              <span style={{ color: 'var(--at-danger)', fontWeight: 600 }}>■ Salidas</span>
            </div>
          </div>

          {/* Historial */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--at-surface-2)', fontWeight: 700, fontSize: 12, color: 'var(--at-ink-2)' }}>
              Historial de movimientos
            </div>
            {historial.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin movimientos aún.</div>
            ) : (
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {historial.map((m, i) => {
                  const cfg = TIPO_CFG[m.tipo as TipoMov] ?? TIPO_CFG.ajuste
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px', borderBottom: i < historial.length - 1 ? '1px solid var(--at-chip)' : undefined }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)' }}>{m.concepto}</div>
                        <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>
                          {m.fecha} · <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                          {m.referencia && ` · ${m.referencia}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: cfg.signo > 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
                          {cfg.signo > 0 ? '+' : '-'}{moneda} {m.monto.toLocaleString('es', { minimumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: 10, color: m.saldoAcum >= 0 ? 'var(--at-success)' : 'var(--at-danger)', fontWeight: 600 }}>
                          Saldo: {moneda} {m.saldoAcum.toLocaleString('es', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
