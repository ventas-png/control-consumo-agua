import { useState, useMemo, useRef } from 'react'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { deleteCondominioRowAfectando, updateCondominioRowAfectando } from '../../../domain/condominios/tabMutations'
import { OrdenCompra, ContratoProveedor } from '../../../types'
import { useProveedoresQuery } from '../../../domain/cxp/queries'
import { useAsignacionesQuery } from '../../../domain/proveedores/queries'
import { useInsumosAlmacenQuery } from '../../../domain/compras/queries'
import { crearOrdenTransaccional } from '../../../domain/compras/mutations'
import { mensajeCrearOrden, nuevaClaveIdempotencia } from '../../../domain/compras/ordenCrear'
import { ordenCompraLineaSchema } from '../../../domain/compras/schemas'
import { DURACION_ERROR_LARGO_MS, mensajeAccionCompras } from '../../../domain/compras/errores'
import type { ProveedorCatalogo } from '../../../types/proveedores'
import { ProveedorSelector } from '../../proveedores/ProveedorSelector'
import { SeguimientoOrdenModal } from '../../compras/SeguimientoOrdenModal'
import { SeguimientoComprasPanel } from '../../compras/SeguimientoComprasPanel'
import { ImportarLineasOrdenModal } from '../../compras/ImportarLineasOrdenModal'
import { LineasOrdenEditor, lineasParaServidor, type LineaForm } from '../../compras/LineasOrdenEditor'
import { useTransicionOrdenConContrato } from '../../compras/excepcionContrato'
import { ContratoSelector } from '../../proveedores/ContratoSelector'
import { ContratoSeguimientoModal } from '../../proveedores/ContratoSeguimientoModal'
import { usePermisosProveedor } from '../../proveedores/permisos'
import { tint } from '../../shared/statusTone'
import { EditModal } from '../../shared/EditModal'

