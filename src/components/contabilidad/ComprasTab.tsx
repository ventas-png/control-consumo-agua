// Compras (Fase 6) — el riel completo dentro de la contabilidad activa.
//
//   proveedor autorizado → orden de compra → recepción → factura → contraseña
//
// Esta pestaña cubre los eslabones que no existían: la orden con líneas, la
// recepción (que es la que contabiliza y mueve inventario/activos) y la
// contraseña de pago. La factura y el pago viven en «Cuentas por pagar», que es
// donde el contador ya los busca.
import { useMemo, useState } from 'react'
import { DataTable, EditModal, type DataTableColumn } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import {
  useActivosFijosQuery,
  useCompromisosQuery,
  useContrasenasQuery,
  useDuplicadosQuery,
  useOrdenCompraLineasQuery,
  useOrdenesCompraQuery,
  useRecepcionesQuery,
} from '../../domain/compras/queries'
import {
  useCambiarEstadoOrdenCompraMutation,
  useCambiarEstadoRecepcionMutation,
  useCrearOrdenCompraMutation,
  useCrearRecepcionMutation,
  useDescartarDuplicadoMutation,
  useEnlazarGastoAFacturaMutation,
} from '../../domain/compras/mutations'
import { ordenCompraFormSchema, pendienteDeRecibir, recepcionFormSchema, totalesOrden } from '../../domain/compras/schemas'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
import { CATEGORIAS_GASTO_CXP } from '../../types/cxp'
import {
  DESTINO_LINEA_LABELS,
  ESTADO_CONTRASENA_LABELS,
  ESTADO_OC_LABELS,
  ESTADO_RECEPCION_LABELS,
  proveedorHabilitado,
  type ActivoFijo,
  type ContrasenaConRelaciones,
  type DestinoLinea,
  type FilaDuplicado,
  type OrdenCompraConRelaciones,
  type RecepcionConRelaciones,
} from '../../types/compras'
import { Campo, btnLink, btnPrimario, btnSecundario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la EMPRESA. */
  projectId: string | null
  monedaBase: string
}

type Vista = 'ordenes' | 'recepciones' | 'contrasenas' | 'activos' | 'compromisos' | 'duplicados'

const TONO_OC = {
  borrador: 'info', aprobada: 'warning', emitida: 'warning',
  recibida_parcial: 'warning', recibida: 'success', cerrada: 'success', cancelada: 'neutral',
} as const
const TONO_REC = { borrador: 'info', registrada: 'success', anulada: 'neutral' } as const
const TONO_CP = { emitida: 'warning', pagada: 'success', anulada: 'neutral' } as const

interface LineaForm {
  descripcion: string
  destino_tipo: DestinoLinea
  categoria: string
  cantidad: string
  unidad: string
  precio_unitario: string
  iva_monto: string
}

const LINEA_VACIA: LineaForm = {
  descripcion: '', destino_tipo: 'gasto', categoria: 'otros',
  cantidad: '1', unidad: 'unidad', precio_unitario: '0', iva_monto: '0',
}

