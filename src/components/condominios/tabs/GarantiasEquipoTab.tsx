import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { GarantiaEquipo, EstadoGarantia } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  garantias: GarantiaEquipo[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_COLOR: Record<EstadoGarantia, { bg: string; color: string }> = {
  vigente:      { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  vencida:      { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  reclamada:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  sin_garantia: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}
const ESTADO_LABEL_KEY: Record<EstadoGarantia, TranslationKey> = {
  vigente:      'condominios.garantias.estado_vigente',
  vencida:      'condominios.garantias.estado_vencida',
  reclamada:    'condominios.garantias.estado_reclamada',
  sin_garantia: 'condominios.garantias.estado_sin_garantia',
}
const ESTADOS = Object.keys(ESTADO_LABEL_KEY) as EstadoGarantia[]

const BLANK = { equipo: '', area: '', numero_serie: '', proveedor: '', contacto_soporte: '', fecha_compra: '', fecha_vencimiento: '', monto_compra: '', estado: 'vigente' as EstadoGarantia, notas: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }
function addDays(d: string, days: number) { const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10) }

export function GarantiasEquipoTab({ garantias, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoGarantia>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(g: GarantiaEquipo) {
    setEditId(g.id)
    setForm({ equipo: g.equipo, area: g.area ?? '', numero_serie: g.numero_serie ?? '', proveedor: g.proveedor ?? '', contacto_soporte: g.contacto_soporte ?? '', fecha_compra: g.fecha_compra ?? '', fecha_vencimiento: g.fecha_vencimiento ?? '', monto_compra: g.monto_compra ? String(g.monto_compra) : '', estado: g.estado, notas: g.notas ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.equipo.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.garantias.err_equipo') })
    setSaving(true)
    const payload = {
      equipo: form.equipo.trim(), area: form.area || null, numero_serie: form.numero_serie || null,
      proveedor: form.proveedor || null, contacto_soporte: form.contacto_soporte || null,
      fecha_compra: form.fecha_compra || null, fecha_vencimiento: form.fecha_vencimiento || null,
      monto_compra: form.monto_compra ? parseFloat(form.monto_compra) : null,
      estado: form.estado, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('garantias_equipo', editId, payload))
    } else {
      ({ error } = await createCondominioRow('garantias_equipo', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.garantias.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    await deleteCondominioRow('garantias_equipo', id)
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoGarantia) {
    await updateCondominioRow('garantias_equipo', id, { estado })
    onRefresh()
  }

  const today = hoyLocalISO()
  const filtered = filtroEstado === 'todos' ? garantias : garantias.filter(g => g.estado === filtroEstado)

  const porVencer  = garantias.filter(g => g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento <= addDays(today, 60) && g.fecha_vencimiento >= today).length
  const vencidas   = garantias.filter(g => g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento < today).length
  const vigentes   = garantias.filter(g => g.estado === 'vigente').length

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.garantias.title')}</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>
            {t('condominios.garantias.subtitle', { vigentes })}
            {porVencer > 0 ? t('condominios.garantias.subtitle_por_vencer', { count: porVencer }) : ''}
            {vencidas > 0 ? t('condominios.garantias.subtitle_vencidas', { count: vencidas }) : ''}
          </p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.garantias.new_button')}
          </button>
        )}
      </div>

      {/* Alerts */}
      {(porVencer > 0 || vencidas > 0) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {vencidas > 0 && <div style={{ background: 'var(--at-danger-tint)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600 }}>{t('condominios.garantias.alerta_vencidas', { count: vencidas })}</div>}
          {porVencer > 0 && <div style={{ background: 'var(--at-warning-tint)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>{t('condominios.garantias.alerta_por_vencer', { count: porVencer })}</div>}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {ESTADOS.map(est => (
          <div key={est} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: ESTADO_COLOR[est].color }}>{garantias.filter(g => g.estado === est).length}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{t(ESTADO_LABEL_KEY[est])}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? t('condominios.garantias.form_title_edit') : t('condominios.garantias.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.equipo')}</label>
              <input style={inputStyle} value={form.equipo} onChange={e => setF('equipo', e.target.value)} placeholder={t('condominios.garantias.equipo_placeholder')} autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.area')}</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder={t('condominios.garantias.area_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.numero_serie')}</label>
              <input style={inputStyle} value={form.numero_serie} onChange={e => setF('numero_serie', e.target.value)} placeholder={t('condominios.garantias.numero_serie_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.proveedor')}</label>
              <input style={inputStyle} value={form.proveedor} onChange={e => setF('proveedor', e.target.value)} placeholder={t('condominios.garantias.proveedor_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.contacto_soporte')}</label>
              <input style={inputStyle} value={form.contacto_soporte} onChange={e => setF('contacto_soporte', e.target.value)} placeholder={t('condominios.garantias.contacto_soporte_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.fecha_compra')}</label>
              <input style={inputStyle} type="date" value={form.fecha_compra} onChange={e => setF('fecha_compra', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.fecha_vencimiento')}</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento} onChange={e => setF('fecha_vencimiento', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.garantias.monto_compra', { moneda })}</label>
              <input style={inputStyle} type="number" step="0.01" value={form.monto_compra} onChange={e => setF('monto_compra', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value as EstadoGarantia)}>
                {ESTADOS.map(v => <option key={v} value={v}>{t(ESTADO_LABEL_KEY[v])}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.comun.notes')}</label>
              <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder={t('condominios.garantias.notas_placeholder')} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? t('condominios.comun.saving') : t('condominios.comun.save')}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              {t('condominios.comun.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* List — cond:B2: migrado a <DataTable> shared */}
      <DataTable<GarantiaEquipo>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'fecha_vencimiento', direction: 'asc' }}
        searchPlaceholder={t('condominios.garantias.search_placeholder')}
        searchableKeys={['equipo', g => g.proveedor ?? '', g => g.numero_serie ?? '']}
        rowStyle={g => {
          const expirada = g.estado === 'vigente' && !!g.fecha_vencimiento && g.fecha_vencimiento < today
          const expirando = g.estado === 'vigente' && !!g.fecha_vencimiento && g.fecha_vencimiento <= addDays(today, 60)
          if (expirada) return { background: 'var(--at-danger-tint)' }
          if (expirando) return { background: 'var(--at-warning-tint)' }
          return {}
        }}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as 'todos' | EstadoGarantia),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...ESTADOS.map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '🛡️', title: t('condominios.garantias.empty') }}
        columns={[
          {
            key: 'equipo', header: t('condominios.garantias.col_equipo'), sortable: true,
            render: g => {
              const expirada = g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento < today
              const expirando = g.estado === 'vigente' && g.fecha_vencimiento && g.fecha_vencimiento <= addDays(today, 60)
              return (
                <div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{g.equipo}</span>
                    {expirada && <span style={{ fontSize: '10px', color: 'var(--at-danger)', fontWeight: 700 }}>{t('condominios.garantias.badge_expirada')}</span>}
                    {!expirada && expirando && <span style={{ fontSize: '10px', color: 'var(--at-warning)', fontWeight: 700 }}>{t('condominios.garantias.badge_por_vencer')}</span>}
                  </div>
                  {g.area && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>📍 {g.area}{g.numero_serie ? ` · SN: ${g.numero_serie}` : ''}</div>}
                  {g.contacto_soporte && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{t('condominios.garantias.soporte_inline', { contacto: g.contacto_soporte })}</div>}
                  {g.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-2)', fontStyle: 'italic' }}>{g.notas}</div>}
                </div>
              )
            },
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            accessor: g => t(ESTADO_LABEL_KEY[g.estado]),
            render: g => {
              const c = ESTADO_COLOR[g.estado]
              return <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: c.bg, color: c.color }}>{t(ESTADO_LABEL_KEY[g.estado])}</span>
            },
          },
          {
            key: 'proveedor', header: t('condominios.garantias.col_proveedor'), sortable: true, hideOnMobile: true,
            accessor: g => g.proveedor ?? '',
            render: g => g.proveedor ? <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>🏢 {g.proveedor}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'fecha_compra', header: t('condominios.garantias.col_compra'), sortable: true, hideOnMobile: true,
            accessor: g => g.fecha_compra ?? '',
            render: g => g.fecha_compra ? <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>🛒 {g.fecha_compra}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'fecha_vencimiento', header: t('condominios.garantias.col_vencimiento'), sortable: true, hideOnMobile: true,
            accessor: g => g.fecha_vencimiento ?? '',
            render: g => {
              if (!g.fecha_vencimiento) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              const expirada = g.estado === 'vigente' && g.fecha_vencimiento < today
              const expirando = g.estado === 'vigente' && g.fecha_vencimiento <= addDays(today, 60)
              return <span style={{ fontSize: '12px', color: expirada ? 'var(--at-danger)' : expirando ? 'var(--at-warning)' : 'var(--at-ink-3)', fontWeight: (expirada || expirando) ? 700 : 400 }}>📅 {g.fecha_vencimiento}</span>
            },
          },
          {
            key: 'monto_compra', header: t('condominios.garantias.col_monto'), sortable: true, align: 'right', hideOnMobile: true,
            accessor: g => g.monto_compra ?? 0,
            render: g => g.monto_compra ? <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{fmt(Number(g.monto_compra), moneda)}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'actions', header: '', align: 'right',
            render: g => canEdit ? (
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {g.estado === 'vigente' && (
                  <button onClick={() => cambiarEstado(g.id, 'reclamada')}
                    style={{ padding: '3px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                    {t('condominios.garantias.accion_reclamar')}
                  </button>
                )}
                <button onClick={() => startEdit(g)} aria-label={t('condominios.comun.edit')}
                  style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(g.id)} aria-label={t('condominios.comun.delete')}
                  style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<GarantiaEquipo>[]}
      />
    </div>
  )
}
