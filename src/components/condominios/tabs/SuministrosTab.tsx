import { hoyLocalISO } from '../../../lib/format'
import { useMemo, useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { SuministroCondominio, MovimientoSuministro, CategoriaSupministro, UnidadMedidaSum, TipoMovimientoSum, ContratoProveedor } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { ImportSuministrosModal } from '../ImportSuministrosModal'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { useAsignacionesQuery } from '../../../domain/proveedores/queries'
import { proveedorHabilitadoEn } from '../../../domain/proveedores/identidad'
import type { ProveedorCatalogo } from '../../../types/proveedores'
import { ProveedorSelector } from '../../proveedores/ProveedorSelector'
import { OperacionesLegadoPanel } from '../../proveedores/OperacionesLegadoPanel'
import { tint } from '../../shared/statusTone'
import {
  UNIDADES_RENDIMIENTO, consumoObservado, describirRendimiento, fmtRendimiento, rendimientoSuministro,
} from '../../../lib/suministros'

interface Props {
  suministros: SuministroCondominio[]
  movimientos: MovimientoSuministro[]
  proveedores: ContratoProveedor[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaSupministro; label: string; icon: string }[] = [
  { value: 'limpieza',    label: 'Limpieza',    icon: '🧹' },
  { value: 'herramienta', label: 'Herramienta', icon: '🔧' },
  { value: 'material',    label: 'Material',    icon: '🧱' },
  { value: 'oficina',     label: 'Oficina',     icon: '📎' },
  { value: 'seguridad',   label: 'Seguridad',   icon: '🛡️' },
  { value: 'otro',        label: 'Otro',        icon: '📦' },
]

const UNIDADES: UnidadMedidaSum[] = ['unidad', 'litro', 'kg', 'metro', 'caja', 'rollo', 'otro']

const TIPOS_MOV: { value: TipoMovimientoSum; label: string; color: string }[] = [
  { value: 'entrada', label: 'Entrada', color: 'var(--at-success)' },
  { value: 'salida',  label: 'Salida',  color: 'var(--at-danger)' },
  { value: 'ajuste',  label: 'Ajuste',  color: 'var(--at-warning)' },
]

/** Ventana del consumo observado que muestra el detalle. */
const DIAS_CONSUMO = 30

interface FormSuministro {
  nombre: string
  categoria: CategoriaSupministro
  unidad_medida: UnidadMedidaSum
  stock_actual: string
  stock_minimo: string
  ubicacion: string
  proveedor_id: string
  proveedor: string
  costo_unitario: string
  rendimiento: string
  rendimiento_unidad: string
  notas: string
}

const FORM_VACIO: FormSuministro = {
  nombre: '', categoria: 'limpieza', unidad_medida: 'unidad', stock_actual: '0', stock_minimo: '0',
  ubicacion: '', proveedor_id: '', proveedor: '', costo_unitario: '', rendimiento: '', rendimiento_unidad: '', notas: '',
}

/** La ficha tal como la edita la persona (el stock no: lo mueven los movimientos). */
function formDesde(s: SuministroCondominio): FormSuministro {
  return {
    nombre: s.nombre, categoria: s.categoria, unidad_medida: s.unidad_medida,
    stock_actual: String(s.stock_actual), stock_minimo: String(s.stock_minimo),
    ubicacion: s.ubicacion ?? '', proveedor_id: s.proveedor_id ?? '', proveedor: s.proveedor ?? '',
    costo_unitario: s.costo_unitario != null ? String(s.costo_unitario) : '',
    rendimiento: s.rendimiento != null ? String(s.rendimiento) : '',
    rendimiento_unidad: s.rendimiento_unidad ?? '',
    notas: s.notas ?? '',
  }
}

export default function SuministrosTab({ suministros, movimientos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  // Se guarda el id y no la fila: así, cuando `suministros` vuelve a cargar
  // tras editar o mover stock, el detalle muestra la ficha nueva y no una copia
  // vieja de la que se pulsó.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => suministros.find(s => s.id === selectedId) ?? null, [suministros, selectedId])
  const [vista, setVista] = useState<'lista' | 'nuevo' | 'editar' | 'movimiento'>('lista')
  const [saving, setSaving] = useState(false)
  const [filtro, setFiltro] = useState<CategoriaSupministro | ''>('')
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  const [form, setForm] = useState<FormSuministro>(FORM_VACIO)

  const [movForm, setMovForm] = useState({
    tipo: 'salida' as TipoMovimientoSum, cantidad: '', motivo: '',
    area_destino: '', realizado_por: '', fecha: hoyLocalISO(), notas: '',
  })

  const lista = suministros.filter(s =>
    (filtro === '' || s.categoria === filtro) &&
    (!soloAlertas || s.stock_actual <= s.stock_minimo)
  )

  const alertas = suministros.filter(s => s.activo && s.stock_actual <= s.stock_minimo)
  const movsDelSelected = selected ? movimientos.filter(m => m.suministro_id === selected.id) : []
  const rendimiento = selected ? rendimientoSuministro(selected) : null
  const consumo = selected ? consumoObservado(selected.stock_actual, movsDelSelected, hoyLocalISO(), DIAS_CONSUMO) : null

  // El proveedor sale del CATÁLOGO COMPARTIDO por id (el mismo de Contabilidad),
  // no de la lista de contratos ni de texto libre. `proveedores` (contratos) sigue
  // en Props porque el registro de pestañas lo pasa.
  const { data: catalogo = [] } = useProveedoresQuery(companyId)
  const { data: asignaciones = [] } = useAsignacionesQuery(companyId, proyectoId)
  const importables = (catalogo as ProveedorCatalogo[])
    .filter(p => proveedorHabilitadoEn(p, asignaciones, proyectoId, hoyLocalISO()))
    .map(p => ({ id: p.id, nombre: p.nombre }))

  function abrirNuevo() {
    setForm(FORM_VACIO)
    setSelectedId(null)
    setVista('nuevo')
  }

  function abrirEdicion(s: SuministroCondominio) {
    setForm(formDesde(s))
    setVista('editar')
  }

  /**
   * Lo que la persona puede cambiar de la ficha. `stock_actual` queda fuera a
   * propósito: lo mueven los movimientos (y la BD ignora un UPDATE directo,
   * 20260821000200). El rendimiento sólo viaja con su unidad; sin número, la
   * unidad no significa nada y se limpia.
   */
  function fichaDesdeForm(): { ficha: Record<string, unknown> } | { error: string } {
    if (!form.nombre.trim()) return { error: 'Nombre obligatorio' }
    const stockMinimo = parseFloat(form.stock_minimo) || 0
    if (stockMinimo < 0) return { error: 'El stock mínimo no puede ser negativo' }
    let rendimiento: number | null = null
    if (form.rendimiento.trim()) {
      rendimiento = parseFloat(form.rendimiento)
      if (!Number.isFinite(rendimiento) || rendimiento <= 0) return { error: 'El rendimiento debe ser un número mayor que 0 (cuántos usos da una unidad)' }
    }
    return {
      ficha: {
        nombre: form.nombre.trim(), categoria: form.categoria,
        unidad_medida: form.unidad_medida,
        stock_minimo: stockMinimo,
        ubicacion: form.ubicacion.trim() || null,
        proveedor_id: form.proveedor_id || null,
        proveedor: form.proveedor.trim() || null,
        costo_unitario: form.costo_unitario ? parseFloat(form.costo_unitario) : null,
        rendimiento,
        rendimiento_unidad: rendimiento != null ? (form.rendimiento_unidad.trim() || null) : null,
        notas: form.notas.trim() || null,
      },
    }
  }

  async function guardar() {
    const r = fichaDesdeForm()
    if ('error' in r) { notify({ variant: 'warning', title: 'Faltan datos', text: r.error }); return }
    setSaving(true)
    const { error } = vista === 'editar' && selected
      ? await updateCondominioRow('suministros_condominio', selected.id, r.ficha)
      : await createCondominioRow('suministros_condominio', {
          company_id: companyId, project_id: proyectoId,
          stock_actual: parseFloat(form.stock_actual) || 0,
          ...r.ficha,
        })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (vista === 'editar') notify({ variant: 'success', title: 'Suministro actualizado', text: r.ficha.nombre as string })
    setForm(FORM_VACIO)
    setVista('lista')
    onRefresh()
  }

  async function registrarMovimiento() {
    if (!selected || !movForm.cantidad) { notify({ variant: 'warning', title: 'Faltan datos', text: 'Cantidad obligatoria' }); return }
    const cant = parseFloat(movForm.cantidad)
    if (isNaN(cant) || cant <= 0) { notify({ variant: 'warning', title: 'Inválido', text: 'Cantidad debe ser positiva' }); return }

    setSaving(true)
    const { error: errMov } = await createCondominioRow('movimientos_suministro', {
      company_id: companyId, suministro_id: selected.id,
      tipo: movForm.tipo, cantidad: cant,
      motivo: movForm.motivo.trim() || null, area_destino: movForm.area_destino.trim() || null,
      realizado_por: movForm.realizado_por.trim() || null, fecha: movForm.fecha,
      notas: movForm.notas.trim() || null,
    })
    setSaving(false)
    if (errMov) { notify({ variant: 'error', title: 'Error', text: errMov.message }); return }

    // El stock ya NO se calcula aquí. Antes eran dos escrituras separadas
    // —insertar el movimiento y luego un UPDATE del stock— y si la segunda
    // fallaba, o dos personas movían el mismo insumo a la vez, `stock_actual`
    // quedaba mintiendo sin que nada lo detectara. Ahora lo recalcula el
    // trigger `suministros_tg_stock` (migración 20260821000200) en la misma
    // transacción que el movimiento, con la misma semántica de siempre:
    // entrada suma, salida resta con piso en 0 y `ajuste` FIJA el stock.
    // La BD además ignora los UPDATE directos a `stock_actual`, así que
    // reponerlos aquí no serviría de nada más que para contar doble.

    setMovForm({ tipo: 'salida', cantidad: '', motivo: '', area_destino: '', realizado_por: '', fecha: hoyLocalISO(), notas: '' })
    setVista('lista')
    onRefresh()
  }

  async function toggleActivo(s: SuministroCondominio) {
    await updateCondominioRow('suministros_condominio', s.id, { activo: !s.activo })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const editando = vista === 'editar'
  const fmtMoneda = (n: number) => `${moneda} ${n.toFixed(2)}`

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 300, borderRight: '1px solid var(--at-line)', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Suministros</span>
            {canCreate && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setShowImportModal(true)} title="Carga masiva desde Excel/CSV"
                  style={{ padding: '5px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  ⬆ Masiva
                </button>
                <button onClick={abrirNuevo}
                  style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  + Nuevo
                </button>
              </div>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtro} onChange={e => setFiltro(e.target.value as CategoriaSupministro | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloAlertas} onChange={e => setSoloAlertas(e.target.checked)} />
            Solo alertas de stock ({alertas.length})
          </label>
        </div>

        {alertas.length > 0 && !soloAlertas && (
          <div style={{ padding: '6px 12px', background: 'var(--at-warning-tint)', borderBottom: '1px solid var(--at-warning-border)', fontSize: 12, color: 'var(--at-warning-strong)' }}>
            ⚠️ {alertas.length} suministros bajo mínimo
          </div>
        )}

        {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin suministros</div>}

        {lista.map(s => {
          const cat = CATEGORIAS.find(c => c.value === s.categoria)
          const alerta = s.stock_actual <= s.stock_minimo
          const r = rendimientoSuministro(s)
          return (
            <div key={s.id} role="button" tabIndex={0} aria-label={s.nombre}
              onClick={() => { setSelectedId(s.id); setVista('lista') }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(s.id); setVista('lista') } }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === s.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', opacity: s.activo ? 1 : 0.5, borderLeft: alerta ? '3px solid var(--at-warning)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cat?.icon} {s.nombre}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: alerta ? 'var(--at-danger)' : 'var(--at-success)' }}>
                  {s.stock_actual} {s.unidad_medida}
                </span>
              </div>
              {alerta && <div style={{ fontSize: 11, color: 'var(--at-warning)' }}>⚠️ Mínimo: {s.stock_minimo}</div>}
              {(s.ubicacion || r) && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>
                  {s.ubicacion}
                  {s.ubicacion && r && ' · '}
                  {r && `≈ ${fmtRendimiento(r.usosDisponibles)} ${r.unidad}`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Formulario nuevo / editar */}
        {(vista === 'nuevo' || (editando && selected)) && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>{editando ? `Editar suministro` : 'Nuevo suministro'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl} htmlFor="sum-f-nombre">Nombre *</label>
                <input id="sum-f-nombre" style={inp} placeholder="Detergente multiusos…" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="sum-f-categoria">Categoría</label>
                <select id="sum-f-categoria" style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaSupministro }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl} htmlFor="sum-f-unidad">Unidad de medida</label>
                <select id="sum-f-unidad" style={inp} value={form.unidad_medida} onChange={e => setForm(p => ({ ...p, unidad_medida: e.target.value as UnidadMedidaSum }))}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label id="sum-f-stock-lbl" style={lbl} htmlFor={editando ? undefined : 'sum-f-stock'}>Stock actual</label>
                {editando && selected ? (
                  // Lo mueven los movimientos: un UPDATE directo al stock lo
                  // ignora la BD. Para corregirlo se registra un «ajuste».
                  <div aria-labelledby="sum-f-stock-lbl" style={{ ...inp, background: 'var(--at-surface-2)', color: 'var(--at-ink-2)' }}>
                    {selected.stock_actual} {selected.unidad_medida}
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>Se cambia con un movimiento de ajuste</div>
                  </div>
                ) : (
                  <input id="sum-f-stock" type="number" style={inp} value={form.stock_actual} onChange={e => setForm(p => ({ ...p, stock_actual: e.target.value }))} />
                )}
              </div>
              <div>
                <label style={lbl} htmlFor="sum-f-minimo">Stock mínimo</label>
                <input id="sum-f-minimo" type="number" style={inp} value={form.stock_minimo} onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl} htmlFor="sum-f-ubicacion">Ubicación</label>
                <input id="sum-f-ubicacion" style={inp} placeholder="Cuarto de limpieza…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
              </div>
              <div>
                <ProveedorSelector
                  proveedores={catalogo as ProveedorCatalogo[]} asignaciones={asignaciones} projectId={proyectoId}
                  value={form.proveedor_id || null} soloHabilitados label="Proveedor"
                  onChange={(id, pr) => setForm(p => ({ ...p, proveedor_id: id ?? '', proveedor: pr?.nombre ?? '' }))}
                />
              </div>
              <div>
                <label style={lbl} htmlFor="sum-f-costo">Costo unitario ({moneda})</label>
                <input id="sum-f-costo" type="number" style={inp} value={form.costo_unitario} onChange={e => setForm(p => ({ ...p, costo_unitario: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3', background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>📐 Rendimiento</div>
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 8 }}>
                  Cuántos usos da 1 {form.unidad_medida}: por ejemplo, 1 litro rinde 40 aplicaciones. Con eso el stock se lee en usos y el costo en costo por uso.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={lbl} htmlFor="sum-f-rendimiento">Rendimiento por {form.unidad_medida}</label>
                    <input id="sum-f-rendimiento" type="number" min="0" step="any" style={inp} placeholder="40" value={form.rendimiento} onChange={e => setForm(p => ({ ...p, rendimiento: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl} htmlFor="sum-f-rendimiento-unidad">Se mide en</label>
                    <input id="sum-f-rendimiento-unidad" list="sum-f-rendimiento-unidades" style={inp} placeholder="aplicaciones, limpiezas, m², días…" value={form.rendimiento_unidad} onChange={e => setForm(p => ({ ...p, rendimiento_unidad: e.target.value }))} />
                    <datalist id="sum-f-rendimiento-unidades">
                      {UNIDADES_RENDIMIENTO.map(u => <option key={u} value={u} />)}
                    </datalist>
                  </div>
                </div>
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl} htmlFor="sum-f-notas">Notas</label>
                <input id="sum-f-notas" style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : editando ? '✅ Guardar cambios' : '✅ Guardar'}
              </button>
              <button onClick={() => { setForm(FORM_VACIO); setVista('lista') }}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Formulario movimiento */}
        {vista === 'movimiento' && selected && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Registrar movimiento</div>
            <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginBottom: 16 }}>
              {selected.nombre} — Stock actual: <strong>{selected.stock_actual} {selected.unidad_medida}</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Tipo *</label>
                <select style={inp} value={movForm.tipo} onChange={e => setMovForm(p => ({ ...p, tipo: e.target.value as TipoMovimientoSum }))}>
                  {TIPOS_MOV.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Cantidad *{movForm.tipo === 'ajuste' ? ' (nuevo stock)' : ''}</label>
                <input type="number" style={inp} value={movForm.cantidad} onChange={e => setMovForm(p => ({ ...p, cantidad: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha</label>
                <input type="date" style={inp} value={movForm.fecha} onChange={e => setMovForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Motivo</label>
                <input style={inp} placeholder="Consumo semanal…" value={movForm.motivo} onChange={e => setMovForm(p => ({ ...p, motivo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Área destino</label>
                <input style={inp} placeholder="Lobby, piscina…" value={movForm.area_destino} onChange={e => setMovForm(p => ({ ...p, area_destino: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Realizado por</label>
                <input style={inp} value={movForm.realizado_por} onChange={e => setMovForm(p => ({ ...p, realizado_por: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={registrarMovimiento} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Registrar'}
              </button>
              <button onClick={() => setVista('lista')}
                style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Detalle */}
        {vista === 'lista' && selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>
                  {CATEGORIAS.find(c => c.value === selected.categoria)?.icon} {selected.nombre}
                </div>
                <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 4 }}>
                  {selected.ubicacion && <span>{selected.ubicacion} · </span>}
                  {selected.proveedor && <span>Proveedor: {selected.proveedor}{!selected.proveedor_id && ' (sin vincular al catálogo)'}</span>}
                </div>
                {rendimiento && (
                  <div style={{ fontSize: 13, color: 'var(--at-ink-2)', marginTop: 4 }}>
                    📐 {describirRendimiento(selected)}
                    {rendimiento.costoPorUso != null && <span> · {fmtMoneda(rendimiento.costoPorUso)} por {rendimiento.unidad === 'usos' ? 'uso' : rendimiento.unidad}</span>}
                  </div>
                )}
                {!rendimiento && canEdit && (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>
                    📐 Sin rendimiento declarado: edita la ficha para indicar cuántos usos da 1 {selected.unidad_medida}.
                  </div>
                )}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => abrirEdicion(selected)}
                    style={{ padding: '7px 14px', background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    ✏️ Editar
                  </button>
                  <button onClick={() => setVista('movimiento')}
                    style={{ padding: '7px 14px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    + Movimiento
                  </button>
                  <button onClick={() => toggleActivo(selected)}
                    style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    {selected.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              )}
            </div>

            {/* Stock KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: `Stock actual (${selected.unidad_medida})`, value: String(selected.stock_actual), color: selected.stock_actual <= selected.stock_minimo ? 'var(--at-danger)' : 'var(--at-success)' },
                { label: `Stock mínimo (${selected.unidad_medida})`, value: String(selected.stock_minimo), color: 'var(--at-ink-3)' },
                { label: `Costo unitario (${moneda})`, value: selected.costo_unitario?.toFixed(2) ?? '—', color: 'var(--at-accent)' },
                ...(rendimiento ? [
                  { label: `Usos disponibles (${rendimiento.unidad})`, value: fmtRendimiento(rendimiento.usosDisponibles), color: rendimiento.usosDisponibles <= rendimiento.usosMinimo ? 'var(--at-danger)' : 'var(--at-success)' },
                  { label: `Costo por ${rendimiento.unidad === 'usos' ? 'uso' : rendimiento.unidad} (${moneda})`, value: rendimiento.costoPorUso != null ? fmtRendimiento(rendimiento.costoPorUso, 4) : '—', color: 'var(--at-accent)' },
                ] : []),
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{k.label}</div>
                </div>
              ))}
            </div>

            {selected.stock_actual <= selected.stock_minimo && (
              <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--at-warning-strong)' }}>
                ⚠️ Stock bajo mínimo — requiere reposición
              </div>
            )}

            {/* Consumo observado: lo que de verdad salió, no lo declarado */}
            {consumo && (
              <div style={{ fontSize: 12, color: 'var(--at-ink-2)', marginBottom: 16 }}>
                {consumo.movimientos === 0
                  ? `Sin salidas en los últimos ${consumo.dias} días.`
                  : <>
                      Salidas en los últimos {consumo.dias} días: <strong>{fmtRendimiento(consumo.salidas)} {selected.unidad_medida}</strong> ({consumo.movimientos} {consumo.movimientos === 1 ? 'movimiento' : 'movimientos'})
                      {' · '}≈ {fmtRendimiento(consumo.porDia, 2)} {selected.unidad_medida} por día
                      {consumo.diasCobertura != null && <> · a ese ritmo el stock alcanza ≈ <strong>{consumo.diasCobertura} {consumo.diasCobertura === 1 ? 'día' : 'días'}</strong></>}
                    </>}
              </div>
            )}

            {/* Historial movimientos — F3.9: migrado a <DataTable> shared */}
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Últimos movimientos</div>
            <DataTable<MovimientoSuministro>
              data={movsDelSelected.slice(0, 30)}
              rowKey="id"
              pageSize={30}
              defaultSort={{ key: 'fecha', direction: 'desc' }}
              emptyState={{ icon: '📋', title: 'Sin movimientos registrados' }}
              columns={[
                { key: 'fecha', header: 'Fecha', sortable: true,
                  render: (m) => m.fecha },
                { key: 'tipo', header: 'Tipo', sortable: true,
                  render: (m) => {
                    const tipo = TIPOS_MOV.find(t => t.value === m.tipo)
                    return <span style={{ padding: '2px 8px', borderRadius: 8, background: tint(tipo?.color ?? 'var(--at-ink-3)', 12), color: tipo?.color, fontSize: 11 }}>{tipo?.label}</span>
                  } },
                { key: 'cantidad', header: 'Cantidad', align: 'right', sortable: true,
                  render: (m) => <span style={{ fontWeight: 600 }}>{m.cantidad} {selected.unidad_medida}</span> },
                { key: 'motivo', header: 'Motivo', hideOnMobile: true,
                  accessor: (m) => m.motivo ?? '',
                  render: (m) => m.motivo || '—' },
                { key: 'area_destino', header: 'Área', hideOnMobile: true,
                  accessor: (m) => m.area_destino ?? '',
                  render: (m) => m.area_destino || '—' },
                { key: 'realizado_por', header: 'Por', hideOnMobile: true,
                  accessor: (m) => m.realizado_por ?? '',
                  render: (m) => m.realizado_por || '—' },
              ] satisfies DataTableColumn<MovimientoSuministro>[]}
            />
          </div>
        )}

        {vista === 'lista' && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--at-ink-3)', fontSize: 14 }}>
            Selecciona un suministro o crea uno nuevo
          </div>
        )}
      </div>

      <OperacionesLegadoPanel companyId={companyId} tabla="suministros_condominio" projectId={proyectoId} canEdit={canEdit} />

      {showImportModal && (
        <ImportSuministrosModal
          proyectoId={proyectoId}
          companyId={companyId}
          proveedoresValidos={importables}
          onClose={() => setShowImportModal(false)}
          onImportado={() => { setShowImportModal(false); onRefresh() }}
        />
      )}
    </div>
  )
}
