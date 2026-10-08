// Compras (Fase 6) — el riel completo dentro de la contabilidad activa.
//
//   proveedor autorizado → orden de compra → recepción → factura → contraseña
//
// Esta pestaña cubre los eslabones que no existían: la orden con líneas, la
// recepción (que es la que contabiliza y mueve inventario/activos) y la
// contraseña de pago. La factura y el pago viven en «Cuentas por pagar», que es
// donde el contador ya los busca.
import { useMemo, useRef, useState } from 'react'
import { DataTable, EditModal, type DataTableColumn } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import { useResponsablesQuery } from '../../domain/proveedores/queries'
import { LineasOrdenEditor, LINEA_VACIA, lineasParaServidor, type LineaForm } from '../compras/LineasOrdenEditor'
import { SeguimientoOrdenModal } from '../compras/SeguimientoOrdenModal'
import { RespaldosRecepcionModal } from '../compras/RespaldosRecepcionModal'
import { SeguimientoComprasPanel } from '../compras/SeguimientoComprasPanel'
import { ImportarLineasOrdenModal } from '../compras/ImportarLineasOrdenModal'
import { useTransicionOrdenConContrato } from '../compras/excepcionContrato'
import { ContratoSelector } from '../proveedores/ContratoSelector'
import { ContratoSeguimientoModal } from '../proveedores/ContratoSeguimientoModal'
import { adjuntarRespaldoRecepcion, validarArchivoRespaldo, MIME_RESPALDO, MAX_BYTES_RESPALDO } from '../../domain/compras/respaldos'
import {
  useActivosFijosQuery,
  useCompromisosQuery,
  useContrasenasQuery,
  useDuplicadosQuery,
  useInsumosAlmacenQuery,
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
import { ordenCompraFormSchema, pendienteDeRecibir, recepcionFormSchema } from '../../domain/compras/schemas'
import { mensajeCrearOrden, nuevaClaveIdempotencia } from '../../domain/compras/ordenCrear'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
import {
  DESTINO_LINEA_LABELS,
  ESTADO_CONTRASENA_LABELS,
  ESTADO_OC_LABELS,
  ESTADO_RECEPCION_LABELS,
  proveedorHabilitado,
  type ActivoFijo,
  type ContrasenaConRelaciones,
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

type Vista = 'ordenes' | 'recepciones' | 'seguimiento' | 'contrasenas' | 'activos' | 'compromisos' | 'duplicados'

const TONO_OC = {
  borrador: 'info', aprobada: 'warning', emitida: 'warning',
  recibida_parcial: 'warning', recibida: 'success', cerrada: 'success', cancelada: 'neutral',
} as const
const TONO_REC = { borrador: 'info', registrada: 'success', anulada: 'neutral' } as const
const TONO_CP = { emitida: 'warning', pagada: 'success', anulada: 'neutral' } as const

export function ComprasTab({ companyId, projectId, monedaBase }: Props) {
  const { puedeCrear, puedeEditar, puedeCambiarEstado, puedeAutorizar } = usePermisosContabilidad()
  // Un PASO (aprobar, emitir, cancelar, registrar, anular) exige la acción Y «Editar»: la política de UPDATE de esas
  // tablas pide editar y el servidor además pide la acción. Con solo la acción el UPDATE no afecta ninguna fila.
  const puedeAutorizarPaso = puedeAutorizar && puedeEditar
  const puedeCambiarEstadoPaso = puedeCambiarEstado && puedeEditar
  const [vista, setVista] = useState<Vista>('ordenes')
  const [nuevaOrden, setNuevaOrden] = useState(false)
  const [recibirDe, setRecibirDe] = useState<OrdenCompraConRelaciones | null>(null)
  const [seguirDe, setSeguirDe] = useState<string | null>(null)
  const [respaldosDe, setRespaldosDe] = useState<RecepcionConRelaciones | null>(null)
  const [importarEn, setImportarEn] = useState<OrdenCompraConRelaciones | null>(null)

  const { data: ordenes = [], isLoading: cargandoOrdenes } = useOrdenesCompraQuery(companyId, projectId)
  const { data: recepciones = [], isLoading: cargandoRecepciones } = useRecepcionesQuery(companyId, projectId)
  const { data: contrasenas = [], isLoading: cargandoContrasenas } = useContrasenasQuery(companyId, projectId)
  const { data: activos = [], isLoading: cargandoActivos } = useActivosFijosQuery(companyId, projectId)
  const { data: compromisos = [] } = useCompromisosQuery(companyId, projectId)
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  const { data: duplicados = [], isLoading: cargandoDuplicados } = useDuplicadosQuery(companyId, projectId)

  const cambiarOrden = useCambiarEstadoOrdenCompraMutation()
  // Aprobar y emitir una orden amparada en un contrato exigen que siga vigente y dentro de su monto; quien tiene
  // el permiso de cambio de estado autoriza una excepción (motivo, a su nombre, en el historial de la orden).
  const transicionar = useTransicionOrdenConContrato(puedeCambiarEstado)
  const [seguirContrato, setSeguirContrato] = useState<string | null>(null)
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
      key: 'acciones', header: '', width: 340,
      render: (o) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button style={btnLink} onClick={(e) => { e.stopPropagation(); setSeguirDe(o.id) }}>Seguimiento</button>
          {o.contrato_id && (
            <button style={btnLink} onClick={(e) => { e.stopPropagation(); setSeguirContrato(o.contrato_id ?? null) }}>Contrato</button>
          )}
          {o.estado === 'borrador' && puedeCrear && (
            <button style={btnLink} onClick={(e) => { e.stopPropagation(); setImportarEn(o) }}>Importar renglones</button>
          )}
          {o.estado === 'borrador' && puedeAutorizarPaso && (
            <button style={btnLink} onClick={(e) => {
              e.stopPropagation()
              void accion(() => (o.contrato_id
                ? transicionar({ ordenId: o.id, etapa: 'aprobar', ejecutar: () => cambiarOrden.mutateAsync({ id: o.id, estado: 'aprobada' }) })
                : cambiarOrden.mutateAsync({ id: o.id, estado: 'aprobada' })), 'Orden aprobada.')
            }}>Aprobar</button>
          )}
          {o.estado === 'aprobada' && puedeAutorizarPaso && (
            <button style={btnLink} onClick={async (e) => {
              e.stopPropagation()
              const r = await openPromptDialog({
                title: 'Devolver a borrador',
                description: 'La aprobación se invalida y la orden vuelve a revisarse; queda escrito por qué.',
                fields: [{ name: 'motivo', label: '¿Qué hay que corregir?', control: 'textarea', rows: 2 }],
              })
              const motivo = r?.motivo?.trim()
              if (!motivo) return
              await accion(() => cambiarOrden.mutateAsync({ id: o.id, estado: 'borrador', motivo }), 'Orden devuelta a borrador (nueva revisión).')
            }}>Devolver a borrador</button>
          )}
          {o.estado === 'aprobada' && puedeCambiarEstadoPaso && (
            <button style={btnLink} onClick={(e) => {
              e.stopPropagation()
              void accion(() => (o.contrato_id
                ? transicionar({ ordenId: o.id, etapa: 'emitir', ejecutar: () => cambiarOrden.mutateAsync({ id: o.id, estado: 'emitida' }) })
                : cambiarOrden.mutateAsync({ id: o.id, estado: 'emitida' })), 'Orden emitida al proveedor.')
            }}>Emitir</button>
          )}
          {['aprobada', 'emitida', 'recibida_parcial'].includes(o.estado) && puedeCrear && (
            <button style={btnLink} onClick={(e) => { e.stopPropagation(); setRecibirDe(o) }}>Recibir</button>
          )}
          {['borrador', 'aprobada', 'emitida'].includes(o.estado) && puedeCambiarEstadoPaso && (
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
      key: 'acciones', header: '', width: 240,
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button style={btnLink} onClick={(e) => { e.stopPropagation(); setRespaldosDe(r) }}>Respaldos</button>
          {r.estado === 'borrador' && puedeCambiarEstadoPaso && (
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
          {r.estado === 'registrada' && puedeCambiarEstadoPaso && (
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
          { value: 'seguimiento', label: 'Seguimiento' },
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

      {vista === 'seguimiento' && (
        <SeguimientoComprasPanel companyId={companyId} projectId={projectId} monedaBase={monedaBase} />
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

      {seguirContrato && <ContratoSeguimientoModal contratoId={seguirContrato} onClose={() => setSeguirContrato(null)} />}
      {seguirDe && (
        <SeguimientoOrdenModal ordenId={seguirDe} monedaBase={monedaBase} onClose={() => setSeguirDe(null)} />
      )}

      {importarEn && (
        <ImportarLineasOrdenModal
          orden={{ id: importarEn.id, numero: importarEn.numero, concepto: importarEn.concepto, moneda: importarEn.moneda }}
          monedaBase={monedaBase}
          onClose={() => setImportarEn(null)}
        />
      )}

      {respaldosDe && (
        <RespaldosRecepcionModal
          companyId={companyId}
          projectId={projectId}
          recepcion={{ id: respaldosDe.id, numero: respaldosDe.numero, tipo: respaldosDe.tipo ?? 'bienes', estado: respaldosDe.estado }}
          puedeAdjuntar={puedeCrear}
          onClose={() => setRespaldosDe(null)}
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

export function OrdenCompraModal({
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
  const { data: insumos = [], isLoading: cargandoInsumos } = useInsumosAlmacenQuery(companyId, projectId)
  // Una clave por apertura del formulario: un doble clic, un reintento tras un corte o una respuesta perdida
  // devuelven LA MISMA orden en vez de crear otra (el servidor guarda la clave con la huella del contenido). Si la
  // creación falla, no queda nada, así que la misma clave sirve para el reintento corregido.
  const claveIdempotencia = useRef(nuevaClaveIdempotencia('oc'))
  const enviando = useRef(false)   // un segundo clic antes de que la pantalla se re-pinte no lanza otra petición
  const [proveedorId, setProveedorId] = useState('')
  const [contratoId, setContratoId] = useState<string | null>(null)
  const [concepto, setConcepto] = useState('')
  const [fechaRequerida, setFechaRequerida] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }])

  async function guardar() {
    const parsed = ordenCompraFormSchema.safeParse({
      proveedor_id: proveedorId,
      contrato_id: contratoId,
      project_id: projectId,
      concepto,
      descripcion: null,
      condiciones_pago: null,
      dias_credito: 0,
      fecha_requerida: fechaRequerida || null,
      obra_id: null,
      notas: notas.trim() || null,
      lineas: lineasParaServidor(lineas),
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    if (enviando.current) return
    enviando.current = true
    try {
      await crear.mutateAsync({ ...parsed.data, clave_idempotencia: claveIdempotencia.current })
      notify({ variant: 'success', title: 'Listo', text: 'Orden creada en borrador. Apruébala para emitirla.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: mensajeCrearOrden(e) })
    } finally {
      enviando.current = false
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
          <select value={proveedorId} onChange={(e) => { setProveedorId(e.target.value); setContratoId(null) }} style={input}>
            <option value="">Selecciona…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Fecha requerida">
          <input type="date" value={fechaRequerida} onChange={(e) => setFechaRequerida(e.target.value)} style={input} />
        </Campo>
        <div style={{ gridColumn: '1 / -1' }}>
          <ContratoSelector companyId={companyId} projectId={projectId} proveedorId={proveedorId || null} value={contratoId} onChange={(id) => setContratoId(id)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Concepto *">
            <input value={concepto} onChange={(e) => setConcepto(e.target.value)} style={{ ...input, width: '100%' }} />
          </Campo>
        </div>
      </div>

      <LineasOrdenEditor
        lineas={lineas} onChange={setLineas} projectId={projectId} proveedorId={proveedorId || null}
        monedaBase={monedaBase} insumos={insumos} cargandoInsumos={cargandoInsumos}
      />

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
  const { data: responsables = [] } = useResponsablesQuery(companyId)
  const crear = useCrearRecepcionMutation(companyId, projectId)
  const [tipo, setTipo] = useState<'bienes' | 'servicio'>('bienes')
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [referencia, setReferencia] = useState('')
  const [destinoFisico, setDestinoFisico] = useState('')
  const [responsable, setResponsable] = useState('')
  const [notas, setNotas] = useState('')
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [rechazos, setRechazos] = useState<Record<string, string>>({})
  const [motivos, setMotivos] = useState<Record<string, string>>({})
  // Evidencia opcional al crear (remisión, foto o acta). Se sube DESPUÉS de crear el borrador y,
  // si falla, la recepción NO se pierde: se puede adjuntar luego desde «Respaldos».
  const [respaldo, setRespaldo] = useState<File | null>(null)
  // Una clave por apertura del formulario: si el usuario da doble clic o reintenta
  // tras un corte de red, el servidor rechaza el segundo borrador en vez de duplicarlo.
  const claveIdempotencia = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

  // Los servicios no se «reciben» en una bodega: se confirma su prestación con
  // una conformidad. Por eso cada tipo muestra solo los renglones que le tocan.
  const pendientes = useMemo(
    () => lineasOC
      .map((l) => ({ ...l, pendiente: pendienteDeRecibir(l) }))
      .filter((l) => l.pendiente > 0 && (tipo === 'servicio' ? l.destino_tipo === 'servicio' : l.destino_tipo !== 'servicio')),
    [lineasOC, tipo],
  )
  const hayServicios = lineasOC.some((l) => l.destino_tipo === 'servicio' && pendienteDeRecibir(l) > 0)
  const hayBienes = lineasOC.some((l) => l.destino_tipo !== 'servicio' && pendienteDeRecibir(l) > 0)

  // Por defecto se acepta TODO lo que falta (lo más común); quien recibe parcial o
  // rechaza corrige el renglón que corresponda.
  function aceptadaDe(id: string, pendiente: number): string {
    return cantidades[id] ?? String(pendiente)
  }

  async function guardar() {
    const lineas = pendientes
      .map((l) => ({
        orden_compra_linea_id: l.id,
        cantidad: parseFloat(aceptadaDe(l.id, l.pendiente)) || 0,
        cantidad_rechazada: parseFloat(rechazos[l.id] ?? '') || 0,
        motivo_rechazo: (motivos[l.id] ?? '').trim() || null,
        costo_unitario: l.precio_unitario,
        observacion: null,
      }))
      .filter((l) => l.cantidad > 0 || l.cantidad_rechazada > 0)

    const parsed = recepcionFormSchema.safeParse({
      orden_compra_id: orden.id,
      tipo,
      fecha,
      documento_referencia: referencia.trim() || null,
      destino_fisico: tipo === 'bienes' ? destinoFisico.trim() || null : null,
      recibido_por: responsable || null,
      respaldo_path: null,
      clave_idempotencia: claveIdempotencia.current,
      notas: notas.trim() || null,
      lineas,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    if (respaldo) {
      const problema = validarArchivoRespaldo(respaldo)
      if (problema) {
        notify({ variant: 'warning', title: 'Atención', text: `Respaldo: ${problema}` })
        return
      }
    }
    try {
      const creada = await crear.mutateAsync(parsed.data)
      if (respaldo) {
        try {
          await adjuntarRespaldoRecepcion({
            companyId, projectId, recepcionId: creada.id, archivo: respaldo, tipo: tipo === 'servicio' ? 'conformidad' : 'entrega',
          })
        } catch (e) {
          notify({
            variant: 'warning', title: 'Recepción creada, respaldo pendiente',
            text: `${e instanceof Error ? e.message : 'No se pudo adjuntar el archivo.'} La recepción quedó en borrador: adjunta el archivo desde «Respaldos».`,
          })
          onClose()
          return
        }
      }
      notify({
        variant: 'success', title: 'Listo',
        text: tipo === 'servicio'
          ? 'Conformidad creada en borrador. Regístrala para devengar el servicio (no mueve inventario).'
          : 'Recepción creada en borrador. Regístrala para que entre a contabilidad e inventario.',
      })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo crear la recepción.' })
    }
  }

  return (
    <EditModal title={`${tipo === 'servicio' ? 'Conformidad de servicio' : 'Recibir'} contra ${orden.numero ?? orden.concepto}`} onClose={onClose} size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending || pendientes.length === 0}
                  style={btnPrimario}>{tipo === 'servicio' ? 'Crear conformidad' : 'Crear recepción'}</button>
        </div>
      }
    >
      {hayServicios && hayBienes && (
        <div role="group" aria-label="Tipo de recepción" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button type="button" style={tipo === 'bienes' ? btnPrimario : btnSecundario} onClick={() => setTipo('bienes')}>Bienes</button>
          <button type="button" style={tipo === 'servicio' ? btnPrimario : btnSecundario} onClick={() => setTipo('servicio')}>Servicios (conformidad)</button>
        </div>
      )}
      {hayServicios && !hayBienes && tipo !== 'servicio' && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" style={btnSecundario} onClick={() => setTipo('servicio')}>Esta orden es de servicios: registrar conformidad</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <Campo label={tipo === 'servicio' ? 'Fecha de la conformidad' : 'Fecha de recepción'}>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
        </Campo>
        <Campo label={tipo === 'servicio' ? 'Acta / soporte de la conformidad' : 'Envío / remisión del proveedor'}>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} style={input} />
        </Campo>
        {tipo === 'bienes' && (
          <Campo label="Destino físico (bodega / ubicación)">
            <input value={destinoFisico} onChange={(e) => setDestinoFisico(e.target.value)} style={input} placeholder="Ej.: Bodega general" />
          </Campo>
        )}
        <Campo label={tipo === 'servicio' ? 'Responsable que confirma el servicio' : 'Responsable de la recepción'}>
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)} style={input}>
            <option value="">Yo (quien captura)</option>
            {responsables.map((r) => <option key={r.id} value={r.id}>{r.full_name ?? r.id}</option>)}
          </select>
        </Campo>
      </div>

      <div style={{ marginTop: 14 }}>
        <strong style={{ fontSize: 12 }}>{tipo === 'servicio' ? 'Qué se prestó' : 'Qué llegó'}</strong>
        {isLoading && <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Cargando renglones…</p>}
        {!isLoading && pendientes.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
            {hayServicios || hayBienes ? 'No hay renglones de este tipo por recibir.' : 'Esta orden ya se recibió completa.'}
          </p>
        )}
        {pendientes.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                  <th style={{ padding: 4 }}>Renglón</th>
                  <th style={{ padding: 4, width: 100 }}>Destino</th>
                  <th style={{ padding: 4, width: 80 }}>Pendiente</th>
                  <th style={{ padding: 4, width: 100 }}>Se acepta</th>
                  <th style={{ padding: 4, width: 100 }}>Se rechaza</th>
                  <th style={{ padding: 4 }}>Motivo del rechazo</th>
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
                        value={aceptadaDe(l.id, l.pendiente)}
                        onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))}
                        style={{ ...input, width: '100%' }}
                        aria-label={`Cantidad aceptada de ${l.descripcion}`}
                      />
                    </td>
                    <td style={{ padding: 2 }}>
                      <input
                        type="number" min="0" step="0.01"
                        value={rechazos[l.id] ?? ''}
                        onChange={(e) => setRechazos((c) => ({ ...c, [l.id]: e.target.value }))}
                        style={{ ...input, width: '100%' }}
                        aria-label={`Cantidad rechazada de ${l.descripcion}`}
                      />
                    </td>
                    <td style={{ padding: 2 }}>
                      <input
                        value={motivos[l.id] ?? ''}
                        onChange={(e) => setMotivos((c) => ({ ...c, [l.id]: e.target.value }))}
                        style={{ ...input, width: '100%' }}
                        placeholder="Obligatorio si rechazas"
                        aria-label={`Motivo del rechazo de ${l.descripcion}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: '6px 0 0' }}>
          Solo lo <strong>aceptado</strong> entra al inventario o se devenga; lo rechazado queda con su motivo y sigue pendiente.
        </p>
      </div>

      <Campo label={`${tipo === 'servicio' ? 'Acta o soporte de la conformidad' : 'Remisión o foto de la entrega'} (opcional · PDF, JPG, PNG o WEBP, hasta ${MAX_BYTES_RESPALDO / 1024 / 1024} MB)`}>
        <input type="file" accept={MIME_RESPALDO.join(',')} aria-label="Respaldo de la recepción"
               onChange={(e) => setRespaldo(e.target.files?.[0] ?? null)} style={input} />
      </Campo>

      <Campo label="Observaciones">
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} />
      </Campo>
    </EditModal>
  )
}
