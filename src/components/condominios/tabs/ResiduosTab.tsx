import { hoyLocalISO, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { resumenReciclaje } from '../../../domain/condominios/sostenibilidad'
import type { RegistroResiduo, TipoResiduo, EstadoResiduo } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { tint } from '../../shared/statusTone'

interface Props {
  residuos: RegistroResiduo[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.residuos.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoResiduo; label: string; icon: string; color: string }[] = [
  { value: 'general',     label: 'General',     icon: '🗑️', color: 'var(--at-ink-3)' },
  { value: 'reciclable',  label: 'Reciclable',  icon: '♻️', color: 'var(--at-success)' },
  { value: 'organico',    label: 'Orgánico',    icon: '🥬', color: '#84cc16' },
  { value: 'electronico', label: 'Electrónico', icon: '💻', color: 'var(--at-primary)' },
  { value: 'peligroso',   label: 'Peligroso',   icon: '☢️', color: 'var(--at-danger)' },
  { value: 'escombros',   label: 'Escombros',   icon: '🧱', color: 'var(--at-warning)' },
]

const ESTADO_CONFIG: Record<EstadoResiduo, { label: string; color: string; bg: string }> = {
  pendiente:   { label: 'Pendiente',   color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  recolectado: { label: 'Recolectado', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  procesado:   { label: 'Procesado',   color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
}

const blank = (): Partial<RegistroResiduo> => ({
  fecha: hoyLocalISO(), tipo_residuo: 'general',
  cantidad_kg: undefined, punto_acopio: '', empresa_recolectora: '',
  estado: 'pendiente', incidencia: false, descripcion_incidencia: '', notas: '',
})

const tipoInfo = (t: TipoResiduo) => TIPOS.find(x => x.value === t) ?? TIPOS[0]

export function ResiduosTab({ residuos, proyectoId, companyId, userId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [filtroTipo, setFiltroTipo] = useState<TipoResiduo | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoResiduo | 'todos'>('todos')
  const [form, setForm] = useState<Partial<RegistroResiduo>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const incidencias = residuos.filter(r => r.incidencia)
  const pendientes = residuos.filter(r => r.estado === 'pendiente')

  const filtered = residuos.filter(r => {
    if (filtroTipo !== 'todos' && r.tipo_residuo !== filtroTipo) return false
    if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false
    return true
  })

  // Stats
  const totalKg = filtered.filter(r => r.cantidad_kg).reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  // Reciclable + electrónico, igual que en Sostenibilidad (antes aquí sólo
  // contaba lo reciclable y las dos pestañas daban porcentajes distintos).
  const { totalKg: totalKgAll, pct: pctReciclaje } = resumenReciclaje(residuos)

  function startEdit(r: RegistroResiduo) {
    setForm({
      fecha: r.fecha, tipo_residuo: r.tipo_residuo, cantidad_kg: r.cantidad_kg ?? undefined,
      punto_acopio: r.punto_acopio ?? '', empresa_recolectora: r.empresa_recolectora ?? '',
      estado: r.estado, incidencia: r.incidencia, descripcion_incidencia: r.descripcion_incidencia ?? '', notas: r.notas ?? '',
    })
    setDetalleId(null); setEditId(r.id); setShowForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  function cancelForm() { if (saving) return; setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (saving) return
    if (!form.fecha) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha!, tipo_residuo: form.tipo_residuo ?? 'general',
      cantidad_kg: form.cantidad_kg ?? null,
      punto_acopio: form.punto_acopio || null, empresa_recolectora: form.empresa_recolectora || null,
      estado: form.estado ?? 'pendiente', incidencia: form.incidencia ?? false,
      descripcion_incidencia: form.descripcion_incidencia || null,
      notas: form.notas || null,
    }
    // Quien registró se fija al crear: editar no lo cambia por quien edita.
    const { error } = editId
      ? await updateCondominioRow('registros_residuos', editId, payload)
      : await createCondominioRow('registros_residuos', { ...payload, registrado_por: userId || null })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setShowForm(false); setEditId(null); setForm(blank()); onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar registro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('registros_residuos', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setDetalleId(null)
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoResiduo) {
    const { error } = await updateCondominioRow('registros_residuos', id, { estado })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box', minWidth: 0 }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  // Se lee la fila vigente, no una copia.
  const detalle = detalleId ? residuos.find(r => r.id === detalleId) ?? null : null

  return (
    <div style={{ padding: '20px 24px' }}>

      {incidencias.length > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger)', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚨</span>
          <span style={{ fontSize: '13px', color: 'var(--at-danger-strong)', fontWeight: 600 }}>
            {incidencias.length} incidencia{incidencias.length > 1 ? 's' : ''} registrada{incidencias.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* KPIs: dos por fila en el teléfono */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total registros', value: String(residuos.length), icon: '📊', color: 'var(--at-primary)' },
          { label: 'Pendientes', value: String(pendientes.length), icon: '⏳', color: 'var(--at-warning)' },
          { label: 'Total Kg registrado', value: totalKgAll > 0 ? `${formatNumber(totalKgAll, 1)}\u00a0kg` : '—', icon: '⚖️', color: 'var(--at-success)' },
          { label: '% Reciclaje', value: pctReciclaje === null ? '—' : `${Math.round(pctReciclaje)}%`, icon: '♻️', color: '#84cc16', nota: 'reciclable + electrónico' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
            {k.nota && <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{k.nota}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>
          Registros
          {totalKg > 0 && filtroTipo !== 'todos' && <span style={{ fontWeight: 400, fontSize: '13px', color: 'var(--at-ink-3)', marginLeft: '8px' }}>{formatNumber(totalKg, 1)}{'\u00a0'}kg filtrados</span>}
        </h2>
        {canCreate && (
          <Button onClick={() => { setEditId(null); setForm(blank()); setShowForm(true) }}>+ Registrar</Button>
        )}
      </div>

      {/* Registro y edición en ventana (antes, un formulario fijo sobre la
          lista: editar una fila de abajo obligaba a subir para encontrarlo). */}
      {showForm && (
        <EditModal
          title={editId ? '✏️ Editar registro' : '♻️ Nuevo registro'}
          maxWidth="620px"
          fullScreenOnMobile
          onClose={cancelForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cancelForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="residuo-form" loading={saving} loadingText="Guardando…">{editId ? 'Actualizar' : 'Registrar'}</Button>
            </>
          }
        >
          <form
            id="residuo-form"
            onSubmit={e => { e.preventDefault(); void handleSave() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '12px', alignItems: 'start' }}
          >
            <div>
              <label htmlFor="residuo-fecha" style={labelStyle}>Fecha *</label>
              <input id="residuo-fecha" style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="residuo-tipo" style={labelStyle}>Tipo de residuo</label>
              <select id="residuo-tipo" style={inputStyle} value={form.tipo_residuo ?? 'general'} onChange={e => setForm(f => ({ ...f, tipo_residuo: e.target.value as TipoResiduo }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="residuo-estado" style={labelStyle}>Estado</label>
              <select id="residuo-estado" style={inputStyle} value={form.estado ?? 'pendiente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoResiduo }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="residuo-cantidad" style={labelStyle}>Cantidad (kg)</label>
              {/* Dos decimales, como la columna (numeric(8,2)). */}
              <input id="residuo-cantidad" style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={form.cantidad_kg ?? ''} onChange={e => setForm(f => ({ ...f, cantidad_kg: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.0" />
            </div>
            <div>
              <label htmlFor="residuo-acopio" style={labelStyle}>Punto de acopio</label>
              <input id="residuo-acopio" style={inputStyle} value={form.punto_acopio ?? ''} onChange={e => setForm(f => ({ ...f, punto_acopio: e.target.value }))} placeholder="ej. Área de reciclaje" />
            </div>
            <div>
              <label htmlFor="residuo-empresa" style={labelStyle}>Empresa recolectora</label>
              <input id="residuo-empresa" style={inputStyle} value={form.empresa_recolectora ?? ''} onChange={e => setForm(f => ({ ...f, empresa_recolectora: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: form.incidencia ? 'var(--at-danger)' : 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.incidencia ?? false} onChange={e => setForm(f => ({ ...f, incidencia: e.target.checked }))} />
                ⚠ Hay incidencia
              </label>
            </div>
            {form.incidencia && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="residuo-incidencia" style={labelStyle}>Descripción de la incidencia</label>
                <textarea id="residuo-incidencia" style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: '50px' }} value={form.descripcion_incidencia ?? ''} onChange={e => setForm(f => ({ ...f, descripcion_incidencia: e.target.value }))} />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="residuo-notas" style={labelStyle}>Notas</label>
              <textarea id="residuo-notas" style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: '46px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle del registro en ventana: las notas y la descripción de la
          incidencia no se veían en ninguna parte de la lista. */}
      {detalle && (
        <EditModal
          title={`${tipoInfo(detalle.tipo_residuo).icon} Residuo ${tipoInfo(detalle.tipo_residuo).label.toLowerCase()}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{detalle.fecha}</span>
              <EstadoBadge estado={detalle.estado} />
            </span>
          }
          maxWidth="480px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            <>
              {canDelete && <Button variant="outline-danger" onClick={() => void handleDelete(detalle.id)}>Eliminar</Button>}
              {canEdit && <Button variant="secondary" onClick={() => startEdit(detalle)}>✏️ Editar</Button>}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
            </>
          }
        >
          <ResiduoDetalle registro={detalle} />
        </EditModal>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {TIPOS.map(t => (
          <button key={t.value} type="button" aria-pressed={filtroTipo === t.value} onClick={() => setFiltroTipo(filtroTipo === t.value ? 'todos' : t.value)}
            style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroTipo === t.value ? t.color : 'var(--at-line)',
              background: filtroTipo === t.value ? tint(t.color, 9) : 'var(--at-surface)',
              color: filtroTipo === t.value ? t.color : 'var(--at-ink-3)' }}>
            {t.icon} {t.label} ({residuos.filter(r => r.tipo_residuo === t.value).length})
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: 'var(--at-line)', margin: '0 4px' }} />
        <select aria-label="Filtrar por estado" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoResiduo | 'todos')}
          style={{ padding: '5px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }}>
          <option value="todos">Todos los estados</option>
          {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Tabla — F3.9: migrado a <DataTable> shared. En el teléfono cada
          registro es una tarjeta; tocarlo abre su detalle y el botón «Ver» es
          el camino de teclado. */}
      <DataTable<RegistroResiduo>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '♻️', title: 'No hay registros de residuos' }}
        rowStyle={(r) => r.incidencia ? { background: 'var(--at-warning-tint)' } : {}}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'fecha', header: 'Fecha', sortable: true,
            render: (r) => (
              <div>
                <div style={{ fontWeight: 600 }}>{r.fecha}</div>
                {r.incidencia && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--at-danger)' }}>⚠ Incidencia</span>}
              </div>
            ) },
          { key: 'tipo_residuo', header: 'Tipo', sortable: true,
            accessor: (r) => tipoInfo(r.tipo_residuo).label,
            render: (r) => {
              const ti = tipoInfo(r.tipo_residuo)
              return (
                <div>
                  <span style={{ fontSize: 16 }}>{ti.icon}</span>
                  <div style={{ fontSize: 11, color: ti.color, fontWeight: 600 }}>{ti.label}</div>
                </div>
              )
            } },
          { key: 'cantidad_kg', header: 'Cantidad', align: 'right', sortable: true,
            accessor: (r) => r.cantidad_kg ?? 0,
            render: (r) => <span style={{ fontWeight: 600 }}>{r.cantidad_kg != null ? `${r.cantidad_kg} kg` : '—'}</span> },
          { key: 'punto_acopio', header: 'Punto Acopio', hideOnMobile: true, sortable: true,
            accessor: (r) => r.punto_acopio ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.punto_acopio ?? '—'}</span> },
          { key: 'empresa_recolectora', header: 'Empresa', hideOnMobile: true, sortable: true,
            accessor: (r) => r.empresa_recolectora ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.empresa_recolectora ?? '—'}</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (r) => {
              const est = ESTADO_CONFIG[r.estado]
              return canEdit ? (
                <select value={r.estado} onChange={(e) => { e.stopPropagation(); handleEstado(r.id, e.target.value as EstadoResiduo) }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: 6, fontSize: 12, fontWeight: 600, color: est.color, background: 'var(--at-surface)', cursor: 'pointer' }}
                  aria-label={`Estado de residuo ${r.fecha}`}>
                  {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              ) : (
                <EstadoBadge estado={r.estado} />
              )
            } },
          { key: 'actions', header: '', align: 'right',
            render: (r) => (
              <div style={{ display: 'inline-flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver registro de residuos del ${r.fecha}`}>Ver</Button>
                {canEdit && <Button size="sm" variant="secondary" onClick={() => startEdit(r)} aria-label="Editar registro">✏️</Button>}
                {canDelete && <Button size="sm" variant="outline-danger" onClick={() => void handleDelete(r.id)} aria-label="Eliminar registro">🗑️</Button>}
              </div>
            ) },
        ] satisfies DataTableColumn<RegistroResiduo>[]}
      />
    </div>
  )
}

function EstadoBadge({ estado }: { estado: EstadoResiduo }) {
  const est = ESTADO_CONFIG[estado]
  return <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: est.bg, color: est.color }}>{est.label}</span>
}

/** Detalle de solo lectura de un registro de residuos. */
function ResiduoDetalle({ registro: r }: { registro: RegistroResiduo }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const ti = tipoInfo(r.tipo_residuo)
  return (
    <div>
      {r.incidencia && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--at-danger-strong, var(--at-danger))' }}>
          <strong>⚠ Incidencia</strong>
          <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{r.descripcion_incidencia || 'Sin descripción.'}</p>
        </div>
      )}
      {fila('Fecha', r.fecha)}
      {fila('Tipo', <span style={{ color: ti.color, fontWeight: 600 }}>{ti.icon} {ti.label}</span>)}
      {fila('Cantidad', r.cantidad_kg != null ? <strong>{r.cantidad_kg} kg</strong> : '—')}
      {fila('Punto de acopio', r.punto_acopio || '—')}
      {fila('Empresa recolectora', r.empresa_recolectora || '—')}
      {fila('Estado', <EstadoBadge estado={r.estado} />)}
      {r.notas && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Notas</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.notas}</p>
        </div>
      )}
    </div>
  )
}
