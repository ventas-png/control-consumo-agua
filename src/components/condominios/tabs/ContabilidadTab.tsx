import { hoyLocalISO, mesLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { GastoCondominio, CategoriaGasto, EstadoGasto } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { FilterChips } from '../../shared/FilterChips'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { usePartidaEstadoQuery } from '../../../domain/presupuesto/queries'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { useDuplicadoProbableQuery } from '../../../domain/compras/queries'

interface Props {
  gastos: GastoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CAT_CONFIG: Record<CategoriaGasto, { label: string; icon: string; color: string }> = {
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', color: 'var(--at-primary)' },
  servicios:     { label: 'Servicios',     icon: '💡', color: 'var(--at-warning)' },
  administrativo:{ label: 'Administrativo',icon: '📋', color: 'var(--at-accent)' },
  seguridad:     { label: 'Seguridad',     icon: '🛡️', color: 'var(--at-danger)' },
  limpieza:      { label: 'Limpieza',      icon: '🧹', color: 'var(--at-success)' },
  obras:         { label: 'Obras',         icon: '🏗️', color: 'var(--at-warning)' },
  otros:         { label: 'Otros',         icon: '📁', color: 'var(--at-ink-3)' },
}

const ESTADO_CONFIG: Record<EstadoGasto, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  pagado:    { label: 'Pagado',    color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  anulado:   { label: 'Anulado',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}

const blank = (): Partial<GastoCondominio> => ({
  concepto: '', categoria: 'otros', monto: undefined,
  fecha: hoyLocalISO(),
  proveedor_id: null, proveedor_nombre: '', factura_id: null,
  estado: 'pagado', metodo_pago: 'transferencia',
  comprobante_num: '', notas: '',
})

function barWidth(val: number, max: number) {
  return max > 0 ? `${Math.min(100, Math.round((val / max) * 100))}%` : '0%'
}

export function ContabilidadTab({ gastos, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [filtroCat, setFiltroCat] = useState<CategoriaGasto | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoGasto | 'todos'>('todos')
  const [form, setForm] = useState<Partial<GastoCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Control presupuestario (Fase 3 ERP): estado de la partida del mes para la
  // categoría seleccionada. Solo consulta con el form abierto.
  const { data: partida } = usePartidaEstadoQuery(
    showForm ? proyectoId : undefined,
    form.categoria ?? 'otros',
    form.fecha ?? undefined,
  )
  const excedePartida = !!partida && partida.presupuestado > 0 &&
    (partida.ejecutado + (form.monto ?? 0)) > partida.presupuestado

  // Catálogo de proveedores de Contabilidad. El campo era texto libre, así que
  // `proveedor_id` —que existe en BD desde junio— quedaba SIEMPRE en NULL y no
  // había con qué cruzar un gasto contra su factura.
  const { data: proveedores = [] } = useProveedoresQuery(companyId)

  // Aviso de doble captura: facturas del mismo proveedor y ledger que calzan
  // con lo que se está escribiendo. Advierte y ofrece enlazar; no bloquea.
  const { data: candidatas = [] } = useDuplicadoProbableQuery({
    companyId: showForm ? companyId : undefined,
    projectId: proyectoId,
    proveedorId: form.proveedor_id ?? null,
    monto: form.monto ?? null,
    fecha: form.fecha ?? null,
    comprobante: form.comprobante_num ?? null,
  })
  // El estado «enlazado» lo manda `form.factura_id`, NO la lista de candidatas:
  // si el enlace dependiera de que la factura siga calzando, tocar el monto la
  // sacaría de la lista y el aviso desaparecería mientras el enlace se guarda
  // igual. La lista solo sirve para poder nombrarla.
  const hayEnlace = !!form.factura_id
  const facturaEnlazada = candidatas.find(c => c.factura_id === form.factura_id)

  const thisMonth = mesLocalISO()
  const thisYear  = new Date().getFullYear().toString()

  const pagados   = gastos.filter(g => g.estado === 'pagado')
  const pendientes = gastos.filter(g => g.estado === 'pendiente')
  const totalAnio  = pagados.filter(g => g.fecha.startsWith(thisYear)).reduce((s, g) => s + g.monto, 0)
  const totalMes   = pagados.filter(g => g.fecha.startsWith(thisMonth)).reduce((s, g) => s + g.monto, 0)

  // Por categoría (pagados año actual)
  const porCat: Partial<Record<CategoriaGasto, number>> = {}
  for (const g of pagados.filter(g => g.fecha.startsWith(thisYear))) {
    porCat[g.categoria] = (porCat[g.categoria] ?? 0) + g.monto
  }
  const catEntries = Object.entries(porCat).sort((a, b) => b[1] - a[1]) as [CategoriaGasto, number][]
  const maxCat = Math.max(...catEntries.map(([, v]) => v), 1)

  const filtered = gastos.filter(g =>
    (filtroCat === 'todos' || g.categoria === filtroCat) &&
    (filtroEstado === 'todos' || g.estado === filtroEstado)
  )

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Gastos del Condominio',
      proyectoNombre,
      headers: ['Fecha', 'Concepto', 'Categoría', 'Monto', 'Estado', 'Proveedor'],
      rows: filtered.map(g => [g.fecha, g.concepto, CAT_CONFIG[g.categoria].label, `${moneda} ${g.monto.toFixed(2)}`, ESTADO_CONFIG[g.estado].label, g.proveedor_nombre ?? '—']),
      totalesRow: ['', '', 'TOTAL PAGADOS', `${moneda} ${filtered.filter(g => g.estado === 'pagado').reduce((s, g) => s + g.monto, 0).toFixed(2)}`, '', ''],
      rightAlignCols: [3],
      filename: `gastos-${mesLocalISO()}`,
    })
  }

  function exportarXlsx() {
    exportarExcel(`gastos-${mesLocalISO()}`, [{
      name: 'Gastos',
      headers: ['Fecha', 'Concepto', 'Categoría', 'Monto', 'Estado', 'Proveedor', 'Método Pago', 'No. Comprobante', 'Notas'],
      rows: gastos.map(g => [g.fecha, g.concepto, CAT_CONFIG[g.categoria].label, g.monto, ESTADO_CONFIG[g.estado].label, g.proveedor_nombre ?? '', g.metodo_pago ?? '', g.comprobante_num ?? '', g.notas ?? '']),
    }])
  }

  function startEdit(g: GastoCondominio) {
    setForm({
      concepto: g.concepto, categoria: g.categoria, monto: g.monto, fecha: g.fecha,
      proveedor_id: g.proveedor_id ?? null,
      proveedor_nombre: g.proveedor_nombre ?? '',
      factura_id: g.factura_id ?? null,
      estado: g.estado,
      metodo_pago: g.metodo_pago ?? 'transferencia',
      comprobante_num: g.comprobante_num ?? '', notas: g.notas ?? '',
    })
    setEditId(g.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.concepto?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el concepto.' })
    if (!form.monto || form.monto <= 0) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el monto.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      concepto: form.concepto!.trim(), categoria: form.categoria ?? 'otros',
      monto: form.monto!, fecha: form.fecha!,
      proveedor_id: form.proveedor_id || null,
      proveedor_nombre: form.proveedor_nombre || null,
      // Con la factura enlazada el gasto NO genera asiento: la factura ya
      // devengó ese desembolso (20260823000000_gastos_enlace_factura.sql).
      factura_id: form.factura_id || null,
      estado: form.estado ?? 'pagado',
      metodo_pago: form.metodo_pago || null,
      comprobante_num: form.comprobante_num || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('gastos_condominio', editId, payload)
      : await createCondominioRow('gastos_condominio', payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar gasto?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('gastos_condominio', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: `Gastos ${thisYear}`, value: `${moneda} ${totalAnio.toFixed(0)}`,     icon: '📊', color: 'var(--at-primary)' },
          { label: 'Gastos del mes',    value: `${moneda} ${totalMes.toFixed(0)}`,       icon: '📅', color: 'var(--at-accent)' },
          { label: 'Pendientes pago',   value: `${moneda} ${pendientes.reduce((s,g) => s+g.monto,0).toFixed(0)}`, icon: '⏳', color: 'var(--at-warning)' },
          { label: 'Registros',         value: String(gastos.length),                    icon: '🗂️', color: 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '20px', marginBottom: '20px', alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Gastos del Condominio</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={exportarPDF} disabled={filtered.length === 0} style={{ padding: '6px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
              <button onClick={exportarXlsx} disabled={gastos.length === 0} style={{ padding: '6px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
              {canCreate && !showForm && (
                <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo Gasto</button>
              )}
            </div>
          </div>

          {/* Alcance (Fase 7 ERP): dos rutas escriben al mismo libro y hasta
              ahora no se conocían. Dejar dicho para qué es ESTA evita el
              duplicado en el origen, que es más barato que detectarlo después. */}
          <p style={{ margin: '0 0 16px', padding: '10px 14px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '12px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
            Aquí van los desembolsos <strong>sin factura de proveedor</strong>: caja chica, reembolsos,
            compras menores. Lo que llega con factura entra por <strong>Contabilidad → Compras</strong>{' '}
            (orden de compra → recepción → factura → contraseña de pago) y lo contabiliza la factura.
            Si un gasto de aquí resulta ser el mismo desembolso que una factura, enlázalos: así se
            contabiliza una sola vez.
          </p>

          {showForm && (
            <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Gasto' : 'Registrar Gasto'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Concepto *</label>
                  <input style={inputStyle} value={form.concepto ?? ''} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} placeholder="Ej: Factura electricidad febrero" />
                </div>
                <div>
                  <label style={labelStyle}>Categoría</label>
                  <select style={inputStyle} value={form.categoria ?? 'otros'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaGasto }))}>
                    {Object.entries(CAT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Monto ({moneda}) *</label>
                  <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto ?? ''} onChange={e => setForm(f => ({ ...f, monto: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
                </div>
                <div>
                  <label style={labelStyle}>Fecha *</label>
                  <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Estado</label>
                  <select style={inputStyle} value={form.estado ?? 'pagado'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoGasto }))}>
                    {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Proveedor</label>
                  {/* Del catálogo, no texto libre: es lo que permite cruzar el
                      gasto contra sus facturas y detectar el doble conteo. Se
                      sigue guardando el nombre porque lo pintan los reportes. */}
                  <select
                    style={inputStyle}
                    value={form.proveedor_id ?? ''}
                    onChange={e => {
                      const id = e.target.value || null
                      const p = proveedores.find(x => x.id === id)
                      setForm(f => ({
                        ...f,
                        proveedor_id: id,
                        proveedor_nombre: p?.nombre ?? '',
                        // Cambiar de proveedor invalida el enlace anterior.
                        factura_id: null,
                      }))
                    }}
                  >
                    <option value="">— sin proveedor —</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Método de pago</label>
                  <select style={inputStyle} value={form.metodo_pago ?? 'transferencia'} onChange={e => setForm(f => ({ ...f, metodo_pago: e.target.value }))}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="cheque">Cheque</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>No. Comprobante</label>
                  <input style={inputStyle} value={form.comprobante_num ?? ''} onChange={e => setForm(f => ({ ...f, comprobante_num: e.target.value }))} placeholder="Factura / recibo" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Notas</label>
                  <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
                </div>
              </div>
              {/* Control presupuestario (Fase 3 ERP): advierte si el gasto excede
                  la partida del mes de la cuenta mapeada a la categoría. No
                  bloquea — la decisión operativa es del admin. */}
              {partida && partida.presupuestado > 0 && (
                excedePartida ? (
                  <div style={{ marginTop: '12px', background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning)', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', color: 'var(--at-warning-strong)' }}>
                    ⚠️ <strong>Partida excedida</strong> — {partida.cuenta_codigo} {partida.cuenta_nombre} ({partida.periodo}):
                    presupuestado {moneda} {partida.presupuestado.toFixed(2)}, ejecutado {moneda} {partida.ejecutado.toFixed(2)}.
                    Con este gasto quedaría en {moneda} {(partida.ejecutado + (form.monto ?? 0)).toFixed(2)}
                    {' '}({moneda} {((partida.ejecutado + (form.monto ?? 0)) - partida.presupuestado).toFixed(2)} sobre el presupuesto).
                  </div>
                ) : (
                  <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                    Partida {partida.cuenta_codigo} ({partida.periodo}): disponible {moneda} {(partida.presupuestado - partida.ejecutado - (form.monto ?? 0)).toFixed(2)} de {moneda} {partida.presupuestado.toFixed(2)}.
                  </div>
                )
              )}
              {/* Doble captura (Fase 7 ERP): este desembolso puede ya estar en
                  cuentas por pagar. Advierte y ofrece enlazar — enlazado, el
                  gasto NO genera asiento y deja de contarse dos veces. No
                  bloquea: dos pagos parecidos al mismo proveedor existen. */}
              {hayEnlace ? (
                <div style={{ marginTop: '12px', background: 'var(--at-success-tint)', border: '1.5px solid var(--at-success)', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px' }}>
                  🔗 <strong>Enlazado a la factura {facturaEnlazada?.factura_numero ?? 'del proveedor'}</strong> — este gasto queda como
                  registro operativo y <strong>no generará asiento</strong>, porque la factura ya contabilizó el desembolso.
                  {' '}<button
                    onClick={() => setForm(f => ({ ...f, factura_id: null }))}
                    style={{ border: 'none', background: 'transparent', color: 'var(--at-primary)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '12.5px' }}
                  >Quitar el enlace</button>
                </div>
              ) : candidatas.length > 0 && (
                <div style={{ marginTop: '12px', background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning)', borderRadius: '10px', padding: '10px 14px', fontSize: '12.5px', color: 'var(--at-warning-strong)' }}>
                  ⚠️ <strong>Puede que ya esté en cuentas por pagar</strong> — si es el mismo desembolso, enlázalo para no contarlo dos veces.
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    {candidatas.map(c => (
                      <div key={c.factura_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>
                          Factura <strong>{c.factura_numero ?? '(sin número)'}</strong> del {c.factura_fecha} ·{' '}
                          {moneda} {c.factura_monto.toFixed(2)} · <em>{c.razones}</em>
                        </span>
                        <button
                          onClick={() => setForm(f => ({ ...f, factura_id: c.factura_id }))}
                          style={{ padding: '3px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 6, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                        >Enlazar</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
                <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
                <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
                </button>
              </div>
            </div>
          )}

          {/* Filtros — F3.20: migrado a <FilterChips> shared */}
          <div style={{ marginBottom: '12px' }}>
            <FilterChips<CategoriaGasto | 'todos'>
              ariaLabel="Filtrar por categoría"
              value={filtroCat}
              onChange={setFiltroCat}
              options={[
                { value: 'todos', label: 'Todos', count: gastos.length, color: 'var(--at-primary)' },
                ...(Object.keys(CAT_CONFIG) as CategoriaGasto[]).map(c => ({
                  value: c,
                  label: CAT_CONFIG[c].label,
                  icon: CAT_CONFIG[c].icon,
                  color: 'var(--at-primary)',
                })),
              ]}
            />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <FilterChips<EstadoGasto | 'todos'>
              ariaLabel="Filtrar por estado"
              value={filtroEstado}
              onChange={setFiltroEstado}
              options={[
                { value: 'todos', label: 'Todos', color: 'var(--at-primary)' },
                { value: 'pendiente', label: ESTADO_CONFIG.pendiente.label, color: 'var(--at-primary)' },
                { value: 'pagado', label: ESTADO_CONFIG.pagado.label, color: 'var(--at-primary)' },
                { value: 'anulado', label: ESTADO_CONFIG.anulado.label, color: 'var(--at-primary)' },
              ]}
            />
          </div>

          {/* Tabla de gastos — F3.9: migrado a <DataTable> shared */}
          <DataTable<GastoCondominio>
            data={filtered}
            rowKey="id"
            pageSize={50}
            defaultSort={{ key: 'fecha', direction: 'desc' }}
            searchableKeys={[
              'concepto',
              g => g.proveedor_nombre ?? '',
              g => g.comprobante_num ?? '',
            ]}
            searchPlaceholder="Buscar gasto, proveedor, comprobante…"
            emptyState={{ icon: '🧾', title: 'No hay gastos registrados' }}
            columns={[
              {
                key: 'fecha', header: 'Fecha', sortable: true,
                accessor: g => g.fecha,
                render: g => <span style={{ color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>{g.fecha}</span>,
              },
              {
                key: 'concepto', header: 'Concepto', sortable: true,
                accessor: g => g.concepto,
                render: g => (
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{g.concepto}</div>
                    {g.proveedor_nombre && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 400 }}>{g.proveedor_nombre}</div>}
                  </div>
                ),
              },
              {
                key: 'categoria', header: 'Categoría', sortable: true,
                accessor: g => g.categoria,
                render: g => {
                  const cat = CAT_CONFIG[g.categoria]
                  return <span style={{ fontSize: '11px', fontWeight: 600, color: cat.color }}>{cat.icon} {cat.label}</span>
                },
                hideOnMobile: true,
              },
              {
                key: 'monto', header: 'Monto', sortable: true,
                accessor: g => g.monto,
                render: g => <span style={{ fontWeight: 700, color: 'var(--at-ink)', whiteSpace: 'nowrap' }}>{moneda} {g.monto.toFixed(2)}</span>,
              },
              {
                key: 'estado', header: 'Estado', sortable: true,
                accessor: g => g.estado,
                render: g => {
                  const est = ESTADO_CONFIG[g.estado]
                  return <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                },
              },
              {
                key: 'acciones', header: '',
                render: g => canEdit ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => startEdit(g)} aria-label="Editar" style={{ padding: '3px 7px', background: 'var(--at-chip)', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(g.id)} aria-label="Eliminar" style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  </div>
                ) : null,
              },
            ] satisfies DataTableColumn<GastoCondominio>[]}
          />
        </div>

        {/* Panel de categorías */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', position: 'sticky', top: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>📊 Gastos por categoría ({thisYear})</h3>
          {catEntries.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--at-ink-3)', textAlign: 'center', margin: '20px 0' }}>Sin datos</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {catEntries.map(([cat, total]) => {
                const c = CAT_CONFIG[cat]
                return (
                  <div key={cat}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--at-ink-3)', fontWeight: 600 }}>{c.icon} {c.label}</span>
                      <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {total.toFixed(0)}</span>
                    </div>
                    <div style={{ background: 'var(--at-chip)', borderRadius: '4px', height: '7px' }}>
                      <div style={{ background: c.color, height: '7px', borderRadius: '4px', width: barWidth(total, maxCat), transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ borderTop: '1px solid var(--at-line)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)' }}>
                <span>Total pagado</span>
                <span>{moneda} {totalAnio.toFixed(0)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
