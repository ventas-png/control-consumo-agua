import { hoyLocalISO } from '../../../lib/format'
import { useState, useEffect, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchEjecucionesMantenimiento } from '../../../domain/condominios/tabQueries'
import type { PlanMantenimiento, EjecucionMantenimiento } from '../../../types'
import { notify } from '../../shared/Dialog'

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
  const today = hoyLocalISO()
  const diff = Math.ceil((new Date(p.proxima_ejecucion).getTime() - new Date(today).getTime()) / 86400000)
  if (diff < 0) return 'vencido'
  if (diff <= 3) return 'urgente'
  if (diff <= 7) return 'proximo'
  return 'ok'
}

const STATUS: Record<string, { bg: string; color: string; label: string }> = {
  vencido:   { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Vencido' },
  urgente:   { bg: 'var(--at-warning-tint)', color: 'var(--at-warning)', label: 'Urgente' },
  proximo:   { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Próximo' },
  ok:        { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Al día' },
  sin_fecha: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Sin fecha' },
}

const BLANK_PLAN = { equipo: '', descripcion: '', frecuencia: 'mensual', responsable: '', ultima_ejecucion: '', proxima_ejecucion: '', costo_estimado: 0 }
const BLANK_EJEC = { fecha: hoyLocalISO(), realizado_por: '', costo_real: 0, observaciones: '', estado: 'completado' }

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
    void fetchEjecucionesMantenimiento<EjecucionMantenimiento>(selected)
      .then(data => { setEjecuciones(data); setLoadingEj(false) })
  }, [selected])

  async function handleSavePlan() {
    if (!form.equipo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El equipo/área es obligatorio.' })
    setSaving(true)
    let proxima = form.proxima_ejecucion
    if (!proxima && form.ultima_ejecucion) {
      proxima = addDays(form.ultima_ejecucion, FREQ_DAYS[form.frecuencia] ?? 30)
    }
    const { error } = await createCondominioRow('planes_mantenimiento', {
      company_id: companyId, project_id: proyectoId,
      equipo: form.equipo.trim(), descripcion: form.descripcion || null,
      frecuencia: form.frecuencia, responsable: form.responsable || null,
      ultima_ejecucion: form.ultima_ejecucion || null,
      proxima_ejecucion: proxima || null,
      costo_estimado: form.costo_estimado || null, activo: true,
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK_PLAN }); onRefresh()
  }

  async function handleRegistrarEjecucion() {
    if (!selected || !plan || !ejecForm.fecha) return
    setSavingEjec(true)
    const proxima = addDays(ejecForm.fecha, FREQ_DAYS[plan.frecuencia] ?? 30)
    const [ejRes] = await Promise.all([
      createCondominioRow('ejecuciones_mantenimiento', {
        company_id: companyId, plan_id: selected, fecha: ejecForm.fecha,
        realizado_por: ejecForm.realizado_por || null,
        costo_real: ejecForm.costo_real || null,
        observaciones: ejecForm.observaciones || null,
        estado: ejecForm.estado,
      }),
      updateCondominioRow('planes_mantenimiento', selected, { ultima_ejecucion: ejecForm.fecha, proxima_ejecucion: proxima }),
    ])
    setSavingEjec(false)
    if (ejRes.error) return notify({ variant: 'error', title: 'Error', text: ejRes.error.message })
    setShowEjecForm(false); setEjecForm({ ...BLANK_EJEC })
    setEjecuciones(await fetchEjecucionesMantenimiento<EjecucionMantenimiento>(selected))
    onRefresh()
  }

  async function toggleActivo(id: string, activo: boolean) {
    await updateCondominioRow('planes_mantenimiento', id, { activo: !activo })
    onRefresh()
  }

  const planesActivos = planes.filter(p => p.activo)
  const vencidos = planesActivos.filter(p => getStatus(p) === 'vencido').length
  const proximos = planesActivos.filter(p => ['urgente', 'proximo'].includes(getStatus(p))).length

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Mantenimiento Preventivo</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Plan
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Planes activos', value: String(planesActivos.length), color: 'var(--at-success)' },
          { label: 'Vencidos',       value: String(vencidos),            color: 'var(--at-danger)' },
          { label: 'Próximos 7d',    value: String(proximos),            color: 'var(--at-warning)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo Plan de Mantenimiento</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Equipo / Área *</label>
              <input style={inputStyle} value={form.equipo} onChange={e => setForm(f => ({ ...f, equipo: e.target.value }))} placeholder="Ej: Bomba de agua, Ascensor, Jardines" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Frecuencia</label>
              <select style={inputStyle} value={form.frecuencia} onChange={e => setForm(f => ({ ...f, frecuencia: e.target.value }))}>
                {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Responsable</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setForm(f => ({ ...f, responsable: e.target.value }))} placeholder="Nombre o empresa" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Última ejecución</label>
              <input style={inputStyle} type="date" value={form.ultima_ejecucion} onChange={e => setForm(f => ({ ...f, ultima_ejecucion: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Próxima ejecución</label>
              <input style={inputStyle} type="date" value={form.proxima_ejecucion} onChange={e => setForm(f => ({ ...f, proxima_ejecucion: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Costo estimado ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.costo_estimado} onChange={e => setForm(f => ({ ...f, costo_estimado: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSavePlan} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
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
            <EmptyState icon="📋" title="No hay planes. Crea uno para comenzar" />
          ) : (
            planes.map(p => {
              const st = getStatus(p)
              const stStyle = STATUS[st]
              return (
                <div key={p.id} onClick={() => setSelected(selected === p.id ? null : p.id)}
                  style={{ background: selected === p.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', border: `1.5px solid ${selected === p.id ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px', cursor: 'pointer', opacity: p.activo ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{p.equipo}</div>
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
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
          <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>{plan.equipo}</h3>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  {FREQ_LABELS[plan.frecuencia]}
                  {plan.responsable ? ` · ${plan.responsable}` : ''}
                  {plan.costo_estimado ? ` · Est. ${moneda} ${plan.costo_estimado.toFixed(2)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {canEdit && (
                  <button onClick={() => toggleActivo(plan.id, plan.activo)}
                    style={{ padding: '4px 10px', background: plan.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', color: plan.activo ? 'var(--at-warning-strong)' : 'var(--at-success)', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                    {plan.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
                {canCreate && plan.activo && (
                  <button onClick={() => setShowEjecForm(v => !v)}
                    style={{ padding: '4px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                    + Registrar ejecución
                  </button>
                )}
              </div>
            </div>

            {/* Execution form */}
            {showEjecForm && (
              <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha *</label>
                    <input style={inputStyle} type="date" value={ejecForm.fecha} onChange={e => setEjecForm(f => ({ ...f, fecha: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Realizado por</label>
                    <input style={inputStyle} value={ejecForm.realizado_por} onChange={e => setEjecForm(f => ({ ...f, realizado_por: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Costo real ({moneda})</label>
                    <input style={inputStyle} type="number" min="0" step="0.01" value={ejecForm.costo_real} onChange={e => setEjecForm(f => ({ ...f, costo_real: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
                    <select style={inputStyle} value={ejecForm.estado} onChange={e => setEjecForm(f => ({ ...f, estado: e.target.value }))}>
                      <option value="completado">Completado</option>
                      <option value="parcial">Parcial</option>
                      <option value="omitido">Omitido</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Observaciones</label>
                    <input style={inputStyle} value={ejecForm.observaciones} onChange={e => setEjecForm(f => ({ ...f, observaciones: e.target.value }))} placeholder="Notas de la ejecución" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                  <button onClick={handleRegistrarEjecucion} disabled={savingEjec}
                    style={{ padding: '6px 14px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {savingEjec ? '…' : 'Guardar'}
                  </button>
                  <button onClick={() => setShowEjecForm(false)}
                    style={{ padding: '6px 10px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
                    Cancelar
                  </button>
                  <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                    → Próxima auto: {ejecForm.fecha ? addDays(ejecForm.fecha, FREQ_DAYS[plan.frecuencia] ?? 30) : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* History */}
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px' }}>Historial de ejecuciones</div>
            {loadingEj ? (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Cargando…</div>
            ) : ejecuciones.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Sin ejecuciones registradas.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ejecuciones.map(e => {
                  const bg = e.estado === 'completado' ? 'var(--at-success-tint)' : e.estado === 'parcial' ? 'var(--at-warning-tint)' : 'var(--at-chip)'
                  const color = e.estado === 'completado' ? 'var(--at-success)' : e.estado === 'parcial' ? 'var(--at-warning-strong)' : 'var(--at-ink-3)'
                  return (
                    <div key={e.id} style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '8px', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '12px' }}>{e.fecha}</div>
                        {e.realizado_por && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{e.realizado_por}</div>}
                        {e.observaciones && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '2px' }}>{e.observaciones}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px', background: bg, color, display: 'block', marginBottom: '2px' }}>
                          {e.estado}
                        </span>
                        {e.costo_real != null && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{moneda} {e.costo_real.toFixed(2)}</div>}
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
