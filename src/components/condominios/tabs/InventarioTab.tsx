import { hoyLocalISO, diasHastaFechaCalendario } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { AreaCondominio, ItemInventario, CategoriaInventario, EstadoInventario, PrestamoEquipo } from '../../../types'
import { areaUnicaPorNombre, nombreAreaDe, vinculoArea } from '../../../domain/condominios/areas'
import { enCirculacion } from '../../../lib/prestamosEquipo'
import { notify, confirm } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'
import { ImportInventarioModal } from '../ImportInventarioModal'

interface Props {
  inventario: ItemInventario[]
  /** Préstamos del proyecto: lo que está en circulación se muestra junto a cada equipo (20261108000000). */
  prestamos?: PrestamoEquipo[]
  /** Catálogo compartido: la ubicación del item se ELIGE de aquí (tab Áreas), no se escribe. */
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.inventario.delete): editar no basta. */
  canDelete: boolean
  /** Visibilidad del tab Áreas: decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas: boolean
  onIrATab: (tabId: 'areas_config') => void
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
  area_id: '', ubicacion: '', estado: 'disponible', cantidad: 1, cantidad_minima: 0,
  unidad_medida: 'unidad', costo_unitario: undefined,
  prestable_con_costo: false, costo_renta_unidad: undefined,
  proveedor: '', fecha_adquisicion: '', fecha_vencimiento: '', notas: '',
})

export function InventarioTab({ inventario, prestamos = [], areas, proyectoId, companyId, moneda, canCreate, canEdit, canDelete, puedeConfigurarAreas, onIrATab, onRefresh }: Props) {
  const { t } = useTranslation()
  const hoy = hoyLocalISO()
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaInventario | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoInventario | 'todos'>('todos')
  const [form, setForm] = useState<Partial<ItemInventario>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  const stockBajo = inventario.filter(i => i.cantidad <= i.cantidad_minima && i.estado !== 'dado_de_baja')
  const porVencer = inventario.filter(i => i.fecha_vencimiento && i.fecha_vencimiento >= hoy &&
    (diasHastaFechaCalendario(i.fecha_vencimiento) ?? Infinity) < 30 && i.estado !== 'dado_de_baja')

  const filtered = inventario.filter(i => {
    if (filtroCategoria !== 'todos' && i.categoria !== filtroCategoria) return false
    if (filtroEstado !== 'todos' && i.estado !== filtroEstado) return false
    return true
  })

  const valorTotal = filtered
    .filter(i => i.estado !== 'dado_de_baja')
    .reduce((s, i) => s + (i.costo_unitario ?? 0) * i.cantidad, 0)

  // La ubicación es un área del catálogo (tab Áreas). Solo las activas se
  // ofrecen al capturar; las inactivas siguen nombrando lo ya registrado.
  const areasActivas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const ubicacionDe = (i: ItemInventario) => nombreAreaDe(i.area_id, areas, i.ubicacion ?? '')

  // Texto libre de un item anterior al catálogo que nadie ha vinculado: se
  // conserva mientras no se elija un área.
  const editando = editId ? inventario.find(i => i.id === editId) : undefined
  const ubicacionLegada = editando && !editando.area_id ? (editando.ubicacion ?? '').trim() : ''
  // El área guardada puede estar inactiva: se sigue ofreciendo para no perderla.
  const areaFueraDeLista = form.area_id && !areasActivas.some(a => a.id === form.area_id) ? form.area_id : null

  function startEdit(i: ItemInventario) {
    setForm({
      nombre: i.nombre, categoria: i.categoria, descripcion: i.descripcion ?? '',
      numero_serie: i.numero_serie ?? '', ubicacion: i.ubicacion ?? '',
      // Lo legado se propone vinculado si su texto coincide con UNA sola área.
      area_id: i.area_id ?? areaUnicaPorNombre(i.ubicacion, areasActivas)?.id ?? '',
      estado: i.estado, cantidad: i.cantidad, cantidad_minima: i.cantidad_minima,
      unidad_medida: i.unidad_medida, costo_unitario: i.costo_unitario ?? undefined,
      prestable_con_costo: i.prestable_con_costo ?? false, costo_renta_unidad: i.costo_renta_unidad ?? undefined,
      proveedor: i.proveedor ?? '', fecha_adquisicion: i.fecha_adquisicion ?? '',
      fecha_vencimiento: i.fecha_vencimiento ?? '', notas: i.notas ?? '',
    })
    setEditId(i.id)
    setShowForm(true)
  }

  function abrirNuevo() {
    // Una edición cancelada no se cuela en el item nuevo.
    if (editId) { setEditId(null); setForm(blank()) }
    setShowForm(true)
  }

  // Cancelar cierra sin borrar lo escrito; no se cierra a mitad del guardado.
  function cerrarForm() { if (!saving) setShowForm(false) }

  async function handleSave() {
    if (saving) return
    if (!form.nombre?.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.inventario.err_nombre') })
    // El toggle «se presta a un costo» exige la renta por unidad (la base también lo impone).
    const rentaUnidad = form.costo_renta_unidad != null && Number(form.costo_renta_unidad) > 0 ? Number(form.costo_renta_unidad) : null
    if (form.prestable_con_costo && rentaUnidad == null) {
      return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.inventario.err_renta') })
    }
    setSaving(true)
    // `ubicacion` es el snapshot del nombre del área al guardar.
    const area = vinculoArea(form.area_id, areas, editando && { area_id: editando.area_id, texto: editando.ubicacion })
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre!.trim(), categoria: form.categoria ?? 'herramienta',
      descripcion: form.descripcion || null, numero_serie: form.numero_serie || null,
      area_id: area.area_id, ubicacion: area.nombre,
      estado: form.estado ?? 'disponible',
      cantidad: form.cantidad ?? 1, cantidad_minima: form.cantidad_minima ?? 0,
      unidad_medida: form.unidad_medida ?? 'unidad',
      costo_unitario: form.costo_unitario ?? null,
      // Apagado, la renta no se guarda: lo que se cobra es lo que el toggle dice.
      prestable_con_costo: !!form.prestable_con_costo,
      costo_renta_unidad: form.prestable_con_costo ? rentaUnidad : null,
      proveedor: form.proveedor || null,
      fecha_adquisicion: form.fecha_adquisicion || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('inventario_condominio', editId, payload)
      : await createCondominioRow('inventario_condominio', payload)
    if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    setSaving(false); setShowForm(false); setEditId(null); setForm(blank()); onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
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
        {canCreate && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowImportModal(true)} style={{ padding: '8px 14px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {t('condominios.inventario.import_button')}
            </button>
            <button onClick={abrirNuevo} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {t('condominios.inventario.new_button')}
            </button>
          </div>
        )}
      </div>

      {/* Nuevo / editar en ventana: antes se desplegaba encima de la lista y
          había que hacer scroll para ver la tabla o el formulario. */}
      {showForm && (
        <EditModal
          title={editId ? t('condominios.inventario.form_title_edit') : t('condominios.inventario.form_title_new')}
          maxWidth="760px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>{t('condominios.comun.cancel')}</Button>
            <Button type="submit" form="inventario-form" loading={saving} loadingText={t('condominios.comun.saving')}>
              {editId ? t('condominios.comun.update') : t('condominios.comun.add')}
            </Button>
          </>}
        >
          <form id="inventario-form" onSubmit={e => { e.preventDefault(); void handleSave() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: '12px', alignItems: 'start' }}>
            <div>
              <label htmlFor="inv-nombre" style={labelStyle}>{t('condominios.inventario.nombre')}</label>
              <input id="inv-nombre" style={inputStyle} value={form.nombre ?? ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder={t('condominios.inventario.nombre_placeholder')} autoFocus />
            </div>
            <div>
              <label htmlFor="inv-categoria" style={labelStyle}>{t('condominios.inventario.categoria')}</label>
              <select id="inv-categoria" style={inputStyle} value={form.categoria ?? 'herramienta'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaInventario }))}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{CATEGORIA_ICON[c]} {t(CATEGORIA_LABEL_KEY[c])}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inv-estado" style={labelStyle}>{t('condominios.comun.status')}</label>
              <select id="inv-estado" style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoInventario }))}>
                {(Object.keys(ESTADO_LABEL_KEY) as EstadoInventario[]).map(k => <option key={k} value={k}>{t(ESTADO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inv-cantidad" style={labelStyle}>{t('condominios.inventario.cantidad')}</label>
              <input id="inv-cantidad" style={inputStyle} type="number" inputMode="numeric" min="0" value={form.cantidad ?? 1} onChange={e => setForm(f => ({ ...f, cantidad: Number(e.target.value) }))} />
            </div>
            <div>
              <label htmlFor="inv-stock-minimo" style={labelStyle}>{t('condominios.inventario.stock_minimo')}</label>
              <input id="inv-stock-minimo" style={inputStyle} type="number" inputMode="numeric" min="0" value={form.cantidad_minima ?? 0} onChange={e => setForm(f => ({ ...f, cantidad_minima: Number(e.target.value) }))} />
            </div>
            <div>
              <label htmlFor="inv-unidad" style={labelStyle}>{t('condominios.inventario.unidad_medida')}</label>
              <select id="inv-unidad" style={inputStyle} value={form.unidad_medida ?? 'unidad'} onChange={e => setForm(f => ({ ...f, unidad_medida: e.target.value }))}>
                {['unidad', 'kg', 'litro', 'metro', 'caja'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inv-costo" style={labelStyle}>{t('condominios.inventario.costo_unitario', { moneda })}</label>
              <input id="inv-costo" style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" value={form.costo_unitario ?? ''} onChange={e => setForm(f => ({ ...f, costo_unitario: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            {/* Se presta a un costo (20261118000000): el toggle encendido pide la renta
                por unidad; esa renta se suma a la reserva por cada unidad que el
                residente pida que se le tenga lista. */}
            <div style={{ gridColumn: '1 / -1', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <label htmlFor="inv-prestable" style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>
                  <input id="inv-prestable" type="checkbox" role="switch" aria-checked={!!form.prestable_con_costo} checked={!!form.prestable_con_costo}
                    onChange={e => setForm(f => ({ ...f, prestable_con_costo: e.target.checked, costo_renta_unidad: e.target.checked ? f.costo_renta_unidad : undefined }))}
                    style={{ width: 18, height: 18, accentColor: 'var(--at-primary)' }} />
                  💲 {t('condominios.inventario.prestable_con_costo')}
                </label>
                {form.prestable_con_costo && (
                  <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label htmlFor="inv-renta" style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>{t('condominios.inventario.renta_unidad', { moneda })}</label>
                    <input id="inv-renta" style={{ ...inputStyle, maxWidth: 180 }} type="number" inputMode="decimal" min="0" step="0.01" autoFocus
                      value={form.costo_renta_unidad ?? ''} onChange={e => setForm(f => ({ ...f, costo_renta_unidad: e.target.value ? Number(e.target.value) : undefined }))}
                      placeholder={t('condominios.inventario.renta_unidad_placeholder')} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>{t('condominios.inventario.prestable_con_costo_hint')}</div>
            </div>
            <div>
              <label htmlFor="inv-ubicacion" style={labelStyle}>{t('condominios.inventario.ubicacion')}</label>
              <select id="inv-ubicacion" style={inputStyle} value={form.area_id ?? ''} onChange={e => setForm(f => ({ ...f, area_id: e.target.value }))}>
                <option value="">{t('condominios.inventario.ubicacion_sin_area')}</option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                {areaFueraDeLista && (
                  <option value={areaFueraDeLista}>{t('condominios.inventario.ubicacion_inactiva', { nombre: nombreAreaDe(areaFueraDeLista, areas, form.ubicacion ?? '') })}</option>
                )}
              </select>
              {!form.area_id && ubicacionLegada && (
                <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', marginTop: '4px' }}>
                  {t('condominios.inventario.ubicacion_legada', { texto: ubicacionLegada })}
                </div>
              )}
              {areasActivas.length === 0 && (
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                  {t('condominios.inventario.sin_areas')}{' '}
                  {puedeConfigurarAreas
                    ? (
                      <button type="button" onClick={() => onIrATab('areas_config')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 600, fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>
                        {t('condominios.inventario.crear_areas')}
                      </button>
                    )
                    : t('condominios.inventario.areas_en_tab')}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="inv-serie" style={labelStyle}>{t('condominios.inventario.numero_serie')}</label>
              <input id="inv-serie" style={inputStyle} value={form.numero_serie ?? ''} onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="inv-proveedor" style={labelStyle}>{t('condominios.inventario.proveedor')}</label>
              <input id="inv-proveedor" style={inputStyle} value={form.proveedor ?? ''} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="inv-adquisicion" style={labelStyle}>{t('condominios.inventario.fecha_adquisicion')}</label>
              <input id="inv-adquisicion" style={inputStyle} type="date" value={form.fecha_adquisicion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_adquisicion: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="inv-vencimiento" style={labelStyle}>{t('condominios.inventario.fecha_vencimiento')}</label>
              <input id="inv-vencimiento" style={inputStyle} type="date" value={form.fecha_vencimiento ?? ''} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inv-descripcion" style={labelStyle}>{t('condominios.inventario.descripcion')}</label>
              <textarea id="inv-descripcion" style={{ ...inputStyle, resize: 'vertical', minHeight: '56px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* List — cond:B2: migrado a <DataTable> shared */}
      <DataTable<ItemInventario>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'nombre', direction: 'asc' }}
        searchPlaceholder={t('condominios.inventario.search_placeholder')}
        searchableKeys={['nombre', ubicacionDe, i => i.numero_serie ?? '']}
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
                (diasHastaFechaCalendario(i.fecha_vencimiento) ?? Infinity) < 30
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '16px' }}>{CATEGORIA_ICON[i.categoria]}</span>
                    <span style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>{i.nombre}</span>
                  </div>
                  {ubicacionDe(i) && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>📍 {ubicacionDe(i)}</div>}
                  {i.prestable_con_costo && i.costo_renta_unidad != null && (
                    <div style={{ fontSize: '11px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                      💲 {t('condominios.inventario.renta_chip', { moneda, monto: Number(i.costo_renta_unidad).toFixed(2) })}
                    </div>
                  )}
                  {(() => {
                    const fuera = enCirculacion(i.id, prestamos)
                    return fuera > 0 ? <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>🔁 {fuera} en préstamo</div> : null
                  })()}
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
            render: i => (canEdit || canDelete) ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {canEdit && i.estado === 'disponible' && (
                  <button onClick={() => handleEstado(i.id, 'en_uso')} style={{ padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.inventario.accion_en_uso')}
                  </button>
                )}
                {canEdit && i.estado === 'en_uso' && (
                  <button onClick={() => handleEstado(i.id, 'disponible')} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {t('condominios.inventario.accion_disponible')}
                  </button>
                )}
                {canEdit && <button onClick={() => startEdit(i)} aria-label={t('condominios.comun.edit')} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                {canDelete && <button onClick={() => handleDelete(i.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>}
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<ItemInventario>[]}
      />

      {showImportModal && (
        <ImportInventarioModal
          areas={areasActivas}
          proyectoId={proyectoId}
          companyId={companyId}
          onClose={() => setShowImportModal(false)}
          onImportado={() => { setShowImportModal(false); onRefresh() }}
        />
      )}
    </div>
  )
}
