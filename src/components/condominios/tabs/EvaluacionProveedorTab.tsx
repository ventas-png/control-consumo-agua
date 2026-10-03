import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { EvaluacionProveedor, ContratoProveedor } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { useAsignacionesQuery } from '../../../domain/proveedores/queries'
import { useOrdenesProveedorProyectoQuery } from '../../../domain/proveedores/contratosCompras'
import { ProveedorSelector } from '../../proveedores/ProveedorSelector'
import type { ContratoProveedorCatalogo, ProveedorCatalogo } from '../../../types/proveedores'

interface Props {
  evaluaciones: EvaluacionProveedor[]
  proveedores: ContratoProveedor[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

// El proveedor se elige del CATÁLOGO COMPARTIDO (por id, nunca por texto) y, si corresponde, el contrato y la orden
// evaluados. El evaluador lo sella el servidor con la sesión. Una evaluación baja NO suspende al proveedor: suspender
// es una decisión de quien autoriza proveedores (Contabilidad), por su vía de siempre.
const BLANK = {
  proveedor_catalogo_id: '', contrato_id: '', orden_compra_id: '',
  calificacion: 5, puntualidad: 5, calidad: 5, precio: 5, cumplimiento: 5, comunicacion: 5,
  comentarios: '', fecha: hoyLocalISO(),
}

function Stars({ value, onChange, readOnly = false }: { value: number; onChange?: (n: number) => void; readOnly?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '2px' }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} onClick={() => !readOnly && onChange?.(n)}
          style={{ fontSize: readOnly ? '14px' : '18px', cursor: readOnly ? 'default' : 'pointer', color: n <= value ? 'var(--at-warning)' : 'var(--at-line)', lineHeight: 1 }}>
          ★
        </span>
      ))}
    </div>
  )
}

function avg(values: (number | undefined | null)[]): number {
  const valid = values.filter(v => v != null) as number[]
  if (!valid.length) return 0
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length * 10) / 10
}