interface Props {
  ordenes: OrdenCompra[]
  proveedores: ContratoProveedor[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type EstadoOC = OrdenCompra['estado']

const ESTADO_CFG: Record<EstadoOC, { label: string; color: string; bg: string; next?: EstadoOC; nextLabel?: string }> = {
  borrador:  { label: 'Borrador',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)', next: 'aprobada',  nextLabel: 'Aprobar' },
  aprobada:  { label: 'Aprobada',   color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', next: 'emitida',   nextLabel: 'Emitir OC' },
  // Una orden emitida ya NO se marca «recibida» a mano: la recepción por línea
  // (Compras → Recibir) la mueve a `recibida_parcial` / `recibida`, y la factura
  // la cierra. El servidor rechaza el cambio manual.
  emitida:   { label: 'Emitida',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  // `recibida_parcial` y `cerrada` los pone la contabilidad (Compras → recepción
  // y factura). Sin entrada aquí, `ESTADO_CFG[orden.estado]` sería `undefined`
  // y la tarjeta reventaba en cuanto una orden pasara por el riel nuevo.
  recibida_parcial: { label: 'Recibida parcial', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  recibida:  { label: 'Recibida',   color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cerrada:   { label: 'Cerrada',    color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelada: { label: 'Cancelada',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const BLANK = {
  proveedor_id: '', proveedor_nombre: '', contrato_id: '', concepto: '', descripcion: '', monto_estimado: '',
  fecha_entrega_esperada: '', notas: '',
}

// `proveedores` (contratos_proveedores) sigue en Props porque el registro de
// pestañas lo pasa, pero esta pantalla ya no lo usa: el proveedor de una orden
// sale del catálogo de Contabilidad, que es el único que sabe de autorizaciones.
/**
 * El servidor solo borra un borrador que nunca tuvo efecto: sin número, sin revisiones (nunca se devolvió) y sin
 * aprobación previa. Un borrador devuelto se cancela (con motivo), no se borra: no se ofrece un botón que va a fallar.
 */
export function sePuedeEliminar(orden: Pick<OrdenCompra, 'numero' | 'revision' | 'aprobada_at'>): boolean {
  return !orden.numero && !((orden.revision ?? 0) > 0) && !orden.aprobada_at
}

export default function OrdenesCompraTab({ ordenes, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoOC | ''>('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  // La ficha abre en ventana al pulsar la tarjeta. Se guarda el id y no la fila:
  // tras aprobar, emitir o editar, la ficha muestra la orden recargada.
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const detalle = detalleId ? ordenes.find(o => o.id === detalleId) ?? null : null
  // Renglones de la orden NUEVA (opcionales aquí: también se cargan después con «Importar renglones»). La clave de
  // idempotencia es por apertura del formulario: un doble clic o un reintento devuelven la MISMA orden.
  const [lineas, setLineas] = useState<LineaForm[]>([])
  const claveIdempotencia = useRef(nuevaClaveIdempotencia('oc'))
  const enviando = useRef(false)
  const { data: insumos = [], isLoading: cargandoInsumos } = useInsumosAlmacenQuery(companyId, proyectoId)

  // Catálogo de Contabilidad (no `contratos_proveedores`, que es otra lista).
  const { data: catalogo = [] } = useProveedoresQuery(companyId)
  const { data: asignaciones = [] } = useAsignacionesQuery(companyId, proyectoId)
  const [seguirDe, setSeguirDe] = useState<string | null>(null)
  const [vistaOc, setVistaOc] = useState<'ordenes' | 'seguimiento'>('ordenes')
  const [importarEn, setImportarEn] = useState<OrdenCompra | null>(null)
  const [seguirContrato, setSeguirContrato] = useState<string | null>(null)
  // Aprobar y emitir una orden con contrato exigen que siga vigente; quien tiene el permiso de cambio de estado
  // de Contabilidad puede autorizar una excepción (con motivo). El servidor decide.
  const permisos = usePermisosProveedor()
  const transicionar = useTransicionOrdenConContrato(permisos.cambiarEstado)
  // El servidor exige un permiso distinto por paso (aprobar y devolver → «Autorizar / Denegar — Órdenes compra»;
  // emitir y cancelar → «Cambiar estado»), y los dos exigen además «Editar» de Contabilidad (la política de UPDATE):
  // aquí solo se ofrece lo que el servidor va a aceptar (`usePermisosProveedor` → `decidirPasosCompras`). Si aun así no
  // cambia ninguna fila, se avisa (nunca «éxito» sin cambio).
  const puedeAvanzar = (siguiente: EstadoOC) => (siguiente === 'aprobada' ? permisos.puedeAprobarOrdenCompra : permisos.puedeCambiarEstadoPaso)

  const filtradas = filtroEstado ? ordenes.filter(o => o.estado === filtroEstado) : ordenes

  // Se cuenta recorriendo ESTADO_CFG en vez de enumerar los estados a mano: así
  // agregar uno nuevo al ciclo no vuelve a dejar una tarjeta sin su conteo.
  const totalesPorEstado = useMemo(() => {
    const base = Object.fromEntries(
      (Object.keys(ESTADO_CFG) as EstadoOC[]).map(e => [e, 0]),
    ) as Record<EstadoOC, number>
    for (const o of ordenes) {
      if (o.estado in base) base[o.estado] += 1
    }
    return base
  }, [ordenes])

  // El estimado de la cabecera o, si la orden trae renglones y no estimado, el total que calculó el servidor.
  const montoDe = (o: OrdenCompra) => o.monto_estimado || o.total || 0
  const montoTotal = ordenes.filter(o => o.estado !== 'cancelada').reduce((s, o) => s + montoDe(o), 0)

  function abrirNueva() {
    claveIdempotencia.current = nuevaClaveIdempotencia('oc')
    setEditId(null); setForm({ ...BLANK }); setLineas([]); setShowForm(true)
  }

  async function guardar() {
    if (!form.concepto.trim() || !form.proveedor_id) {
      notify({ variant: 'warning', title: 'Campos requeridos', text: 'Elige un proveedor autorizado y escribe el concepto.' }); return
    }
    if (enviando.current) return
    enviando.current = true
    setSaving(true)
    try {
      if (editId) {
        // Editar el borrador solo toca la cabecera (los renglones se corrigen con la importación o en Contabilidad).
        const { error } = await updateCondominioRowAfectando('ordenes_compra', editId, {
          company_id: companyId, project_id: proyectoId,
          proveedor_id: form.proveedor_id,
          contrato_id: form.contrato_id || null,
          proveedor_nombre: form.proveedor_nombre.trim(),
          concepto: form.concepto.trim(),
          descripcion: form.descripcion.trim() || null,
          monto_estimado: form.monto_estimado ? parseFloat(form.monto_estimado) : null,
          fecha_entrega_esperada: form.fecha_entrega_esperada || null,
          notas: form.notas.trim() || null,
          estado: 'borrador' as EstadoOC,
        })
        if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
      } else {
        // Orden NUEVA: cabecera y renglones en UNA operación del servidor (todo o nada, idempotente por clave).
        const renglones = lineasParaServidor(lineas)
        const validos = ordenCompraLineaSchema.array().safeParse(renglones)
        if (!validos.success) {
          notify({ variant: 'warning', title: 'Revisa los renglones', text: validos.error.issues[0]?.message ?? 'Datos inválidos.' }); return
        }
        if (validos.data.some((l) => l.destino_tipo === 'inventario' && !l.suministro_id)) {
          notify({ variant: 'warning', title: 'Revisa los renglones', text: 'Las líneas con destino Inventario deben apuntar a un insumo del almacén' }); return
        }
        await crearOrdenTransaccional(companyId, proyectoId, {
          proveedor_id: form.proveedor_id,
          contrato_id: form.contrato_id || null,
          concepto: form.concepto.trim(),
          descripcion: form.descripcion.trim() || null,
          monto_estimado: form.monto_estimado ? parseFloat(form.monto_estimado) : null,
          fecha_entrega_esperada: form.fecha_entrega_esperada || null,
          fecha_requerida: null,
          notas: form.notas.trim() || null,
          lineas: validos.data,
          clave_idempotencia: claveIdempotencia.current,
        })
      }
      setShowForm(false); setEditId(null); setForm({ ...BLANK }); setLineas([]); onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: mensajeCrearOrden(e) })
    } finally {
      enviando.current = false
      setSaving(false)
    }
  }

  async function avanzarEstado(orden: OrdenCompra) {
    const cfg = ESTADO_CFG[orden.estado]
    if (!cfg.next) return
    const updates: Partial<OrdenCompra> = { estado: cfg.next }
    const ejecutar = async () => {
      const { error } = await updateCondominioRowAfectando('ordenes_compra', orden.id, updates)
      // El SQLSTATE viaja con el error: el traductor distingue los dos COMPRAS_ALCANCE_PROYECTO del servidor por él.
      if (error) throw Object.assign(new Error(error.message), { code: error.code })
    }
    try {
      if (orden.contrato_id && (cfg.next === 'aprobada' || cfg.next === 'emitida')) {
        const r = await transicionar({ ordenId: orden.id, etapa: cfg.next === 'aprobada' ? 'aprobar' : 'emitir', ejecutar })
        if (r === 'excepcion') notify({ variant: 'success', title: 'Excepción autorizada', text: 'Quedó registrada a tu nombre, con el motivo, en el historial de la orden.' })
      } else {
        await ejecutar()
      }
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo', duration: DURACION_ERROR_LARGO_MS, text: mensajeAccionCompras(e) })
      return
    }
    onRefresh()
  }

  async function devolverABorrador(orden: OrdenCompra) {
    const r = await openPromptDialog({
      title: 'Devolver a borrador',
      description: 'La aprobación se invalida y la orden se vuelve a revisar (nueva revisión); queda escrito por qué.',
      fields: [{ name: 'motivo', label: '¿Qué hay que corregir?', control: 'textarea', rows: 2, required: true }],
      submitText: 'Devolver',
    })
    const motivo = r?.motivo?.trim()
    if (!motivo) return
    const { error } = await updateCondominioRowAfectando('ordenes_compra', orden.id, { estado: 'borrador', motivo_devolucion: motivo })
    if (error) { notify({ variant: 'error', title: 'No se pudo', duration: DURACION_ERROR_LARGO_MS, text: mensajeAccionCompras(error) }); return }
    onRefresh()
  }

  async function cancelar(orden: OrdenCompra) {
    const r = await confirm({ title: '¿Cancelar orden?', text: orden.concepto, icon: 'warning', variant: 'danger', confirmText: 'Cancelar OC' })
    if (!r.isConfirmed) return
    const { error } = await updateCondominioRowAfectando('ordenes_compra', orden.id, { estado: 'cancelada' })
    if (error) { notify({ variant: 'error', title: 'No se pudo', duration: DURACION_ERROR_LARGO_MS, text: mensajeAccionCompras(error) }); return }
    onRefresh()
  }

  async function eliminar(orden: OrdenCompra) {
    const r = await confirm({ title: '¿Eliminar borrador?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRowAfectando('ordenes_compra', orden.id)
    if (error) { notify({ variant: 'error', title: 'No se pudo', text: error.message }); return }
    setDetalleId(null)
    onRefresh()
  }

  // Cancelar cierra sin borrar lo escrito; no se cierra a mitad del guardado.
  function cerrarForm() { if (!saving) { setShowForm(false); setEditId(null) } }

  function abrirEdicion(orden: OrdenCompra) {
    setEditId(orden.id)
    setForm({ proveedor_id: orden.proveedor_id ?? '', proveedor_nombre: orden.proveedor_nombre, contrato_id: orden.contrato_id ?? '', concepto: orden.concepto, descripcion: orden.descripcion ?? '', monto_estimado: String(orden.monto_estimado ?? ''), fecha_entrega_esperada: orden.fecha_entrega_esperada ?? '', notas: orden.notas ?? '' })
    setShowForm(true)
  }

  const fmtMonto = (n: number) => `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}`

  const botonVista = (v: 'ordenes' | 'seguimiento', texto: string) => (
    <button onClick={() => setVistaOc(v)} aria-pressed={vistaOc === v}
      style={{ padding: '6px 14px', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
               background: vistaOc === v ? 'var(--at-primary)' : 'var(--at-surface)', color: vistaOc === v ? 'white' : 'var(--at-ink)' }}>
      {texto}
    </button>
  )

  if (vistaOc === 'seguimiento') {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {botonVista('ordenes', 'Órdenes')}
          {botonVista('seguimiento', 'Seguimiento')}
        </div>
        <SeguimientoComprasPanel companyId={companyId} projectId={proyectoId} monedaBase={moneda} />
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {botonVista('ordenes', 'Órdenes')}
        {botonVista('seguimiento', 'Seguimiento')}
      </div>
      {/* KPIs */}
      {/* auto-fit en vez de 5 columnas fijas: el ciclo pasó de 5 estados a 7 y
          las tarjetas se salían de la fila en pantallas angostas. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8, marginBottom: 16 }}>
        {(Object.keys(ESTADO_CFG) as EstadoOC[]).map(e => {
          const cfg = ESTADO_CFG[e]
          return (
            <div key={e} onClick={() => setFiltroEstado(filtroEstado === e ? '' : e)}
              style={{ background: filtroEstado === e ? cfg.bg : 'var(--at-surface)', border: `1.5px solid ${filtroEstado === e ? cfg.color : 'var(--at-line)'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>{totalesPorEstado[e]}</div>
              <div style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
          Total comprometido: <strong style={{ color: 'var(--at-ink)' }}>{moneda} {montoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}</strong>
          {filtroEstado && <span> · Filtrando: {ESTADO_CFG[filtroEstado].label} ({filtradas.length})</span>}
        </div>
        {canCreate && (
          <button onClick={abrirNueva}
            style={{ padding: '6px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + Nueva OC
          </button>
        )}
      </div>

      {importarEn && (
        <ImportarLineasOrdenModal
          orden={{ id: importarEn.id, numero: importarEn.numero ?? null, concepto: importarEn.concepto }}
          monedaBase={moneda}
          onClose={() => { setImportarEn(null); onRefresh() }}
        />
      )}

      {seguirContrato && <ContratoSeguimientoModal contratoId={seguirContrato} onClose={() => setSeguirContrato(null)} />}
      {seguirDe && <SeguimientoOrdenModal ordenId={seguirDe} monedaBase={moneda} onClose={() => setSeguirDe(null)} />}

      {/* Lista: una tarjeta por orden. Pulsarla abre la ficha en ventana
          (antes se desplegaba dentro de la tarjeta, en acordeón). */}
      {filtradas.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🛒</div>
          No hay órdenes de compra{filtroEstado ? ` en estado "${ESTADO_CFG[filtroEstado].label}"` : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtradas.map((orden) => {
            const cfg = ESTADO_CFG[orden.estado]
            return (
              <div key={orden.id} role="button" tabIndex={0} aria-label={orden.concepto}
                onClick={() => setDetalleId(orden.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetalleId(orden.id) } }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', background: 'var(--at-surface)', border: `1px solid ${tint(cfg.color, 20)}`, borderRadius: 10, borderLeft: `4px solid ${cfg.color}` }}>
                {/* El número REAL de la orden (el mismo en Contabilidad y en el seguimiento), no un contador por posición en la lista. */}
                <div style={{ minWidth: 76, fontSize: 10, color: 'var(--at-ink-3)', fontWeight: 600, flexShrink: 0 }}>{orden.numero ?? 'Sin número'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--at-ink)' }}>{orden.concepto}</div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{orden.proveedor_nombre}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {montoDe(orden) > 0 && (
                    <div style={{ fontWeight: 700, fontSize: 13, color: cfg.color }}>{fmtMonto(montoDe(orden))}</div>
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: cfg.bg, color: cfg.color, borderRadius: 6 }}>{cfg.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ficha en ventana (pantalla completa en el teléfono): datos y acciones
          de la orden. Los pasos del ciclo (aprobar, emitir) y Editar van en el
          pie; devolver, cancelar, eliminar e importar renglones, en el cuerpo. */}
      {detalle && (() => {
        const orden = detalle
        const cfg = ESTADO_CFG[orden.estado]
        const siguiente = cfg.next
        const datos: { label: string; value: string; color?: string }[] = [
          { label: orden.monto_estimado ? 'Monto estimado' : 'Total de los renglones', value: montoDe(orden) > 0 ? fmtMonto(montoDe(orden)) : '—', color: cfg.color },
          { label: 'Monto real', value: orden.monto_real ? fmtMonto(orden.monto_real) : '—' },
          { label: 'Entrega esperada', value: orden.fecha_entrega_esperada || '—' },
          { label: 'Recibido', value: orden.estado === 'recibida' ? '✓ Sí' : orden.estado === 'recibida_parcial' ? 'Parcial' : '—', color: orden.estado === 'recibida' ? 'var(--at-success)' : undefined },
          ...((orden.revision ?? 0) > 0 ? [{ label: 'Revisión', value: String(orden.revision) }] : []),
        ]
        const puedeDevolver = canEdit && permisos.puedeAprobarOrdenCompra && orden.estado === 'aprobada'
        const puedeCancelar = canEdit && permisos.puedeCambiarEstadoPaso && (orden.estado === 'borrador' || orden.estado === 'aprobada')
        const puedeBorrar = canEdit && orden.estado === 'borrador' && sePuedeEliminar(orden)
        const puedeImportar = canCreate && orden.estado === 'borrador'
        return (
          <EditModal
            title={orden.concepto}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '2px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: cfg.bg, color: cfg.color, borderRadius: 6 }}>{cfg.label}</span>
                <span>{orden.numero ?? 'Sin número'}</span>
                <span>· {orden.proveedor_nombre}</span>
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
                <button type="button" onClick={() => setDetalleId(null)}
                  style={{ padding: '8px 14px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
                  Cerrar
                </button>
                <button type="button" onClick={() => setSeguirDe(orden.id)}
                  style={{ padding: '8px 14px', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 13, background: 'var(--at-surface)' }}>
                  Seguimiento
                </button>
                {canEdit && orden.estado === 'borrador' && (
                  <button type="button" onClick={() => abrirEdicion(orden)}
                    style={{ padding: '8px 14px', border: '1px solid var(--at-line-strong)', borderRadius: 7, cursor: 'pointer', fontSize: 13, background: 'var(--at-surface)', color: 'var(--at-ink)' }}>
                    ✏️ Editar
                  </button>
                )}
                {canEdit && siguiente && puedeAvanzar(siguiente) && (
                  <button type="button" onClick={() => avanzarEstado(orden)}
                    style={{ padding: '8px 16px', background: ESTADO_CFG[siguiente].bg, color: ESTADO_CFG[siguiente].color, border: `1px solid ${tint(ESTADO_CFG[siguiente].color, 40)}`, borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    → {cfg.nextLabel}
                  </button>
                )}
              </div>
            }
          >
            {orden.contrato_id && (
              <div data-testid={`orden-contrato-${orden.id}`} style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--at-ink-2)' }}>
                🤝 Amparada en un contrato{' '}
                <button type="button" onClick={() => setSeguirContrato(orden.contrato_id ?? null)}
                  style={{ border: 'none', background: 'none', color: 'var(--at-primary)', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}>
                  ver seguimiento del contrato
                </button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              {datos.map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: d.color ?? 'var(--at-ink)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>
            {(orden.descripcion || orden.notas) && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>
                {orden.descripcion && <div>{orden.descripcion}</div>}
                {orden.notas && <div style={{ marginTop: orden.descripcion ? 6 : 0 }}>📝 {orden.notas}</div>}
              </div>
            )}
            {(puedeImportar || puedeDevolver || puedeCancelar || puedeBorrar) && (
              <div style={{ paddingTop: 12, borderTop: '1px solid var(--at-line)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Otras acciones</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {puedeImportar && (
                    <button type="button" onClick={() => setImportarEn(orden)}
                      style={{ padding: '6px 12px', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: 'var(--at-surface)' }}>
                      Importar renglones
                    </button>
                  )}
                  {puedeDevolver && (
                    <button type="button" onClick={() => devolverABorrador(orden)}
                      style={{ padding: '6px 12px', border: '1px solid var(--at-line)', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: 'var(--at-surface-2)' }}>
                      Devolver a borrador
                    </button>
                  )}
                  {puedeCancelar && (
                    <button type="button" onClick={() => cancelar(orden)}
                      style={{ padding: '6px 12px', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>
                      Cancelar OC
                    </button>
                  )}
                  {puedeBorrar && (
                    <button type="button" onClick={() => eliminar(orden)}
                      style={{ padding: '6px 12px', border: '1px solid var(--at-danger-border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: 'var(--at-danger-tint)', color: 'var(--at-danger)' }}>
                      🗑 Eliminar
                    </button>
                  )}
                </div>
              </div>
            )}
          </EditModal>
        )
      })()}

      {/* Formulario en ventana (antes se desplegaba entre los KPIs y la lista).
          Va DESPUÉS de la ficha en el árbol porque Editar lo abre desde ella;
          como se monta después, queda encima (EditModal apila por montaje). */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar orden' : 'Nueva orden de compra'}
          size="lg"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <button type="button" onClick={cerrarForm} disabled={saving}
              style={{ padding: '8px 14px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={saving}
              style={{ padding: '8px 18px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : 'Guardar como borrador'}
            </button>
          </>}
        >
          <div className="at-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              {/* El proveedor se elige del CATÁLOGO COMPARTIDO por su id (nunca texto
                  libre) y solo aparecen los habilitados HOY en este proyecto: el
                  servidor rechaza aprobar y emitir a cualquier otro, y ofrecerlo
                  aquí sería una trampa. */}
              <ProveedorSelector
                proveedores={catalogo as ProveedorCatalogo[]} asignaciones={asignaciones} projectId={proyectoId}
                value={form.proveedor_id || null} soloHabilitados label="Proveedor autorizado *"
                onChange={(id, p) => setForm(f => ({ ...f, proveedor_id: id ?? '', proveedor_nombre: p?.nombre ?? '', contrato_id: '' }))}
              />
              <div style={{ marginTop: 8 }}>
                <ContratoSelector
                  companyId={companyId} projectId={proyectoId} proveedorId={form.proveedor_id || null}
                  value={form.contrato_id || null}
                  onChange={(id) => setForm(f => ({ ...f, contrato_id: id ?? '' }))}
                />
              </div>
              {catalogo.length === 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--at-ink-3)' }}>
                  No hay proveedores autorizados. Autorízalos en Contabilidad → Proveedores.
                </p>
              )}
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Monto estimado ({moneda})</label>
              <input type="number" value={form.monto_estimado} onChange={e => setForm(f => ({ ...f, monto_estimado: e.target.value }))}
                placeholder="0.00"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Concepto *</label>
            <input value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
              placeholder="Descripción breve de la compra"
              style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div className="at-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fecha entrega esperada</label>
              <input type="date" value={form.fecha_entrega_esperada} onChange={e => setForm(f => ({ ...f, fecha_entrega_esperada: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Observaciones adicionales"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-primary-soft-2)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          {!editId && (
            <div>
              <LineasOrdenEditor
                lineas={lineas} onChange={setLineas} projectId={proyectoId} proveedorId={form.proveedor_id || null}
                monedaBase={moneda} insumos={insumos} cargandoInsumos={cargandoInsumos} minimo={0} titulo="Renglones (opcional)"
              />
              <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--at-ink-3)' }}>
                Se guardan junto con la orden, todo o nada. También puedes cargarlos después con «Importar renglones».
              </p>
            </div>
          )}
        </EditModal>
      )}

    </div>
  )
}