export function ComprasTab({ companyId, projectId, monedaBase }: Props) {
  const { puedeCrear, puedeCambiarEstado, puedeAutorizar } = usePermisosContabilidad()
  const [vista, setVista] = useState<Vista>('ordenes')
  const [nuevaOrden, setNuevaOrden] = useState(false)
  const [recibirDe, setRecibirDe] = useState<OrdenCompraConRelaciones | null>(null)

  const { data: ordenes = [], isLoading: cargandoOrdenes } = useOrdenesCompraQuery(companyId, projectId)
  const { data: recepciones = [], isLoading: cargandoRecepciones } = useRecepcionesQuery(companyId, projectId)
  const { data: contrasenas = [], isLoading: cargandoContrasenas } = useContrasenasQuery(companyId, projectId)
  const { data: activos = [], isLoading: cargandoActivos } = useActivosFijosQuery(companyId, projectId)
  const { data: compromisos = [] } = useCompromisosQuery(companyId, projectId)
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  const { data: duplicados = [], isLoading: cargandoDuplicados } = useDuplicadosQuery(companyId, projectId)

  const cambiarOrden = useCambiarEstadoOrdenCompraMutation()
  const cambiarRecepcion = useCambiarEstadoRecepcionMutation()
  const enlazarGasto = useEnlazarGastoAFacturaMutation()
  const descartarDuplicado = useDescartarDuplicadoMutation(companyId)

  const hoy = hoyLocalISO()
  const autorizados = useMemo(
    () => proveedores.filter((p) => proveedorHabilitado(p, hoy)),
    [proveedores, hoy],
  )

  async function accion(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      notify({ variant: 'success', title: 'Listo', text: ok })
    } catch (e) {
      // Los mensajes de los triggers (COMPRAS_*) están escritos para leerse tal
      // cual: dicen qué pasó y qué hacer. Se muestran sin reescribir.
      notify({ variant: 'error', title: 'No se pudo', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  // ── Órdenes de compra ─────────────────────────────────────────────────────
  const columnasOrden: DataTableColumn<OrdenCompraConRelaciones>[] = [
    { key: 'numero', header: 'N.º', accessor: (o) => o.numero ?? '', render: (o) => o.numero ?? '—', width: 110, sortable: true },
    { key: 'proveedor', header: 'Proveedor', accessor: (o) => o.proveedores?.nombre ?? o.proveedor_nombre, sortable: true },
    { key: 'concepto', header: 'Concepto', accessor: (o) => o.concepto, hideOnMobile: true },
    { key: 'total', header: 'Total', accessor: (o) => o.total, numeric: true, render: (o) => formatCurrency(o.total, o.moneda ?? monedaBase), width: 120 },
    {
      key: 'estado', header: 'Estado', accessor: (o) => o.estado, width: 140,
      render: (o) => <StatusBadge tone={TONO_OC[o.estado] ?? 'neutral'}>{ESTADO_OC_LABELS[o.estado] ?? o.estado}</StatusBadge>,
    },
    {
      key: 'acciones', header: '', width: 210,
      render: (o) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {o.estado === 'borrador' && puedeAutorizar && (
            <button style={btnLink} onClick={(e) => {
              e.stopPropagation()
              void accion(() => cambiarOrden.mutateAsync({ id: o.id, estado: 'aprobada' }), 'Orden aprobada.')
            }}>Aprobar</button>
          )}
          {o.estado === 'aprobada' && puedeCambiarEstado && (
            <button style={btnLink} onClick={(e) => {
              e.stopPropagation()
              void accion(() => cambiarOrden.mutateAsync({ id: o.id, estado: 'emitida' }), 'Orden emitida al proveedor.')
            }}>Emitir</button>
          )}
          {['aprobada', 'emitida', 'recibida_parcial'].includes(o.estado) && puedeCrear && (
            <button style={btnLink} onClick={(e) => { e.stopPropagation(); setRecibirDe(o) }}>Recibir</button>
          )}
          {['borrador', 'aprobada', 'emitida'].includes(o.estado) && puedeCambiarEstado && (
            <button style={btnLink} onClick={async (e) => {
              e.stopPropagation()
              const r = await openPromptDialog({
                title: 'Cancelar orden',
                description: 'Queda escrito en la orden por qué no se llevó a cabo.',
                fields: [{ name: 'motivo', label: '¿Por qué se cancela?', control: 'textarea', rows: 2 }],
              })
              const motivo = r?.motivo?.trim()
              if (!motivo) return
              await accion(() => cambiarOrden.mutateAsync({ id: o.id, estado: 'cancelada', motivo }), 'Orden cancelada.')
            }}>Cancelar</button>
          )}
        </div>
      ),
    },
  ]

  // ── Recepciones ───────────────────────────────────────────────────────────
  const columnasRecepcion: DataTableColumn<RecepcionConRelaciones>[] = [
    { key: 'numero', header: 'N.º', accessor: (r) => r.numero ?? '', render: (r) => r.numero ?? '—', width: 110, sortable: true },
    { key: 'orden', header: 'Orden', accessor: (r) => r.ordenes_compra?.numero ?? '', render: (r) => r.ordenes_compra?.numero ?? r.ordenes_compra?.concepto ?? '—' },
    { key: 'fecha', header: 'Fecha', accessor: (r) => r.fecha, render: (r) => formatDateShort(r.fecha), width: 110, sortable: true },
    { key: 'ref', header: 'Envío / remisión', accessor: (r) => r.documento_referencia ?? '', render: (r) => r.documento_referencia ?? '—', hideOnMobile: true },
    {
      key: 'estado', header: 'Estado', accessor: (r) => r.estado, width: 120,
      render: (r) => <StatusBadge tone={TONO_REC[r.estado] ?? 'neutral'}>{ESTADO_RECEPCION_LABELS[r.estado]}</StatusBadge>,
    },
    {
      key: 'acciones', header: '', width: 180,
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {r.estado === 'borrador' && puedeCambiarEstado && (
            <button style={btnLink} onClick={async (e) => {
              e.stopPropagation()
              const ok = await confirm({
                title: 'Registrar recepción',
                text: 'Al registrarla se contabiliza la entrada (contra «Bienes y servicios por facturar»), se mueven las existencias y se dan de alta los activos. ¿Continuar?',
                confirmText: 'Registrar',
              })
              if (!ok) return
              await accion(() => cambiarRecepcion.mutateAsync({ id: r.id, estado: 'registrada' }), 'Recepción registrada y contabilizada.')
            }}>Registrar</button>
          )}
          {r.estado === 'registrada' && puedeCambiarEstado && (
            <button style={btnLink} onClick={async (e) => {
              e.stopPropagation()
              const res = await openPromptDialog({
                title: 'Anular recepción',
                description: 'Se reversa el asiento, se devuelven las existencias y los activos dados de alta se dan de baja.',
                fields: [{ name: 'motivo', label: '¿Por qué se anula?', control: 'textarea', rows: 2 }],
              })
              const motivo = res?.motivo?.trim()
              if (!motivo) return
              await accion(() => cambiarRecepcion.mutateAsync({ id: r.id, estado: 'anulada', motivo }), 'Recepción anulada y reversada.')
            }}>Anular</button>
          )}
        </div>
      ),
    },
  ]

  // ── Contraseñas de pago ───────────────────────────────────────────────────
  const columnasContrasena: DataTableColumn<ContrasenaConRelaciones>[] = [
    { key: 'numero', header: 'N.º', accessor: (c) => c.numero ?? '', render: (c) => c.numero ?? '—', width: 110, sortable: true },
    { key: 'proveedor', header: 'Proveedor', accessor: (c) => c.proveedores?.nombre ?? '', sortable: true },
    { key: 'emision', header: 'Emitida', accessor: (c) => c.fecha_emision, render: (c) => formatDateShort(c.fecha_emision), width: 110, hideOnMobile: true },
    {
      key: 'pago', header: 'Se paga el', accessor: (c) => c.fecha_pago_programada, width: 120, sortable: true,
      render: (c) => (
        <span style={{ fontWeight: c.estado === 'emitida' && c.fecha_pago_programada < hoy ? 700 : 400,
                       color: c.estado === 'emitida' && c.fecha_pago_programada < hoy ? 'var(--at-danger)' : undefined }}>
          {formatDateShort(c.fecha_pago_programada)}
        </span>
      ),
    },
    { key: 'total', header: 'Total', accessor: (c) => c.total, numeric: true, render: (c) => formatCurrency(c.total, c.moneda ?? monedaBase), width: 120 },
    {
      key: 'estado', header: 'Estado', accessor: (c) => c.estado, width: 110,
      render: (c) => <StatusBadge tone={TONO_CP[c.estado] ?? 'neutral'}>{ESTADO_CONTRASENA_LABELS[c.estado]}</StatusBadge>,
    },
  ]

  // ── Activos fijos ─────────────────────────────────────────────────────────
  const columnasActivo: DataTableColumn<ActivoFijo>[] = [
    { key: 'codigo', header: 'Código', accessor: (a) => a.codigo, width: 120, sortable: true },
    { key: 'nombre', header: 'Activo', accessor: (a) => a.nombre, sortable: true },
    { key: 'alta', header: 'Alta', accessor: (a) => a.fecha_alta, render: (a) => formatDateShort(a.fecha_alta), width: 110, hideOnMobile: true },
    { key: 'costo', header: 'Costo', accessor: (a) => a.costo, numeric: true, render: (a) => formatCurrency(a.costo, monedaBase), width: 120 },
    { key: 'vida', header: 'Vida útil', accessor: (a) => a.vida_util_meses, render: (a) => `${a.vida_util_meses} meses`, width: 100, hideOnMobile: true },
    {
      key: 'estado', header: 'Estado', accessor: (a) => a.estado, width: 130,
      render: (a) => <StatusBadge tone={a.estado === 'activo' ? 'success' : a.estado === 'en_reparacion' ? 'warning' : 'neutral'}>
        {a.estado === 'dado_de_baja' ? 'Dado de baja' : a.estado === 'en_reparacion' ? 'En reparación' : 'Activo'}
      </StatusBadge>,
    },
  ]

  // ── Posibles duplicados (gasto ↔ factura) ─────────────────────────────────
  // El reporte NO corrige nada solo: propone pares y una persona decide. Enlazar
  // deja UN asiento (el de la factura); descartar recuerda que ya se revisó.
  const columnasDuplicado: DataTableColumn<FilaDuplicado>[] = [
    {
      key: 'gasto', header: 'Gasto capturado', accessor: (d) => d.gasto_concepto, sortable: true,
      render: (d) => (
        <div>
          <div style={{ fontWeight: 600 }}>{d.gasto_concepto}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>
            {formatDateShort(d.gasto_fecha)} · {formatCurrency(d.gasto_monto, monedaBase)}
            {d.gasto_contabilizado && ' · contabilizado'}
          </div>
        </div>
      ),
    },
    {
      key: 'factura', header: 'Factura del proveedor', accessor: (d) => d.factura_numero ?? '', sortable: true,
      render: (d) => (
        <div>
          <div style={{ fontWeight: 600 }}>{d.factura_numero ?? 'Sin número'}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>
            {formatDateShort(d.factura_fecha)} · {formatCurrency(d.factura_monto, monedaBase)}
            {d.proveedor ? ` · ${d.proveedor}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'razones', header: 'Por qué se parecen', accessor: (d) => d.razones, hideOnMobile: true,
      render: (d) => <span style={{ fontSize: 12 }}>{d.razones}</span>,
    },
    {
      key: 'puntaje', header: 'Indicio', accessor: (d) => d.puntaje, numeric: true, width: 100, sortable: true,
      render: (d) => (
        <StatusBadge tone={d.puntaje >= 80 ? 'danger' : d.puntaje >= 60 ? 'warning' : 'info'}>
          {d.puntaje >= 80 ? 'Alto' : d.puntaje >= 60 ? 'Medio' : 'Bajo'}
        </StatusBadge>
      ),
    },
    {
      key: 'acciones', header: '', width: 190,
      render: (d) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {puedeCrear && (
            <button style={btnLink} onClick={async (e) => {
              e.stopPropagation()
              const ok = await confirm({
                title: 'Es el mismo desembolso',
                text: d.gasto_contabilizado
                  ? 'El gasto ya está contabilizado: se anulará y su asiento se reversará, de modo que solo quede el de la factura. La factura no se toca.'
                  : 'El gasto queda enlazado a la factura y ya no generará asiento propio: la factura es la que contabiliza.',
                confirmText: 'Enlazar',
              })
              if (!ok) return
              await accion(
                () => enlazarGasto.mutateAsync({
                  gastoId: d.gasto_id,
                  facturaId: d.factura_id,
                  yaContabilizado: d.gasto_contabilizado,
                }),
                d.gasto_contabilizado
                  ? 'Gasto enlazado y anulado; su asiento quedó reversado.'
                  : 'Gasto enlazado a la factura.',
              )
            }}>Enlazar</button>
          )}
          {puedeCrear && (
            <button style={btnLink} onClick={async (e) => {
              e.stopPropagation()
              const r = await openPromptDialog({
                title: 'No es duplicado',
                description: 'El par deja de aparecer en el reporte. Queda escrito quién lo revisó y por qué.',
                fields: [{ name: 'motivo', label: '¿Por qué son desembolsos distintos?', control: 'textarea', rows: 2 }],
              })
              const motivo = r?.motivo?.trim()
              if (!motivo) return
              await accion(
                () => descartarDuplicado.mutateAsync({ gastoId: d.gasto_id, facturaId: d.factura_id, motivo }),
                'Par descartado. No volverá a aparecer.',
              )
            }}>Descartar</button>
          )}
        </div>
      ),
    },
  ]

  const totalComprometido = compromisos.reduce((s, c) => s + c.pendiente, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <FilterChips<Vista>
        options={[
          { value: 'ordenes', label: 'Órdenes de compra', count: ordenes.filter((o) => o.estado !== 'cancelada').length },
          { value: 'recepciones', label: 'Recepciones', count: recepciones.filter((r) => r.estado !== 'anulada').length },
          { value: 'contrasenas', label: 'Contraseñas de pago', count: contrasenas.filter((c) => c.estado === 'emitida').length },
          { value: 'activos', label: 'Activos fijos', count: activos.filter((a) => a.estado !== 'dado_de_baja').length },
          { value: 'compromisos', label: 'Comprometido' },
          { value: 'duplicados', label: 'Posibles duplicados', count: duplicados.length },
        ]}
        value={vista}
        onChange={setVista}
        ariaLabel="Vista de compras"
      />

      {vista === 'ordenes' && (
        <DataTable<OrdenCompraConRelaciones>
          data={ordenes}
          columns={columnasOrden}
          rowKey="id"
          isLoading={cargandoOrdenes}
          searchableKeys={[(o) => o.proveedores?.nombre ?? o.proveedor_nombre, 'concepto', (o) => o.numero ?? '']}
          searchPlaceholder="Buscar orden…"
          toolbar={puedeCrear
            ? <button onClick={() => setNuevaOrden(true)} style={btnPrimario}>+ Nueva orden</button>
            : undefined}
          emptyState={{
            title: 'Sin órdenes de compra',
            description: 'La orden se emite a un proveedor AUTORIZADO y es lo que después se recibe y se factura. Aprobarla no genera asiento: es un compromiso, no un gasto.',
          }}
        />
      )}

      {vista === 'recepciones' && (
        <DataTable<RecepcionConRelaciones>
          data={recepciones}
          columns={columnasRecepcion}
          rowKey="id"
          isLoading={cargandoRecepciones}
          searchableKeys={[(r) => r.numero ?? '', (r) => r.documento_referencia ?? '', (r) => r.ordenes_compra?.numero ?? '']}
          searchPlaceholder="Buscar recepción…"
          emptyState={{
            title: 'Sin recepciones',
            description: 'Se crean desde una orden aprobada o emitida, con el botón «Recibir». Al registrarlas entran a inventario, activos o gasto, y la contabilidad las reconoce el mismo día.',
          }}
        />
      )}

      {vista === 'contrasenas' && (
        <DataTable<ContrasenaConRelaciones>
          data={contrasenas}
          columns={columnasContrasena}
          rowKey="id"
          isLoading={cargandoContrasenas}
          searchableKeys={[(c) => c.proveedores?.nombre ?? '', (c) => c.numero ?? '']}
          searchPlaceholder="Buscar contraseña…"
          emptyState={{
            title: 'Sin contraseñas de pago',
            description: 'Se emiten desde «Cuentas por pagar», sobre las facturas aprobadas de un proveedor. Una contraseña agrupa varias facturas y una sola orden de pago las cancela todas.',
          }}
        />
      )}

      {vista === 'activos' && (
        <DataTable<ActivoFijo>
          data={activos}
          columns={columnasActivo}
          rowKey="id"
          isLoading={cargandoActivos}
          searchableKeys={['codigo', 'nombre', (a) => a.numero_serie ?? '']}
          searchPlaceholder="Buscar activo…"
          emptyState={{
            title: 'Sin activos fijos',
            description: 'Se dan de alta solos cuando una recepción trae líneas con destino «Activo fijo». Quedan con su cuenta de activo y su cuenta de depreciación acumulada listas.',
          }}
        />
      )}

      {vista === 'compromisos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
            Lo pedido a cada proveedor que todavía no ha llegado. No es deuda —no
            está en la contabilidad— pero sí es dinero ya comprometido.
            Total pendiente: <strong>{formatCurrency(totalComprometido, monedaBase)}</strong>.
          </p>
          <DataTable
            data={compromisos}
            rowKey="proveedor_id"
            columns={[
              { key: 'proveedor', header: 'Proveedor', accessor: (c) => c.proveedor, sortable: true },
              { key: 'ordenes', header: 'Órdenes', accessor: (c) => c.ordenes, numeric: true, width: 90 },
              { key: 'comprometido', header: 'Comprometido', accessor: (c) => c.comprometido, numeric: true, render: (c) => formatCurrency(c.comprometido, monedaBase), width: 130 },
              { key: 'recibido', header: 'Recibido', accessor: (c) => c.recibido, numeric: true, render: (c) => formatCurrency(c.recibido, monedaBase), width: 120 },
              { key: 'pendiente', header: 'Pendiente', accessor: (c) => c.pendiente, numeric: true, render: (c) => formatCurrency(c.pendiente, monedaBase), width: 120 },
            ]}
            emptyState={{ title: 'Nada comprometido', description: 'No hay órdenes vivas con entregas pendientes en esta contabilidad.' }}
          />
        </div>
      )}

      {vista === 'duplicados' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
            Un gasto y una factura de proveedor que probablemente son el mismo
            desembolso, capturado dos veces. Mientras no se enlacen, la
            contabilidad los reconoce por separado y el gasto sale duplicado.
            Nada se corrige solo: revisa el par y decide.
          </p>
          <DataTable<FilaDuplicado>
            data={duplicados}
            columns={columnasDuplicado}
            rowKey={(d) => `${d.gasto_id}:${d.factura_id}`}
            isLoading={cargandoDuplicados}
            searchableKeys={['gasto_concepto', (d) => d.factura_numero ?? '', (d) => d.proveedor ?? '']}
            searchPlaceholder="Buscar par…"
            emptyState={{
              title: 'Sin duplicados a la vista',
              description: 'No hay gastos que calcen con una factura de proveedor de esta contabilidad. Los gastos son para desembolsos SIN factura de proveedor —caja chica, reembolsos, compras menores—; lo facturado entra por Órdenes de compra y Cuentas por pagar.',
            }}
          />
        </div>
      )}

      {nuevaOrden && (
        <OrdenCompraModal
          companyId={companyId}
          projectId={projectId}
          monedaBase={monedaBase}
          proveedores={autorizados}
          hayProveedores={proveedores.length > 0}
          onClose={() => setNuevaOrden(false)}
        />
      )}

      {recibirDe && (
        <RecepcionModal
          companyId={companyId}
          projectId={projectId}
          orden={recibirDe}
          onClose={() => setRecibirDe(null)}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Nueva orden de compra
// ════════════════════════════════════════════════════════════════════════════

function OrdenCompraModal({
  companyId, projectId, monedaBase, proveedores, hayProveedores, onClose,
}: {
  companyId: string
  projectId: string | null
  monedaBase: string
  proveedores: { id: string; nombre: string }[]
  hayProveedores: boolean
  onClose: () => void
}) {
  const crear = useCrearOrdenCompraMutation(companyId, projectId)
  const [proveedorId, setProveedorId] = useState('')
  const [concepto, setConcepto] = useState('')
  const [fechaRequerida, setFechaRequerida] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }])

  const totales = totalesOrden(lineas.map((l) => ({
    cantidad: parseFloat(l.cantidad) || 0,
    precio_unitario: parseFloat(l.precio_unitario) || 0,
    iva_monto: parseFloat(l.iva_monto) || 0,
  })))

  function actualizar(i: number, campo: keyof LineaForm, valor: string) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
  }

  async function guardar() {
    const parsed = ordenCompraFormSchema.safeParse({
      proveedor_id: proveedorId,
      project_id: projectId,
      concepto,
      descripcion: null,
      condiciones_pago: null,
      dias_credito: 0,
      fecha_requerida: fechaRequerida || null,
      obra_id: null,
      notas: notas.trim() || null,
      lineas: lineas.map((l) => ({
        descripcion: l.descripcion,
        destino_tipo: l.destino_tipo,
        // El destino Inventario exige elegir el insumo del almacén; mientras el
        // selector de insumos no esté en este formulario, esa línea se captura
        // desde la pestaña de Suministros del proyecto.
        suministro_id: null,
        cuenta_id: null,
        categoria: l.categoria,
        cantidad: parseFloat(l.cantidad) || 0,
        unidad: l.unidad,
        precio_unitario: parseFloat(l.precio_unitario) || 0,
        iva_monto: parseFloat(l.iva_monto) || 0,
      })),
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      const prov = proveedores.find((p) => p.id === proveedorId)
      await crear.mutateAsync({ ...parsed.data, proveedorNombre: prov?.nombre ?? '' })
      notify({ variant: 'success', title: 'Listo', text: 'Orden creada en borrador. Apruébala para emitirla.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo crear la orden.' })
    }
  }

  return (
    <EditModal title="Nueva orden de compra" onClose={onClose} size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending} style={btnPrimario}>Crear borrador</button>
        </div>
      }
    >
      {proveedores.length === 0 && (
        <p style={{ margin: '0 0 12px', padding: 10, borderRadius: 8, fontSize: 12,
                    background: 'var(--at-warning-tint)', color: 'var(--at-ink)' }}>
          {hayProveedores
            ? 'Ningún proveedor está autorizado y vigente. Autorízalo en la pestaña Proveedores antes de emitirle una orden.'
            : 'Todavía no hay proveedores. Regístralos y autorízalos en la pestaña Proveedores.'}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo label="Proveedor autorizado *">
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={input}>
            <option value="">Selecciona…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Fecha requerida">
          <input type="date" value={fechaRequerida} onChange={(e) => setFechaRequerida(e.target.value)} style={input} />
        </Campo>
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Concepto *">
            <input value={concepto} onChange={(e) => setConcepto(e.target.value)} style={{ ...input, width: '100%' }} />
          </Campo>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 12 }}>Renglones</strong>
          <button style={btnLink} onClick={() => setLineas((ls) => [...ls, { ...LINEA_VACIA }])}>+ Agregar renglón</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                <th style={{ padding: 4 }}>Descripción</th>
                <th style={{ padding: 4, width: 120 }}>Destino</th>
                <th style={{ padding: 4, width: 130 }}>Categoría</th>
                <th style={{ padding: 4, width: 80 }}>Cant.</th>
                <th style={{ padding: 4, width: 90 }}>Unidad</th>
                <th style={{ padding: 4, width: 100 }}>Precio</th>
                <th style={{ padding: 4, width: 90 }}>IVA</th>
                <th style={{ padding: 4, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: 2 }}>
                    <input value={l.descripcion} onChange={(e) => actualizar(i, 'descripcion', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Descripción del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <select value={l.destino_tipo} onChange={(e) => actualizar(i, 'destino_tipo', e.target.value)}
                            style={{ ...input, width: '100%' }} aria-label={`Destino del renglón ${i + 1}`}>
                      {(Object.keys(DESTINO_LINEA_LABELS) as DestinoLinea[])
                        .filter((d) => d !== 'inventario')
                        .map((d) => <option key={d} value={d}>{DESTINO_LINEA_LABELS[d]}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 2 }}>
                    <select value={l.categoria} onChange={(e) => actualizar(i, 'categoria', e.target.value)}
                            style={{ ...input, width: '100%' }} aria-label={`Categoría del renglón ${i + 1}`}>
                      {CATEGORIAS_GASTO_CXP.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 2 }}>
                    <input type="number" min="0" step="0.01" value={l.cantidad}
                           onChange={(e) => actualizar(i, 'cantidad', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Cantidad del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <input value={l.unidad} onChange={(e) => actualizar(i, 'unidad', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Unidad del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <input type="number" min="0" step="0.01" value={l.precio_unitario}
                           onChange={(e) => actualizar(i, 'precio_unitario', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`Precio del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2 }}>
                    <input type="number" min="0" step="0.01" value={l.iva_monto}
                           onChange={(e) => actualizar(i, 'iva_monto', e.target.value)}
                           style={{ ...input, width: '100%' }} aria-label={`IVA del renglón ${i + 1}`} />
                  </td>
                  <td style={{ padding: 2, textAlign: 'right' }}>
                    {lineas.length > 1 && (
                      <button style={btnLink} aria-label={`Quitar renglón ${i + 1}`}
                              onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: '10px 0 0', textAlign: 'right', fontSize: 13 }}>
          Subtotal {formatCurrency(totales.subtotal, monedaBase)} · IVA {formatCurrency(totales.iva, monedaBase)} ·{' '}
          <strong>Total {formatCurrency(totales.total, monedaBase)}</strong>
        </p>
      </div>

      <div style={{ marginTop: 12 }}>
        <Campo label="Notas">
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)}
                    style={{ ...input, width: '100%', minHeight: 50 }} />
        </Campo>
      </div>
    </EditModal>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Recepción contra una orden
// ════════════════════════════════════════════════════════════════════════════

function RecepcionModal({
  companyId, projectId, orden, onClose,
}: {
  companyId: string
  projectId: string | null
  orden: OrdenCompraConRelaciones
  onClose: () => void
}) {
  const { data: lineasOC = [], isLoading } = useOrdenCompraLineasQuery(orden.id)
  const crear = useCrearRecepcionMutation(companyId, projectId)
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [referencia, setReferencia] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})

  // Por defecto se recibe TODO lo que falta: es lo que pasa el 90 % de las
  // veces, y quien recibe parcial corrige el renglón que corresponda.
  const pendientes = useMemo(
    () => lineasOC.map((l) => ({ ...l, pendiente: pendienteDeRecibir(l) })).filter((l) => l.pendiente > 0),
    [lineasOC],
  )

  function cantidadDe(id: string, pendiente: number): string {
    return cantidades[id] ?? String(pendiente)
  }

  async function guardar() {
    const lineas = pendientes
      .map((l) => ({
        orden_compra_linea_id: l.id,
        cantidad: parseFloat(cantidadDe(l.id, l.pendiente)) || 0,
        costo_unitario: l.precio_unitario,
        observacion: null,
      }))
      .filter((l) => l.cantidad > 0)

    const parsed = recepcionFormSchema.safeParse({
      orden_compra_id: orden.id,
      fecha,
      documento_referencia: referencia.trim() || null,
      notas: null,
      lineas,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await crear.mutateAsync(parsed.data)
      notify({
        variant: 'success', title: 'Listo',
        text: 'Recepción creada en borrador. Regístrala para que entre a contabilidad e inventario.',
      })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo crear la recepción.' })
    }
  }

  return (
    <EditModal title={`Recibir contra ${orden.numero ?? orden.concepto}`} onClose={onClose} size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending || pendientes.length === 0}
                  style={btnPrimario}>Crear recepción</button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo label="Fecha de recepción">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
        </Campo>
        <Campo label="Envío / remisión del proveedor">
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} style={input} />
        </Campo>
      </div>

      <div style={{ marginTop: 14 }}>
        <strong style={{ fontSize: 12 }}>Qué llegó</strong>
        {isLoading && <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Cargando renglones…</p>}
        {!isLoading && pendientes.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
            Esta orden ya se recibió completa.
          </p>
        )}
        {pendientes.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                  <th style={{ padding: 4 }}>Renglón</th>
                  <th style={{ padding: 4, width: 110 }}>Destino</th>
                  <th style={{ padding: 4, width: 90 }}>Pendiente</th>
                  <th style={{ padding: 4, width: 110 }}>Se recibe</th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ padding: 4 }}>{l.descripcion}</td>
                    <td style={{ padding: 4 }}>{DESTINO_LINEA_LABELS[l.destino_tipo]}</td>
                    <td style={{ padding: 4 }}>{l.pendiente} {l.unidad}</td>
                    <td style={{ padding: 2 }}>
                      <input
                        type="number" min="0" step="0.01" max={l.pendiente}
                        value={cantidadDe(l.id, l.pendiente)}
                        onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))}
                        style={{ ...input, width: '100%' }}
                        aria-label={`Cantidad recibida de ${l.descripcion}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </EditModal>
  )
}
