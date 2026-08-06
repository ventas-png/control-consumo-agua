import { hoyLocalISO } from '../../../lib/format'
import { useState, useEffect, useCallback, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import {
  createCondominioRow,
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { fetchCuotasPlanPago } from '../../../domain/condominios/tabQueries'
import type { PlanPagoCond, CuotaPlanPago } from '../../../types'
import type { Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  planes: PlanPagoCond[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  activo:      { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Activo' },
  completado:  { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Completado' },
  incumplido:  { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Incumplido' },
  cancelado:   { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Cancelado' },
}

const BLANK = { unidad_id: '', concepto: '', monto_total: '', num_cuotas: '3', fecha_inicio: hoyLocalISO(), notas: '', aprobado_por: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function PlanPagoCondTab({ planes, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<PlanPagoCond | null>(null)
  const [cuotas, setCuotas] = useState<CuotaPlanPago[]>([])
  const [loadingCuotas, setLoadingCuotas] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'completado' | 'incumplido' | 'cancelado'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  const fetchCuotas = useCallback(async (planId: string) => {
    setLoadingCuotas(true)
    setCuotas(await fetchCuotasPlanPago<CuotaPlanPago>(planId))
    setLoadingCuotas(false)
  }, [])

  useEffect(() => { if (selected) fetchCuotas(selected.id) }, [selected, fetchCuotas])

  async function handleSave() {
    if (!form.unidad_id) return notify({ variant: 'warning', title: 'Requerido', text: 'Seleccione una unidad.' })
    if (!form.concepto.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El concepto es obligatorio.' })
    const montoTotal = parseFloat(form.monto_total)
    const numCuotas = parseInt(form.num_cuotas)
    if (!montoTotal || montoTotal <= 0) return notify({ variant: 'warning', title: 'Requerido', text: 'El monto total debe ser mayor a 0.' })
    if (!numCuotas || numCuotas < 1) return notify({ variant: 'warning', title: 'Requerido', text: 'El número de cuotas debe ser al menos 1.' })

    const montoCuota = parseFloat((montoTotal / numCuotas).toFixed(2))
    setSaving(true)

    const { data: plan, error } = await createCondominioRowReturning('planes_pago_condominio', {
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      concepto: form.concepto.trim(), monto_total: montoTotal, num_cuotas: numCuotas,
      monto_cuota: montoCuota, fecha_inicio: form.fecha_inicio,
      notas: form.notas || null, aprobado_por: form.aprobado_por || null,
    })

    if (error || !plan) { setSaving(false); return notify({ variant: 'error', title: 'Error', text: error?.message ?? 'Error al crear plan' }) }

    // Generate installments
    const installments = Array.from({ length: numCuotas }, (_, i) => ({
      company_id: companyId, plan_id: plan.id as string,
      numero: i + 1, monto: montoCuota,
      fecha_vencimiento: addMonths(form.fecha_inicio, i + 1),
    }))
    await createCondominioRow('cuotas_plan_pago', installments)

    setSaving(false)
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar plan de pago?', text: 'Se eliminarán todas sus cuotas.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('planes_pago_condominio', id)
    if (selected?.id === id) { setSelected(null); setCuotas([]) }
    onRefresh()
  }

  async function cambiarEstadoPlan(id: string, estado: string) {
    await updateCondominioRow('planes_pago_condominio', id, { estado })
    onRefresh()
  }

  async function marcarCuotaPagada(cuota: CuotaPlanPago) {
    const pagado = !cuota.pagado
    const update: Record<string, unknown> = { pagado, fecha_pago: pagado ? hoyLocalISO() : null }
    await updateCondominioRow('cuotas_plan_pago', cuota.id, update)

    // Check if plan is complete
    if (pagado && selected) {
      const all = await fetchCuotasPlanPago<CuotaPlanPago>(selected.id)
      const todasPagadas = all.every(c => c.id === cuota.id ? true : c.pagado)
      if (todasPagadas) await updateCondominioRow('planes_pago_condominio', selected.id, { estado: 'completado' })
    }
    fetchCuotas(selected!.id)
    onRefresh()
  }

  const today = hoyLocalISO()
  const filtered = filtroEstado === 'todos' ? planes : planes.filter(p => p.estado === filtroEstado)
  const montoCuotaPreview = form.monto_total && form.num_cuotas
    ? (parseFloat(form.monto_total) / parseInt(form.num_cuotas)).toFixed(2)
    : ''

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Planes de Pago</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Acuerdos de pago para unidades con saldo en mora</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Plan
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(ESTADO_STYLE).map(([estado, s]) => (
          <div key={estado} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: s.color }}>{planes.filter(p => p.estado === estado).length}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo Plan de Pago</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Concepto *</label>
              <input style={inputStyle} value={form.concepto} onChange={e => setF('concepto', e.target.value)} placeholder="Ej: Deuda cuotas mantenimiento Q1 2026" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Monto total ({moneda}) *</label>
              <input style={inputStyle} type="number" step="0.01" value={form.monto_total} onChange={e => setF('monto_total', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Número de cuotas *</label>
              <input style={inputStyle} type="number" min="1" max="60" value={form.num_cuotas} onChange={e => setF('num_cuotas', e.target.value)} />
            </div>
            {montoCuotaPreview && (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ background: 'var(--at-primary-soft)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-primary-hover)', fontWeight: 700 }}>
                  ≈ {moneda} {montoCuotaPreview} / cuota
                </div>
              </div>
            )}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Primera cuota vence</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Aprobado por</label>
              <input style={inputStyle} value={form.aprobado_por} onChange={e => setF('aprobado_por', e.target.value)} placeholder="Nombre del aprobador" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Condiciones, observaciones…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Creando…' : 'Crear plan'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'activo', 'completado', 'incumplido', 'cancelado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* Plans list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <EmptyState icon="💳" title="No hay planes de pago" />
          ) : filtered.map(p => {
            const unidad = unidades.find(u => u.id === p.unidad_id)
            const es = ESTADO_STYLE[p.estado] ?? ESTADO_STYLE.activo
            return (
              <div key={p.id} onClick={() => setSelected(selected?.id === p.id ? null : p)}
                style={{ background: 'var(--at-surface)', border: `1.5px solid ${selected?.id === p.id ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{p.concepto}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {unidad && <span>🏠 {unidad.nombre}</span>}
                      <span>💰 {fmt(Number(p.monto_total), moneda)}</span>
                      <span>📋 {p.num_cuotas} cuotas de {fmt(Number(p.monto_cuota), moneda)}</span>
                      <span>📅 Desde {p.fecha_inicio}</span>
                    </div>
                    {p.aprobado_por && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Aprobado por: {p.aprobado_por}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {p.estado === 'activo' && (
                        <button onClick={() => cambiarEstadoPlan(p.id, 'incumplido')}
                          style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          Incumplido
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id)}
                        style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Cuotas panel */}
        {selected && (
          <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700 }}>
              Cuotas — {selected.concepto}
            </h3>
            {loadingCuotas ? (
              <EmptyState icon="📋" title="Cargando…" />
            ) : (
              <>
                {/* Progress */}
                {cuotas.length > 0 && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>
                      <span>{cuotas.filter(c => c.pagado).length}/{cuotas.length} pagadas</span>
                      <span>{Math.round(cuotas.filter(c => c.pagado).length / cuotas.length * 100)}%</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--at-line)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${cuotas.filter(c => c.pagado).length / cuotas.length * 100}%`, background: 'var(--at-success)', borderRadius: '3px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {cuotas.map(c => {
                    const vencida = !c.pagado && c.fecha_vencimiento < today
                    return (
                      <div key={c.id} style={{ background: 'var(--at-surface)', borderRadius: '7px', padding: '8px 10px', border: `1px solid ${vencida ? 'var(--at-danger-border)' : 'var(--at-line)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Cuota #{c.numero}</span>
                          <span style={{ fontSize: '12px', color: 'var(--at-primary)', fontWeight: 600, marginLeft: '8px' }}>{fmt(Number(c.monto), moneda)}</span>
                          <div style={{ fontSize: '10px', color: vencida ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                            Vence: {c.fecha_vencimiento}{vencida ? ' ⚠️ Vencida' : ''}
                          </div>
                          {c.fecha_pago && <div style={{ fontSize: '10px', color: 'var(--at-success)' }}>Pagado: {c.fecha_pago}</div>}
                        </div>
                        {canEdit && (
                          <button onClick={() => marcarCuotaPagada(c)}
                            style={{ padding: '4px 9px', background: c.pagado ? 'var(--at-success-tint)' : 'var(--at-chip)', color: c.pagado ? 'var(--at-success)' : 'var(--at-ink-3)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                            {c.pagado ? '✓ Pagado' : 'Marcar pagado'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