export function EvaluacionProveedorTab({ evaluaciones, proveedores, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [view, setView] = useState<'lista' | 'ranking'>('lista')
  const { data: catalogo = [] } = useProveedoresQuery(companyId)
  const { data: asignaciones = [] } = useAsignacionesQuery(companyId, proyectoId)
  const contratosDelProveedor = (proveedores as unknown as ContratoProveedorCatalogo[]).filter(
    c => form.proveedor_catalogo_id !== '' && c.proveedor_id === form.proveedor_catalogo_id,
  )
  const { data: ordenesDelProveedor = [] } = useOrdenesProveedorProyectoQuery(
    companyId, proyectoId, form.proveedor_catalogo_id || null, form.contrato_id || null,
  )

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(e: EvaluacionProveedor) {
    setEditId(e.id)
    setForm({ proveedor_catalogo_id: e.proveedor_catalogo_id ?? '', contrato_id: e.contrato_id ?? e.proveedor_id ?? '', orden_compra_id: e.orden_compra_id ?? '',
      cumplimiento: e.cumplimiento ?? 5, comunicacion: e.comunicacion ?? 5,
      calificacion: e.calificacion, puntualidad: e.puntualidad ?? 5, calidad: e.calidad ?? 5, precio: e.precio ?? 5, comentarios: e.comentarios ?? '', fecha: e.fecha })
    setShowForm(true)
  }

  async function handleSave() {
    if (!editId && !form.proveedor_catalogo_id) return notify({ variant: 'warning', title: 'Requerido', text: 'Elige el proveedor del catálogo que se evalúa.' })
    setSaving(true)
    const criterios = {
      calificacion: form.calificacion, puntualidad: form.puntualidad, calidad: form.calidad, precio: form.precio,
      cumplimiento: form.cumplimiento, comunicacion: form.comunicacion, comentarios: form.comentarios || null,
    }
    let error
    if (editId) {
      // Proveedor, contrato, orden, evaluador y fecha no se cambian (lo exige el servidor): solo criterios y comentarios.
      ({ error } = await updateCondominioRow('evaluaciones_proveedor', editId, criterios))
    } else {
      // El evaluador NO viaja: el servidor lo sella con la sesión.
      ({ error } = await createCondominioRow('evaluaciones_proveedor', {
        ...criterios, fecha: form.fecha, company_id: companyId, project_id: proyectoId,
        proveedor_catalogo_id: form.proveedor_catalogo_id,
        contrato_id: form.contrato_id || null,
        orden_compra_id: form.orden_compra_id || null,
      }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar evaluación?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('evaluaciones_proveedor', id)
    onRefresh()
  }

  const nombreDe = (e: EvaluacionProveedor) => (catalogo as ProveedorCatalogo[]).find(p => p.id === e.proveedor_catalogo_id)?.nombre ?? e.nombre_proveedor
  let filtered = evaluaciones
  if (filtroProveedor) filtered = filtered.filter(e => e.nombre_proveedor.toLowerCase().includes(filtroProveedor.toLowerCase()))

  // Ranking: group by proveedor_nombre, compute avg
  const ranking = Object.values(
    evaluaciones.reduce<Record<string, { nombre: string; evals: EvaluacionProveedor[] }>>((acc, e) => {
      const key = e.proveedor_catalogo_id ?? e.nombre_proveedor
      if (!acc[key]) acc[key] = { nombre: nombreDe(e), evals: [] }
      acc[key].evals.push(e)
      return acc
    }, {})
  ).map(g => ({
    nombre: g.nombre,
    count: g.evals.length,
    promedio: avg(g.evals.map(e => e.calificacion)),
    puntualidad: avg(g.evals.map(e => e.puntualidad)),
    calidad: avg(g.evals.map(e => e.calidad)),
    precio: avg(g.evals.map(e => e.precio)),
  })).sort((a, b) => b.promedio - a.promedio)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Evaluación de Proveedores</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{evaluaciones.length} evaluaciones · {ranking.length} proveedores</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ display: 'flex', border: '1.5px solid var(--at-line)', borderRadius: '8px', overflow: 'hidden' }}>
            {(['lista', 'ranking'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{ padding: '6px 12px', border: 'none', fontSize: '12px', cursor: 'pointer', fontWeight: view === v ? 700 : 500,
                  background: view === v ? 'var(--at-primary)' : 'var(--at-surface)', color: view === v ? 'white' : 'var(--at-ink-3)' }}>
                {v === 'lista' ? '📋 Lista' : '🏆 Ranking'}
              </button>
            ))}
          </div>
          {canCreate && !showForm && (
            <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
              style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Evaluar
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar evaluación' : 'Nueva Evaluación'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <ProveedorSelector
                proveedores={catalogo as ProveedorCatalogo[]} asignaciones={asignaciones} projectId={proyectoId}
                value={form.proveedor_catalogo_id || null} disabled={!!editId} label="Proveedor del catálogo *"
                onChange={(id) => setForm(p => ({ ...p, proveedor_catalogo_id: id ?? '', contrato_id: '', orden_compra_id: '' }))}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Contrato (opcional)</label>
              <select style={inputStyle} value={form.contrato_id} disabled={!!editId || !form.proveedor_catalogo_id}
                onChange={e => setForm(p => ({ ...p, contrato_id: e.target.value, orden_compra_id: '' }))}>
                <option value="">— Sin contrato —</option>
                {contratosDelProveedor.map(c => <option key={c.id} value={c.id}>{c.referencia ?? c.servicio} · {c.estado}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Orden de compra (opcional)</label>
              <select style={inputStyle} value={form.orden_compra_id} disabled={!!editId || !form.proveedor_catalogo_id}
                onChange={e => setF('orden_compra_id', e.target.value)}>
                <option value="">— Sin orden —</option>
                {ordenesDelProveedor.map(o => <option key={o.id} value={o.id}>{o.numero ?? o.concepto} · {o.estado}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha evaluación</label>
              <input style={inputStyle} type="date" value={form.fecha} disabled={!!editId} onChange={e => setF('fecha', e.target.value)} />
            </div>
          </div>
          <p data-testid="eval-aviso" style={{ margin: '0 0 10px', fontSize: '11px', color: 'var(--at-ink-3)' }}>
            Quedas registrado como evaluador. Una evaluación baja <strong>no suspende</strong> al proveedor: esa decisión la toma quien autoriza proveedores en Contabilidad.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            {([
              { k: 'calificacion' as const, label: 'Calificación general' },
              { k: 'puntualidad' as const, label: 'Puntualidad' },
              { k: 'calidad' as const, label: 'Calidad del trabajo' },
              { k: 'precio' as const, label: 'Precio / valor' },
              { k: 'cumplimiento' as const, label: 'Cumplimiento del contrato' },
              { k: 'comunicacion' as const, label: 'Comunicación' },
            ]).map(({ k, label }) => (
              <div key={k}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '5px' }}>{label}</label>
                <Stars value={form[k] as number} onChange={n => setF(k, n)} />
                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{form[k]}/5</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Comentarios</label>
            <textarea style={{ ...inputStyle, minHeight: '55px', resize: 'vertical', fontFamily: 'inherit' }}
              value={form.comentarios} onChange={e => setF('comentarios', e.target.value)} placeholder="Observaciones, recomendaciones, aspectos positivos/negativos…" />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar evaluación'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {view === 'ranking' ? (
        /* Ranking view */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ranking.length === 0 ? (
            <EmptyState icon="⭐" title="Sin evaluaciones" />
          ) : ranking.map((r, i) => (
            <div key={r.nombre} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: i === 0 ? 'var(--at-warning)' : i === 1 ? 'var(--at-ink-3)' : i === 2 ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>#{i + 1}</span>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>{r.nombre}</span>
                    <span style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{r.count} evaluación(es)</span>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'General', val: r.promedio },
                      { label: 'Puntualidad', val: r.puntualidad },
                      { label: 'Calidad', val: r.calidad },
                      { label: 'Precio', val: r.precio },
                    ].map(f => (
                      <div key={f.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{f.label}</div>
                        <Stars value={Math.round(f.val)} readOnly />
                        <div style={{ fontSize: '10px', fontWeight: 700, color: f.val >= 4 ? 'var(--at-success)' : f.val >= 3 ? 'var(--at-warning)' : 'var(--at-danger)' }}>{f.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <>
          <div style={{ marginBottom: '10px' }}>
            <input style={{ ...inputStyle, maxWidth: '220px' }} value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)} placeholder="Buscar proveedor…" />
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon="⭐" title="No hay evaluaciones" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(e => (
                <div key={e.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '13px' }}>{nombreDe(e)}</span>
                        <Stars value={e.calificacion} readOnly />
                        <span style={{ fontSize: '11px', fontWeight: 700, color: e.calificacion >= 4 ? 'var(--at-success)' : e.calificacion >= 3 ? 'var(--at-warning)' : 'var(--at-danger)' }}>{e.calificacion}/5</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--at-ink-3)', flexWrap: 'wrap' }}>
                        {e.puntualidad != null && <span>⏱ Puntualidad: {e.puntualidad}/5</span>}
                        {e.calidad != null && <span>⭐ Calidad: {e.calidad}/5</span>}
                        {e.precio != null && <span>💰 Precio: {e.precio}/5</span>}
                        {e.cumplimiento != null && <span>📋 Cumplimiento: {e.cumplimiento}/5</span>}
                        {e.comunicacion != null && <span>💬 Comunicación: {e.comunicacion}/5</span>}
                        {(e.contrato_id ?? e.proveedor_id) && <span>📄 Con contrato</span>}
                        {e.orden_compra_id && <span>🛒 Con orden de compra</span>}
                        {e.calificacion <= 2 && <span data-testid={`eval-baja-${e.id}`} style={{ color: 'var(--at-warning)' }}>⚠ Evaluación baja: no suspende al proveedor</span>}
                        <span>📅 {e.fecha}</span>
                        {e.evaluado_por && <span>👤 {e.evaluado_por}</span>}
                      </div>
                      {e.comentarios && <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '4px', fontStyle: 'italic' }}>{e.comentarios}</div>}
                    </div>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                        <button onClick={() => startEdit(e)}
                          style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                        <button onClick={() => handleDelete(e.id)}
                          style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
