import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { LocalComercial, EstadoLocal, GiroLocal } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  locales: LocalComercial[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_COLOR: Record<EstadoLocal, { color: string; bg: string }> = {
  disponible:      { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  ocupado:         { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  en_remodelacion: { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
}
const ESTADO_LABEL_KEY: Record<EstadoLocal, TranslationKey> = {
  disponible:      'condominios.locales.estado_disponible',
  ocupado:         'condominios.locales.estado_ocupado',
  en_remodelacion: 'condominios.locales.estado_en_remodelacion',
}

const GIRO_ICON: Record<GiroLocal, string> = {
  restaurante: '🍽️', oficina: '💼', comercio: '🛍️', servicio: '🔧', otro: '📋',
}
const GIRO_LABEL_KEY: Record<GiroLocal, TranslationKey> = {
  restaurante: 'condominios.locales.giro_restaurante',
  oficina:     'condominios.locales.giro_oficina',
  comercio:    'condominios.locales.giro_comercio',
  servicio:    'condominios.locales.giro_servicio',
  otro:        'condominios.locales.giro_otro',
}

const blank = (): Partial<LocalComercial> => ({
  numero_local: '', piso: '', area_m2: undefined, giro: 'comercio',
  inquilino_nombre: '', inquilino_telefono: '', fecha_inicio: '', fecha_fin: '',
  renta_base: undefined, porcentaje_cam: 0, cuota_cam: undefined,
  estado: 'disponible', notas: '',
})

export function LocalesTab({ locales, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [filtroEstado, setFiltroEstado] = useState<EstadoLocal | 'todos'>('todos')
  const [form, setForm] = useState<Partial<LocalComercial>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = locales.filter(l => filtroEstado === 'todos' || l.estado === filtroEstado)
  const ocupados  = locales.filter(l => l.estado === 'ocupado').length
  const rentaTotal = locales.filter(l => l.estado === 'ocupado').reduce((s, l) => s + (l.renta_base ?? 0) + (l.cuota_cam ?? 0), 0)

  function startEdit(l: LocalComercial) {
    setForm({
      numero_local: l.numero_local, piso: l.piso ?? '', area_m2: l.area_m2 ?? undefined,
      giro: l.giro, inquilino_nombre: l.inquilino_nombre ?? '', inquilino_telefono: l.inquilino_telefono ?? '',
      fecha_inicio: l.fecha_inicio ?? '', fecha_fin: l.fecha_fin ?? '',
      renta_base: l.renta_base ?? undefined, porcentaje_cam: l.porcentaje_cam ?? 0,
      cuota_cam: l.cuota_cam ?? undefined, estado: l.estado, notas: l.notas ?? '',
    })
    setEditId(l.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  function recalcCAM(f: Partial<LocalComercial>) {
    if (f.renta_base && f.porcentaje_cam) {
      return { ...f, cuota_cam: parseFloat(((f.renta_base * f.porcentaje_cam) / 100).toFixed(2)) }
    }
    return f
  }

  async function handleSave() {
    if (!form.numero_local?.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.locales.err_numero') })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      numero_local: form.numero_local!.trim(), piso: form.piso || null,
      area_m2: form.area_m2 ?? null, giro: form.giro ?? 'comercio',
      inquilino_nombre: form.inquilino_nombre || null, inquilino_telefono: form.inquilino_telefono || null,
      fecha_inicio: form.fecha_inicio || null, fecha_fin: form.fecha_fin || null,
      renta_base: form.renta_base ?? null, porcentaje_cam: form.porcentaje_cam ?? 0,
      cuota_cam: form.cuota_cam ?? null, estado: form.estado ?? 'disponible',
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('locales_comerciales').update(payload).eq('id', editId)
      : await supabase.from('locales_comerciales').insert(payload)
    if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.locales.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('locales_comerciales').delete().eq('id', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  const today = new Date()

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: t('condominios.locales.kpi_total'),       value: String(locales.length),  icon: '🏪', color: 'var(--at-primary)' },
          { label: t('condominios.locales.kpi_ocupados'),    value: String(ocupados),        icon: '🔑', color: 'var(--at-accent)' },
          { label: t('condominios.locales.kpi_disponibles'), value: String(locales.filter(l => l.estado === 'disponible').length), icon: '✅', color: 'var(--at-success)' },
          { label: t('condominios.locales.kpi_renta'),       value: rentaTotal > 0 ? `${moneda} ${rentaTotal.toFixed(0)}` : '—', icon: '💰', color: 'var(--at-warning)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.locales.title')}</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{t('condominios.locales.new_button')}</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? t('condominios.locales.form_title_edit') : t('condominios.locales.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>{t('condominios.locales.numero')}</label>
              <input style={inputStyle} value={form.numero_local ?? ''} onChange={e => setForm(f => ({ ...f, numero_local: e.target.value }))} placeholder={t('condominios.locales.numero_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.piso')}</label>
              <input style={inputStyle} value={form.piso ?? ''} onChange={e => setForm(f => ({ ...f, piso: e.target.value }))} placeholder={t('condominios.locales.piso_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.area')}</label>
              <input style={inputStyle} type="number" min="0" step="0.1" value={form.area_m2 ?? ''} onChange={e => setForm(f => ({ ...f, area_m2: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.giro')}</label>
              <select style={inputStyle} value={form.giro ?? 'comercio'} onChange={e => setForm(f => ({ ...f, giro: e.target.value as GiroLocal }))}>
                {(Object.keys(GIRO_LABEL_KEY) as GiroLocal[]).map(k => <option key={k} value={k}>{GIRO_ICON[k]} {t(GIRO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoLocal }))}>
                {(Object.keys(ESTADO_LABEL_KEY) as EstadoLocal[]).map(k => <option key={k} value={k}>{t(ESTADO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.inquilino')}</label>
              <input style={inputStyle} value={form.inquilino_nombre ?? ''} onChange={e => setForm(f => ({ ...f, inquilino_nombre: e.target.value }))} placeholder={t('condominios.locales.inquilino_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.inquilino_telefono')}</label>
              <input style={inputStyle} value={form.inquilino_telefono ?? ''} onChange={e => setForm(f => ({ ...f, inquilino_telefono: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.inicio_contrato')}</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio ?? ''} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.fin_contrato')}</label>
              <input style={inputStyle} type="date" value={form.fecha_fin ?? ''} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.renta_base', { moneda })}</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.renta_base ?? ''} onChange={e => setForm(f => recalcCAM({ ...f, renta_base: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.porcentaje_cam')}</label>
              <input style={inputStyle} type="number" min="0" max="100" step="0.1" value={form.porcentaje_cam ?? 0} onChange={e => setForm(f => recalcCAM({ ...f, porcentaje_cam: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.locales.cuota_cam', { moneda })}</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.cuota_cam ?? ''} onChange={e => setForm(f => ({ ...f, cuota_cam: e.target.value ? Number(e.target.value) : undefined }))} placeholder={t('condominios.locales.cuota_cam_placeholder')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('condominios.comun.notes')}</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>{t('condominios.comun.cancel')}</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? t('condominios.comun.saving') : editId ? t('condominios.comun.update') : t('condominios.comun.add')}
            </button>
          </div>
        </div>
      )}

      {/* List — cond:B2: migrado a <DataTable> shared */}
      <DataTable<LocalComercial>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'numero_local', direction: 'asc' }}
        searchPlaceholder={t('condominios.locales.search_placeholder')}
        searchableKeys={['numero_local', l => l.inquilino_nombre ?? '', l => t(GIRO_LABEL_KEY[l.giro])]}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoLocal | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_LABEL_KEY) as EstadoLocal[]).map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '🏪', title: t('condominios.locales.empty') }}
        rowStyle={l => (l.fecha_fin && l.estado === 'ocupado' && new Date(l.fecha_fin) < today) ? { background: 'var(--at-warning-tint)' } : {}}
        columns={[
          {
            key: 'numero_local', header: t('condominios.locales.col_local'), sortable: true,
            render: l => (
              <div>
                <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-ink)' }}>{GIRO_ICON[l.giro]} {l.numero_local}</div>
                {l.piso && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{l.piso}</div>}
              </div>
            ),
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            accessor: l => t(ESTADO_LABEL_KEY[l.estado]),
            render: l => {
              const c = ESTADO_COLOR[l.estado]
              return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: c.bg, color: c.color }}>{t(ESTADO_LABEL_KEY[l.estado])}</span>
            },
          },
          {
            key: 'area', header: t('condominios.locales.col_area'), sortable: true, hideOnMobile: true,
            accessor: l => l.area_m2 ?? 0,
            render: l => l.area_m2 ? <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>📐 {l.area_m2} m²</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'inquilino', header: t('condominios.locales.col_inquilino'), sortable: true,
            accessor: l => l.inquilino_nombre ?? '',
            render: l => l.inquilino_nombre ? (
              <div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>👤 {l.inquilino_nombre}</div>
                {l.inquilino_telefono && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>📞 {l.inquilino_telefono}</div>}
              </div>
            ) : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'renta', header: t('condominios.locales.col_renta'), align: 'right', hideOnMobile: true,
            accessor: l => (l.renta_base ?? 0) + (l.cuota_cam ?? 0),
            render: l => (l.renta_base || l.cuota_cam) ? (
              <span style={{ fontWeight: 600, color: 'var(--at-ink)', fontSize: '12px' }}>
                {t('condominios.locales.renta_inline', { moneda, renta: (l.renta_base ?? 0).toFixed(0) })}
                {l.cuota_cam ? t('condominios.locales.cam_inline', { moneda, cam: l.cuota_cam.toFixed(0) }) : ''}
              </span>
            ) : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'vencimiento', header: t('condominios.locales.col_vencimiento'), sortable: true, hideOnMobile: true,
            accessor: l => l.fecha_fin ?? '',
            render: l => {
              if (!l.fecha_fin) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              const vence = new Date(l.fecha_fin) < today
              return <span style={{ fontSize: '12px', color: vence ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>📅 {l.fecha_fin}{vence ? ` ⚠️ ${t('condominios.locales.vencido')}` : ''}</span>
            },
          },
          {
            key: 'actions', header: '', align: 'right',
            render: l => canEdit ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={() => startEdit(l)} aria-label={t('condominios.comun.edit')} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(l.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<LocalComercial>[]}
      />
    </div>
  )
}
