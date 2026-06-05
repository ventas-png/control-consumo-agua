import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { BodegaCondominio, EstadoBodega, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  bodegas: BodegaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_COLOR: Record<EstadoBodega, { color: string; bg: string }> = {
  disponible: { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  asignada:   { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  bloqueada:  { color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}
const ESTADO_LABEL_KEY: Record<EstadoBodega, TranslationKey> = {
  disponible: 'condominios.bodegas.estado_disponible',
  asignada:   'condominios.bodegas.estado_asignada',
  bloqueada:  'condominios.bodegas.estado_bloqueada',
}

const blank = (): Partial<BodegaCondominio> => ({
  numero: '', piso: '', area_m2: undefined, unidad_id: undefined,
  estado: 'disponible', monto_renta: undefined, fecha_asignacion: '', notas: '',
})

export function BodegasTab({ bodegas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [filtroEstado, setFiltroEstado] = useState<EstadoBodega | 'todos'>('todos')
  const [form, setForm] = useState<Partial<BodegaCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = bodegas.filter(b => filtroEstado === 'todos' || b.estado === filtroEstado)
  const disponibles = bodegas.filter(b => b.estado === 'disponible').length
  const rentaTotal = bodegas.filter(b => b.estado === 'asignada' && b.monto_renta).reduce((s, b) => s + (b.monto_renta ?? 0), 0)

  function startEdit(b: BodegaCondominio) {
    setForm({
      numero: b.numero, piso: b.piso ?? '', area_m2: b.area_m2 ?? undefined,
      unidad_id: b.unidad_id ?? undefined, estado: b.estado,
      monto_renta: b.monto_renta ?? undefined, fecha_asignacion: b.fecha_asignacion ?? '', notas: b.notas ?? '',
    })
    setEditId(b.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.numero?.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.bodegas.err_numero') })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      numero: form.numero!.trim(), piso: form.piso || null,
      area_m2: form.area_m2 ?? null,
      unidad_id: form.unidad_id || null,
      estado: form.estado ?? 'disponible',
      monto_renta: form.monto_renta ?? null,
      fecha_asignacion: form.fecha_asignacion || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('bodegas_condominio').update(payload).eq('id', editId)
      : await supabase.from('bodegas_condominio').insert(payload)
    if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.bodegas.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('bodegas_condominio').delete().eq('id', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoBodega) {
    const updates: Partial<BodegaCondominio> = { estado }
    if (estado === 'disponible') { updates.unidad_id = null; updates.fecha_asignacion = null }
    if (estado === 'asignada') updates.fecha_asignacion = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('bodegas_condominio').update(updates).eq('id', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: t('condominios.bodegas.kpi_total'), value: String(bodegas.length), icon: '🗄️', color: 'var(--at-primary)' },
          { label: t('condominios.bodegas.kpi_disponibles'), value: String(disponibles), icon: '✅', color: 'var(--at-success)' },
          { label: t('condominios.bodegas.kpi_asignadas'), value: String(bodegas.filter(b => b.estado === 'asignada').length), icon: '🔑', color: 'var(--at-accent)' },
          { label: t('condominios.bodegas.kpi_renta'), value: rentaTotal > 0 ? `${moneda} ${rentaTotal.toFixed(0)}` : '—', icon: '💰', color: 'var(--at-warning)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.bodegas.title')}</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{t('condominios.bodegas.new_button')}</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? t('condominios.bodegas.form_title_edit') : t('condominios.bodegas.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>{t('condominios.bodegas.numero')}</label>
              <input style={inputStyle} value={form.numero ?? ''} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder={t('condominios.bodegas.numero_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.bodegas.piso')}</label>
              <input style={inputStyle} value={form.piso ?? ''} onChange={e => setForm(f => ({ ...f, piso: e.target.value }))} placeholder={t('condominios.bodegas.piso_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.bodegas.area')}</label>
              <input style={inputStyle} type="number" min="0" step="0.1" value={form.area_m2 ?? ''} onChange={e => setForm(f => ({ ...f, area_m2: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoBodega }))}>
                {(Object.keys(ESTADO_LABEL_KEY) as EstadoBodega[]).map(k => <option key={k} value={k}>{t(ESTADO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.bodegas.unidad_asignada')}</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">{t('condominios.comun.no_assignment')}</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.bodegas.renta_mensual', { moneda })}</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_renta ?? ''} onChange={e => setForm(f => ({ ...f, monto_renta: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.bodegas.fecha_asignacion')}</label>
              <input style={inputStyle} type="date" value={form.fecha_asignacion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_asignacion: e.target.value }))} />
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
      <DataTable<BodegaCondominio>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'numero', direction: 'asc' }}
        searchPlaceholder={t('condominios.bodegas.search_placeholder')}
        searchableKeys={['numero', b => b.piso ?? '', b => b.unidad_nombre ?? '']}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoBodega | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_LABEL_KEY) as EstadoBodega[]).map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '🗄️', title: t('condominios.bodegas.empty') }}
        columns={[
          {
            key: 'numero', header: t('condominios.bodegas.col_bodega'), sortable: true,
            render: b => (
              <div>
                <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--at-ink)' }}>🗄️ {b.numero}</div>
                {b.piso && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{b.piso}</div>}
              </div>
            ),
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            accessor: b => t(ESTADO_LABEL_KEY[b.estado]),
            render: b => {
              const c = ESTADO_COLOR[b.estado]
              return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: c.bg, color: c.color }}>{t(ESTADO_LABEL_KEY[b.estado])}</span>
            },
          },
          {
            key: 'area', header: t('condominios.bodegas.col_area'), sortable: true, hideOnMobile: true,
            accessor: b => b.area_m2 ?? 0,
            render: b => b.area_m2 ? <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>📐 {b.area_m2} m²</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'unidad', header: t('condominios.bodegas.col_unidad'), sortable: true, hideOnMobile: true,
            accessor: b => b.unidad_nombre ?? '',
            render: b => b.unidad_nombre ? <span style={{ fontSize: '12px', color: 'var(--at-primary)' }}>🏠 {b.unidad_nombre}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'renta', header: t('condominios.bodegas.col_renta'), sortable: true, align: 'right', hideOnMobile: true,
            accessor: b => b.monto_renta ?? 0,
            render: b => b.monto_renta ? <span style={{ fontWeight: 600, color: 'var(--at-ink)', fontSize: '12px' }}>{t('condominios.bodegas.renta_mes', { moneda, monto: b.monto_renta })}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'asignacion', header: t('condominios.bodegas.col_asignacion'), hideOnMobile: true,
            accessor: b => b.fecha_asignacion ?? '',
            render: b => b.fecha_asignacion ? <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>📅 {b.fecha_asignacion}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'actions', header: '', align: 'right',
            render: b => canEdit ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {b.estado === 'disponible' && (
                  <button onClick={() => handleEstado(b.id, 'asignada')} style={{ padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.bodegas.asignar')}
                  </button>
                )}
                {b.estado === 'asignada' && (
                  <button onClick={() => handleEstado(b.id, 'disponible')} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.bodegas.liberar')}
                  </button>
                )}
                <button onClick={() => startEdit(b)} aria-label={t('condominios.comun.edit')} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(b.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<BodegaCondominio>[]}
      />
    </div>
  )
}
