import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { VehiculoResidente } from '../../../types'
import type { Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  vehiculos: VehiculoResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABEL_KEY: Record<string, TranslationKey> = {
  auto: 'condominios.vehiculos.tipo_auto',
  moto: 'condominios.vehiculos.tipo_moto',
  camion: 'condominios.vehiculos.tipo_camion',
  otro: 'condominios.vehiculos.tipo_otro',
}
const TIPO_PLURAL_KEY: Record<string, TranslationKey> = {
  auto: 'condominios.vehiculos.tipo_auto_plural',
  moto: 'condominios.vehiculos.tipo_moto_plural',
  camion: 'condominios.vehiculos.tipo_camion_plural',
  otro: 'condominios.vehiculos.tipo_otro_plural',
}
const TIPO_COLOR: Record<string, { bg: string; color: string }> = {
  auto:   { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  moto:   { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  camion: { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
  otro:   { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

const BLANK = { unidad_id: '', placa: '', marca: '', modelo: '', color: '', anio: '', tipo: 'auto', activo: true, notas: '' }

export function VehiculosTab({ vehiculos, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [soloActivos, setSoloActivos] = useState(true)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(v: VehiculoResidente) {
    setEditId(v.id)
    setForm({ unidad_id: v.unidad_id, placa: v.placa, marca: v.marca ?? '', modelo: v.modelo ?? '', color: v.color ?? '', anio: v.anio ? String(v.anio) : '', tipo: v.tipo, activo: v.activo, notas: v.notas ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.placa.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.vehiculos.err_placa') })
    if (!form.unidad_id) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.vehiculos.err_unit') })
    setSaving(true)
    const payload = {
      unidad_id: form.unidad_id, placa: form.placa.trim().toUpperCase(),
      marca: form.marca || null, modelo: form.modelo || null, color: form.color || null,
      anio: form.anio ? parseInt(form.anio) : null, tipo: form.tipo,
      activo: form.activo, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('vehiculos_residentes', editId, payload))
    } else {
      ({ error } = await createCondominioRow('vehiculos_residentes', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.vehiculos.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    await deleteCondominioRow('vehiculos_residentes', id)
    onRefresh()
  }

  async function toggleActivo(v: VehiculoResidente) {
    await updateCondominioRow('vehiculos_residentes', v.id, { activo: !v.activo })
    onRefresh()
  }

  let filtered = vehiculos
  if (filtroUnidad) filtered = filtered.filter(v => v.unidad_id === filtroUnidad)
  if (filtroTipo !== 'todos') filtered = filtered.filter(v => v.tipo === filtroTipo)
  if (soloActivos) filtered = filtered.filter(v => v.activo)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  const totalActivos = vehiculos.filter(v => v.activo).length

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.vehiculos.title')}</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{t('condominios.vehiculos.subtitle', { count: totalActivos })}</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.vehiculos.new_button')}
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.keys(TIPO_LABEL_KEY).map(tipo => {
          const count = vehiculos.filter(v => v.tipo === tipo && v.activo).length
          const style = TIPO_COLOR[tipo]
          return (
            <div key={tipo} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color: style.color }}>{count}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{t(TIPO_PLURAL_KEY[tipo])}</div>
            </div>
          )
        })}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? t('condominios.vehiculos.form_title_edit') : t('condominios.vehiculos.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.comun.unit_required')}</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">{t('condominios.comun.select_dash')}</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.vehiculos.placa')}</label>
              <input style={inputStyle} value={form.placa} onChange={e => setF('placa', e.target.value)} placeholder={t('condominios.vehiculos.placa_placeholder')} autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.comun.type')}</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.keys(TIPO_LABEL_KEY).map(v => <option key={v} value={v}>{t(TIPO_LABEL_KEY[v])}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.vehiculos.marca')}</label>
              <input style={inputStyle} value={form.marca} onChange={e => setF('marca', e.target.value)} placeholder={t('condominios.vehiculos.marca_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.vehiculos.modelo')}</label>
              <input style={inputStyle} value={form.modelo} onChange={e => setF('modelo', e.target.value)} placeholder={t('condominios.vehiculos.modelo_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.vehiculos.color')}</label>
              <input style={inputStyle} value={form.color} onChange={e => setF('color', e.target.value)} placeholder={t('condominios.vehiculos.color_placeholder')} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.vehiculos.anio')}</label>
              <input style={inputStyle} type="number" value={form.anio} onChange={e => setF('anio', e.target.value)} placeholder={t('condominios.vehiculos.anio_placeholder')} min="1990" max="2030" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.activo ? 'true' : 'false'} onChange={e => setF('activo', e.target.value === 'true')}>
                <option value="true">{t('condominios.comun.active')}</option>
                <option value="false">{t('condominios.comun.inactive')}</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>{t('condominios.comun.notes')}</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder={t('condominios.vehiculos.notas_placeholder')} />
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
      <DataTable<VehiculoResidente>
        data={filtered}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'placa', direction: 'asc' }}
        searchPlaceholder={t('condominios.vehiculos.search_placeholder')}
        searchableKeys={['placa', v => v.marca ?? '', v => v.modelo ?? '']}
        rowStyle={v => v.activo ? {} : { opacity: 0.6 }}
        filters={[
          {
            key: 'unidad',
            label: t('condominios.comun.unit'),
            value: filtroUnidad,
            onChange: setFiltroUnidad,
            options: [{ value: '', label: t('condominios.comun.all_units') }, ...unidades.map(u => ({ value: u.id, label: u.nombre }))],
          },
          {
            key: 'tipo',
            label: t('condominios.comun.type'),
            value: filtroTipo,
            onChange: setFiltroTipo,
            options: [{ value: 'todos', label: t('condominios.comun.all_types') }, ...Object.keys(TIPO_LABEL_KEY).map(v => ({ value: v, label: t(TIPO_LABEL_KEY[v]) }))],
          },
          {
            key: 'activos',
            label: t('condominios.comun.status'),
            value: soloActivos ? 'activos' : 'todos',
            onChange: v => setSoloActivos(v === 'activos'),
            options: [{ value: 'activos', label: t('condominios.vehiculos.solo_activos') }, { value: 'todos', label: t('condominios.vehiculos.todos') }],
          },
        ]}
        emptyState={{ icon: '📋', title: t('condominios.vehiculos.empty') }}
        columns={[
          {
            key: 'placa', header: t('condominios.vehiculos.placa_header'), sortable: true,
            render: v => (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '1px', color: 'var(--at-ink)' }}>{v.placa}</span>
                {!v.activo && <span style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', borderRadius: '20px' }}>{t('condominios.comun.inactive')}</span>}
              </div>
            ),
          },
          {
            key: 'tipo', header: t('condominios.comun.type'), sortable: true,
            accessor: v => t(TIPO_LABEL_KEY[v.tipo] ?? 'condominios.vehiculos.tipo_otro'),
            render: v => {
              const tc = TIPO_COLOR[v.tipo] ?? TIPO_COLOR.otro
              return <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: tc.bg, color: tc.color }}>{t(TIPO_LABEL_KEY[v.tipo] ?? 'condominios.vehiculos.tipo_otro')}</span>
            },
          },
          {
            key: 'vehiculo', header: t('condominios.vehiculos.vehiculo_header'), hideOnMobile: true,
            accessor: v => [v.marca, v.modelo].filter(Boolean).join(' '),
            render: v => (
              <div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{[v.anio, v.marca, v.modelo].filter(Boolean).join(' · ') || '—'}</div>
                {v.color && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{t('condominios.vehiculos.color_inline', { color: v.color })}</div>}
                {v.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontStyle: 'italic' }}>{v.notas}</div>}
              </div>
            ),
          },
          {
            key: 'unidad', header: t('condominios.comun.unit'), sortable: true,
            accessor: v => unidades.find(u => u.id === v.unidad_id)?.nombre ?? '',
            render: v => {
              const unidad = unidades.find(u => u.id === v.unidad_id)
              return unidad ? <span style={{ fontSize: '12px', color: 'var(--at-primary)' }}>🏠 {unidad.nombre}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>
            },
          },
          {
            key: 'actions', header: '', align: 'right',
            render: v => canEdit ? (
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                <button onClick={() => toggleActivo(v)}
                  style={{ padding: '3px 7px', background: v.activo ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', color: v.activo ? 'var(--at-danger)' : 'var(--at-success)' }}>
                  {v.activo ? t('condominios.vehiculos.desactivar') : t('condominios.vehiculos.activar')}
                </button>
                <button onClick={() => startEdit(v)} aria-label={t('condominios.comun.edit')}
                  style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(v.id)} aria-label={t('condominios.comun.delete')}
                  style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<VehiculoResidente>[]}
      />
    </div>
  )
}
