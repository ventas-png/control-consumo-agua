import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow } from '../../../domain/condominios/tabMutations'
import { entregarPrestamos, recibirPrestamos } from '../../../domain/condominios/prestamosEquipo'
import type { PrestamoEquipo, EstadoPrestamo, Unidad, ItemInventario, ReservaAmenidad, CategoriaInventario } from '../../../types'
import { disponibilidadEquipo, faltantes, prestamoCerrado } from '../../../lib/prestamosEquipo'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  prestamos: PrestamoEquipo[]
  unidades: Unidad[]
  /** Inventario del condominio: el préstamo se ata a una fila y la cantidad se limita a lo disponible (20261108000000). */
  inventario?: ItemInventario[]
  /** Reservas del proyecto, para mostrar de cuál cuelga cada préstamo. */
  reservas?: ReservaAmenidad[]
  moneda?: string
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.prestamos.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<EstadoPrestamo, { color: string; bg: string; label: string }> = {
  solicitado: { color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', label: 'Solicitado' },
  prestado:   { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', label: 'Prestado' },
  devuelto:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)', label: 'Devuelto' },
  dañado:     { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', label: 'Dañado'   },
  perdido:    { color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint)', label: 'Perdido'  },
  cancelado:  { color: 'var(--at-ink-3)', bg: 'var(--at-chip)', label: 'Cancelado' },
}

const CATEGORIA_ICON: Record<CategoriaInventario, string> = {
  herramienta: '🔨', equipo: '⚙️', material: '📦', mobiliario: '🪑', vehiculo: '🚗', otro: '📋',
}

const EQUIPOS_COMUNES = ['Sillas','Mesas','Proyector','Pantalla','Micrófono','Toldo','Cañonera','Extensiones','Decoraciones','Cocina','Otro']

/** Opción del selector de equipo para un préstamo que no sale del inventario. */
const OTRO = '__otro__'

const BLANK = {
  unidad_id: '', inventario_id: '', equipo_nombre: '', cantidad: 1,
  fecha_prestamo: hoyLocalISO(), hora_prestamo: '',
  fecha_devolucion: '', deposito: '', deposito_pagado: false,
  entregado_por: '', observaciones: '',
}

export function PrestamoEquiposTab({ prestamos, unidades, inventario = [], reservas = [], moneda = 'Q', proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoPrestamo | 'all'>('all')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  // Equipo del inventario que se puede prestar (lo dado de baja no se ofrece).
  const prestables = inventario.filter(i => i.estado !== 'dado_de_baja')
  const itemSel = prestables.find(i => i.id === form.inventario_id) ?? null
  const disponible = itemSel ? disponibilidadEquipo(itemSel, prestamos, form.fecha_prestamo) : null
  const sinInventario = prestables.length === 0

  const filtered = prestamos.filter(p => filtroEstado === 'all' || p.estado === filtroEstado)
  const activos     = prestamos.filter(p => p.estado === 'prestado').length
  const porEntregar = prestamos.filter(p => p.estado === 'solicitado').length
  const conDeposito = prestamos.filter(p => p.estado === 'prestado' && p.deposito && p.deposito > 0).length
  const reposicionPendiente = prestamos
    .filter(p => prestamoCerrado(p) && !p.cuota_reposicion_id)
    .reduce((s, p) => s + Number(p.monto_reposicion ?? 0), 0)

  function elegirEquipo(id: string) {
    const item = prestables.find(i => i.id === id)
    setForm(prev => ({
      ...prev,
      inventario_id: id,
      equipo_nombre: item ? item.nombre : (id === OTRO ? '' : prev.equipo_nombre),
    }))
  }

  async function handleSave() {
    if (!form.unidad_id) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'La unidad es obligatoria.' })
    if (!sinInventario && !form.inventario_id) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Elige el equipo del inventario (o «Otro» si no está inventariado).' })
    const nombre = (itemSel ? itemSel.nombre : form.equipo_nombre).trim()
    if (!nombre) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Indica el nombre del equipo.' })
    if (form.cantidad < 1) return notify({ variant: 'warning', title: 'Cantidad inválida', text: 'La cantidad debe ser al menos 1.' })
    if (itemSel && disponible != null && form.cantidad > disponible) {
      return notify({ variant: 'warning', title: 'Sin disponibilidad', text: `De "${itemSel.nombre}" sólo hay ${Math.max(0, disponible)} disponible(s) para el ${form.fecha_prestamo}.` })
    }
    setSaving(true)
    const { error } = await createCondominioRow('prestamos_equipo', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      inventario_id: itemSel ? itemSel.id : null,
      equipo_nombre: nombre,
      cantidad: form.cantidad,
      cantidad_solicitada: form.cantidad,
      fecha_prestamo: form.fecha_prestamo,
      hora_prestamo: form.hora_prestamo || null,
      deposito: form.deposito ? parseFloat(form.deposito) : null,
      deposito_pagado: form.deposito_pagado,
      entregado_por: form.entregado_por || null,
      observaciones: form.observaciones || null,
      estado: 'prestado',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  /** Entrega un préstamo pedido con una reserva (quedó 'solicitado'). */
  async function entregar(p: PrestamoEquipo) {
    const result = await openPromptDialog({
      title: `Entregar ${p.equipo_nombre}`,
      description: `Pedido: ${p.cantidad}. Indica cuánto se entrega (0 = no se entregó) y quién lo entrega; la fecha y hora las sella el sistema.`,
      fields: [
        { name: 'cantidad', label: 'Cantidad entregada', type: 'number', min: 0, initialValue: String(p.cantidad), required: true, autoFocus: true },
        { name: 'entregado_por', label: 'Entregado por', placeholder: 'Nombre del encargado' },
        { name: 'observaciones', label: 'Observaciones', control: 'textarea', rows: 2, placeholder: 'Estado del equipo al entregar' },
      ],
      submitText: 'Registrar entrega',
      validate: d => (d.cantidad === '' || Number(d.cantidad) < 0) ? 'Indica la cantidad (0 si no se entregó).' : null,
    })
    if (!result) return
    const { data, error } = await entregarPrestamos(
      [{ id: p.id, cantidad: Number(result.cantidad) }], result.entregado_por, result.observaciones,
    )
    if (error) return notify({ variant: 'error', title: 'No se registró la entrega', text: error.message })
    notify({ variant: 'success', title: data?.cancelados ? 'Solicitud cerrada sin entrega' : 'Entrega registrada', duration: 1800 })
    onRefresh()
  }

  /** Recibe un préstamo en circulación: cuánto volvió, en qué estado y qué cuesta lo que faltó. */
  async function recibir(p: PrestamoEquipo) {
    const costo = p.costo_reposicion_unitario != null ? Number(p.costo_reposicion_unitario) : null
    const result = await openPromptDialog({
      title: `Recibir ${p.equipo_nombre}`,
      description: `Entregado: ${p.cantidad}${costo != null ? ` · reposición ${moneda} ${costo.toFixed(2)} c/u` : ''}. Si falta algo, la reposición se calcula con el costo congelado al prestar; puedes indicar otro monto.`,
      fields: [
        { name: 'cantidad_devuelta', label: `Cantidad devuelta (de ${p.cantidad})`, type: 'number', min: 0, max: p.cantidad, initialValue: String(p.cantidad), required: true, autoFocus: true },
        {
          name: 'estado', label: 'Estado al recibir', control: 'select', initialValue: 'devuelto',
          options: [
            { value: 'devuelto', label: 'Devuelto completo y en buen estado' },
            { value: 'dañado', label: 'Dañado' },
            { value: 'perdido', label: 'Perdido (faltan unidades)' },
          ],
        },
        {
          name: 'monto_reposicion', label: `Reposición (${moneda})`, type: 'number', min: 0, step: 0.01,
          placeholder: costo != null ? `Vacío = faltantes × ${moneda} ${costo.toFixed(2)}` : 'Vacío = sin reposición',
          helpText: 'Lo que la unidad debe por lo que faltó o se dañó.',
        },
        { name: 'observaciones', label: 'Observaciones de la devolución', control: 'textarea', rows: 2, placeholder: 'Daños, limpieza, piezas faltantes…' },
        { name: 'recibido_por', label: 'Recibido por', placeholder: 'Nombre del encargado' },
        ...(p.unidad_id ? [{ name: 'generar_cargo', label: 'Generar cargo a la unidad por la reposición (si la hay)', control: 'checkbox' as const }] : []),
      ],
      submitText: 'Registrar recepción',
      validate: d => {
        const n = Number(d.cantidad_devuelta)
        if (d.cantidad_devuelta === '' || Number.isNaN(n) || n < 0 || n > p.cantidad) return `La cantidad devuelta debe estar entre 0 y ${p.cantidad}.`
        if (d.monto_reposicion !== '' && Number(d.monto_reposicion) < 0) return 'La reposición no puede ser negativa.'
        return null
      },
    })
    if (!result) return
    const { data, error } = await recibirPrestamos(
      [{
        id: p.id,
        cantidad_devuelta: Number(result.cantidad_devuelta),
        estado: result.estado as 'devuelto' | 'dañado' | 'perdido',
        monto_reposicion: result.monto_reposicion !== '' && result.monto_reposicion != null ? Number(result.monto_reposicion) : null,
        observaciones: result.observaciones || null,
      }],
      result.recibido_por,
      result.generar_cargo === 'true',
    )
    if (error) return notify({ variant: 'error', title: 'No se registró la recepción', text: error.message })
    const monto = Number(data?.monto_reposicion ?? 0)
    notify({
      variant: 'success', title: 'Recepción registrada', duration: 2600,
      text: monto > 0 ? `Reposición ${moneda} ${monto.toFixed(2)}${data?.cuota_id ? ' · cargo generado a la unidad' : ''}` : 'El equipo volvió completo.',
    })
    onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar registro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('prestamos_equipo', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  function reservaDe(p: PrestamoEquipo): ReservaAmenidad | undefined {
    return p.reserva_id ? reservas.find(r => r.id === p.reserva_id) : undefined
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Préstamo de Equipos</h2>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>El equipo que los residentes piden al reservar una amenidad aparece aquí como «Solicitado» hasta que se entrega.</span>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Préstamo
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Activos (prestados)', value: activos,                   color: 'var(--at-warning)' },
          { label: 'Por entregar',        value: porEntregar,               color: porEntregar > 0 ? 'var(--at-primary)' : 'var(--at-ink-3)' },
          { label: 'Total histórico',     value: prestamos.length,          color: 'var(--at-ink)' },
          { label: 'Con depósito',        value: conDeposito,               color: 'var(--at-accent)' },
          { label: 'Dañados/Perdidos',    value: prestamos.filter(p => p.estado === 'dañado' || p.estado === 'perdido').length, color: 'var(--at-danger)' },
          { label: 'Reposición por cobrar', value: `${moneda} ${reposicionPendiente.toFixed(2)}`, color: reposicionPendiente > 0 ? 'var(--at-danger-strong)' : 'var(--at-ink-3)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo préstamo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
            <div>
              <label style={labelStyle} htmlFor="prestamo-unidad">Unidad *</label>
              <select id="prestamo-unidad" style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            {!sinInventario && (
              <div style={{ gridColumn: 'span 2' }}>
                <label style={labelStyle} htmlFor="prestamo-equipo">Equipo del inventario *</label>
                <select id="prestamo-equipo" style={inputStyle} value={form.inventario_id} onChange={e => elegirEquipo(e.target.value)} autoFocus>
                  <option value="">— Elegir del inventario —</option>
                  {prestables.map(i => {
                    const disp = disponibilidadEquipo(i, prestamos, form.fecha_prestamo)
                    return (
                      <option key={i.id} value={i.id}>
                        {CATEGORIA_ICON[i.categoria] ?? '📋'} {i.nombre} · {Math.max(0, disp)} disponible{disp === 1 ? '' : 's'}{i.estado === 'en_reparacion' ? ' (en reparación)' : ''}
                      </option>
                    )
                  })}
                  <option value={OTRO}>Otro (no inventariado)</option>
                </select>
                {itemSel && (
                  <div style={{ fontSize: 11, color: (disponible ?? 0) > 0 ? 'var(--at-ink-3)' : 'var(--at-danger)', marginTop: 3 }}>
                    {Math.max(0, disponible ?? 0)} de {itemSel.cantidad} disponible(s) para el {form.fecha_prestamo}
                    {itemSel.costo_unitario != null && ` · reposición ${moneda} ${Number(itemSel.costo_unitario).toFixed(2)} c/u`}
                    {itemSel.prestable_con_costo && itemSel.costo_renta_unidad != null && <strong style={{ color: 'var(--at-primary-hover)' }}>{` · renta ${moneda} ${Number(itemSel.costo_renta_unidad).toFixed(2)} c/u`}</strong>}
                  </div>
                )}
              </div>
            )}
            {(sinInventario || form.inventario_id === OTRO) && (
              <div>
                <label style={labelStyle} htmlFor="prestamo-nombre">Equipo *</label>
                <input id="prestamo-nombre" style={inputStyle} list="equipos-list" value={form.equipo_nombre}
                  onChange={e => setF('equipo_nombre', e.target.value)} placeholder="Ej: Sillas, Proyector…" autoFocus={sinInventario} />
                <datalist id="equipos-list">{EQUIPOS_COMUNES.map(e => <option key={e} value={e} />)}</datalist>
              </div>
            )}
            <div>
              <label style={labelStyle} htmlFor="prestamo-cantidad">Cantidad</label>
              <input id="prestamo-cantidad" style={inputStyle} type="number" min="1" max={disponible != null ? Math.max(0, disponible) : undefined} value={form.cantidad} onChange={e => setF('cantidad', parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="prestamo-fecha">Fecha préstamo</label>
              <input id="prestamo-fecha" style={inputStyle} type="date" value={form.fecha_prestamo} onChange={e => setF('fecha_prestamo', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="prestamo-hora">Hora</label>
              <input id="prestamo-hora" style={inputStyle} type="time" value={form.hora_prestamo} onChange={e => setF('hora_prestamo', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="prestamo-deposito">Depósito</label>
              <input id="prestamo-deposito" style={inputStyle} type="number" min="0" step="0.01" value={form.deposito} onChange={e => setF('deposito', e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
              <input type="checkbox" checked={form.deposito_pagado} onChange={e => setF('deposito_pagado', e.target.checked)} id="dep_pagado" />
              <label htmlFor="dep_pagado" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Depósito pagado</label>
            </div>
            <div>
              <label style={labelStyle} htmlFor="prestamo-entregado">Entregado por</label>
              <input id="prestamo-entregado" style={inputStyle} value={form.entregado_por} onChange={e => setF('entregado_por', e.target.value)} placeholder="Nombre del encargado" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle} htmlFor="prestamo-obs">Observaciones</label>
              <input id="prestamo-obs" style={inputStyle} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Estado del equipo, condiciones, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {(['all','solicitado','prestado','devuelto','dañado','perdido','cancelado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e as EstadoPrestamo | 'all')}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
              background: filtroEstado === e ? 'var(--at-ink)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'white' : 'var(--at-ink-3)',
              borderColor: filtroEstado === e ? 'var(--at-ink)' : 'var(--at-line)' }}>
            {e === 'all' ? 'Todos' : ESTADO_STYLE[e as EstadoPrestamo]?.label ?? e}
          </button>
        ))}
      </div>

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<PrestamoEquipo>
        data={filtered}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'fecha_prestamo', direction: 'desc' }}
        emptyState={{ icon: '📋', title: 'No hay préstamos registrados' }}
        columns={[
          { key: 'equipo_nombre', header: 'Equipo', sortable: true,
            render: (p) => {
              const res = reservaDe(p)
              return (
                <div style={{ fontWeight: 600 }}>
                  {p.equipo_nombre}
                  {!p.inventario_id && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--at-ink-3)' }}>(sin inventario)</span>}
                  {res && (
                    <div style={{ fontSize: 11, color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                      📅 Reserva {res.amenidad_nombre ?? 'amenidad'} · {res.fecha} {res.hora_inicio}–{res.hora_fin}
                    </div>
                  )}
                  {!res && p.reserva_id && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 500 }}>📅 Pedido con una reserva</div>}
                  {p.estado !== 'cancelado' && p.monto_renta != null && Number(p.monto_renta) > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--at-primary-hover)', fontWeight: 600 }} title={p.cuota_renta_id ? 'Renta cargada a la unidad' : 'Renta sin cargo propio'}>
                      💲 Renta {moneda} {Number(p.monto_renta).toFixed(2)}{p.cuota_renta_id ? ' ✓' : ''}
                    </div>
                  )}
                  {p.observaciones && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 400 }}>{p.observaciones}</div>}
                  {p.observaciones_devolucion && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 400 }}>↩ {p.observaciones_devolucion}</div>}
                </div>
              )
            } },
          { key: 'unidad_nombre', header: 'Unidad', sortable: true,
            accessor: (p) => p.unidad_nombre ?? '',
            render: (p) => <span style={{ color: 'var(--at-ink-3)' }}>{p.unidad_nombre ?? '—'}</span> },
          { key: 'cantidad', header: 'Qty', align: 'center', sortable: true, hideOnMobile: true,
            render: (p) => {
              const falt = faltantes(p)
              if (!prestamoCerrado(p)) return p.cantidad
              return (
                <div>
                  <span>{p.cantidad_devuelta ?? p.cantidad}/{p.cantidad}</span>
                  {falt > 0 && <div style={{ fontSize: 10, color: 'var(--at-danger)', fontWeight: 700 }}>faltan {falt}</div>}
                </div>
              )
            } },
          { key: 'fecha_prestamo', header: 'F. Préstamo', sortable: true,
            render: (p) => <span style={{ color: 'var(--at-ink-3)' }}>{p.fecha_prestamo}{p.hora_prestamo ? ` ${p.hora_prestamo.slice(0, 5)}` : ''}</span> },
          { key: 'fecha_devolucion', header: 'F. Devolución', sortable: true, hideOnMobile: true,
            accessor: (p) => p.fecha_devolucion ?? '',
            render: (p) => p.fecha_devolucion ? <span style={{ color: 'var(--at-ink-3)' }}>{p.fecha_devolucion}</span> : <span style={{ color: 'var(--at-line-strong)' }}>—</span> },
          { key: 'deposito', header: 'Depósito', align: 'right', sortable: true, hideOnMobile: true,
            accessor: (p) => p.deposito ?? 0,
            render: (p) => p.deposito ? (
              <span style={{ fontSize: 12, color: p.deposito_pagado ? 'var(--at-success)' : 'var(--at-warning)', fontWeight: 600 }}>
                {p.deposito_pagado ? '✓' : '!'} {p.deposito.toFixed(2)}
              </span>
            ) : <span style={{ color: 'var(--at-line-strong)' }}>—</span> },
          { key: 'monto_reposicion', header: 'Reposición', align: 'right', sortable: true, hideOnMobile: true,
            accessor: (p) => Number(p.monto_reposicion ?? 0),
            render: (p) => p.monto_reposicion != null && Number(p.monto_reposicion) > 0 ? (
              <span style={{ fontSize: 12, color: 'var(--at-danger-strong)', fontWeight: 700 }} title={p.cuota_reposicion_id ? 'Cargo generado a la unidad' : 'Sin cargo a la unidad'}>
                {moneda} {Number(p.monto_reposicion).toFixed(2)}{p.cuota_reposicion_id ? ' ✓' : ''}
              </span>
            ) : <span style={{ color: 'var(--at-line-strong)' }}>—</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (p) => {
              const es = ESTADO_STYLE[p.estado] ?? ESTADO_STYLE.prestado
              return <span style={{ background: es.bg, color: es.color, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{es.label}</span>
            } },
          { key: 'actions', header: '', align: 'right',
            render: (p) => (canEdit || canDelete) ? (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {canEdit && p.estado === 'solicitado' && (
                  <button onClick={(e) => { e.stopPropagation(); entregar(p) }}
                    style={{ padding: '3px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    📦 Entregar
                  </button>
                )}
                {canEdit && p.estado === 'prestado' && (
                  <button onClick={(e) => { e.stopPropagation(); recibir(p) }}
                    style={{ padding: '3px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    ✓ Recibir
                  </button>
                )}
                {canDelete && (
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }} aria-label="Eliminar préstamo"
                    style={{ padding: '3px 7px', background: 'var(--at-chip)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer', color: 'var(--at-ink-3)' }}>🗑️</button>
                )}
              </div>
            ) : null },
        ] satisfies DataTableColumn<PrestamoEquipo>[]}
      />
    </div>
  )
}
