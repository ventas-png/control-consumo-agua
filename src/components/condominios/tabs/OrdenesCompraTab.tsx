import { hoyLocalISO } from '../../../lib/format'
import { useState, useMemo } from 'react'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { OrdenCompra, ContratoProveedor } from '../../../types'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { proveedorHabilitado } from '../../../types/compras'

interface Props {
  ordenes: OrdenCompra[]
  proveedores: ContratoProveedor[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type EstadoOC = OrdenCompra['estado']

const ESTADO_CFG: Record<EstadoOC, { label: string; color: string; bg: string; next?: EstadoOC; nextLabel?: string }> = {
  borrador:  { label: 'Borrador',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)', next: 'aprobada',  nextLabel: 'Aprobar' },
  aprobada:  { label: 'Aprobada',   color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', next: 'emitida',   nextLabel: 'Emitir OC' },
  emitida:   { label: 'Emitida',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', next: 'recibida',  nextLabel: 'Marcar recibida' },
  // `recibida_parcial` y `cerrada` los pone la contabilidad (Compras → recepción
  // y factura). Sin entrada aquí, `ESTADO_CFG[orden.estado]` sería `undefined`
  // y la tarjeta reventaba en cuanto una orden pasara por el riel nuevo.
  recibida_parcial: { label: 'Recibida parcial', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  recibida:  { label: 'Recibida',   color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cerrada:   { label: 'Cerrada',    color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelada: { label: 'Cancelada',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const BLANK = {
  proveedor_id: '', proveedor_nombre: '', concepto: '', descripcion: '', monto_estimado: '',
  fecha_entrega_esperada: '', notas: '',
}

// `proveedores` (contratos_proveedores) sigue en Props porque el registro de
// pestañas lo pasa, pero esta pantalla ya no lo usa: el proveedor de una orden
// sale del catálogo de Contabilidad, que es el único que sabe de autorizaciones.
export default function OrdenesCompraTab({ ordenes, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoOC | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)

  // Catálogo de Contabilidad (no `contratos_proveedores`, que es otra lista).
  const { data: catalogo = [] } = useProveedoresQuery(companyId)
  const autorizados = useMemo(
    () => catalogo.filter(p => proveedorHabilitado(p, hoyLocalISO())),
    [catalogo],
  )

  const filtradas = filtroEstado ? ordenes.filter(o => o.estado === filtroEstado) : ordenes

  // Se cuenta recorriendo ESTADO_CFG en vez de enumerar los estados a mano: así
  // agregar uno nuevo al ciclo no vuelve a dejar una tarjeta sin su conteo.
  const totalesPorEstado = useMemo(() => {
    const base = Object.fromEntries(
      (Object.keys(ESTADO_CFG) as EstadoOC[]).map(e => [e, 0]),
    ) as Record<EstadoOC, number>
    for (const o of ordenes) {
      if (o.estado in base) base[o.estado] += 1
    }
    return base
  }, [ordenes])

  const montoTotal = ordenes.filter(o => o.estado !== 'cancelada').reduce((s, o) => s + (o.monto_estimado ?? 0), 0)

  function abrirNueva() {
    setEditId(null); setForm({ ...BLANK }); setShowForm(true)
  }

  async function guardar() {
    if (!form.concepto.trim() || !form.proveedor_id) {
      notify({ variant: 'warning', title: 'Campos requeridos', text: 'Elige un proveedor autorizado y escribe el concepto.' }); return
    }
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      proveedor_id: form.proveedor_id,
      proveedor_nombre: form.proveedor_nombre.trim(),
      concepto: form.concepto.trim(),
      descripcion: form.descripcion.trim() || null,
      monto_estimado: form.monto_estimado ? parseFloat(form.monto_estimado) : null,
      fecha_entrega_esperada: form.fecha_entrega_esperada || null,
      notas: form.notas.trim() || null,
      estado: 'borrador' as EstadoOC,
    }
    const { error } = editId
      ? await updateCondominioRow('ordenes_compra', editId, payload)
      : await createCondominioRow('ordenes_compra', payload)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function avanzarEstado(orden: OrdenCompra) {
    const cfg = ESTADO_CFG[orden.estado]
    if (!cfg.next) return
    const updates: Partial<OrdenCompra> = { estado: cfg.next }
    if (cfg.next === 'recibida') {
      const result = await openPromptDialog({
        title: 'Monto real de la OC',
        fields: [{
          name: 'montoReal',
          label: 'Monto real',
          type: 'number',
          placeholder: `Estimado: ${orden.monto_estimado ?? '—'}`,
          min: 0,
          step: 0.01,
          autoFocus: true,
        }],
        submitText: 'Confirmar recepción',
      })
      if (!result) return
      const montoReal = result.montoReal
      updates.monto_real = montoReal ? parseFloat(montoReal) : orden.monto_estimado
      updates.fecha_entrega_esperada = hoyLocalISO()
    }
    const { error } = await updateCondominioRow('ordenes_compra', orden.id, updates)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function cancelar(orden: OrdenCompra) {
    const r = await confirm({ title: '¿Cancelar orden?', text: orden.concepto, icon: 'warning', variant: 'danger', confirmText: 'Cancelar OC' })
    if (!r.isConfirmed) return
    await updateCondominioRow('ordenes_compra', orden.id, { estado: 'cancelada' })
    onRefresh()
  }

  async function eliminar(orden: OrdenCompra) {
    const r = await confirm({ title: '¿Eliminar borrador?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('ordenes_compra', orden.id)
    onRefresh()
  }

  const correlativo = (i: number) => `OC-${String(ordenes.length - i).padStart(4, '0')}`

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      {/* auto-fit en vez de 5 columnas fijas: el ciclo pasó de 5 estados a 7 y
          las tarjetas se salían de la fila en pantallas angostas. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8, marginBottom: 16 }}>
        {(Object.keys(ESTADO_CFG) as EstadoOC[]).map(e => {
          const cfg = ESTADO_CFG[e]
          return (
            <div key={e} onClick={() => setFiltroEstado(filtroEstado === e ? '' : e)}
              style={{ background: filtroEstado === e ? cfg.bg : 'var(--at-surface)', border: `1.5px solid ${filtroEstado === e ? cfg.color : 'var(--at-line)'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>{totalesPorEstado[e]}</div>
              <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
          Total comprometido: <strong style={{ color: 'var(--at-ink)' }}>{moneda} {montoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}</strong>
          {filtroEstado && <span> · Filtrando: {ESTADO_CFG[filtroEstado].label} ({filtradas.length})</span>}
        </div>
        {canCreate && (
          <button onClick={abrirNueva}
            style={{ padding: '6px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + Nueva OC
          </button>
        )}
      </div>

      {/* Formulario */}
      {showForm && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: 'var(--at-primary-hover)' }}>
            {editId ? 'Editar orden' : 'Nueva orden de compra'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Proveedor autorizado *</label>
              {/* Antes era texto libre con un datalist de sugerencias, así que
                  cada orden inventaba su propio proveedor y no había forma de
                  exigir que estuviera autorizado. Ahora se elige del catálogo
                  de Contabilidad, y solo aparecen los autorizados y vigentes:
                  el trigger de BD rechaza aprobar la orden en cualquier otro
                  caso, y ofrecer aquí a quien va a ser rechazado sería una
                  trampa. */}
              <select
                value={form.proveedor_id}
                onChange={e => {
                  const id = e.target.value
                  const p = autorizados.find(x => x.id === id)
                  setForm(f => ({ ...f, proveedor_id: id, proveedor_nombre: p?.nombre ?? '' }))
                }}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }}
              >
                <option value="">Selecciona…</option>
                {autorizados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              {autorizados.length === 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--at-ink-3)' }}>
                  No hay proveedores autorizados. Autorízalos en Contabilidad → Proveedores.
                </p>
              )}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Monto estimado ({moneda})</label>
              <input type="number" value={form.monto_estimado} onChange={e => setForm(f => ({ ...f, monto_estimado: e.target.value }))}
                placeholder="0.00"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Concepto *</label>
            <input value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
              placeholder="Descripción breve de la compra"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fecha entrega esperada</label>
              <input type="date" value={form.fecha_entrega_esperada} onChange={e => setForm(f => ({ ...f, fecha_entrega_esperada: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Observaciones adicionales"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={guardar} disabled={saving}
              style={{ padding: '8px 18px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : 'Guardar como borrador'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '8px 14px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🛒</div>
          No hay órdenes de compra{filtroEstado ? ` en estado "${ESTADO_CFG[filtroEstado].label}"` : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtradas.map((orden, i) => {
            const cfg = ESTADO_CFG[orden.estado]
            const isOpen = expandida === orden.id
            return (
              <div key={orden.id} style={{ background: 'var(--at-surface)', border: `1px solid ${cfg.color}33`, borderRadius: 10, borderLeft: `4px solid ${cfg.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer' }}
                  onClick={() => setExpandida(isOpen ? null : orden.id)}>
                  <div style={{ width: 60, fontSize: 10, color: 'var(--at-ink-3)', fontWeight: 600, flexShrink: 0 }}>{correlativo(i)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-ink)' }}>{orden.concepto}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{orden.proveedor_nombre}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {orden.monto_estimado && (
                      <div style={{ fontWeight: 700, fontSize: 13, color: cfg.color }}>{moneda} {orden.monto_estimado.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
                    )}
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: cfg.bg, color: cfg.color, borderRadius: 6 }}>{cfg.label}</span>
                  </div>
                  <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {isOpen && (
                  <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--at-chip)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '10px 0', fontSize: 11, color: 'var(--at-ink-3)' }}>
                      {orden.fecha_entrega_esperada && <div>Entrega esperada: <strong>{orden.fecha_entrega_esperada}</strong></div>}
                      {orden.estado === 'recibida' && <div>Recibido: <strong style={{ color: 'var(--at-success)' }}>✓</strong></div>}
                      {orden.monto_real && <div>Monto real: <strong style={{ color: 'var(--at-ink)' }}>{moneda} {orden.monto_real.toFixed(2)}</strong></div>}
                    </div>
                    {orden.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 10 }}>📝 {orden.notas}</div>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canEdit && cfg.next && (
                        <button onClick={() => avanzarEstado(orden)}
                          style={{ padding: '5px 12px', background: ESTADO_CFG[cfg.next!].bg, color: ESTADO_CFG[cfg.next!].color, border: `1px solid ${ESTADO_CFG[cfg.next!].color}66`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          → {cfg.nextLabel}
                        </button>
                      )}
                      {canEdit && orden.estado === 'borrador' && (
                        <button onClick={() => { setEditId(orden.id); setForm({ proveedor_id: orden.proveedor_id ?? '', proveedor_nombre: orden.proveedor_nombre, concepto: orden.concepto, descripcion: orden.descripcion ?? '', monto_estimado: String(orden.monto_estimado ?? ''), fecha_entrega_esperada: orden.fecha_entrega_esperada ?? '', notas: orden.notas ?? '' }); setShowForm(true) }}
                          style={{ padding: '5px 12px', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: 'var(--at-surface-2)' }}>
                          ✏️ Editar
                        </button>
                      )}
                      {canEdit && (orden.estado === 'borrador' || orden.estado === 'aprobada') && (
                        <button onClick={() => cancelar(orden)}
                          style={{ padding: '5px 12px', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>
                          Cancelar OC
                        </button>
                      )}
                      {canEdit && orden.estado === 'borrador' && (
                        <button onClick={() => eliminar(orden)}
                          style={{ padding: '5px 12px', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>
                          🗑 Eliminar
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
