import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ItemInventario, CategoriaInventario, EstadoInventario } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  inventario: ItemInventario[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIA_ICON: Record<CategoriaInventario, string> = {
  herramienta: '🔨', equipo: '⚙️', material: '📦', mobiliario: '🪑', vehiculo: '🚗', otro: '📋',
}
const CATEGORIA_LABEL_KEY: Record<CategoriaInventario, TranslationKey> = {
  herramienta: 'condominios.inventario.cat_herramienta',
  equipo:      'condominios.inventario.cat_equipo',
  material:    'condominios.inventario.cat_material',
  mobiliario:  'condominios.inventario.cat_mobiliario',
  vehiculo:    'condominios.inventario.cat_vehiculo',
  otro:        'condominios.inventario.cat_otro',
}
const CATEGORIAS = Object.keys(CATEGORIA_ICON) as CategoriaInventario[]

const ESTADO_COLOR: Record<EstadoInventario, { color: string; bg: string }> = {
  disponible:    { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  en_uso:        { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  en_reparacion: { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  dado_de_baja:  { color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}
const ESTADO_LABEL_KEY: Record<EstadoInventario, TranslationKey> = {
  disponible:    'condominios.inventario.estado_disponible',
  en_uso:        'condominios.inventario.estado_en_uso',
  en_reparacion: 'condominios.inventario.estado_en_reparacion',
  dado_de_baja:  'condominios.inventario.estado_dado_de_baja',
}

const blank = (): Partial<ItemInventario> => ({
  nombre: '', categoria: 'herramienta', descripcion: '', numero_serie: '',
  ubicacion: '', estado: 'disponible', cantidad: 1, cantidad_minima: 0,
  unidad_medida: 'unidad', costo_unitario: undefined,
  proveedor: '', fecha_adquisicion: '', fecha_vencimiento: '', notas: '',
})

export function InventarioTab({ inventario, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaInventario | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoInventario | 'todos'>('todos')
  const [form, setForm] = useState<Partial<ItemInventario>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const stockBajo = inventario.filter(i => i.cantidad <= i.cantidad_minima && i.estado !== 'dado_de_baja')
  const porVencer = inventario.filter(i => i.fecha_vencimiento && i.fecha_vencimiento >= hoy &&
    new Date(i.fecha_vencimiento).getTime() - Date.now() < 30 * 24 * 3600 * 1000 && i.estado !== 'dado_de_baja')

  const filtered = inventario.filter(i => {
    if (filtroCategoria !== 'todos' && i.categoria !== filtroCategoria) return false
    if (filtroEstado !== 'todos' && i.estado !== filtroEstado) return false
    return true
  })

  const valorTotal = filtered
    .filter(i => i.estado !== 'dado_de_baja')
    .reduce((s, i) => s + (i.costo_unitario ?? 0) * i.cantidad, 0)

  function startEdit(i: ItemInventario) {
    setForm({
      nombre: i.nombre, categoria: i.categoria, descripcion: i.descripcion ?? '',
      numero_serie: i.numero_serie ?? '', ubicacion: i.ubicacion ?? '',
      estado: i.estado, cantidad: i.cantidad, cantidad_minima: i.cantidad_minima,
      unidad_medida: i.unidad_medida, costo_unitario: i.costo_unitario ?? undefined,
      proveedor: i.proveedor ?? '', fecha_adquisicion: i.fecha_adquisicion ?? '',
      fecha_vencimiento: i.fecha_vencimiento ?? '', notas: i.notas ?? '',
    })
    setEditId(i.id)
    setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.nombre?.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.inventario.err_nombre') })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre!.trim(), categoria: form.categoria ?? 'herramienta',
      descripcion: form.descripcion || null, numero_serie: form.numero_serie || null,
      ubicacion: form.ubicacion || null, estado: form.estado ?? 'disponible',
      cantidad: form.cantidad ?? 1, cantidad_minima: form.cantidad_minima ?? 0,
      unidad_medida: form.unidad_medida ?? 'unidad',
      costo_unitario: form.costo_unitario ?? null,
      proveedor: form.proveedor || null,
      fecha_adquisicion: form.fecha_adquisicion || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('inventario_condominio', editId, payload)
      : await createCondominioRow('inventario_condominio', payload)
    if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: t('condominios.inventario.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('inventario_condominio', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoInventario) {
    const { error } = await updateCondominioRow('inventario_condominio', id, { estado })
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Alertas */}
      {stockBajo.length > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger)', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13px', color: 'var(--at-danger-strong)', fontWeight: 600 }}>
            {t('condominios.inventario.alerta_stock', { count: stockBajo.length })}
          </span>
        </div>
      )}
      {porVencer.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>📅</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {t('condominios.inventario.alerta_vencer', { count: porVencer.length })}
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.inventario.title')}</h2>
          {valorTotal > 0 && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{t('condominios.inventario.valor_activo')} <strong style={{ color: 'var(--at-primary)' }}>{moneda} {valorTotal.toFixed(2)}</strong></span>}
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.inventario.new_button')}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>{editId ? t('condominios.inventario.form_title_edit') : t('condominios.inventario.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.nombre')}</label>
              <input style={inputStyle} value={form.nombre ?? ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder={t('condominios.inventario.nombre_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.categoria')}</label>
              <select style={inputStyle} value={form.categoria ?? 'herramienta'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaInventario }))}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{CATEGORIA_ICON[c]} {t(CATEGORIA_LABEL_KEY[c])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoInventario }))}>
                {(Object.keys(ESTADO_LABEL_KEY) as EstadoInventario[]).map(k => <option key={k} value={k}>{t(ESTADO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.cantidad')}</label>
              <input style={inputStyle} type="number" min="0" value={form.cantidad ?? 1} onChange={e => setForm(f => ({ ...f, cantidad: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.stock_minimo')}</label>
              <input style={inputStyle} type="number" min="0" value={form.cantidad_minima ?? 0} onChange={e => setForm(f => ({ ...f, cantidad_minima: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.unidad_medida')}</label>
              <select style={inputStyle} value={form.unidad_medida ?? 'unidad'} onChange={e => setForm(f => ({ ...f, unidad_medida: e.target.value }))}>
                {['unidad', 'kg', 'litro', 'metro', 'caja'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.costo_unitario', { moneda })}</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.costo_unitario ?? ''} onChange={e => setForm(f => ({ ...f, costo_unitario: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.ubicacion')}</label>
              <input style={inputStyle} value={form.ubicacion ?? ''} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder={t('condominios.inventario.ubicacion_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.numero_serie')}</label>
              <input style={inputStyle} value={form.numero_serie ?? ''} onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.proveedor')}</label>
              <input style={inputStyle} value={form.proveedor ?? ''} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.fecha_adquisicion')}</label>
              <input style={inputStyle} type="date" value={form.fecha_adquisicion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_adquisicion: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.inventario.fecha_vencimiento')}</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento ?? ''} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('condominios.inventario.descripcion')}</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '56px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
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
      <DataTable<ItemInventario>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'nombre', direction: 'asc' }}
        searchPlaceholder={t('condominios.inventario.search_placeholder')}
        searchableKeys={['nombre', i => i.ubicacion ?? '', i => i.numero_serie ?? '']}
        rowStyle={i => (i.cantidad <= i.cantidad_minima && i.estado !== 'dado_de_baja') ? { background: 'var(--at-danger-tint)' } : {}}
        filters={[
          {
            key: 'categoria',
            label: t('condominios.inventario.categoria'),
            value: filtroCategoria,
            onChange: v => setFiltroCategoria(v as CategoriaInventario | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.inventario.all_categorias') },
              ...CATEGORIAS.map(c => ({ value: c, label: `${CATEGORIA_ICON[c]} ${t(CATEGORIA_LABEL_KEY[c])}` })),
            ],
          },
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoInventario | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_LABEL_KEY) as EstadoInventario[]).map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '📦', title: t('condominios.inventario.empty') }}
        columns={[
          {
            key: 'nombre', header: t('condominios.inventario.col_item'), sortable: true,
            render: i => {
              const venceProx = i.fecha_vencimiento && i.fecha_vencimiento >= hoy &&
                new Date(i.fecha_vencimiento).getTime() - Date.now() < 30 * 24 * 3600 * 1000
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '16px' }}>{CATEGORIA_ICON[i.categoria]}</span>
                    <span style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>{i.nombre}</span>
                  </div>
                  {i.ubicacion && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>📍 {i.ubicacion}</div>}
                  {venceProx && <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>{t('condominios.inventario.vence_label', { fecha: i.fecha_vencimiento ?? '' })}</div>}
                </div>
              )
            },
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            accessor: i => t(ESTADO_LABEL_KEY[i.estado]),
            render: i => {
              const c = ESTADO_COLOR[i.estado]
              return <span style={{ padding: '3px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{t(ESTADO_LABEL_KEY[i.estado])}</span>
            },
          },
          {
            key: 'cantidad', header: t('condominios.inventario.col_cantidad'), sortable: true, align: 'right',
            accessor: i => i.cantidad,
            render: i => {
              const stockAlerta = i.cantidad <= i.cantidad_minima && i.estado !== 'dado_de_baja'
              return (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: stockAlerta ? 'var(--at-danger)' : 'var(--at-ink)', fontWeight: 700 }}>{i.cantidad}</span>
                  <span style={{ color: 'var(--at-ink-3)', fontSize: '11px' }}> {i.unidad_medida}</span>
                  {stockAlerta && <div style={{ fontSize: '10px', color: 'var(--at-danger)', fontWeight: 600 }}>{t('condominios.inventario.stock_bajo', { min: i.cantidad_minima })}</div>}
                </div>
              )
            },
          },
          {
            key: 'costo', header: t('condominios.inventario.col_costo'), sortable: true, align: 'right', hideOnMobile: true,
            accessor: i => i.costo_unitario ?? 0,
            render: i => i.costo_unitario != null ? <span style={{ color: 'var(--at-ink-2)', fontSize: '12px' }}>{moneda} {i.costo_unitario.toFixed(2)}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'actions', header: '', align: 'right',
            render: i => canEdit ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {i.estado === 'disponible' && (
                  <button onClick={() => handleEstado(i.id, 'en_uso')} style={{ padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.inventario.accion_en_uso')}
                  </button>
                )}
                {i.estado === 'en_uso' && (
                  <button onClick={() => handleEstado(i.id, 'disponible')} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.inventario.accion_disponible')}
                  </button>
                )}
                <button onClick={() => startEdit(i)} aria-label={t('condominios.comun.edit')} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(i.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<ItemInventario>[]}
      />
    </div>
  )
}
