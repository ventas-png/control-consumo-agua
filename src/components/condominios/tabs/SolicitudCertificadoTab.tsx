import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { SolicitudCertificado, TipoCertificado, EstadoCertificado, Unidad } from '../../../types'

interface Props {
  solicitudes: SolicitudCertificado[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoCertificado; label: string; icon: string }[] = [
  { value: 'solvencia',       label: 'Solvencia',          icon: '✅' },
  { value: 'residencia',      label: 'Residencia',         icon: '🏠' },
  { value: 'historial_pagos', label: 'Historial de pagos', icon: '📊' },
  { value: 'paz_y_salvo',     label: 'Paz y salvo',        icon: '🕊️' },
  { value: 'otro',            label: 'Otro',               icon: '📄' },
]

const ESTADOS: { value: EstadoCertificado; label: string; color: string; bg: string }[] = [
  { value: 'pendiente',   label: 'Pendiente',   color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'en_proceso',  label: 'En proceso',  color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'aprobado',    label: 'Aprobado',    color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'rechazado',   label: 'Rechazado',   color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  { value: 'entregado',   label: 'Entregado',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
]

const FLUJO: EstadoCertificado[] = ['pendiente', 'en_proceso', 'aprobado', 'entregado']

export default function SolicitudCertificadoTab({ solicitudes, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<SolicitudCertificado | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCertificado | ''>('')

  const [form, setForm] = useState({
    unidad_id: '', solicitante: '', tipo: 'solvencia' as TipoCertificado,
    motivo: '', fecha_solicitud: hoyLocalISO(), observaciones: '',
  })

  const lista = solicitudes.filter(s => filtroEstado === '' || s.estado === filtroEstado)
  const kpis = ESTADOS.map(e => ({ ...e, count: solicitudes.filter(s => s.estado === e.value).length }))

  async function guardar() {
    if (!form.solicitante.trim()) { notify({ variant: 'warning', title: 'Faltan datos', text: 'Nombre del solicitante obligatorio' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('solicitudes_certificado', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      solicitante: form.solicitante.trim(), tipo: form.tipo,
      motivo: form.motivo.trim() || null,
      fecha_solicitud: form.fecha_solicitud,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ unidad_id: '', solicitante: '', tipo: 'solvencia', motivo: '', fecha_solicitud: hoyLocalISO(), observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function avanzar(s: SolicitudCertificado) {
    const idx = FLUJO.indexOf(s.estado)
    if (idx < 0 || idx >= FLUJO.length - 1) return
    const siguiente = FLUJO[idx + 1]
    const patch: Record<string, unknown> = { estado: siguiente }
    if (siguiente === 'aprobado') patch.fecha_aprobacion = hoyLocalISO()
    if (siguiente === 'entregado') patch.fecha_entrega = hoyLocalISO()
    const { error } = await updateCondominioRow('solicitudes_certificado', s.id, patch)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selected?.id === s.id) setSelected(prev => prev ? { ...prev, ...patch } as SolicitudCertificado : null)
    onRefresh()
  }

  async function rechazar(s: SolicitudCertificado) {
    const res = await confirm({ title: 'Rechazar solicitud', text: '¿Confirmar rechazo?', icon: 'warning', variant: 'danger', confirmText: 'Rechazar' })
    if (!res.isConfirmed) return
    await updateCondominioRow('solicitudes_certificado', s.id, { estado: 'rechazado' as EstadoCertificado })
    if (selected?.id === s.id) setSelected(prev => prev ? { ...prev, estado: 'rechazado' } as SolicitudCertificado : null)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      <div style={{ width: 320, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Certificados ({lista.length})</span>
            {canCreate && (
              <button onClick={() => { setMostrarForm(true); setSelected(null) }}
                style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nueva
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3, marginBottom: 8 }}>
            {kpis.map(k => (
              <div key={k.value} onClick={() => setFiltroEstado(filtroEstado === k.value ? '' : k.value)}
                style={{ textAlign: 'center', padding: '4px 2px', borderRadius: 6, cursor: 'pointer', background: filtroEstado === k.value ? k.bg : 'var(--at-surface-2)', border: `1px solid ${filtroEstado === k.value ? k.color : 'var(--at-line)'}` }}>
                <div style={{ fontWeight: 700, color: k.color, fontSize: 13 }}>{k.count}</div>
                <div style={{ fontSize: 9, color: k.color, lineHeight: 1.1 }}>{k.label}</div>
              </div>
            ))}
          </div>
        </div>

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin solicitudes</div>}
        {lista.map(s => {
          const est = ESTADOS.find(e => e.value === s.estado)
          const tipo = TIPOS.find(t => t.value === s.tipo)
          const unidad = unidades.find(u => u.id === s.unidad_id)
          return (
            <div key={s.id} onClick={() => { setSelected(s); setMostrarForm(false) }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === s.id ? 'var(--at-accent-tint)' : 'var(--at-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{tipo?.icon} {tipo?.label}</span>
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: est?.bg, color: est?.color }}>{est?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginTop: 2 }}>{s.solicitante}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>
                {unidad && <span>{unidad.nombre} · </span>}
                {s.fecha_solicitud}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {mostrarForm && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nueva solicitud de certificado</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Unidad</label>
                <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                  <option value="">— Sin unidad —</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Solicitante *</label>
                <input style={inp} placeholder="Nombre del residente" value={form.solicitante} onChange={e => setForm(p => ({ ...p, solicitante: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Tipo de certificado</label>
                <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoCertificado }))}>
                  {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Fecha solicitud</label>
                <input type="date" style={inp} value={form.fecha_solicitud} onChange={e => setForm(p => ({ ...p, fecha_solicitud: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Motivo / uso</label>
                <input style={inp} placeholder="Banco, trámite legal…" value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Observaciones</label>
                <textarea style={{ ...inp, height: 60, resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Crear solicitud'}
              </button>
              <button onClick={() => setMostrarForm(false)}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!mostrarForm && selected && (() => {
          const est = ESTADOS.find(e => e.value === selected.estado)
          const tipo = TIPOS.find(t => t.value === selected.tipo)
          const unidad = unidades.find(u => u.id === selected.unidad_id)
          const idx = FLUJO.indexOf(selected.estado)
          const siguiente = idx >= 0 && idx < FLUJO.length - 1 ? FLUJO[idx + 1] : null
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{tipo?.icon} {tipo?.label}</div>
                  <div style={{ fontSize: 14, color: 'var(--at-ink-2)', marginTop: 4 }}>{selected.solicitante}</div>
                  {unidad && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Unidad: {unidad.nombre}</div>}
                  <div style={{ marginTop: 6 }}>
                    <span style={{ padding: '4px 12px', borderRadius: 10, background: est?.bg, color: est?.color, fontSize: 13, fontWeight: 600 }}>{est?.label}</span>
                  </div>
                </div>
                {canEdit && selected.estado !== 'rechazado' && selected.estado !== 'entregado' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {siguiente && (
                      <button onClick={() => avanzar(selected)}
                        style={{ padding: '7px 14px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                        → {ESTADOS.find(e => e.value === siguiente)?.label}
                      </button>
                    )}
                    <button onClick={() => rechazar(selected)}
                      style={{ padding: '7px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      ✕ Rechazar
                    </button>
                  </div>
                )}
              </div>

              {/* Línea de tiempo */}
              <div className="tab-strip-scrollable" style={{ display: 'flex', gap: 0, marginBottom: 20, overflowX: 'auto' }}>
                {FLUJO.map((f, i) => {
                  const e = ESTADOS.find(es => es.value === f)!
                  const actual = selected.estado === f
                  const pasado = FLUJO.indexOf(selected.estado) > i
                  return (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ textAlign: 'center', minWidth: 80 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: actual ? e.color : pasado ? 'var(--at-success-tint)' : 'var(--at-chip)', margin: '0 auto 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: actual ? 'white' : pasado ? 'var(--at-success)' : 'var(--at-ink-3)', fontWeight: 700 }}>
                          {pasado ? '✓' : i + 1}
                        </div>
                        <div style={{ fontSize: 10, color: actual ? e.color : 'var(--at-ink-3)', fontWeight: actual ? 700 : 400 }}>{e.label}</div>
                      </div>
                      {i < FLUJO.length - 1 && <div style={{ width: 24, height: 2, background: pasado ? 'var(--at-success)' : 'var(--at-line)', marginBottom: 16 }} />}
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Fecha solicitud', value: selected.fecha_solicitud },
                  { label: 'Motivo', value: selected.motivo || '—' },
                  { label: 'Fecha aprobación', value: selected.fecha_aprobacion || '—' },
                  { label: 'Aprobado por', value: selected.aprobado_por || '—' },
                  { label: 'Fecha entrega', value: selected.fecha_entrega || '—' },
                ].map(d => (
                  <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 6, padding: '7px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{d.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</div>
                  </div>
                ))}
              </div>

              {selected.observaciones && (
                <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--at-warning-strong)', marginBottom: 3 }}>Observaciones</div>
                  {selected.observaciones}
                </div>
              )}
            </div>
          )
        })()}

        {!mostrarForm && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona una solicitud o crea una nueva
          </div>
        )}
      </div>
    </div>
  )
}
