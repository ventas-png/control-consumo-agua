import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { ConvenioCuotaCond, EstadoConvenioCuota, Unidad } from '../../../types'

interface Props {
  convenios: ConvenioCuotaCond[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoConvenioCuota, { label: string; bg: string; color: string }> = {
  activo:      { label: 'Activo',      bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  cumplido:    { label: 'Cumplido',    bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  incumplido:  { label: 'Incumplido', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  anulado:     { label: 'Anulado',    bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

export default function ConveniosCuotaTab({ convenios, unidades, proyectoId, companyId, moneda, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ConvenioCuotaCond | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoConvenioCuota | ''>('')
  const [form, setForm] = useState({
    unidad_id: '', descripcion: '', monto_total: '', num_cuotas: '3', dia_pago: '5',
    fecha_inicio: new Date().toISOString().slice(0, 10), notas: '',
  })

  const montoC = form.monto_total && form.num_cuotas
    ? parseFloat(form.monto_total) / parseInt(form.num_cuotas)
    : null

  const lista = convenios.filter(c => !filtroEstado || c.estado === filtroEstado)
  const activos = convenios.filter(c => c.estado === 'activo').length
  const incumplidos = convenios.filter(c => c.estado === 'incumplido').length

  function resetForm() {
    setForm({ unidad_id: '', descripcion: '', monto_total: '', num_cuotas: '3', dia_pago: '5', fecha_inicio: new Date().toISOString().slice(0, 10), notas: '' })
    setMostrarForm(false)
  }

  async function guardar() {
    if (!form.unidad_id || !form.descripcion.trim() || !form.monto_total || !form.num_cuotas) {
      notify({ variant: 'warning', title: 'Error', text: 'Unidad, descripción, monto y número de cuotas son obligatorios' }); return
    }
    const monto_total = parseFloat(form.monto_total)
    const num_cuotas = parseInt(form.num_cuotas)
    const monto_cuota = parseFloat((monto_total / num_cuotas).toFixed(2))
    setSaving(true)
    const { error } = await supabase.from('convenios_cuota_cond').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      descripcion: form.descripcion.trim(),
      monto_total, num_cuotas, monto_cuota,
      dia_pago: parseInt(form.dia_pago),
      fecha_inicio: form.fecha_inicio,
      aprobado_por: autorNombre,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    resetForm(); onRefresh()
  }

  async function registrarPago(c: ConvenioCuotaCond) {
    const nuevasPagadas = c.cuotas_pagadas + 1
    const nuevoEstado: EstadoConvenioCuota = nuevasPagadas >= c.num_cuotas ? 'cumplido' : 'activo'
    await supabase.from('convenios_cuota_cond').update({ cuotas_pagadas: nuevasPagadas, estado: nuevoEstado }).eq('id', c.id)
    Swal.fire({ icon: 'success', title: nuevoEstado === 'cumplido' ? '✅ Convenio cumplido' : 'Pago registrado', timer: 1500, showConfirmButton: false })
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoConvenioCuota) {
    await supabase.from('convenios_cuota_cond').update({ estado }).eq('id', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Activos', val: activos, bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
          { label: 'Incumplidos', val: incumplidos, bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
          { label: 'Cumplidos', val: convenios.filter(c => c.estado === 'cumplido').length, bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Total', val: convenios.length, bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['', 'activo', 'cumplido', 'incumplido', 'anulado'] as (EstadoConvenioCuota | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
              {e === '' ? 'Todos' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo convenio'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo convenio de pago</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Descripción *</label>
              <input style={inp} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Ej. Acuerdo de pago cuotas atrasadas Q1 2026" />
            </div>
            <div>
              <label style={lbl}>Monto total ({moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.monto_total} onChange={e => setForm(p => ({ ...p, monto_total: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Número de cuotas *</label>
              <input type="number" min={1} max={24} style={inp} value={form.num_cuotas} onChange={e => setForm(p => ({ ...p, num_cuotas: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Cuota mensual</label>
              <div style={{ ...inp, background: 'var(--at-chip)', color: montoC ? 'var(--at-ink-2)' : 'var(--at-ink-3)' }}>
                {montoC ? `${moneda} ${montoC.toFixed(2)}` : 'Auto-calculado'}
              </div>
            </div>
            <div>
              <label style={lbl}>Día de pago mensual</label>
              <input type="number" min={1} max={28} style={inp} value={form.dia_pago} onChange={e => setForm(p => ({ ...p, dia_pago: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha de inicio</label>
              <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear convenio'}
          </button>
        </div>
      )}

      {/* Lista */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>Sin convenios de pago registrados</div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Lista */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lista.map(c => {
              const ec = ESTADO_CFG[c.estado]
              const pct = Math.round((c.cuotas_pagadas / c.num_cuotas) * 100)
              const unidad = unidades.find(u => u.id === c.unidad_id)
              return (
                <div key={c.id} onClick={() => setSelected(c === selected ? null : c)}
                  style={{ background: selected?.id === c.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', border: `1.5px solid ${selected?.id === c.id ? 'var(--at-accent)' : 'var(--at-line)'}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{unidad?.nombre ?? c.unidad_nombre ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{c.descripcion}</div>
                    </div>
                    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, background: 'var(--at-line)', borderRadius: 20, height: 8, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: c.estado === 'cumplido' ? 'var(--at-success)' : c.estado === 'incumplido' ? 'var(--at-danger)' : 'var(--at-accent-hover)', width: `${pct}%`, borderRadius: 20, transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>
                      {c.cuotas_pagadas}/{c.num_cuotas} · {moneda} {c.monto_cuota.toFixed(2)}/mes
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Detalle */}
          {selected && (
            <div style={{ width: 260, flexShrink: 0, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>Detalle del convenio</div>
              {[
                ['Monto total', `${moneda} ${selected.monto_total.toFixed(2)}`],
                ['Cuotas', `${selected.num_cuotas} de ${moneda} ${selected.monto_cuota.toFixed(2)}`],
                ['Día de pago', `Día ${selected.dia_pago}`],
                ['Inicio', selected.fecha_inicio],
                ['Pagadas', `${selected.cuotas_pagadas} de ${selected.num_cuotas}`],
                ['Aprobado por', selected.aprobado_por ?? '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--at-chip)' }}>
                  <span style={{ color: 'var(--at-ink-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>{v}</span>
                </div>
              ))}
              {selected.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 8 }}>{selected.notas}</div>}
              {canEdit && selected.estado === 'activo' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button onClick={() => registrarPago(selected)}
                    style={{ flex: 1, padding: '7px 0', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    💳 Registrar pago
                  </button>
                  <button onClick={() => cambiarEstado(selected.id, 'incumplido')}
                    style={{ padding: '7px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    ✗
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
