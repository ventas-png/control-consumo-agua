import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { LlaveCondominio, EstadoLlave, TipoLlave, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  llaves: LlaveCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_COLOR: Record<EstadoLlave, { color: string; bg: string }> = {
  activa:    { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  devuelta:  { color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
  perdida:   { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  bloqueada: { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
}
const ESTADO_LABEL_KEY: Record<EstadoLlave, TranslationKey> = {
  activa:    'condominios.llaves.estado_activa',
  devuelta:  'condominios.llaves.estado_devuelta',
  perdida:   'condominios.llaves.estado_perdida',
  bloqueada: 'condominios.llaves.estado_bloqueada',
}

const TIPO_ICON: Record<TipoLlave, string> = {
  fisica: '🔑', tarjeta: '💳', codigo: '🔢', app: '📱',
}
const TIPO_LABEL_KEY: Record<TipoLlave, TranslationKey> = {
  fisica:  'condominios.llaves.tipo_fisica',
  tarjeta: 'condominios.llaves.tipo_tarjeta',
  codigo:  'condominios.llaves.tipo_codigo',
  app:     'condominios.llaves.tipo_app',
}

const blank = (): Partial<LlaveCondominio> => ({
  unidad_id: undefined, tipo: 'fisica', descripcion: '', codigo: '',
  cantidad: 1, fecha_entrega: '', fecha_devolucion: '',
  estado: 'activa', deposito_pagado: false, monto_deposito: undefined, notas: '',
})

export function LlavesTab({ llaves, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [filtroEstado, setFiltroEstado] = useState<EstadoLlave | 'todos'>('todos')
  const [form, setForm] = useState<Partial<LlaveCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = llaves.filter(l => filtroEstado === 'todos' || l.estado === filtroEstado)
  const activas   = llaves.filter(l => l.estado === 'activa').length
  const perdidas  = llaves.filter(l => l.estado === 'perdida').length
  const depositoTotal = llaves.filter(l => l.deposito_pagado && l.estado === 'activa').reduce((s, l) => s + (l.monto_deposito ?? 0), 0)

  function startEdit(l: LlaveCondominio) {
    setForm({
      unidad_id: l.unidad_id ?? undefined, tipo: l.tipo, descripcion: l.descripcion,
      codigo: l.codigo ?? '', cantidad: l.cantidad, fecha_entrega: l.fecha_entrega ?? '',
      fecha_devolucion: l.fecha_devolucion ?? '', estado: l.estado,
      deposito_pagado: l.deposito_pagado, monto_deposito: l.monto_deposito ?? undefined, notas: l.notas ?? '',
    })
    setEditId(l.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.descripcion?.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.llaves.err_descripcion') })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo ?? 'fisica', descripcion: form.descripcion!.trim(),
      codigo: form.codigo || null, cantidad: form.cantidad ?? 1,
      fecha_entrega: form.fecha_entrega || null, fecha_devolucion: form.fecha_devolucion || null,
      estado: form.estado ?? 'activa',
      deposito_pagado: form.deposito_pagado ?? false,
      monto_deposito: form.monto_deposito ?? null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('llaves_condominio', editId, payload)
      : await createCondominioRow('llaves_condominio', payload)
    if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.llaves.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('llaves_condominio', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoLlave) {
    const updates: Record<string, unknown> = { estado }
    if (estado === 'devuelta') updates.fecha_devolucion = new Date().toISOString().slice(0, 10)
    const { error } = await updateCondominioRow('llaves_condominio', id, updates)
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
          { label: t('condominios.llaves.kpi_total'),     value: String(llaves.length),     icon: '🔑', color: 'var(--at-primary)' },
          { label: t('condominios.llaves.kpi_activas'),   value: String(activas),           icon: '✅', color: 'var(--at-success)' },
          { label: t('condominios.llaves.kpi_perdidas'),  value: String(perdidas),          icon: '❌', color: 'var(--at-danger)' },
          { label: t('condominios.llaves.kpi_depositos'), value: depositoTotal > 0 ? `${moneda} ${depositoTotal.toFixed(0)}` : '—', icon: '💰', color: 'var(--at-accent)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.llaves.title')}</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{t('condominios.llaves.new_button')}</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? t('condominios.llaves.form_title_edit') : t('condominios.llaves.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>{t('condominios.comun.type')}</label>
              <select style={inputStyle} value={form.tipo ?? 'fisica'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoLlave }))}>
                {(Object.keys(TIPO_LABEL_KEY) as TipoLlave[]).map(k => <option key={k} value={k}>{TIPO_ICON[k]} {t(TIPO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.llaves.descripcion')}</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder={t('condominios.llaves.descripcion_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.unit')}</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">{t('condominios.llaves.sin_unidad')}</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.llaves.codigo')}</label>
              <input style={inputStyle} value={form.codigo ?? ''} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder={t('condominios.llaves.codigo_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.llaves.cantidad')}</label>
              <input style={inputStyle} type="number" min="1" value={form.cantidad ?? 1} onChange={e => setForm(f => ({ ...f, cantidad: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.estado ?? 'activa'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoLlave }))}>
                {(Object.keys(ESTADO_LABEL_KEY) as EstadoLlave[]).map(k => <option key={k} value={k}>{t(ESTADO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.llaves.fecha_entrega')}</label>
              <input style={inputStyle} type="date" value={form.fecha_entrega ?? ''} onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.llaves.fecha_devolucion')}</label>
              <input style={inputStyle} type="date" value={form.fecha_devolucion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_devolucion: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.llaves.deposito', { moneda })}</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_deposito ?? ''} onChange={e => setForm(f => ({ ...f, monto_deposito: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
              <input type="checkbox" id="dep_pagado" checked={form.deposito_pagado ?? false} onChange={e => setForm(f => ({ ...f, deposito_pagado: e.target.checked }))} />
              <label htmlFor="dep_pagado" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', cursor: 'pointer' }}>{t('condominios.llaves.deposito_pagado')}</label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('condominios.comun.notes')}</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>{t('condominios.comun.cancel')}</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? t('condominios.comun.saving') : editId ? t('condominios.comun.update') : t('condominios.comun.register')}
            </button>
          </div>
        </div>
      )}

      {/* List — cond:B2: migrado a <DataTable> shared */}
      <DataTable<LlaveCondominio>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'descripcion', direction: 'asc' }}
        searchPlaceholder={t('condominios.llaves.search_placeholder')}
        searchableKeys={['descripcion', l => l.codigo ?? '', l => l.unidad_nombre ?? '']}
        rowStyle={l => l.estado === 'perdida' ? { background: 'var(--at-danger-tint)' } : {}}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoLlave | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_LABEL_KEY) as EstadoLlave[]).map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '🔑', title: t('condominios.llaves.empty') }}
        columns={[
          {
            key: 'descripcion', header: t('condominios.llaves.col_llave'), sortable: true,
            render: l => (
              <div>
                <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--at-ink)' }}>{TIPO_ICON[l.tipo]} {l.descripcion}</div>
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{t(TIPO_LABEL_KEY[l.tipo])}{l.cantidad > 1 ? ` · ${t('condominios.llaves.copias', { count: l.cantidad })}` : ''}</div>
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
            key: 'unidad', header: t('condominios.llaves.col_unidad'), sortable: true, hideOnMobile: true,
            accessor: l => l.unidad_nombre ?? '',
            render: l => l.unidad_nombre ? <span style={{ fontSize: '12px', color: 'var(--at-primary)' }}>🏠 {l.unidad_nombre}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'codigo', header: t('condominios.llaves.col_codigo'), hideOnMobile: true,
            accessor: l => l.codigo ?? '',
            render: l => l.codigo ? <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>🔢 {l.codigo}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'entrega', header: t('condominios.llaves.col_entrega'), sortable: true, hideOnMobile: true,
            accessor: l => l.fecha_entrega ?? '',
            render: l => (
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                {l.fecha_entrega && <div>{t('condominios.llaves.entregada', { fecha: l.fecha_entrega })}</div>}
                {l.fecha_devolucion && <div>{t('condominios.llaves.devuelta_el', { fecha: l.fecha_devolucion })}</div>}
                {!l.fecha_entrega && !l.fecha_devolucion && '—'}
              </div>
            ),
          },
          {
            key: 'deposito', header: t('condominios.llaves.col_deposito'), align: 'right', hideOnMobile: true,
            accessor: l => l.monto_deposito ?? 0,
            render: l => l.monto_deposito ? (
              <span style={{ fontSize: '12px', fontWeight: 600, color: l.deposito_pagado ? 'var(--at-success)' : 'var(--at-warning)' }}>
                💰 {moneda} {l.monto_deposito.toFixed(0)} {l.deposito_pagado ? '✅' : `⚠️ ${t('condominios.llaves.deposito_pendiente')}`}
              </span>
            ) : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'actions', header: '', align: 'right',
            render: l => canEdit ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {l.estado === 'activa' && (
                  <button onClick={() => handleEstado(l.id, 'devuelta')} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>{t('condominios.llaves.devolver')}</button>
                )}
                {(l.estado === 'activa' || l.estado === 'bloqueada') && (
                  <button onClick={() => handleEstado(l.id, 'perdida')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>{t('condominios.llaves.reportar_perdida')}</button>
                )}
                <button onClick={() => startEdit(l)} aria-label={t('condominios.comun.edit')} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(l.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<LlaveCondominio>[]}
      />
    </div>
  )
}
