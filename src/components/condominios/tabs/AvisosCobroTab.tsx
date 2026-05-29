import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { AvisoCobro } from '../../../types'
import type { Unidad } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

interface Props {
  avisos: AvisoCobro[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface DetalleItem { concepto: string; monto: string; periodo: string }

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  primer_aviso:       { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: '1° Aviso' },
  segundo_aviso:      { bg: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', label: '2° Aviso' },
  ultimo_aviso:       { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Último Aviso' },
  notificacion_legal: { bg: 'var(--at-ink-2)', color: 'var(--at-surface-2)', label: 'Not. Legal' },
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  emitido:    { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Emitido' },
  entregado:  { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Entregado' },
  pagado:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Pagado' },
  anulado:    { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Anulado' },
}

const BLANK = { unidad_id: '', tipo: 'primer_aviso', fecha_emision: new Date().toISOString().slice(0, 10), fecha_limite: '', enviado_por: '', notas: '' }
const BLANK_ITEM: DetalleItem = { concepto: '', monto: '', periodo: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${Number(n).toLocaleString('es', { minimumFractionDigits: 2 })}` }

export function AvisosCobroTab({ avisos, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [detalle, setDetalle] = useState<DetalleItem[]>([{ ...BLANK_ITEM }])
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'emitido' | 'entregado' | 'pagado' | 'anulado'>('todos')
  const [filtroUnidad, setFiltroUnidad] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
  function addItem() { setDetalle(p => [...p, { ...BLANK_ITEM }]) }
  function removeItem(i: number) { setDetalle(p => p.filter((_, idx) => idx !== i)) }
  function setItem(i: number, f: keyof DetalleItem, v: string) { setDetalle(p => p.map((it, idx) => idx === i ? { ...it, [f]: v } : it)) }

  function startEdit(a: AvisoCobro) {
    setEditId(a.id)
    setForm({ unidad_id: a.unidad_id, tipo: a.tipo, fecha_emision: a.fecha_emision, fecha_limite: a.fecha_limite ?? '', enviado_por: a.enviado_por ?? '', notas: a.notas ?? '' })
    setDetalle((a.detalle ?? []) as DetalleItem[])
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.unidad_id) return notify({ variant: 'warning', title: 'Requerido', text: 'Seleccione una unidad.' })
    const items = detalle.filter(it => it.concepto.trim() && it.monto)
    if (items.length === 0) return notify({ variant: 'warning', title: 'Requerido', text: 'Agregue al menos un concepto.' })
    const monto_total = items.reduce((s, it) => s + parseFloat(it.monto || '0'), 0)
    setSaving(true)
    const payload = {
      unidad_id: form.unidad_id, tipo: form.tipo,
      monto_total, detalle: items,
      fecha_emision: form.fecha_emision, fecha_limite: form.fecha_limite || null,
      enviado_por: form.enviado_por || null, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('avisos_cobro').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('avisos_cobro').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); setDetalle([{ ...BLANK_ITEM }]); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar aviso?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)' })
    if (!r.isConfirmed) return
    await supabase.from('avisos_cobro').delete().eq('id', id)
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await supabase.from('avisos_cobro').update({ estado }).eq('id', id)
    onRefresh()
  }

  function handlePrint(a: AvisoCobro) {
    const unidad = unidades.find(u => u.id === a.unidad_id)
    const tipo = TIPO_STYLE[a.tipo]
    const items = (a.detalle ?? []) as DetalleItem[]
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Aviso de Cobro</title>
<style>body{font-family:Arial,sans-serif;padding:40px;font-size:13px;max-width:600px;margin:0 auto}
h1{font-size:20px;margin-bottom:2px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:${tipo?.bg};color:${tipo?.color};margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #ccc;padding:7px 10px;text-align:left}
th{background:var(--at-surface-2)}
.total{font-size:16px;font-weight:800;color:#15291F;margin-top:12px;text-align:right}
.footer{margin-top:40px;border-top:1px solid #ccc;padding-top:16px;font-size:11px;color:var(--at-ink-3)}
.sig{margin-top:60px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig-box{border-top:1px solid #000;padding-top:8px;font-size:11px}</style></head>
<body>
<h1>Aviso de Cobro</h1>
<div class="badge">${tipo?.label ?? a.tipo}</div>
<p><strong>Unidad:</strong> ${unidad?.nombre ?? '—'}</p>
<p><strong>Fecha de emisión:</strong> ${a.fecha_emision}${a.fecha_limite ? `&nbsp;&nbsp;<strong>Fecha límite:</strong> ${a.fecha_limite}` : ''}</p>
<table>
  <tr><th>Concepto</th><th>Período</th><th style="text-align:right">Monto</th></tr>
  ${items.map(it => `<tr><td>${it.concepto}</td><td>${it.periodo || '—'}</td><td style="text-align:right">${fmt(parseFloat(it.monto || '0'), moneda)}</td></tr>`).join('')}
</table>
<div class="total">Total: ${fmt(Number(a.monto_total), moneda)}</div>
${a.notas ? `<p style="margin-top:16px;font-style:italic">${a.notas}</p>` : ''}
<div class="sig">
  <div class="sig-box">Administración${a.enviado_por ? `<br>${a.enviado_por}` : ''}</div>
  <div class="sig-box">Recibido por (residente)</div>
</div>
<div class="footer">Este documento constituye notificación oficial de deuda pendiente. En caso de no regularizar su situación antes de la fecha límite indicada, se procederá a los mecanismos legales correspondientes.</div>
</body></html>`
    const w = window.open('', '_blank'); if (!w) return; w.document.write(html); w.document.close(); w.print()
  }

  let filtered = avisos
  if (filtroEstado !== 'todos') filtered = filtered.filter(a => a.estado === filtroEstado)
  if (filtroUnidad) filtered = filtered.filter(a => a.unidad_id === filtroUnidad)

  const pendientes = avisos.filter(a => a.estado === 'emitido' || a.estado === 'entregado').length
  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Avisos de Cobro</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{pendientes} aviso(s) pendiente(s) de resolución</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setDetalle([{ ...BLANK_ITEM }]); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Aviso
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(TIPO_STYLE).map(([tipo, s]) => (
          <div key={tipo} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: s.color }}>{avisos.filter(a => a.tipo === tipo).length}</div>
            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar aviso' : 'Nuevo Aviso de Cobro'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo de aviso</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha emisión</label>
              <input style={inputStyle} type="date" value={form.fecha_emision} onChange={e => setF('fecha_emision', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha límite pago</label>
              <input style={inputStyle} type="date" value={form.fecha_limite} onChange={e => setF('fecha_limite', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Emitido por</label>
              <input style={inputStyle} value={form.enviado_por} onChange={e => setF('enviado_por', e.target.value)} placeholder="Nombre del administrador" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones adicionales…" />
            </div>
          </div>

          {/* Detalle de deuda */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)' }}>Detalle de deuda *</label>
              <button onClick={addItem}
                style={{ padding: '3px 9px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                + Agregar concepto
              </button>
            </div>
            {detalle.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
                <input style={{ ...inputStyle, fontSize: '12px' }} value={it.concepto} onChange={e => setItem(i, 'concepto', e.target.value)} placeholder="Concepto (ej: Cuota mantenimiento)" />
                <input style={{ ...inputStyle, fontSize: '12px' }} value={it.periodo} onChange={e => setItem(i, 'periodo', e.target.value)} placeholder="Período" />
                <input style={{ ...inputStyle, fontSize: '12px' }} type="number" step="0.01" value={it.monto} onChange={e => setItem(i, 'monto', e.target.value)} placeholder="Monto" />
                <button onClick={() => removeItem(i)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>✕</button>
              </div>
            ))}
            {detalle.filter(it => it.monto).length > 0 && (
              <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)', marginTop: '4px' }}>
                Total: {fmt(detalle.reduce((s, it) => s + parseFloat(it.monto || '0'), 0), moneda)}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['todos', 'emitido', 'entregado', 'pagado', 'anulado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
        <select style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }}
          value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)', fontSize: '13px' }}>No hay avisos de cobro.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(a => {
            const unidad = unidades.find(u => u.id === a.unidad_id)
            const ts = TIPO_STYLE[a.tipo] ?? TIPO_STYLE.primer_aviso
            const es = ESTADO_STYLE[a.estado] ?? ESTADO_STYLE.emitido
            const today = new Date().toISOString().slice(0, 10)
            const vencido = a.estado === 'emitido' && a.fecha_limite && a.fecha_limite < today
            return (
              <div key={a.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${vencido ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{unidad?.nombre ?? '—'}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ts.bg, color: ts.color }}>{ts.label}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                      {vencido && <span style={{ fontSize: '10px', color: 'var(--at-danger)', fontWeight: 700 }}>⚠️ Vencido</span>}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--at-primary)' }}>{fmt(Number(a.monto_total), moneda)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', marginTop: '2px' }}>
                      <span>📅 Emitido: {a.fecha_emision}</span>
                      {a.fecha_limite && <span style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>⏰ Límite: {a.fecha_limite}</span>}
                      {a.enviado_por && <span>👤 {a.enviado_por}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                    <button onClick={() => handlePrint(a)}
                      style={{ padding: '3px 7px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🖨️</button>
                    {canEdit && (
                      <>
                        {a.estado === 'emitido' && (
                          <button onClick={() => cambiarEstado(a.id, 'entregado')}
                            style={{ padding: '3px 7px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                            Entregado
                          </button>
                        )}
                        {(a.estado === 'emitido' || a.estado === 'entregado') && (
                          <button onClick={() => cambiarEstado(a.id, 'pagado')}
                            style={{ padding: '3px 7px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                            ✓ Pagado
                          </button>
                        )}
                        <button onClick={() => startEdit(a)}
                          style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                        <button onClick={() => handleDelete(a.id)}
                          style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
