import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { FlujoAprobacionCond, TipoFlujoAprobacion, EstadoFlujoAprobacion } from '../../../types'

interface Props {
  flujos: FlujoAprobacionCond[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_CFG: Record<TipoFlujoAprobacion, { label: string; icon: string }> = {
  gasto_mayor:  { label: 'Gasto mayor',     icon: '💸' },
  propuesta:    { label: 'Propuesta',        icon: '📋' },
  permiso_obra: { label: 'Permiso de obra',  icon: '🏗️' },
  mudanza:      { label: 'Mudanza',          icon: '📦' },
  otro:         { label: 'Otro',             icon: '📌' },
}

const ESTADO_CFG: Record<EstadoFlujoAprobacion, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  aprobado:  { label: 'Aprobado',  color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  rechazado: { label: 'Rechazado', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const BLANK = { tipo: 'gasto_mayor' as TipoFlujoAprobacion, titulo: '', descripcion: '', monto: '' }

export default function FlujoAprobacionTab({ flujos, proyectoId, companyId, moneda, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoFlujoAprobacion | ''>('pendiente')
  const [form, setForm] = useState({ ...BLANK })
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtrados = filtroEstado ? flujos.filter(f => f.estado === filtroEstado) : flujos

  const pendientes = flujos.filter(f => f.estado === 'pendiente').length
  const aprobados  = flujos.filter(f => f.estado === 'aprobado').length
  const rechazados = flujos.filter(f => f.estado === 'rechazado').length

  async function crear() {
    if (!form.titulo.trim()) { Swal.fire('Campo requerido', 'El título es obligatorio.', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('flujo_aprobacion_cond').insert({
      company_id: companyId,
      project_id: proyectoId,
      tipo: form.tipo,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      monto: form.monto ? parseFloat(form.monto) : null,
      solicitado_por: autorNombre || null,
      estado: 'pendiente',
      fecha_solicitud: new Date().toISOString().slice(0, 10),
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ ...BLANK })
    setShowForm(false)
    onRefresh()
  }

  async function resolver(flujo: FlujoAprobacionCond, nuevoEstado: 'aprobado' | 'rechazado') {
    const { value: comentario } = await Swal.fire({
      title: nuevoEstado === 'aprobado' ? '✅ Aprobar solicitud' : '❌ Rechazar solicitud',
      input: 'textarea',
      inputPlaceholder: 'Comentario (opcional)…',
      showCancelButton: true,
      confirmButtonText: nuevoEstado === 'aprobado' ? 'Aprobar' : 'Rechazar',
      confirmButtonColor: nuevoEstado === 'aprobado' ? 'var(--at-success)' : 'var(--at-danger)',
      cancelButtonText: 'Cancelar',
    })
    if (comentario === undefined) return
    const { error } = await supabase.from('flujo_aprobacion_cond').update({
      estado: nuevoEstado,
      aprobado_por: autorNombre || null,
      fecha_resolucion: new Date().toISOString().slice(0, 10),
      comentario_resolucion: comentario || null,
    }).eq('id', flujo.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function eliminar(flujo: FlujoAprobacionCond) {
    const r = await Swal.fire({ title: '¿Eliminar solicitud?', text: flujo.titulo, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('flujo_aprobacion_cond').delete().eq('id', flujo.id)
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Pendientes',  val: pendientes,  cfg: ESTADO_CFG.pendiente },
          { label: 'Aprobados',   val: aprobados,   cfg: ESTADO_CFG.aprobado  },
          { label: 'Rechazados',  val: rechazados,  cfg: ESTADO_CFG.rechazado },
        ].map(k => (
          <div key={k.label} style={{ background: k.cfg.bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center', cursor: 'pointer' }}
            onClick={() => setFiltroEstado(flujos.find(f => ESTADO_CFG[f.estado].label === k.label) ? (k.label === 'Pendientes' ? 'pendiente' : k.label === 'Aprobados' ? 'aprobado' : 'rechazado') : '')}>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.cfg.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.cfg.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Barra de acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['', 'pendiente', 'aprobado', 'rechazado'] as (EstadoFlujoAprobacion | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '4px 12px', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: filtroEstado === e ? 700 : 400,
                background: filtroEstado === e ? 'var(--at-ink)' : 'var(--at-surface)', color: filtroEstado === e ? 'white' : 'var(--at-ink-2)' }}>
              {e === '' ? 'Todas' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(s => !s)}
            style={{ padding: '6px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {showForm ? '✕ Cancelar' : '+ Nueva solicitud'}
          </button>
        )}
      </div>

      {/* Formulario nueva solicitud */}
      {showForm && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: 'var(--at-primary-hover)' }}>Nueva solicitud de aprobación</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoFlujoAprobacion }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13 }}>
                {(Object.keys(TIPO_CFG) as TipoFlujoAprobacion[]).map(t => <option key={t} value={t}>{TIPO_CFG[t].icon} {TIPO_CFG[t].label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Monto ({moneda})</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="Opcional"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Título *</label>
            <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
              placeholder="Descripción breve de la solicitud"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Descripción adicional</label>
            <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              rows={3} placeholder="Detalles, justificación, adjuntos…"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
          <button onClick={crear} disabled={saving}
            style={{ padding: '8px 18px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </div>
      )}

      {/* Lista de flujos */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          No hay solicitudes {filtroEstado ? ESTADO_CFG[filtroEstado].label.toLowerCase() + 's' : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrados.map(f => {
            const tipoCfg = TIPO_CFG[f.tipo]
            const estCfg = ESTADO_CFG[f.estado]
            return (
              <div key={f.id} style={{ background: 'var(--at-surface)', border: `1px solid ${estCfg.color}33`, borderRadius: 10, padding: '12px 14px', borderLeft: `4px solid ${estCfg.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 14 }}>{tipoCfg.icon}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', borderRadius: 5 }}>{tipoCfg.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', background: estCfg.bg, color: estCfg.color, borderRadius: 5 }}>{estCfg.label}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-ink)', marginBottom: 2 }}>{f.titulo}</div>
                    {f.descripcion && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 4 }}>{f.descripcion}</div>}
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--at-ink-3)', flexWrap: 'wrap' }}>
                      {f.monto && <span>{moneda} {f.monto.toLocaleString('es', { minimumFractionDigits: 2 })}</span>}
                      {f.solicitado_por && <span>Solicitado por: {f.solicitado_por}</span>}
                      <span>{f.fecha_solicitud}</span>
                      {f.fecha_resolucion && <span>Resuelto: {f.fecha_resolucion}</span>}
                      {f.aprobado_por && <span>Por: {f.aprobado_por}</span>}
                    </div>
                    {f.comentario_resolucion && (
                      <div style={{ marginTop: 6, padding: '6px 10px', background: estCfg.bg, borderRadius: 6, fontSize: 11, color: estCfg.color }}>
                        💬 {f.comentario_resolucion}
                      </div>
                    )}
                  </div>
                  {canEdit && f.estado === 'pendiente' && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 10 }}>
                      <button onClick={() => resolver(f, 'aprobado')}
                        style={{ padding: '5px 12px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        ✓ Aprobar
                      </button>
                      <button onClick={() => resolver(f, 'rechazado')}
                        style={{ padding: '5px 12px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        ✕ Rechazar
                      </button>
                    </div>
                  )}
                  {canEdit && f.estado !== 'pendiente' && (
                    <button onClick={() => eliminar(f)}
                      style={{ padding: '4px 8px', border: '1px solid var(--at-danger-border)', borderRadius: 5, cursor: 'pointer', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontSize: 11, flexShrink: 0, marginLeft: 10 }}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
