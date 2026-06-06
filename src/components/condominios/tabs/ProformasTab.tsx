import { useState, useMemo } from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { confirm, notify } from '../../shared/Dialog'
import { EmptyState } from '../../shared/EmptyState'
import { Proforma, ContratoProveedor } from '../../../types'

interface Props {
  proformas: Proforma[]
  proveedores: ContratoProveedor[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type EstadoP = Proforma['estado']

const ESTADO_CFG: Record<EstadoP, { label: string; color: string; bg: string; next?: EstadoP; nextLabel?: string }> = {
  borrador:      { label: 'Borrador',     color: 'var(--at-ink-3)', bg: 'var(--at-chip)', next: 'enviada',     nextLabel: 'Enviar a proveedor' },
  enviada:       { label: 'Enviada',      color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', next: 'aprobada',    nextLabel: 'Aprobar' },
  aprobada:      { label: 'Aprobada',     color: 'var(--at-success)', bg: 'var(--at-success-tint)', next: 'convertida_oc', nextLabel: 'Convertir a OC' },
  convertida_oc: { label: 'OC generada', color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
  rechazada:     { label: 'Rechazada',    color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const BLANK = {
  proveedor_nombre: '', concepto: '', descripcion: '',
  monto: '', fecha_validez: '', notas: '',
}

export default function ProformasTab({ proformas, proveedores, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoP | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)

  const filtradas = filtroEstado ? proformas.filter(p => p.estado === filtroEstado) : proformas

  const conteos = useMemo(() => ({
    borrador:      proformas.filter(p => p.estado === 'borrador').length,
    enviada:       proformas.filter(p => p.estado === 'enviada').length,
    aprobada:      proformas.filter(p => p.estado === 'aprobada').length,
    convertida_oc: proformas.filter(p => p.estado === 'convertida_oc').length,
    rechazada:     proformas.filter(p => p.estado === 'rechazada').length,
  }), [proformas])

  const montoTotal = proformas.filter(p => p.estado !== 'rechazada').reduce((s, p) => s + (p.monto ?? 0), 0)

  function resetForm() { setForm({ ...BLANK }); setEditId(null); setShowForm(false) }

  function abrirEditar(p: Proforma) {
    setForm({
      proveedor_nombre: p.proveedor_nombre,
      concepto: p.concepto,
      descripcion: p.descripcion ?? '',
      monto: String(p.monto ?? ''),
      fecha_validez: p.fecha_validez ?? '',
      notas: p.notas ?? '',
    })
    setEditId(p.id)
    setShowForm(true)
  }

  async function guardar() {
    if (!form.proveedor_nombre.trim() || !form.concepto.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Proveedor y concepto son obligatorios.' })
      return
    }
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      proveedor_nombre: form.proveedor_nombre.trim(),
      concepto: form.concepto.trim(),
      descripcion: form.descripcion.trim() || null,
      monto: form.monto ? parseFloat(form.monto) : null,
      fecha_validez: form.fecha_validez || null,
      notas: form.notas.trim() || null,
    }
    const { error } = editId
      ? await updateCondominioRow('proformas_condominio', editId, payload)
      : await createCondominioRow('proformas_condominio', { ...payload, estado: 'borrador' })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    resetForm(); onRefresh()
  }

  async function avanzarEstado(p: Proforma) {
    const cfg = ESTADO_CFG[p.estado]
    if (!cfg.next) return
    const nuevoEstado = cfg.next
    const { error } = await updateCondominioRow('proformas_condominio', p.id, { estado: nuevoEstado })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (nuevoEstado === 'convertida_oc') {
      await createCondominioRow('ordenes_compra', {
        company_id: companyId, project_id: proyectoId,
        proveedor_nombre: p.proveedor_nombre,
        concepto: p.concepto,
        descripcion: `Generada desde proforma. ${p.descripcion ?? ''}`.trim(),
        monto_estimado: p.monto,
        estado: 'borrador',
        notas: `Proforma: ${p.id}`,
      })
      notify({ variant: 'success', title: 'OC generada', text: 'Se creó una orden de compra en estado Borrador.' })
    }
    onRefresh()
  }

  async function rechazar(p: Proforma) {
    const res = await confirm({ title: '¿Rechazar proforma?', text: p.concepto, icon: 'warning', variant: 'danger', confirmText: 'Rechazar' })
    if (!res.isConfirmed) return
    await updateCondominioRow('proformas_condominio', p.id, { estado: 'rechazada' })
    onRefresh()
  }

  async function eliminar(p: Proforma) {
    const res = await confirm({ title: '¿Eliminar?', text: p.concepto, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!res.isConfirmed) return
    await deleteCondominioRow('proformas_condominio', p.id)
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Proformas / Cotizaciones</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>Monto total activo: <strong>{moneda} {montoTotal.toLocaleString('es', { maximumFractionDigits: 0 })}</strong></div>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '7px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            + Nueva proforma
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(Object.entries(ESTADO_CFG) as [EstadoP, typeof ESTADO_CFG[EstadoP]][]).map(([est, cfg]) => (
          <div key={est} onClick={() => setFiltroEstado(filtroEstado === est ? '' : est)}
            style={{ padding: '8px 14px', background: filtroEstado === est ? cfg.bg : 'var(--at-surface-2)', border: `1px solid ${filtroEstado === est ? cfg.color : 'var(--at-line)'}`, borderRadius: 10, cursor: 'pointer', minWidth: 90, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>{conteos[est]}</div>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{cfg.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{editId ? 'Editar proforma' : 'Nueva proforma'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Proveedor *</label>
              <input list="proveedores-list" value={form.proveedor_nombre} onChange={e => setForm(f => ({ ...f, proveedor_nombre: e.target.value }))}
                placeholder="Nombre del proveedor"
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
              <datalist id="proveedores-list">
                {proveedores.map(p => <option key={p.id} value={p.proveedor_nombre} />)}
              </datalist>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Concepto *</label>
              <input value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
                placeholder="Ej: Pintura fachada"
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Monto ({moneda})</label>
              <input type="number" min="0" step="0.01" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Válida hasta</label>
              <input type="date" value={form.fecha_validez} onChange={e => setForm(f => ({ ...f, fecha_validez: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Descripción</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={2}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3, resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, boxSizing: 'border-box', marginTop: 3 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={guardar} disabled={saving}
              style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear proforma'}
            </button>
            <button onClick={resetForm} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* List */}
      {filtradas.length === 0 ? (
        <EmptyState
          icon="📋"
          compact
          title={filtroEstado ? `Sin proformas en "${ESTADO_CFG[filtroEstado].label}"` : 'No hay proformas registradas'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtradas.map(p => {
            const cfg = ESTADO_CFG[p.estado]
            const exp = expandida === p.id
            const vencida = p.fecha_validez && p.fecha_validez < new Date().toISOString().slice(0, 10) && p.estado !== 'convertida_oc' && p.estado !== 'rechazada'
            return (
              <div key={p.id} style={{ background: 'var(--at-surface)', border: `1px solid ${vencida ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: 12, overflow: 'hidden' }}>
                <div onClick={() => setExpandida(exp ? null : p.id)}
                  style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)' }}>{p.concepto}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                      {p.proveedor_nombre} · {p.monto != null ? `${moneda} ${p.monto.toLocaleString('es', { maximumFractionDigits: 2 })}` : 'Sin monto'}
                      {p.fecha_validez && ` · Válida hasta: ${p.fecha_validez}`}
                    </div>
                  </div>
                  {vencida && <span style={{ fontSize: 10, color: 'var(--at-danger)', fontWeight: 600 }}>VENCIDA</span>}
                  <span style={{ padding: '3px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 600 }}>{cfg.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{exp ? '▲' : '▼'}</span>
                </div>
                {exp && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--at-chip)' }}>
                    {p.descripcion && <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginTop: 10 }}>{p.descripcion}</div>}
                    {p.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 6 }}>📝 {p.notas}</div>}
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 6 }}>Creada: {p.created_at?.slice(0, 10)}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {canEdit && cfg.next && p.estado !== 'rechazada' && (
                        <button onClick={() => avanzarEstado(p)}
                          style={{ padding: '6px 14px', background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                          {cfg.nextLabel}
                        </button>
                      )}
                      {canEdit && p.estado === 'borrador' && (
                        <>
                          <button onClick={() => abrirEditar(p)}
                            style={{ padding: '6px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1px solid var(--at-primary)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                            ✏️ Editar
                          </button>
                          <button onClick={() => rechazar(p)}
                            style={{ padding: '6px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                            ✗ Rechazar
                          </button>
                        </>
                      )}
                      {canEdit && (p.estado === 'borrador' || p.estado === 'rechazada') && (
                        <button onClick={() => eliminar(p)}
                          style={{ padding: '6px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
