import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { SuministroCondominio, MovimientoSuministro, CategoriaSupministro, UnidadMedidaSum, TipoMovimientoSum, ContratoProveedor } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { ImportSuministrosModal } from '../ImportSuministrosModal'

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

export default function SuministrosTab({ suministros, movimientos, proveedores, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<SuministroCondominio | null>(null)
  const [vista, setVista] = useState<'lista' | 'nuevo' | 'movimiento'>('lista')
  const [saving, setSaving] = useState(false)
  const [filtro, setFiltro] = useState<CategoriaSupministro | ''>('')
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  const [form, setForm] = useState({
    nombre: '', categoria: 'limpieza' as CategoriaSupministro,
    unidad_medida: 'unidad' as UnidadMedidaSum, stock_actual: '0', stock_minimo: '0',
    ubicacion: '', proveedor: '', costo_unitario: '', notas: '',
  })

  const [movForm, setMovForm] = useState({
    tipo: 'salida' as TipoMovimientoSum, cantidad: '', motivo: '',
    area_destino: '', realizado_por: '', fecha: new Date().toISOString().split('T')[0], notas: '',
  })

  const lista = suministros.filter(s =>
    (filtro === '' || s.categoria === filtro) &&
    (!soloAlertas || s.stock_actual <= s.stock_minimo)
  )

  const alertas = suministros.filter(s => s.activo && s.stock_actual <= s.stock_minimo)
  const movsDelSelected = selected ? movimientos.filter(m => m.suministro_id === selected.id) : []

  // Proveedores autorizados/definidos (pestaña Proveedores) — únicas opciones
  // válidas para el campo Proveedor del suministro. Nombres distintos, con los
  // contratos activos primero.
  const proveedoresDisponibles = Array.from(
    new Set(
      [...proveedores]
        .sort((a, b) => (a.estado === 'activo' ? 0 : 1) - (b.estado === 'activo' ? 0 : 1))
        .map(p => p.proveedor_nombre.trim())
        .filter(Boolean)
    )
  )

  async function guardar() {
    if (!form.nombre.trim()) { notify({ variant: 'warning', title: 'Faltan datos', text: 'Nombre obligatorio' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('suministros_condominio', {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), categoria: form.categoria,
      unidad_medida: form.unidad_medida,
      stock_actual: parseFloat(form.stock_actual) || 0,
      stock_minimo: parseFloat(form.stock_minimo) || 0,
      ubicacion: form.ubicacion.trim() || null,
      proveedor: form.proveedor.trim() || null,
      costo_unitario: form.costo_unitario ? parseFloat(form.costo_unitario) : null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ nombre: '', categoria: 'limpieza', unidad_medida: 'unidad', stock_actual: '0', stock_minimo: '0', ubicacion: '', proveedor: '', costo_unitario: '', notas: '' })
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
    if (errMov) { setSaving(false); notify({ variant: 'error', title: 'Error', text: errMov.message }); return }

    // Actualizar stock
    let nuevoStock = selected.stock_actual
    if (movForm.tipo === 'entrada') nuevoStock += cant
    else if (movForm.tipo === 'salida') nuevoStock = Math.max(0, nuevoStock - cant)
    else nuevoStock = cant // ajuste directo

    const { error: errStock } = await updateCondominioRow('suministros_condominio', selected.id, { stock_actual: nuevoStock })
    setSaving(false)
    if (errStock) { notify({ variant: 'error', title: 'Error', text: errStock.message }); return }

    setMovForm({ tipo: 'salida', cantidad: '', motivo: '', area_destino: '', realizado_por: '', fecha: new Date().toISOString().split('T')[0], notas: '' })
    setVista('lista')
    onRefresh()
  }

  async function toggleActivo(s: SuministroCondominio) {
    await updateCondominioRow('suministros_condominio', s.id, { activo: !s.activo })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

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
                <button onClick={() => { setVista('nuevo'); setSelected(null) }}
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
          return (
            <div key={s.id} onClick={() => { setSelected(s); setVista('lista') }}
              style={{ padding: '10px 12px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === s.id ? 'var(--at-accent-tint)' : 'var(--at-surface)', opacity: s.activo ? 1 : 0.5, borderLeft: alerta ? '3px solid var(--at-warning)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cat?.icon} {s.nombre}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: alerta ? 'var(--at-danger)' : 'var(--at-success)' }}>
                  {s.stock_actual} {s.unidad_medida}
                </span>
              </div>
              {alerta && <div style={{ fontSize: 11, color: 'var(--at-warning)' }}>⚠️ Mínimo: {s.stock_minimo}</div>}
              {s.ubicacion && <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{s.ubicacion}</div>}
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Formulario nuevo */}
        {vista === 'nuevo' && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo suministro</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Nombre *</label>
                <input style={inp} placeholder="Detergente multiusos…" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaSupministro }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Unidad de medida</label>
                <select style={inp} value={form.unidad_medida} onChange={e => setForm(p => ({ ...p, unidad_medida: e.target.value as UnidadMedidaSum }))}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Stock actual</label>
                <input type="number" style={inp} value={form.stock_actual} onChange={e => setForm(p => ({ ...p, stock_actual: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Stock mínimo</label>
                <input type="number" style={inp} value={form.stock_minimo} onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Ubicación</label>
                <input style={inp} placeholder="Cuarto de limpieza…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Proveedor</label>
                <select style={inp} value={form.proveedor}
                  onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))}
                  disabled={proveedoresDisponibles.length === 0}>
                  <option value="">— Sin proveedor —</option>
                  {proveedoresDisponibles.map(nombre => <option key={nombre} value={nombre}>{nombre}</option>)}
                </select>
                {proveedoresDisponibles.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>
                    Define proveedores en la pestaña <strong>Proveedores</strong> para poder elegirlos aquí.
                  </div>
                )}
              </div>
              <div>
                <label style={lbl}>Costo unitario ({moneda})</label>
                <input type="number" style={inp} value={form.costo_unitario} onChange={e => setForm(p => ({ ...p, costo_unitario: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Notas</label>
                <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Guardar'}
              </button>
              <button onClick={() => setVista('lista')}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>
                  {CATEGORIAS.find(c => c.value === selected.categoria)?.icon} {selected.nombre}
                </div>
                <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginTop: 4 }}>
                  {selected.ubicacion && <span>{selected.ubicacion} · </span>}
                  {selected.proveedor && <span>Proveedor: {selected.proveedor}</span>}
                </div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8 }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { label: `Stock actual (${selected.unidad_medida})`, value: selected.stock_actual, color: selected.stock_actual <= selected.stock_minimo ? 'var(--at-danger)' : 'var(--at-success)' },
                { label: `Stock mínimo (${selected.unidad_medida})`, value: selected.stock_minimo, color: 'var(--at-ink-3)' },
                { label: `Costo unitario (${moneda})`, value: selected.costo_unitario?.toFixed(2) ?? '—', color: 'var(--at-accent)' },
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
                    return <span style={{ padding: '2px 8px', borderRadius: 8, background: (tipo?.color ?? 'var(--at-ink-3)') + '20', color: tipo?.color, fontSize: 11 }}>{tipo?.label}</span>
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

      {showImportModal && (
        <ImportSuministrosModal
          proyectoId={proyectoId}
          companyId={companyId}
          proveedoresValidos={proveedoresDisponibles}
          onClose={() => setShowImportModal(false)}
          onImportado={() => { setShowImportModal(false); onRefresh() }}
        />
      )}
    </div>
  )
}
