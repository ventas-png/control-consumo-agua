import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { SolicitudResidente, TipoSolicitud, EstadoSolicitud, PrioridadSolicitud, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  solicitudes: SolicitudResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoSolicitud, { labelKey: TranslationKey; icon: string }> = {
  solvencia:      { labelKey: 'condominios.solicitudes.tipo_solvencia',       icon: '📜' },
  permiso_mudanza:{ labelKey: 'condominios.solicitudes.tipo_permiso_mudanza', icon: '🚚' },
  permiso_obra:   { labelKey: 'condominios.solicitudes.tipo_permiso_obra',    icon: '🏗️' },
  reclamo:        { labelKey: 'condominios.solicitudes.tipo_reclamo',         icon: '⚠️' },
  sugerencia:     { labelKey: 'condominios.solicitudes.tipo_sugerencia',      icon: '💡' },
  certificado:    { labelKey: 'condominios.solicitudes.tipo_certificado',     icon: '📋' },
  otro:           { labelKey: 'condominios.solicitudes.tipo_otro',            icon: '📁' },
}

const ESTADO_STYLE: Record<EstadoSolicitud, { color: string; bg: string; labelKey: TranslationKey }> = {
  pendiente:  { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', labelKey: 'condominios.solicitudes.estado_pendiente' },
  en_proceso: { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)', labelKey: 'condominios.solicitudes.estado_en_proceso' },
  resuelto:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)', labelKey: 'condominios.solicitudes.estado_resuelto' },
  rechazado:  { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', labelKey: 'condominios.solicitudes.estado_rechazado' },
}

const PRIORIDAD_COLOR: Record<PrioridadSolicitud, string> = {
  baja: 'var(--at-ink-3)', normal: 'var(--at-primary)', alta: 'var(--at-warning)', urgente: 'var(--at-danger)',
}

const PRIORIDAD_LABEL_KEY: Record<PrioridadSolicitud, TranslationKey> = {
  baja: 'condominios.solicitudes.prioridad_baja',
  normal: 'condominios.solicitudes.prioridad_normal',
  alta: 'condominios.solicitudes.prioridad_alta',
  urgente: 'condominios.solicitudes.prioridad_urgente',
}

const BLANK = {
  unidad_id: '', tipo: 'otro' as TipoSolicitud, descripcion: '',
  prioridad: 'normal' as PrioridadSolicitud, fecha_limite: '',
}

export function SolicitudesTab({ solicitudes, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
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
    if (!form.descripcion.trim()) return notify({ variant: 'warning', title: t('condominios.solicitudes.err_description_title'), text: t('condominios.solicitudes.err_description') })
    setSaving(true)
    const { error } = await createCondominioRow('solicitudes_residente', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      prioridad: form.prioridad, fecha_limite: form.fecha_limite || null,
      estado: 'pendiente',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoSolicitud) {
    const payload: Record<string, unknown> = { estado }
    if (estado === 'resuelto' || estado === 'rechazado') payload.respuesta = respuesta || null
    await updateCondominioRow('solicitudes_residente', id, payload)
    setExpandedId(null); setRespuesta(''); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.solicitudes.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    await deleteCondominioRow('solicitudes_residente', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.solicitudes.title')}</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.solicitudes.new_button')}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: t('condominios.solicitudes.kpi_total'),      value: solicitudes.length, color: 'var(--at-ink)' },
          { label: t('condominios.solicitudes.kpi_pendientes'), value: pendientes,         color: 'var(--at-warning)' },
          { label: t('condominios.solicitudes.kpi_en_proceso'), value: enProceso,          color: 'var(--at-primary)' },
          { label: t('condominios.solicitudes.kpi_urgentes'),   value: urgentes,           color: urgentes > 0 ? 'var(--at-danger)' : 'var(--at-success)' },
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
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{t('condominios.solicitudes.form_title')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.solicitudes.unit_optional')}</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">{t('condominios.solicitudes.unit_none')}</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.solicitudes.type_required')}</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoSolicitud)}>
                {(Object.keys(TIPO_LABELS) as TipoSolicitud[]).map(tipo => (
                  <option key={tipo} value={tipo}>{t(TIPO_LABELS[tipo].labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.solicitudes.priority')}</label>
              <select style={inputStyle} value={form.prioridad} onChange={e => setF('prioridad', e.target.value as PrioridadSolicitud)}>
                {(['baja','normal','alta','urgente'] as PrioridadSolicitud[]).map(p => (
                  <option key={p} value={p}>{t(PRIORIDAD_LABEL_KEY[p])}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.solicitudes.deadline')}</label>
              <input style={inputStyle} type="date" value={form.fecha_limite} onChange={e => setF('fecha_limite', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.solicitudes.description')}</label>
              <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.descripcion} onChange={e => setF('descripcion', e.target.value)}
                placeholder={t('condominios.solicitudes.description_placeholder')} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? t('condominios.comun.saving') : t('condominios.comun.save')}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              {t('condominios.comun.cancel')}
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
        searchPlaceholder={t('condominios.solicitudes.search_placeholder')}
        searchableKeys={['descripcion', s => s.unidad_nombre ?? '']}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoSolicitud | 'all'),
            options: [
              { value: 'all', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_STYLE) as EstadoSolicitud[]).map(e => ({ value: e, label: t(ESTADO_STYLE[e].labelKey) })),
            ],
          },
          {
            key: 'tipo',
            label: t('condominios.comun.type'),
            value: filtroTipo,
            onChange: v => setFiltroTipo(v as TipoSolicitud | 'all'),
            options: [
              { value: 'all', label: t('condominios.comun.all_types') },
              ...(Object.keys(TIPO_LABELS) as TipoSolicitud[]).map(tipo => ({ value: tipo, label: t(TIPO_LABELS[tipo].labelKey) })),
            ],
          },
        ]}
        emptyState={{ icon: '📋', title: t('condominios.solicitudes.empty') }}
        columns={[
          {
            key: 'tipo', header: t('condominios.comun.type'), sortable: true,
            accessor: s => t(TIPO_LABELS[s.tipo].labelKey),
            render: s => (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--at-ink)' }}>
                <span style={{ fontSize: '20px' }}>{TIPO_LABELS[s.tipo].icon}</span>
                {t(TIPO_LABELS[s.tipo].labelKey)}
              </span>
            ),
          },
          {
            key: 'unidad', header: t('condominios.comun.unit'), sortable: true,
            accessor: s => s.unidad_nombre ?? '',
            render: s => s.unidad_nombre
              ? <span style={{ color: 'var(--at-ink-2)' }}>{s.unidad_nombre}</span>
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'descripcion', header: t('condominios.solicitudes.header_descripcion'), sortable: true, hideOnMobile: true,
            render: s => (
              <span style={{ color: 'var(--at-ink-3)', display: 'block', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.descripcion}
              </span>
            ),
          },
          {
            key: 'prioridad', header: t('condominios.solicitudes.header_prioridad'), sortable: true,
            render: s => {
              const prioColor = PRIORIDAD_COLOR[s.prioridad]
              return <span style={{ fontSize: '10px', fontWeight: 700, color: prioColor, background: `${prioColor}15`, padding: '2px 6px', borderRadius: '20px' }}>{t(PRIORIDAD_LABEL_KEY[s.prioridad]).toUpperCase()}</span>
            },
          },
          {
            key: 'created_at', header: t('condominios.solicitudes.header_fecha'), sortable: true, hideOnMobile: true,
            render: s => <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{s.created_at.slice(0, 10)}{s.fecha_limite ? ` — ${t('condominios.solicitudes.deadline_inline', { fecha: s.fecha_limite })}` : ''}</span>,
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            render: s => {
              const est = ESTADO_STYLE[s.estado]
              return <span style={{ fontSize: '11px', fontWeight: 700, color: est.color, background: est.bg, padding: '3px 8px', borderRadius: '20px' }}>{t(est.labelKey)}</span>
            },
          },
          {
            key: 'actions', header: '', align: 'right',
            render: s => canEdit ? (
              <button onClick={e => { e.stopPropagation(); handleDelete(s.id) }} aria-label={t('condominios.comun.delete')}
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
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-success)', marginBottom: '2px' }}>{t('condominios.solicitudes.response')}</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink)' }}>{s.respuesta}</div>
              </div>
            )}
            {canEdit && (s.estado === 'pendiente' || s.estado === 'en_proceso') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} onClick={e => e.stopPropagation()}>
                <textarea value={respuesta} onChange={e => setRespuesta(e.target.value)}
                  placeholder={t('condominios.solicitudes.response_placeholder')}
                  rows={2} style={{ padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {s.estado === 'pendiente' && (
                    <button onClick={() => handleEstado(s.id, 'en_proceso')}
                      style={{ padding: '5px 12px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {t('condominios.solicitudes.action_en_proceso')}
                    </button>
                  )}
                  <button onClick={() => handleEstado(s.id, 'resuelto')}
                    style={{ padding: '5px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.solicitudes.action_resolver')}
                  </button>
                  <button onClick={() => handleEstado(s.id, 'rechazado')}
                    style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                    {t('condominios.solicitudes.action_rechazar')}
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
