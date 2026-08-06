import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ServicioHousekeeping, EstadoHousekeeping, TipoHousekeeping, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  servicios: ServicioHousekeeping[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoHousekeeping, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  en_proceso: { label: 'En proceso', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  completado: { label: 'Completado', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelado:  { label: 'Cancelado',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const TIPO_CONFIG: Record<TipoHousekeeping, { label: string; icon: string }> = {
  limpieza_estandar:   { label: 'Limpieza Estándar',  icon: '🧹' },
  limpieza_profunda:   { label: 'Limpieza Profunda',  icon: '🧽' },
  lavanderia:          { label: 'Lavandería',          icon: '👕' },
  mantenimiento_menor: { label: 'Mant. Menor',         icon: '🔧' },
  otro:                { label: 'Otro',                icon: '📋' },
}

const blank = (): Partial<ServicioHousekeeping> => ({
  unidad_id: undefined, tipo: 'limpieza_estandar',
  fecha: hoyLocalISO(),
  hora_inicio: '', hora_fin: '', responsable: '',
  estado: 'pendiente', costo: undefined, notas: '',
})

export function HousekeepingTab({ servicios, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoHousekeeping | 'todos'>('todos')
  const [form, setForm] = useState<Partial<ServicioHousekeeping>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const today = hoyLocalISO()
  const thisMonth = today.slice(0, 7)

  const filtered = servicios.filter(s => filtroEstado === 'todos' || s.estado === filtroEstado)
  const pendientes  = servicios.filter(s => s.estado === 'pendiente').length
  const enProceso   = servicios.filter(s => s.estado === 'en_proceso').length
  const completados = servicios.filter(s => s.estado === 'completado' && s.fecha.startsWith(thisMonth)).length
  const costoMes    = servicios.filter(s => s.estado === 'completado' && s.fecha.startsWith(thisMonth)).reduce((s, r) => s + (r.costo ?? 0), 0)

  // Agrupar por fecha para vista de agenda
  const byFecha: Record<string, ServicioHousekeeping[]> = {}
  for (const s of filtered) {
    byFecha[s.fecha] = byFecha[s.fecha] ?? []
    byFecha[s.fecha].push(s)
  }
  const fechas = Object.keys(byFecha).sort((a, b) => b.localeCompare(a))

  function startEdit(s: ServicioHousekeeping) {
    setForm({
      unidad_id: s.unidad_id ?? undefined, tipo: s.tipo, fecha: s.fecha,
      hora_inicio: s.hora_inicio ?? '', hora_fin: s.hora_fin ?? '',
      responsable: s.responsable ?? '', estado: s.estado,
      costo: s.costo ?? undefined, notas: s.notas ?? '',
    })
    setEditId(s.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.fecha) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha del servicio.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo ?? 'limpieza_estandar',
      fecha: form.fecha!, hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      responsable: form.responsable || null, estado: form.estado ?? 'pendiente',
      costo: form.costo ?? null, notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('servicios_housekeeping', editId, payload)
      : await createCondominioRow('servicios_housekeeping', payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar servicio?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('servicios_housekeeping', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoHousekeeping) {
    const { error } = await updateCondominioRow('servicios_housekeeping', id, { estado })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Pendientes',       value: String(pendientes),                                                     icon: '⏳', color: 'var(--at-warning)' },
          { label: 'En proceso',       value: String(enProceso),                                                      icon: '🔄', color: 'var(--at-primary)' },
          { label: 'Completados (mes)',value: String(completados),                                                    icon: '✅', color: 'var(--at-success)' },
          { label: 'Costo del mes',    value: costoMes > 0 ? `${moneda} ${costoMes.toFixed(0)}` : '—',               icon: '💰', color: 'var(--at-accent)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Housekeeping</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo Servicio</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Servicio' : 'Nuevo Servicio de Housekeeping'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'limpieza_estandar'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoHousekeeping }))}>
                {Object.entries(TIPO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin unidad específica</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora inicio</label>
              <input style={inputStyle} type="time" value={form.hora_inicio ?? ''} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora fin</label>
              <input style={inputStyle} type="time" value={form.hora_fin ?? ''} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Responsable</label>
              <input style={inputStyle} value={form.responsable ?? ''} onChange={e => setForm(f => ({ ...f, responsable: e.target.value }))} placeholder="Nombre del limpiador" />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'pendiente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoHousekeeping }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Costo ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.costo ?? ''} onChange={e => setForm(f => ({ ...f, costo: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'pendiente', 'en_proceso', 'completado', 'cancelado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todos (${servicios.length})` : `${ESTADO_CONFIG[e as EstadoHousekeeping]?.label} (${servicios.filter(s => s.estado === e).length})`}
          </button>
        ))}
      </div>

      {/* Vista agrupada por fecha */}
      {fechas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🧹</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay servicios de housekeeping</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {fechas.map(fecha => (
            <div key={fecha}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <div style={{ height: '1px', flex: 1, background: 'var(--at-line)' }} />
                <span style={{ fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap',
                  background: fecha === today ? 'var(--at-warning-tint)' : 'var(--at-surface)', padding: '2px 8px', borderRadius: '10px',
                  border: `1.5px solid ${fecha === today ? '#fcd34d' : 'var(--at-line)'}`,
                  color: fecha === today ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>
                  {fecha === today ? '⭐ Hoy' : ''} {fecha}
                </span>
                <div style={{ height: '1px', flex: 1, background: 'var(--at-line)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '10px' }}>
                {byFecha[fecha].map(s => {
                  const est = ESTADO_CONFIG[s.estado]
                  const tipo = TIPO_CONFIG[s.tipo]
                  return (
                    <div key={s.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{tipo.icon} {tipo.label}</div>
                        <span style={{ padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                        {s.unidad_nombre && <div>🏠 {s.unidad_nombre}</div>}
                        {s.responsable && <div>👤 {s.responsable}</div>}
                        {(s.hora_inicio || s.hora_fin) && <div>🕐 {s.hora_inicio ?? '?'} — {s.hora_fin ?? '?'}</div>}
                        {s.costo && <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>💰 {moneda} {s.costo.toFixed(2)}</div>}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {s.estado === 'pendiente' && (
                            <button onClick={() => handleEstado(s.id, 'en_proceso')} style={{ flex: 1, padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Iniciar</button>
                          )}
                          {s.estado === 'en_proceso' && (
                            <button onClick={() => handleEstado(s.id, 'completado')} style={{ flex: 1, padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Completar</button>
                          )}
                          <button onClick={() => startEdit(s)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                          <button onClick={() => handleDelete(s.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
