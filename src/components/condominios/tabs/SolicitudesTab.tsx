import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { SolicitudResidente, TipoSolicitud, EstadoSolicitud, PrioridadSolicitud, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  solicitudes: SolicitudResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoSolicitud, { label: string; icon: string }> = {
  solvencia:      { label: 'Solvencia / Paz y Salvo', icon: '📜' },
  permiso_mudanza:{ label: 'Permiso de Mudanza',      icon: '🚚' },
  permiso_obra:   { label: 'Permiso de Obra',          icon: '🏗️' },
  reclamo:        { label: 'Reclamo',                  icon: '⚠️' },
  sugerencia:     { label: 'Sugerencia',               icon: '💡' },
  certificado:    { label: 'Certificado',              icon: '📋' },
  otro:           { label: 'Otro',                     icon: '📁' },
}

const ESTADO_STYLE: Record<EstadoSolicitud, { color: string; bg: string; label: string }> = {
  pendiente:  { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', label: 'Pendiente' },
  en_proceso: { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)', label: 'En Proceso' },
  resuelto:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)', label: 'Resuelto' },
  rechazado:  { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', label: 'Rechazado' },
}

const PRIORIDAD_COLOR: Record<PrioridadSolicitud, string> = {
  baja: 'var(--at-ink-3)', normal: 'var(--at-primary)', alta: 'var(--at-warning)', urgente: 'var(--at-danger)',
}

const BLANK = {
  unidad_id: '', tipo: 'otro' as TipoSolicitud, descripcion: '',
  prioridad: 'normal' as PrioridadSolicitud, fecha_limite: '',
}

export function SolicitudesTab({ solicitudes, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoSolicitud | 'all'>('all')
  const [filtroTipo, setFiltroTipo] = useState<TipoSolicitud | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [respuesta, setRespuesta] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  const filtered = solicitudes
    .filter(s => filtroEstado === 'all' || s.estado === filtroEstado)
    .filter(s => filtroTipo === 'all' || s.tipo === filtroTipo)

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente').length
  const enProceso  = solicitudes.filter(s => s.estado === 'en_proceso').length
  const urgentes   = solicitudes.filter(s => s.prioridad === 'urgente' && s.estado !== 'resuelto' && s.estado !== 'rechazado').length

  async function handleSave() {
    if (!form.descripcion.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'La descripción es obligatoria.' })
    setSaving(true)
    const { error } = await supabase.from('solicitudes_residente').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      prioridad: form.prioridad, fecha_limite: form.fecha_limite || null,
      estado: 'pendiente',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoSolicitud) {
    const payload: Record<string, unknown> = { estado }
    if (estado === 'resuelto' || estado === 'rechazado') payload.respuesta = respuesta || null
    await supabase.from('solicitudes_residente').update(payload).eq('id', id)
    setExpandedId(null); setRespuesta(''); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar solicitud?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('solicitudes_residente').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Solicitudes de Residentes</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Solicitud
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total',         value: solicitudes.length, color: 'var(--at-ink)' },
          { label: 'Pendientes',    value: pendientes,         color: 'var(--at-warning)' },
          { label: 'En proceso',    value: enProceso,          color: 'var(--at-primary)' },
          { label: 'Urgentes',      value: urgentes,           color: urgentes > 0 ? 'var(--at-danger)' : 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nueva solicitud</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoSolicitud)}>
                {(Object.keys(TIPO_LABELS) as TipoSolicitud[]).map(t => (
                  <option key={t} value={t}>{TIPO_LABELS[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Prioridad</label>
              <select style={inputStyle} value={form.prioridad} onChange={e => setF('prioridad', e.target.value as PrioridadSolicitud)}>
                {(['baja','normal','alta','urgente'] as PrioridadSolicitud[]).map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha límite</label>
              <input style={inputStyle} type="date" value={form.fecha_limite} onChange={e => setF('fecha_limite', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción *</label>
              <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.descripcion} onChange={e => setF('descripcion', e.target.value)}
                placeholder="Detalle de la solicitud…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
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

      {/* List — cond:B2: migrado a <DataTable> shared con expandedContent */}
      <DataTable<SolicitudResidente>
        data={filtered}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'created_at', direction: 'desc' }}
        onRowClick={s => setExpandedId(expandedId === s.id ? null : s.id)}
        searchPlaceholder="Buscar descripción, unidad…"
        searchableKeys={['descripcion', s => s.unidad_nombre ?? '']}
        filters={[
          {
            key: 'estado',
            label: 'Estado',
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoSolicitud | 'all'),
            options: [
              { value: 'all', label: 'Todos los estados' },
              ...(Object.keys(ESTADO_STYLE) as EstadoSolicitud[]).map(e => ({ value: e, label: ESTADO_STYLE[e].label })),
            ],
          },
          {
            key: 'tipo',
            label: 'Tipo',
            value: filtroTipo,
            onChange: v => setFiltroTipo(v as TipoSolicitud | 'all'),
            options: [
              { value: 'all', label: 'Todos los tipos' },
              ...(Object.keys(TIPO_LABELS) as TipoSolicitud[]).map(t => ({ value: t, label: TIPO_LABELS[t].label })),
            ],
          },
        ]}
        emptyState={{ icon: '📋', title: 'No hay solicitudes que mostrar' }}
        columns={[
          {
            key: 'tipo', header: 'Tipo', sortable: true,
            accessor: s => TIPO_LABELS[s.tipo].label,
            render: s => (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--at-ink)' }}>
                <span style={{ fontSize: '20px' }}>{TIPO_LABELS[s.tipo].icon}</span>
                {TIPO_LABELS[s.tipo].label}
              </span>
            ),
          },
          {
            key: 'unidad', header: 'Unidad', sortable: true,
            accessor: s => s.unidad_nombre ?? '',
            render: s => s.unidad_nombre
              ? <span style={{ color: 'var(--at-ink-2)' }}>{s.unidad_nombre}</span>
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'descripcion', header: 'Descripción', sortable: true, hideOnMobile: true,
            render: s => (
              <span style={{ color: 'var(--at-ink-3)', display: 'block', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.descripcion}
              </span>
            ),
          },
          {
            key: 'prioridad', header: 'Prioridad', sortable: true,
            render: s => {
              const prioColor = PRIORIDAD_COLOR[s.prioridad]
              return <span style={{ fontSize: '10px', fontWeight: 700, color: prioColor, background: `${prioColor}15`, padding: '2px 6px', borderRadius: '20px' }}>{s.prioridad.toUpperCase()}</span>
            },
          },
          {
            key: 'created_at', header: 'Fecha', sortable: true, hideOnMobile: true,
            render: s => <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{s.created_at.slice(0, 10)}{s.fecha_limite ? ` — límite: ${s.fecha_limite}` : ''}</span>,
          },
          {
            key: 'estado', header: 'Estado', sortable: true,
            render: s => {
              const est = ESTADO_STYLE[s.estado]
              return <span style={{ fontSize: '11px', fontWeight: 700, color: est.color, background: est.bg, padding: '3px 8px', borderRadius: '20px' }}>{est.label}</span>
            },
          },
          {
            key: 'actions', header: '', align: 'right',
            render: s => canEdit ? (
              <button onClick={e => { e.stopPropagation(); handleDelete(s.id) }} aria-label="Eliminar solicitud"
                style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
            ) : null,
          },
        ] satisfies DataTableColumn<SolicitudResidente>[]}
        isRowExpanded={s => expandedId === s.id}
        expandedContent={s => (
          <div style={{ padding: '4px 0 8px' }}>
            <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--at-ink)' }}>{s.descripcion}</p>
            {s.respuesta && (
              <div style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '7px', padding: '8px 10px', marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-success)', marginBottom: '2px' }}>Respuesta:</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink)' }}>{s.respuesta}</div>
              </div>
            )}
            {canEdit && (s.estado === 'pendiente' || s.estado === 'en_proceso') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} onClick={e => e.stopPropagation()}>
                <textarea value={respuesta} onChange={e => setRespuesta(e.target.value)}
                  placeholder="Respuesta / observaciones (opcional)…"
                  rows={2} style={{ padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {s.estado === 'pendiente' && (
                    <button onClick={() => handleEstado(s.id, 'en_proceso')}
                      style={{ padding: '5px 12px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      ▶ En Proceso
                    </button>
                  )}
                  <button onClick={() => handleEstado(s.id, 'resuelto')}
                    style={{ padding: '5px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    ✓ Resolver
                  </button>
                  <button onClick={() => handleEstado(s.id, 'rechazado')}
                    style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                    ✕ Rechazar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      />
    </div>
  )
}
