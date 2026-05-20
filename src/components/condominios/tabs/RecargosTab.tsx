import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { RecargoMora, EstadoRecargo, TipoRecargo, Unidad, CuotaCondominio, ReglaMoraConfig } from '../../../types'

interface Props {
  recargos: RecargoMora[]
  cuotas: CuotaCondominio[]
  reglas: ReglaMoraConfig[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoRecargo, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', bg: '#fef3c7', color: '#92400e' },
  aplicado:  { label: 'Aplicado',  bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  anulado:   { label: 'Anulado',   bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

export default function RecargosTab({ recargos, cuotas, reglas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoRecargo | ''>('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [form, setForm] = useState({
    unidad_id: '', cuota_id: '', tipo: 'porcentaje' as TipoRecargo,
    valor: '', fecha_aplicacion: new Date().toISOString().slice(0, 10), motivo: '',
  })

  const cuotasVencidas = cuotas.filter(c => c.estado === 'moroso' || c.estado === 'pendiente')
  const cuotasUnidad = form.unidad_id ? cuotasVencidas.filter(c => c.unidad_id === form.unidad_id) : []

  const lista = recargos.filter(r =>
    (!filtroEstado || r.estado === filtroEstado) &&
    (!filtroUnidad || r.unidad_id === filtroUnidad)
  )

  const totalAplicado = recargos.filter(r => r.estado === 'aplicado').reduce((s, r) => s + r.monto_calculado, 0)
  const totalPendiente = recargos.filter(r => r.estado === 'pendiente').reduce((s, r) => s + r.monto_calculado, 0)

  function calcularMonto() {
    if (!form.valor) return null
    if (form.tipo === 'monto_fijo') return parseFloat(form.valor)
    if (form.cuota_id) {
      const cuota = cuotas.find(c => c.id === form.cuota_id)
      if (cuota) return (cuota.monto * parseFloat(form.valor)) / 100
    }
    return null
  }

  const montoPreview = calcularMonto()

  function resetForm() {
    setForm({ unidad_id: '', cuota_id: '', tipo: 'porcentaje', valor: '', fecha_aplicacion: new Date().toISOString().slice(0, 10), motivo: '' })
    setMostrarForm(false)
  }

  async function guardar() {
    if (!form.unidad_id || !form.valor) { Swal.fire('Error', 'Unidad y valor son obligatorios', 'warning'); return }
    const monto = montoPreview
    if (!monto || monto <= 0) { Swal.fire('Error', 'El monto calculado debe ser mayor a 0', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('recargos_mora').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      cuota_id: form.cuota_id || null,
      tipo: form.tipo,
      valor: parseFloat(form.valor),
      monto_calculado: monto,
      fecha_aplicacion: form.fecha_aplicacion,
      motivo: form.motivo.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    resetForm(); onRefresh()
  }

  async function cambiarEstado(r: RecargoMora, estado: EstadoRecargo) {
    const update: Record<string, unknown> = { estado }
    if (estado === 'anulado') update.fecha_anulacion = new Date().toISOString()
    await supabase.from('recargos_mora').update(update).eq('id', r.id)
    onRefresh()
  }

  async function aplicarMasivo() {
    const hoy = new Date().toISOString().slice(0, 10)
    const reglaActiva = reglas.find(r => r.activa)
    // cuotas vencidas: moroso o pendiente con fecha_vencimiento superada
    const cuotasVenc = cuotas.filter(c =>
      c.estado === 'moroso' ||
      (c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
    )
    const unidadesMorosas = [...new Set(cuotasVenc.map(c => c.unidad_id).filter(Boolean))]
    if (unidadesMorosas.length === 0) { Swal.fire('Sin cuotas vencidas', 'No hay cuotas vencidas a las que aplicar recargo.', 'info'); return }

    let pct = 5
    let tipoRecargo: TipoRecargo = 'porcentaje'
    let motivo = `Recargo masivo mora`

    if (reglaActiva) {
      pct = reglaActiva.valor
      tipoRecargo = reglaActiva.tipo === 'porcentaje' ? 'porcentaje' : 'monto_fijo'
      motivo = `Recargo automático — ${reglaActiva.nombre}`
      const conf = await Swal.fire({
        title: 'Aplicar mora automática',
        html: `<p style="font-size:13px;color:var(--at-ink-2)">Usando regla: <b>${reglaActiva.nombre}</b><br>
               Tipo: <b>${tipoRecargo === 'porcentaje' ? pct + '%' : moneda + ' ' + pct + ' fijo'}</b><br>
               ${unidadesMorosas.length} unidades afectadas</p>`,
        icon: 'question', showCancelButton: true,
        confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar', confirmButtonColor: '#dc2626',
      })
      if (!conf.isConfirmed) return
    } else {
      const { value } = await Swal.fire({
        title: 'Recargo masivo por mora',
        html: `<p style="font-size:13px;color:var(--at-ink-2);margin-bottom:8px">${unidadesMorosas.length} unidades con cuotas vencidas · Porcentaje de recargo:</p>
               <input id="pct-input" class="swal2-input" type="number" min="0.1" max="100" step="0.1" value="5" style="font-size:14px">
               <p style="font-size:11px;color:var(--at-ink-3);margin-top:4px">Configura reglas automáticas en la pestaña "Reglas mora"</p>`,
        showCancelButton: true, confirmButtonText: 'Aplicar', cancelButtonText: 'Cancelar',
        preConfirm: () => parseFloat((document.getElementById('pct-input') as HTMLInputElement)?.value ?? '0'),
      })
      if (!value || value <= 0) return
      pct = value
    }

    setSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    const rows = unidadesMorosas.map(uid => {
      const cuotasU = cuotasVenc.filter(c => c.unidad_id === uid)
      const montoBase = cuotasU.reduce((s, c) => s + c.monto, 0)
      const monto_calculado = tipoRecargo === 'porcentaje'
        ? parseFloat(((montoBase * pct) / 100).toFixed(2))
        : pct
      return {
        company_id: companyId, project_id: proyectoId,
        unidad_id: uid, tipo: tipoRecargo, valor: pct,
        monto_calculado, fecha_aplicacion: today, motivo,
      }
    })
    const { error } = await supabase.from('recargos_mora').insert(rows)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${rows.length} recargos creados`, text: `Total: ${moneda} ${rows.reduce((s, r) => s + r.monto_calculado, 0).toFixed(2)}`, timer: 2200, showConfirmButton: false })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Recargos aplicados', val: recargos.filter(r => r.estado === 'aplicado').length, sub: `${moneda} ${totalAplicado.toLocaleString()}`, bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
          { label: 'Pendientes de aplicar', val: recargos.filter(r => r.estado === 'pendiente').length, sub: `${moneda} ${totalPendiente.toLocaleString()}`, bg: '#fef3c7', color: '#d97706' },
          { label: 'Anulados', val: recargos.filter(r => r.estado === 'anulado').length, sub: '', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
          { label: 'Unidades con mora', val: new Set(cuotas.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size, sub: '', bg: '#fef2f2', color: '#ef4444' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10, color: k.color }}>{k.label}</div>
            {k.sub && <div style={{ fontSize: 11, color: k.color, fontWeight: 600 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filtros + botones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          {(['', 'pendiente', 'aplicado', 'anulado'] as (EstadoRecargo | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
              {e === '' ? 'Todos' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <button onClick={aplicarMasivo} disabled={saving}
              style={{ padding: '8px 14px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ⚡ Recargo masivo
            </button>
          )}
          {canCreate && (
            <button onClick={() => setMostrarForm(!mostrarForm)}
              style={{ padding: '8px 14px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
              {mostrarForm ? '✕ Cancelar' : '+ Recargo individual'}
            </button>
          )}
        </div>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo recargo de mora</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value, cuota_id: '' }))}>
                <option value="">Seleccionar…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Cuota relacionada</label>
              <select style={inp} value={form.cuota_id} onChange={e => setForm(p => ({ ...p, cuota_id: e.target.value }))} disabled={!form.unidad_id}>
                <option value="">Sin cuota específica</option>
                {cuotasUnidad.map(c => <option key={c.id} value={c.id}>{c.concepto} {c.periodo} — {moneda} {c.monto}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Tipo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoRecargo }))}>
                <option value="porcentaje">Porcentaje (%)</option>
                <option value="monto_fijo">Monto fijo</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Valor ({form.tipo === 'porcentaje' ? '%' : moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha de aplicación</label>
              <input type="date" style={inp} value={form.fecha_aplicacion} onChange={e => setForm(p => ({ ...p, fecha_aplicacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Motivo</label>
              <input style={inp} value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          {montoPreview !== null && (
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13, color: '#92400e' }}>
              Monto a cobrar: <strong>{moneda} {montoPreview.toFixed(2)}</strong>
            </div>
          )}
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear recargo'}
          </button>
        </div>
      )}

      {/* Tabla */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>Sin recargos de mora registrados</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                {['Unidad', 'Fecha', 'Tipo', 'Valor', 'Monto', 'Estado', 'Motivo', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600, borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map(r => {
                const ec = ESTADO_CFG[r.estado]
                const unidad = unidades.find(u => u.id === r.unidad_id)
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{unidad?.nombre ?? r.unidad_nombre ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-3)' }}>{r.fecha_aplicacion}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-2)' }}>{r.tipo === 'porcentaje' ? `${r.valor}%` : 'Fijo'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-2)' }}>{r.tipo === 'porcentaje' ? `${r.valor}%` : `${moneda} ${r.valor}`}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: '#dc2626' }}>{moneda} {r.monto_calculado.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-3)', fontSize: 12 }}>{r.motivo ?? '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {canEdit && r.estado === 'pendiente' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => cambiarEstado(r, 'aplicado')}
                            style={{ padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Aplicar</button>
                          <button onClick={() => cambiarEstado(r, 'anulado')}
                            style={{ padding: '4px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Anular</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
