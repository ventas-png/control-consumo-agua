import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import type { PlanMantenimiento, EjecucionMantenimiento } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  planes: PlanMantenimiento[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const FREQ_DAYS: Record<string, number> = {
  semanal: 7, quincenal: 15, mensual: 30, trimestral: 90, semestral: 180, anual: 365,
}
const FREQ_LABELS: Record<string, string> = {
  semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual',
  trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual',
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function getStatus(p: PlanMantenimiento): 'vencido' | 'urgente' | 'proximo' | 'ok' | 'sin_fecha' {
  if (!p.proxima_ejecucion) return 'sin_fecha'
  const today = new Date().toISOString().slice(0, 10)
  const diff = Math.ceil((new Date(p.proxima_ejecucion).getTime() - new Date(today).getTime()) / 86400000)
  if (diff < 0) return 'vencido'
  if (diff <= 3) return 'urgente'
  if (diff <= 7) return 'proximo'
  return 'ok'
}

const STATUS: Record<string, { bg: string; color: string; label: string }> = {
  vencido:   { bg: '#fee2e2', color: '#ef4444', label: 'Vencido' },
  urgente:   { bg: '#fef3c7', color: '#d97706', label: 'Urgente' },
  proximo:   { bg: '#e0f2fe', color: '#0369a1', label: 'Próximo' },
  ok:        { bg: '#dcfce7', color: '#16a34a', label: 'Al día' },
  sin_fecha: { bg: '#f1f5f9', color: '#94a3b8', label: 'Sin fecha' },
}

const BLANK_PLAN = { equipo: '', descripcion: '', frecuencia: 'mensual', responsable: '', ultima_ejecucion: '', proxima_ejecucion: '', costo_estimado: 0 }
const BLANK_EJEC = { fecha: new Date().toISOString().slice(0, 10), realizado_por: '', costo_real: 0, observaciones: '', estado: 'completado' }

export function MantenimientoPrevTab({ planes, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK_PLAN })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [ejecuciones, setEjecuciones] = useState<EjecucionMantenimiento[]>([])
  const [loadingEj, setLoadingEj] = useState(false)
  const [showEjecForm, setShowEjecForm] = useState(false)
  const [ejecForm, setEjecForm] = useState({ ...BLANK_EJEC })
  const [savingEjec, setSavingEjec] = useState(false)

  const plan = planes.find(p => p.id === selected)

  useEffect(() => {
    if (!selected) return
    setLoadingEj(true)
    supabase.from('ejecuciones_mantenimiento').select('*').eq('plan_id', selected).order('fecha', { ascending: false })
      .then(({ data }) => { setEjecuciones((data ?? []) as EjecucionMantenimiento[]); setLoadingEj(false) })
  }, [selected])

  async function handleSavePlan() {
    if (!form.equipo.trim()) return Swal.fire('Requerido', 'El equipo/área es obligatorio.', 'warning')
    setSaving(true)
    let proxima = form.proxima_ejecucion
    if (!proxima && form.ultima_ejecucion) {
      proxima = addDays(form.ultima_ejecucion, FREQ_DAYS[form.frecuencia] ?? 30)
    }
    const { error } = await supabase.from('planes_mantenimiento').insert({
      company_id: companyId, project_id: proyectoId,
      equipo: form.equipo.trim(), descripcion: form.descripcion || null,
      frecuencia: form.frecuencia, responsable: form.responsable || null,
      ultima_ejecucion: form.ultima_ejecucion || null,
      proxima_ejecucion: proxima || null,
      costo_estimado: form.costo_estimado || null, activo: true,
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setForm({ ...BLANK_PLAN }); onRefresh()
  }

  async function handleRegistrarEjecucion() {
    if (!selected || !plan || !ejecForm.fecha) return
    setSavingEjec(true)
    const proxima = addDays(ejecForm.fecha, FREQ_DAYS[plan.frecuencia] ?? 30)
    const [ejRes] = await Promise.all([
      supabase.from('ejecuciones_mantenimiento').insert({
        company_id: companyId, plan_id: selected, fecha: ejecForm.fecha,
        realizado_por: ejecForm.realizado_por || null,
        costo_real: ejecForm.costo_real || null,
        observaciones: ejecForm.observaciones || null,
        estado: ejecForm.estado,
      }),
      supabase.from('planes_mantenimiento').update({ ultima_ejecucion: ejecForm.fecha, proxima_ejecucion: proxima }).eq('id', selected),
    ])
    setSavingEjec(false)
    if (ejRes.error) return Swal.fire('Error', ejRes.error.message, 'error')
    setShowEjecForm(false); setEjecForm({ ...BLANK_EJEC })
    const { data } = await supabase.from('ejecuciones_mantenimiento').select('*').eq('plan_id', selected).order('fecha', { ascending: false })
    setEjecuciones((data ?? []) as EjecucionMantenimiento[])
    onRefresh()
  }

  async function toggleActivo(id: string, activo: boolean) {
    await supabase.from('planes_mantenimiento').update({ activo: !activo }).eq('id', id)
    onRefresh()
  }

  const planesActivos = planes.filter(p => p.activo)
  const vencidos = planesActivos.filter(p => getStatus(p) === 'vencido').length
  const proximos = planesActivos.filter(p => ['urgente', 'proximo'].includes(getStatus(p))).length

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Mantenimiento Preventivo</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Plan
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Planes activos', value: String(planesActivos.length), color: '#10b981' },
          { label: 'Vencidos',       value: String(vencidos),            color: '#ef4444' },
          { label: 'Próximos 7d',    value: String(proximos),            color: '#f59e0b' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo Plan de Mantenimiento</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Equipo / Área *</label>
              <input style={inputStyle} value={form.equipo} onChange={e => setForm(f => ({ ...f, equipo: e.target.value }))} placeholder="Ej: Bomba de agua, Ascensor, Jardines" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Frecuencia</label>
              <select style={inputStyle} value={form.frecuencia} onChange={e => setForm(f => ({ ...f, frecuencia: e.target.value }))}>
                {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Responsable</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setForm(f => ({ ...f, responsable: e.target.value }))} placeholder="Nombre o empresa" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Última ejecución</label>
              <input style={inputStyle} type="date" value={form.ultima_ejecucion} onChange={e => setForm(f => ({ ...f, ultima_ejecucion: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Próxima ejecución</label>
              <input style={inputStyle} type="date" value={form.proxima_ejecucion} onChange={e => setForm(f => ({ ...f, proxima_ejecucion: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Costo estimado ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.costo_estimado} onChange={e => setForm(f => ({ ...f, costo_estimado: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSavePlan} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Split view */}
      <div style={{ display: 'grid', gridTemplateColumns: plan ? '280px 1fr' : '1fr', gap: '16px' }}>
        {/* Plans list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {planes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay planes. Crea uno para comenzar.</div>
          ) : (
            planes.map(p => {
              const st = getStatus(p)
              const stStyle = STATUS[st]
              return (
                <div key={p.id} onClick={() => setSelected(selected === p.id ? null : p.id)}
                  style={{ background: selected === p.id ? '#f0f9ff' : 'white', border: `1.5px solid ${selected === p.id ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px', cursor: 'pointer', opacity: p.activo ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>{p.equipo}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                        {FREQ_LABELS[p.frecuencia]}{p.responsable ? ` · ${p.responsable}` : ''}
                      </div>
                      {p.proxima_ejecucion && (
                        <div style={{ fontSize: '11px', color: stStyle.color, fontWeight: 600, marginTop: '2px' }}>
                          Próxima: {p.proxima_ejecucion}
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: stStyle.bg, color: stStyle.color, flexShrink: 0, alignSelf: 'flex-start' }}>
                      {stStyle.label}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail */}
        {plan && (
          <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>{plan.equipo}</h3>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {FREQ_LABELS[plan.frecuencia]}
                  {plan.responsable ? ` · ${plan.responsable}` : ''}
                  {plan.costo_estimado ? ` · Est. ${moneda} ${plan.costo_estimado.toFixed(2)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {canEdit && (
                  <button onClick={() => toggleActivo(plan.id, plan.activo)}
                    style={{ padding: '4px 10px', background: plan.activo ? '#fef3c7' : '#dcfce7', color: plan.activo ? '#92400e' : '#16a34a', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                    {plan.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
                {canCreate && plan.activo && (
                  <button onClick={() => setShowEjecForm(v => !v)}
                    style={{ padding: '4px 12px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                    + Registrar ejecución
                  </button>
                )}
              </div>
            </div>

            {/* Execution form */}
            {showEjecForm && (
              <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha *</label>
                    <input style={inputStyle} type="date" value={ejecForm.fecha} onChange={e => setEjecForm(f => ({ ...f, fecha: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Realizado por</label>
                    <input style={inputStyle} value={ejecForm.realizado_por} onChange={e => setEjecForm(f => ({ ...f, realizado_por: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Costo real ({moneda})</label>
                    <input style={inputStyle} type="number" min="0" step="0.01" value={ejecForm.costo_real} onChange={e => setEjecForm(f => ({ ...f, costo_real: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Estado</label>
                    <select style={inputStyle} value={ejecForm.estado} onChange={e => setEjecForm(f => ({ ...f, estado: e.target.value }))}>
                      <option value="completado">Completado</option>
                      <option value="parcial">Parcial</option>
                      <option value="omitido">Omitido</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Observaciones</label>
                    <input style={inputStyle} value={ejecForm.observaciones} onChange={e => setEjecForm(f => ({ ...f, observaciones: e.target.value }))} placeholder="Notas de la ejecución" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                  <button onClick={handleRegistrarEjecucion} disabled={savingEjec}
                    style={{ padding: '6px 14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {savingEjec ? '…' : 'Guardar'}
                  </button>
                  <button onClick={() => setShowEjecForm(false)}
                    style={{ padding: '6px 10px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#64748b' }}>
                    Cancelar
                  </button>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    → Próxima auto: {ejecForm.fecha ? addDays(ejecForm.fecha, FREQ_DAYS[plan.frecuencia] ?? 30) : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* History */}
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>Historial de ejecuciones</div>
            {loadingEj ? (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Cargando…</div>
            ) : ejecuciones.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Sin ejecuciones registradas.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ejecuciones.map(e => {
                  const bg = e.estado === 'completado' ? '#dcfce7' : e.estado === 'parcial' ? '#fef3c7' : '#f1f5f9'
                  const color = e.estado === 'completado' ? '#16a34a' : e.estado === 'parcial' ? '#92400e' : '#94a3b8'
                  return (
                    <div key={e.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '12px' }}>{e.fecha}</div>
                        {e.realizado_por && <div style={{ fontSize: '11px', color: '#64748b' }}>{e.realizado_por}</div>}
                        {e.observaciones && <div style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic', marginTop: '2px' }}>{e.observaciones}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px', background: bg, color, display: 'block', marginBottom: '2px' }}>
                          {e.estado}
                        </span>
                        {e.costo_real != null && <div style={{ fontSize: '11px', color: '#64748b' }}>{moneda} {e.costo_real.toFixed(2)}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
