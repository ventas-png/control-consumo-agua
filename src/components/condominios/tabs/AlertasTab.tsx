import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { AlertaCondominio, TipoAlerta, PolizaSeguro, ContratoProveedor, InspeccionNormativa, LlaveCondominio } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

type TFunc = (key: TranslationKey, params?: Record<string, string | number>) => string

interface Props {
  alertas: AlertaCondominio[]
  polizas: PolizaSeguro[]
  contratos: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  llaves: LlaveCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoAlerta, { labelKey: TranslationKey; color: string; bg: string }> = {
  urgente:       { labelKey: 'condominios.alertas.tipo_urgente',      color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  vencimiento:   { labelKey: 'condominios.alertas.tipo_vencimiento',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  recordatorio:  { labelKey: 'condominios.alertas.tipo_recordatorio', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  aviso:         { labelKey: 'condominios.alertas.tipo_aviso',        color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
}

const DAYS_WARNING = 30

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}

interface AutoAlert {
  key: string
  tipo: TipoAlerta
  titulo: string
  descripcion: string
  fecha_alerta: string
  referencia_tabla: string
  referencia_id: string
}

function buildAutoAlerts(
  polizas: PolizaSeguro[],
  contratos: ContratoProveedor[],
  inspecciones: InspeccionNormativa[],
  llaves: LlaveCondominio[],
  t: TFunc,
): AutoAlert[] {
  const alerts: AutoAlert[] = []
  const venceDesc = (d: number) => d <= 0 ? t('condominios.alertas.auto_vence_pasada') : t('condominios.alertas.auto_vence_dias', { days: d })
  const programadaDesc = (d: number) => d <= 0 ? t('condominios.alertas.auto_programada_pasada') : t('condominios.alertas.auto_programada_dias', { days: d })

  for (const p of polizas) {
    if (!p.fecha_vencimiento) continue
    const d = daysUntil(p.fecha_vencimiento)
    if (d <= DAYS_WARNING) {
      alerts.push({
        key: `poliza-${p.id}`,
        tipo: d <= 7 ? 'urgente' : 'vencimiento',
        titulo: t('condominios.alertas.auto_poliza_title', { aseguradora: p.aseguradora }),
        descripcion: venceDesc(d),
        fecha_alerta: p.fecha_vencimiento,
        referencia_tabla: 'polizas_seguro',
        referencia_id: p.id,
      })
    }
  }

  for (const c of contratos) {
    if (!c.fecha_fin) continue
    const d = daysUntil(c.fecha_fin)
    if (d <= DAYS_WARNING) {
      alerts.push({
        key: `contrato-${c.id}`,
        tipo: d <= 7 ? 'urgente' : 'vencimiento',
        titulo: t('condominios.alertas.auto_contrato_title', { proveedor: c.proveedor_nombre }),
        descripcion: venceDesc(d),
        fecha_alerta: c.fecha_fin,
        referencia_tabla: 'contratos_proveedores',
        referencia_id: c.id,
      })
    }
  }

  for (const i of inspecciones) {
    if (!i.fecha_proxima) continue
    const d = daysUntil(i.fecha_proxima)
    if (d <= DAYS_WARNING) {
      alerts.push({
        key: `inspeccion-${i.id}`,
        tipo: d <= 7 ? 'urgente' : 'recordatorio',
        titulo: t('condominios.alertas.auto_inspeccion_title', { tipo: i.tipo }),
        descripcion: programadaDesc(d),
        fecha_alerta: i.fecha_proxima,
        referencia_tabla: 'inspecciones_normativas',
        referencia_id: i.id,
      })
    }
  }

  for (const l of llaves) {
    if (l.estado === 'perdida') {
      alerts.push({
        key: `llave-${l.id}`,
        tipo: 'urgente',
        titulo: t('condominios.alertas.auto_llave_title'),
        descripcion: t('condominios.alertas.auto_llave_desc', {
          tipo: l.tipo.toUpperCase(),
          codigo: l.codigo ?? t('condominios.alertas.auto_sin_codigo'),
          unidad: l.unidad_nombre ?? t('condominios.alertas.auto_unidad_desconocida'),
        }),
        fecha_alerta: l.created_at.slice(0, 10),
        referencia_tabla: 'llaves_condominio',
        referencia_id: l.id,
      })
    }
  }

  return alerts.sort((a, b) => new Date(a.fecha_alerta).getTime() - new Date(b.fecha_alerta).getTime())
}

const BLANK: Omit<AlertaCondominio, 'id' | 'company_id' | 'project_id' | 'created_at'> = {
  tipo: 'aviso',
  titulo: '',
  descripcion: '',
  fecha_alerta: new Date().toISOString().slice(0, 10),
  estado: 'activa',
  referencia_tabla: undefined,
  referencia_id: undefined,
}

export function AlertasTab({ alertas, polizas, contratos, inspecciones, llaves, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'activa' | 'resuelta' | 'ignorada' | 'all'>('activa')

  const autoAlerts = buildAutoAlerts(polizas, contratos, inspecciones, llaves, t)
  const storedActivas = alertas.filter(a => filtroEstado === 'all' ? true : a.estado === filtroEstado)

  const totalUrgentes = alertas.filter(a => a.estado === 'activa' && a.tipo === 'urgente').length
    + autoAlerts.filter(a => a.tipo === 'urgente').length
  const totalVencimientos = alertas.filter(a => a.estado === 'activa' && a.tipo === 'vencimiento').length
    + autoAlerts.filter(a => a.tipo === 'vencimiento').length
  const totalAuto = autoAlerts.length

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSave() {
    if (!form.titulo.trim() || !form.fecha_alerta) return notify({ variant: 'warning', title: t('condominios.alertas.err_required_title'), text: t('condominios.alertas.err_required') })
    setSaving(true)
    const { error } = await createCondominioRow('alertas_condominio', {
      company_id: companyId,
      project_id: proyectoId,
      tipo: form.tipo,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion || null,
      fecha_alerta: form.fecha_alerta,
      estado: 'activa',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setShowForm(false)
    setForm({ ...BLANK })
    onRefresh()
  }

  async function handleEstado(id: string, estado: 'resuelta' | 'ignorada') {
    await updateCondominioRow('alertas_condominio', id, { estado })
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.alertas.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    await deleteCondominioRow('alertas_condominio', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.alertas.title')}</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.alertas.new_button')}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: t('condominios.alertas.kpi_urgentes'),     value: totalUrgentes,    icon: '🚨', color: 'var(--at-danger)' },
          { label: t('condominios.alertas.kpi_vencimientos'), value: totalVencimientos, icon: '⏰', color: 'var(--at-warning)' },
          { label: t('condominios.alertas.kpi_auto'),         value: totalAuto,        icon: '🤖', color: 'var(--at-primary)' },
          { label: t('condominios.alertas.kpi_manuales'),     value: alertas.filter(a => a.estado === 'activa').length, icon: '📌', color: 'var(--at-accent)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.alertas.form_title')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '4px' }}>{t('condominios.alertas.type_required')}</label>
              <select value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoAlerta)} style={inputStyle}>
                {(Object.keys(TIPO_LABELS) as TipoAlerta[]).map(tipo => (
                  <option key={tipo} value={tipo}>{t(TIPO_LABELS[tipo].labelKey)}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '4px' }}>{t('condominios.alertas.title_field')}</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder={t('condominios.alertas.title_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '4px' }}>{t('condominios.alertas.date_field')}</label>
              <input style={inputStyle} type="date" value={form.fecha_alerta} onChange={e => setF('fecha_alerta', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '4px' }}>{t('condominios.alertas.description')}</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setF('descripcion', e.target.value)} placeholder={t('condominios.alertas.description_placeholder')} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? t('condominios.comun.saving') : t('condominios.comun.save')}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '8px 14px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              {t('condominios.comun.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Auto-detected alerts */}
      {autoAlerts.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('condominios.alertas.auto_section', { count: autoAlerts.length })}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {autoAlerts.map(a => {
              const cfg = TIPO_LABELS[a.tipo]
              return (
                <div key={a.key} style={{ background: cfg.bg, border: `1.5px solid ${cfg.color}30`, borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{a.titulo}</div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{a.descripcion}</div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: cfg.color, background: 'var(--at-surface)', padding: '3px 8px', borderRadius: '20px', flexShrink: 0 }}>
                    {t(cfg.labelKey)}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', flexShrink: 0 }}>{a.fecha_alerta}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Manual stored alerts — cond:B2: migrado a <DataTable> shared */}
      <div>
        <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t('condominios.alertas.manual_section', { count: alertas.length })}
        </h3>
        <DataTable<AlertaCondominio>
          data={storedActivas}
          rowKey="id"
          pageSize={50}
          defaultSort={{ key: 'fecha_alerta', direction: 'asc' }}
          searchPlaceholder={t('condominios.alertas.search_placeholder')}
          searchableKeys={['titulo', a => a.descripcion ?? '']}
          rowStyle={a => a.estado !== 'activa' ? { background: 'var(--at-surface-2)' } : {}}
          filters={[{
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as 'activa' | 'resuelta' | 'ignorada' | 'all'),
            options: [
              { value: 'activa', label: t('condominios.alertas.filter_activa') },
              { value: 'resuelta', label: t('condominios.alertas.filter_resuelta') },
              { value: 'ignorada', label: t('condominios.alertas.filter_ignorada') },
              { value: 'all', label: t('condominios.alertas.filter_all') },
            ],
          }]}
          emptyState={{ icon: '📋', title: filtroEstado !== 'all' ? t('condominios.alertas.empty_filtered', { estado: filtroEstado }) : t('condominios.alertas.empty') }}
          columns={[
            {
              key: 'tipo', header: t('condominios.comun.type'), sortable: true,
              accessor: a => t(TIPO_LABELS[a.tipo].labelKey),
              render: a => {
                const cfg = TIPO_LABELS[a.tipo]
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: a.estado !== 'activa' ? 'var(--at-line-strong)' : cfg.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: a.estado !== 'activa' ? 'var(--at-ink-3)' : cfg.color, background: 'var(--at-surface)', padding: '3px 8px', borderRadius: '20px', border: '1px solid var(--at-line)' }}>
                      {t(cfg.labelKey)}
                    </span>
                  </span>
                )
              },
            },
            {
              key: 'titulo', header: t('condominios.alertas.header_titulo'), sortable: true,
              render: a => (
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: a.estado !== 'activa' ? 'var(--at-ink-3)' : 'var(--at-ink)', textDecoration: a.estado === 'ignorada' ? 'line-through' : 'none' }}>
                    {a.titulo}
                  </div>
                  {a.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{a.descripcion}</div>}
                </div>
              ),
            },
            {
              key: 'fecha_alerta', header: t('condominios.alertas.header_fecha'), sortable: true, hideOnMobile: true,
              render: a => {
                const d = daysUntil(a.fecha_alerta)
                const suffix = a.estado === 'activa' && d <= 7 && d > 0
                  ? ` ${t('condominios.alertas.due_days', { days: d })}`
                  : a.estado === 'activa' && d <= 0
                    ? ` ${t('condominios.alertas.due_overdue')}`
                    : ''
                return (
                  <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                    {a.fecha_alerta}{suffix}
                  </span>
                )
              },
            },
            {
              key: 'actions', header: '', align: 'right',
              render: a => (
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {canEdit && a.estado === 'activa' && (
                    <>
                      <button onClick={() => handleEstado(a.id, 'resuelta')}
                        style={{ padding: '4px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                        {t('condominios.alertas.action_resolver')}
                      </button>
                      <button onClick={() => handleEstado(a.id, 'ignorada')}
                        style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>
                        {t('condominios.alertas.action_ignorar')}
                      </button>
                    </>
                  )}
                  {canEdit && (
                    <button onClick={() => handleDelete(a.id)} aria-label={t('condominios.comun.delete')}
                      style={{ padding: '4px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>
                      🗑️
                    </button>
                  )}
                </div>
              ),
            },
          ] satisfies DataTableColumn<AlertaCondominio>[]}
        />
      </div>
    </div>
  )
}
