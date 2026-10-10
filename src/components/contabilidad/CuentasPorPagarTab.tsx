import { useMemo, useRef, useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { EditModal } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import {
  useFacturasProveedorQuery,
  useOrdenesPagoQuery,
  useProveedoresQuery,
  useAgingQuery,
  useProyeccionPagosQuery,
} from '../../domain/cxp/queries'
import {
  useAnularFacturaMutation,
  useAnularOrdenMutation,
  useAprobarFacturaMutation,
  useAprobarOrdenMutation,
  useCrearFacturaProveedorMutation,
  useCrearOrdenPagoMutation,
  useMarcarOrdenPagadaMutation,
} from '../../domain/cxp/mutations'
import {
  facturaProveedorFormSchema, facturaRenglonSchema, ordenPagoFormSchema, saldoFactura, textoErrorServidor, totalesFactura,
} from '../../domain/cxp/schemas'
import { useCuadreQuery, useOrdenCompraLineasQuery, useOrdenesCompraQuery } from '../../domain/compras/queries'
import { redondear2 } from '../../lib/business'
import {
  useAprobarFacturaConCuadreMutation,
  useCrearContrasenaMutation,
} from '../../domain/compras/mutations'
import { nuevaClaveIdempotencia } from '../../domain/compras/ordenCrear'
import { DURACION_ERROR_LARGO_MS, mensajeAccionCompras } from '../../domain/compras/errores'
import { contrasenaFormSchema } from '../../domain/compras/schemas'
import { formatCurrency, formatDateShort, hoyLocalISO, sumarDiasCalendario } from '../../lib/format'
import {
  CATEGORIAS_GASTO_CXP,
  ESTADO_FACTURA_PROV_LABELS,
  ESTADO_ORDEN_PAGO_LABELS,
  METODOS_PAGO_CXP,
  type FacturaProveedorConProveedor,
  type MetodoPagoCxP,
  type OrdenPagoConRelaciones,
} from '../../types/cxp'
import { Campo, btnLink, btnPrimario, btnSecundario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
}

type Vista = 'facturas' | 'ordenes' | 'antiguedad' | 'proyeccion'

const TONO_FACTURA = {
  registrada: 'info', aprobada: 'warning', pagada_parcial: 'warning', pagada: 'success', anulada: 'neutral',
} as const
const TONO_ORDEN = { borrador: 'info', aprobada: 'warning', pagada: 'success', anulada: 'neutral' } as const

export function CuentasPorPagarTab({ companyId, projectId, monedaBase }: Props) {
  // Cada PASO exige SU llave Y «Editar» (la política de UPDATE pide editar y el servidor además pide la llave de la
  // acción): aprobar la factura, aprobar la orden de pago, pagar y anular el pago son cuatro permisos distintos. La
  // combinación se decide una sola vez (`decidirPasosCompras`); anular la factura sigue con «Cambiar estado» + «Editar».
  const {
    puedeCrear, puedeAprobarFactura, puedeAprobarOrdenPago, puedeEjecutarPago, puedeAnularPago, puedeCambiarEstadoPaso,
  } = usePermisosContabilidad()
  const [vista, setVista] = useState<Vista>('facturas')
  const [nuevaFactura, setNuevaFactura] = useState(false)
  const [ordenPara, setOrdenPara] = useState<FacturaProveedorConProveedor | null>(null)
  const [cuadreDe, setCuadreDe] = useState<FacturaProveedorConProveedor | null>(null)
  const [emitirContrasena, setEmitirContrasena] = useState(false)

  // `projectId` es la IDENTIDAD de la contabilidad activa, no un filtro opcional:
  // sin pasarlo, estas dos listas traían las facturas y órdenes de TODAS las
  // contabilidades de la empresa y las mostraban dentro de cualquiera de ellas
  // —mientras la antigüedad y la proyección, que sí lo pasan, mostraban otra
  // cosa en la misma pantalla—.
  const { data: facturas = [], isLoading: cargandoFacturas } = useFacturasProveedorQuery(companyId, { projectId })
  const { data: ordenes = [], isLoading: cargandoOrdenes } = useOrdenesPagoQuery(companyId, { projectId })
  const { data: aging = [] } = useAgingQuery(companyId, projectId)
  const { data: proyeccion = [] } = useProyeccionPagosQuery(vista === 'proyeccion' ? companyId : undefined, projectId)
  const totalProyectado = proyeccion.reduce((s, f) => s + f.total, 0)

  const aprobarFactura = useAprobarFacturaMutation(companyId)
  const anularFactura = useAnularFacturaMutation(companyId)
  const aprobarOrden = useAprobarOrdenMutation(companyId)
  const pagarOrden = useMarcarOrdenPagadaMutation(companyId)
  const anularOrden = useAnularOrdenMutation(companyId)

  async function accion(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      notify({ variant: 'success', title: 'Listo', text: ok })
    } catch (e) {
      // El rechazo de permiso o de alcance nombra lo que hay que pedir: se queda el tiempo de leerlo entero.
      notify({ variant: 'error', title: 'Error', duration: DURACION_ERROR_LARGO_MS, text: mensajeAccionCompras(e, 'No se pudo completar la acción.') })
    }
  }

  const facturaColumns: DataTableColumn<FacturaProveedorConProveedor>[] = [
    { key: 'proveedor', header: 'Proveedor', accessor: (f) => f.proveedores?.nombre ?? '', render: (f) => f.proveedores?.nombre ?? '—', sortable: true },
    { key: 'numero', header: 'Factura', accessor: (f) => f.numero_factura ?? '', render: (f) => f.numero_factura ?? '—', width: 100, hideOnMobile: true },
    { key: 'concepto', header: 'Concepto', accessor: (f) => f.concepto, hideOnMobile: true },
    { key: 'vence', header: 'Vence', accessor: (f) => f.fecha_vencimiento ?? '', render: (f) => f.fecha_vencimiento ? formatDateShort(f.fecha_vencimiento) : '—', sortable: true, width: 100 },
    {
      key: 'total',
      header: 'Total',
      accessor: (f) => f.monto_total,
      render: (f) => formatCurrency(f.monto_total, f.moneda ?? monedaBase),
      numeric: true,
      width: 120,
    },
    {
      key: 'saldo',
      header: 'Saldo',
      accessor: (f) => saldoFactura(f),
      render: (f) => formatCurrency(saldoFactura(f), f.moneda ?? monedaBase),
      numeric: true,
      width: 120,
    },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (f) => f.estado,
      render: (f) => <StatusBadge tone={TONO_FACTURA[f.estado]}>{ESTADO_FACTURA_PROV_LABELS[f.estado]}</StatusBadge>,
      width: 120,
    },
    {
      key: 'acciones',
      header: '',
      render: (f) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {/* Con orden de compra detrás, aprobar pasa por el cuadre de 3 vías:
              lo pedido, lo recibido y lo facturado tienen que coincidir. Sin
              orden (gasto directo, caja chica) se aprueba como siempre. */}
          {f.estado === 'registrada' && puedeAprobarFactura && f.orden_compra_id && (
            <button onClick={(e) => { e.stopPropagation(); setCuadreDe(f) }} style={btnLink}>Revisar y aprobar</button>
          )}
          {f.estado === 'registrada' && puedeAprobarFactura && !f.orden_compra_id && (
            <button
              onClick={(e) => { e.stopPropagation(); void accion(() => aprobarFactura.mutateAsync(f.id), 'Factura aprobada: el gasto quedó devengado contra CxP.') }}
              style={btnLink}
            >
              Aprobar
            </button>
          )}
          {(f.estado === 'aprobada' || f.estado === 'pagada_parcial') && puedeCrear && (
            <button onClick={(e) => { e.stopPropagation(); setOrdenPara(f) }} style={btnLink}>Pagar</button>
          )}
          {f.estado !== 'anulada' && f.monto_pagado === 0 && puedeCambiarEstadoPaso && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void (async () => {
                  const { isConfirmed } = await confirm({
                    title: '¿Anular factura?',
                    text: f.estado === 'registrada' ? 'La factura quedará anulada.' : 'Se reversará el devengo contable.',
                    confirmText: 'Anular',
                    variant: 'danger',
                  })
                  if (isConfirmed) void accion(() => anularFactura.mutateAsync(f.id), 'Factura anulada.')
                })()
              }}
              style={{ ...btnLink, color: 'var(--at-danger)' }}
            >
              Anular
            </button>
          )}
        </div>
      ),
      width: 170,
    },
  ]

  const ordenColumns: DataTableColumn<OrdenPagoConRelaciones>[] = [
    { key: 'proveedor', header: 'Proveedor', accessor: (o) => o.proveedores?.nombre ?? '', render: (o) => o.proveedores?.nombre ?? '—' },
    {
      key: 'factura',
      header: 'Factura',
      accessor: (o) => o.facturas_proveedor?.numero_factura ?? '',
      render: (o) => o.facturas_proveedor?.numero_factura ?? o.facturas_proveedor?.concepto ?? '—',
      hideOnMobile: true,
    },
    { key: 'metodo', header: 'Método', accessor: (o) => o.metodo_pago, width: 110, hideOnMobile: true },
    { key: 'monto', header: 'Monto', accessor: (o) => o.monto, render: (o) => formatCurrency(o.monto, monedaBase), numeric: true, width: 120 },
    { key: 'fecha', header: 'Pagada', accessor: (o) => o.fecha_pago ?? '', render: (o) => o.fecha_pago ? formatDateShort(o.fecha_pago) : '—', width: 100, hideOnMobile: true },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (o) => o.estado,
      render: (o) => <StatusBadge tone={TONO_ORDEN[o.estado]}>{ESTADO_ORDEN_PAGO_LABELS[o.estado]}</StatusBadge>,
      width: 100,
    },
    {
      key: 'acciones',
      header: '',
      render: (o) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {o.estado === 'borrador' && puedeAprobarOrdenPago && (
            <button onClick={() => void accion(() => aprobarOrden.mutateAsync(o.id), 'Orden aprobada.')} style={btnLink}>Aprobar</button>
          )}
          {o.estado === 'aprobada' && puedeEjecutarPago && (
            <button onClick={() => void accion(() => pagarOrden.mutateAsync({ ordenId: o.id }), 'Orden pagada: asiento generado y saldo de la factura actualizado.')} style={btnLink}>
              Marcar pagada
            </button>
          )}
          {o.estado !== 'anulada' && puedeAnularPago && (
            <button
              onClick={() => {
                void (async () => {
                  const { isConfirmed } = await confirm({
                    title: '¿Anular orden?',
                    text: o.estado === 'pagada' ? 'Se reversará el asiento y se restará el pago de la factura.' : 'La orden quedará anulada.',
                    confirmText: 'Anular',
                    variant: 'danger',
                  })
                  if (isConfirmed) void accion(() => anularOrden.mutateAsync(o.id), 'Orden anulada.')
                })()
              }}
              style={{ ...btnLink, color: 'var(--at-danger)' }}
            >
              Anular
            </button>
          )}
        </div>
      ),
      width: 190,
    },
  ]

  const totalPorPagar = useMemo(() => aging.reduce((s, a) => s + a.total, 0), [aging])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <FilterChips<Vista>
        options={[
          { value: 'facturas', label: 'Facturas', count: facturas.filter((f) => f.estado !== 'anulada').length },
          { value: 'ordenes', label: 'Órdenes de pago', count: ordenes.filter((o) => o.estado !== 'anulada').length },
          { value: 'antiguedad', label: 'Antigüedad de saldos' },
          { value: 'proyeccion', label: 'Proyección de pagos' },
        ]}
        value={vista}
        onChange={setVista}
        ariaLabel="Vista de cuentas por pagar"
      />

      {vista === 'facturas' && (
        <DataTable<FacturaProveedorConProveedor>
          data={facturas}
          columns={facturaColumns}
          rowKey="id"
          isLoading={cargandoFacturas}
          searchableKeys={[(f) => f.proveedores?.nombre ?? '', 'concepto', (f) => f.numero_factura ?? '']}
          searchPlaceholder="Buscar factura…"
          defaultSort={{ key: 'vence', direction: 'asc' }}
          toolbar={puedeCrear
            ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setNuevaFactura(true)} style={btnPrimario}>+ Registrar factura</button>
                <button onClick={() => setEmitirContrasena(true)} style={btnSecundario}>Emitir contraseña de pago</button>
              </div>
            )
            : undefined}
          emptyState={{
            title: 'Sin facturas de proveedor',
            description: 'Registra las facturas por pagar; al aprobarlas se devengan en contabilidad (gasto contra Proveedores por pagar) y se liquidan con órdenes de pago.',
          }}
        />
      )}

      {vista === 'ordenes' && (
        <DataTable<OrdenPagoConRelaciones>
          data={ordenes}
          columns={ordenColumns}
          rowKey="id"
          isLoading={cargandoOrdenes}
          searchableKeys={[(o) => o.proveedores?.nombre ?? '', (o) => o.referencia ?? '']}
          searchPlaceholder="Buscar orden…"
          emptyState={{
            title: 'Sin órdenes de pago',
            description: 'Crea órdenes desde la pestaña Facturas (botón Pagar). Quien tiene el permiso de crear puede solicitarlas; aprobar la orden, marcarla pagada y anular el pago son permisos distintos.',
          }}
        />
      )}

      {vista === 'antiguedad' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Proveedor</th>
                <th style={{ padding: 6 }}>Corriente</th>
                <th style={{ padding: 6 }}>1–30 días</th>
                <th style={{ padding: 6 }}>31–60</th>
                <th style={{ padding: 6 }}>61–90</th>
                <th style={{ padding: 6 }}>+90</th>
                <th style={{ padding: 6 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {aging.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-soft)' }}>Sin saldos por pagar.</td></tr>
              ) : aging.map((a) => (
                <tr key={a.proveedor_id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                  <td style={{ padding: 6 }}>{a.proveedor}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(a.corriente, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(a.d1_30, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: a.d31_60 > 0 ? 'var(--at-warning)' : undefined }}>{formatCurrency(a.d31_60, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: a.d61_90 > 0 ? 'var(--at-warning)' : undefined }}>{formatCurrency(a.d61_90, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: a.d90_mas > 0 ? 'var(--at-danger)' : undefined, fontWeight: a.d90_mas > 0 ? 700 : 400 }}>{formatCurrency(a.d90_mas, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(a.total, monedaBase)}</td>
                </tr>
              ))}
            </tbody>
            {aging.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>
                  <td style={{ padding: 6 }}>Total por pagar</td>
                  <td colSpan={5} />
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(totalPorPagar, monedaBase)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: '8px 0 0' }}>
            Saldos de facturas aprobadas o pagadas parcialmente, por días vencidos contra su fecha de vencimiento.
          </p>
        </div>
      )}

      {vista === 'proyeccion' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6, textAlign: 'left' }}>Proveedor</th>
                <th style={{ padding: 6 }}>Vencido</th>
                <th style={{ padding: 6 }}>0–7 días</th>
                <th style={{ padding: 6 }}>8–14</th>
                <th style={{ padding: 6 }}>15–30</th>
                <th style={{ padding: 6 }}>+30</th>
                <th style={{ padding: 6 }}>Sin fecha</th>
                <th style={{ padding: 6 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {proyeccion.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-soft)' }}>Sin pagos por proyectar.</td></tr>
              ) : proyeccion.map((f) => (
                <tr key={f.proveedor_id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                  <td style={{ padding: 6 }}>{f.proveedor}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: f.vencido > 0 ? 'var(--at-danger)' : undefined, fontWeight: f.vencido > 0 ? 700 : 400 }}>{formatCurrency(f.vencido, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: f.d0_7 > 0 ? 'var(--at-warning)' : undefined }}>{formatCurrency(f.d0_7, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(f.d8_14, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(f.d15_30, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(f.d31_mas, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: 'var(--at-ink-soft)' }}>{formatCurrency(f.sin_fecha, monedaBase)}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(f.total, monedaBase)}</td>
                </tr>
              ))}
            </tbody>
            {proyeccion.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--at-line)' }}>
                  <td style={{ padding: 6 }}>Total proyectado</td>
                  <td colSpan={6} />
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(totalProyectado, monedaBase)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: '8px 0 0' }}>
            Saldos pendientes agrupados por cuándo VENCEN (hacia adelante): lo vencido exige pago inmediato; el resto proyecta el efectivo a reservar.
          </p>
        </div>
      )}

      {nuevaFactura && (
        <FacturaFormModal companyId={companyId} projectId={projectId} monedaBase={monedaBase} onClose={() => setNuevaFactura(false)} />
      )}
      {ordenPara && (
        <OrdenFormModal companyId={companyId} factura={ordenPara} monedaBase={monedaBase} onClose={() => setOrdenPara(null)} />
      )}
      {cuadreDe && (
        <CuadreModal factura={cuadreDe} monedaBase={monedaBase} onClose={() => setCuadreDe(null)} />
      )}
      {emitirContrasena && (
        <ContrasenaFormModal
          companyId={companyId}
          projectId={projectId}
          monedaBase={monedaBase}
          facturas={facturas.filter((f) => f.estado === 'aprobada' || f.estado === 'pagada_parcial')}
          onClose={() => setEmitirContrasena(false)}
        />
      )}
    </div>
  )
}

// ── Modal: cuadre de 3 vías antes de aprobar ────────────────────────────────
// Es el punto donde se paga de más: un precio distinto al cotizado, una
// cantidad que nunca entró, o la misma factura capturada dos veces. La BD
// bloquea la aprobación si algo no cuadra; aquí se muestra QUÉ no cuadra para
// que la decisión de forzarla sea informada y quede escrita.

function CuadreModal({ factura, monedaBase, onClose }: {
  factura: FacturaProveedorConProveedor
  monedaBase: string
  onClose: () => void
}) {
  const { data: filas = [], isLoading } = useCuadreQuery(factura.id)
  const aprobar = useAprobarFacturaConCuadreMutation()
  const [justificacion, setJustificacion] = useState('')

  const problemas = filas.filter((f) => !f.dentro_tolerancia)
  const cuadra = !isLoading && problemas.length === 0

  async function confirmar() {
    if (!cuadra && justificacion.trim().length < 5) {
      notify({
        variant: 'warning', title: 'Falta la justificación',
        text: 'Para aprobar una factura que no cuadra hay que dejar escrito por qué.',
      })
      return
    }
    try {
      await aprobar.mutateAsync({
        facturaId: factura.id,
        justificacion: cuadra ? undefined : justificacion.trim(),
      })
      notify({
        variant: 'success', title: 'Listo',
        text: cuadra
          ? 'Factura aprobada y devengada contra la cuenta puente de la recepción.'
          : 'Factura aprobada con justificación; queda registrada quién la autorizó.',
      })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo aprobar', duration: DURACION_ERROR_LARGO_MS, text: mensajeAccionCompras(e, 'Error inesperado.') })
    }
  }

  return (
    <EditModal title={`Cuadre de ${factura.numero_factura ?? factura.concepto}`} onClose={onClose} size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cerrar</button>
          <button onClick={() => void confirmar()} disabled={aprobar.isPending || isLoading} style={btnPrimario}>
            {cuadra ? 'Aprobar' : 'Aprobar de todos modos'}
          </button>
        </div>
      }
    >
      {isLoading && <p style={{ fontSize: 12 }}>Comparando con la orden…</p>}

      {!isLoading && filas.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Esta factura no tiene renglones ligados a la orden, así que no hay nada
          que comparar. Se aprobará por la ruta de siempre.
        </p>
      )}

      {filas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 860 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                <th style={{ padding: 4 }}>Renglón</th>
                <th style={{ padding: 4, width: 70 }}>Pedido</th>
                <th style={{ padding: 4, width: 80 }}>Recibido</th>
                <th style={{ padding: 4, width: 80 }}>Se factura</th>
                <th style={{ padding: 4, width: 100 }}>Precio OC</th>
                <th style={{ padding: 4, width: 100 }}>Precio factura</th>
                <th style={{ padding: 4, width: 110 }}>IVA OC / factura</th>
                <th style={{ padding: 4, width: 90 }}>Moneda OC / factura</th>
                <th style={{ padding: 4 }}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.linea} style={{ background: f.dentro_tolerancia ? undefined : 'var(--at-danger-tint)' }}>
                  <td style={{ padding: 4 }}>{f.descripcion}</td>
                  <td style={{ padding: 4 }}>{f.cantidad_ordenada}</td>
                  <td style={{ padding: 4 }}>{f.cantidad_recibida}</td>
                  <td style={{ padding: 4 }}>{f.cantidad_factura}</td>
                  <td style={{ padding: 4 }}>{formatCurrency(f.precio_orden, factura.moneda ?? monedaBase)}</td>
                  <td style={{ padding: 4 }}>
                    {formatCurrency(f.precio_factura, factura.moneda ?? monedaBase)}
                    {f.diferencia_pct !== null && f.diferencia_pct !== 0 && (
                      <span style={{ marginLeft: 4, color: f.dentro_tolerancia ? 'var(--at-ink-soft)' : 'var(--at-danger)' }}>
                        ({f.diferencia_pct > 0 ? '+' : ''}{f.diferencia_pct}%)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 4 }} data-testid={`cuadre-iva-${f.linea}`}>
                    {f.iva_orden !== undefined && f.iva_factura !== undefined
                      ? `${formatCurrency(f.iva_orden, f.moneda_orden ?? monedaBase)} / ${formatCurrency(f.iva_factura, f.moneda_factura ?? monedaBase)}`
                      : '—'}
                  </td>
                  <td style={{ padding: 4, color: f.moneda_orden && f.moneda_factura && f.moneda_orden !== f.moneda_factura ? 'var(--at-danger)' : undefined }}
                      data-testid={`cuadre-moneda-${f.linea}`}>
                    {f.moneda_orden ?? '—'} / {f.moneda_factura ?? '—'}
                  </td>
                  <td style={{ padding: 4 }}>
                    <StatusBadge tone={f.dentro_tolerancia ? 'success' : 'danger'}>
                      {f.dentro_tolerancia ? 'Cuadra' : f.motivo}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cuadra && filas.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Campo label="¿Por qué se aprueba de todos modos? *">
            <textarea
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              placeholder="Ej.: alza de precio autorizada por gerencia (correo del 12/08)."
              style={{ ...input, width: '100%', minHeight: 60 }}
            />
          </Campo>
        </div>
      )}
    </EditModal>
  )
}

// ── Modal: emitir contraseña de pago ────────────────────────────────────────
// El acuse que se le devuelve al proveedor cuando entrega sus facturas: dice
// cuáles se le recibieron y qué día se le pagan. Agrupa varias del MISMO
// proveedor y después una sola orden de pago las cancela todas.

function ContrasenaFormModal({ companyId, projectId, monedaBase, facturas, onClose }: {
  companyId: string
  projectId: string | null
  monedaBase: string
  facturas: FacturaProveedorConProveedor[]
  onClose: () => void
}) {
  const crear = useCrearContrasenaMutation(companyId, projectId)
  // Una clave por apertura del formulario (ver la nota de la orden de pago): un doble clic no emite dos contraseñas.
  const claveIdempotencia = useRef(nuevaClaveIdempotencia('cp'))
  const [proveedorId, setProveedorId] = useState('')
  const [fechaPago, setFechaPago] = useState('')
  const [entregadaPor, setEntregadaPor] = useState('')
  const [recibidaPor, setRecibidaPor] = useState('')
  const [elegidas, setElegidas] = useState<Record<string, boolean>>({})

  // Solo facturas con saldo del proveedor elegido: la contraseña no mezcla
  // proveedores (la BD lo rechaza) y no puede cubrir más que el saldo vivo.
  const candidatas = useMemo(
    () => facturas.filter((f) => f.proveedor_id === proveedorId && saldoFactura(f) > 0),
    [facturas, proveedorId],
  )
  const proveedoresConSaldo = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of facturas) {
      if (saldoFactura(f) > 0) m.set(f.proveedor_id, f.proveedores?.nombre ?? '—')
    }
    return [...m.entries()]
  }, [facturas])

  const total = candidatas.reduce((s, f) => s + (elegidas[f.id] ? saldoFactura(f) : 0), 0)

  async function guardar() {
    const parsed = contrasenaFormSchema.safeParse({
      proveedor_id: proveedorId,
      fecha_emision: hoyLocalISO(),
      fecha_pago_programada: fechaPago,
      entregada_por: entregadaPor.trim() || null,
      recibida_por: recibidaPor.trim() || null,
      observaciones: null,
      clave_idempotencia: claveIdempotencia.current,
      facturas: candidatas
        .filter((f) => elegidas[f.id])
        .map((f) => ({ factura_id: f.id, monto: saldoFactura(f) })),
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await crear.mutateAsync(parsed.data)
      notify({
        variant: 'success', title: 'Contraseña emitida',
        text: 'Queda en la pestaña Compras. Al pagarla, una sola orden cancela todas sus facturas.',
      })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo emitir.' })
    }
  }

  return (
    <EditModal title="Emitir contraseña de pago" onClose={onClose} size="md"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending || total <= 0} style={btnPrimario}>Emitir</button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Campo label="Proveedor *">
          <select
            value={proveedorId}
            onChange={(e) => { setProveedorId(e.target.value); setElegidas({}) }}
            style={input}
          >
            <option value="">Selecciona…</option>
            {proveedoresConSaldo.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Se le paga el *">
          <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} style={input} />
        </Campo>
        <Campo label="Entregada por">
          <input value={entregadaPor} onChange={(e) => setEntregadaPor(e.target.value)} style={input} />
        </Campo>
        <Campo label="Recibida por (del proveedor)">
          <input value={recibidaPor} onChange={(e) => setRecibidaPor(e.target.value)} style={input} />
        </Campo>
      </div>

      <div style={{ marginTop: 14 }}>
        <strong style={{ fontSize: 12 }}>Facturas que cubre</strong>
        {!proveedorId && (
          <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Elige primero el proveedor.</p>
        )}
        {proveedorId && candidatas.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
            Este proveedor no tiene facturas aprobadas con saldo en esta contabilidad.
          </p>
        )}
        {candidatas.map((f) => (
          <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={!!elegidas[f.id]}
              onChange={(e) => setElegidas((s) => ({ ...s, [f.id]: e.target.checked }))}
            />
            <span style={{ flex: 1 }}>{f.numero_factura ?? f.concepto}</span>
            <span>{formatCurrency(saldoFactura(f), f.moneda ?? monedaBase)}</span>
          </label>
        ))}
        {total > 0 && (
          <p style={{ margin: '10px 0 0', textAlign: 'right', fontSize: 13 }}>
            <strong>Total de la contraseña: {formatCurrency(total, monedaBase)}</strong>
          </p>
        )}
      </div>
    </EditModal>
  )
}

// ── Modal: registrar factura ────────────────────────────────────────────────
//
// Dos modos. SIN orden: gasto directo (monto total + IVA), como siempre. CON
// orden: la factura se captura por RENGLÓN contra lo recibido y aún no facturado;
// el servidor cuadra cada renglón (cantidad, precio, IVA, moneda) al aprobarla y
// la deja devengar contra «Bienes y servicios por facturar». Sin esta captura no
// existía forma de facturar contra una orden desde la interfaz.

/** Estados de orden contra los que ya hay algo recibido que facturar. */
const ESTADOS_FACTURABLES = ['recibida_parcial', 'recibida']

type RenglonEdit = { cantidad: string; precio: string; iva: string; ivaManual: boolean }

export function FacturaFormModal({ companyId, projectId, monedaBase, onClose }: {
  companyId: string
  projectId: string | null
  monedaBase: string
  onClose: () => void
}) {
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  const { data: ordenes = [] } = useOrdenesCompraQuery(companyId, projectId)
  const crear = useCrearFacturaProveedorMutation(companyId)
  const [f, setF] = useState({
    proveedor_id: '', numero_factura: '',
    fecha_emision: hoyLocalISO(), fecha_vencimiento: '',
    concepto: '', categoria: 'otros', moneda: '', monto_total: '', iva_monto: '', notas: '',
  })
  const [ordenId, setOrdenId] = useState('')
  const [edit, setEdit] = useState<Record<string, RenglonEdit>>({})
  // Una clave por apertura del formulario: un doble clic o un reintento tras un corte de
  // red devuelve LA MISMA factura en vez de crear otra. Si el servidor rechazó el intento
  // no dejó nada, así que la misma clave sirve para el reintento corregido.
  const claveIdempotencia = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `fac-${Date.now()}-${Math.random()}`)

  const ordenesDelProveedor = useMemo(
    () => ordenes.filter((o) =>
      o.proveedor_id === f.proveedor_id
      && (o.project_id ?? null) === (projectId ?? null)
      && ESTADOS_FACTURABLES.includes(o.estado)),
    [ordenes, f.proveedor_id, projectId],
  )
  const orden = ordenesDelProveedor.find((o) => o.id === ordenId) ?? null
  const { data: lineasOC = [], isLoading: cargandoLineas } = useOrdenCompraLineasQuery(orden?.id)

  // Lo que falta por facturar de cada renglón: recibido (aceptado) menos facturado.
  const renglonesOC = useMemo(
    () => lineasOC
      .map((l) => ({ ...l, porFacturar: redondear2(l.cantidad_recibida - l.cantidad_facturada) }))
      .filter((l) => l.porFacturar > 0),
    [lineasOC],
  )

  function valorDe(l: (typeof renglonesOC)[number]): RenglonEdit {
    const e = edit[l.id]
    const cantidad = e?.cantidad ?? String(l.porFacturar)
    const prorrata = l.cantidad > 0 ? redondear2(l.iva_monto * (parseFloat(cantidad) || 0) / l.cantidad) : 0
    return {
      cantidad,
      precio: e?.precio ?? String(l.precio_unitario),
      iva: e?.ivaManual ? e.iva : String(prorrata),
      ivaManual: e?.ivaManual ?? false,
    }
  }
  function cambiar(l: (typeof renglonesOC)[number], campo: 'cantidad' | 'precio' | 'iva', valor: string) {
    const actual = valorDe(l)
    setEdit((m) => ({
      ...m,
      [l.id]: { ...actual, [campo]: valor, ivaManual: campo === 'iva' ? true : actual.ivaManual },
    }))
  }

  const renglonesCapturados = renglonesOC
    .map((l) => {
      const v = valorDe(l)
      return {
        orden_compra_linea_id: l.id,
        descripcion: l.descripcion,
        cantidad: parseFloat(v.cantidad) || 0,
        precio_unitario: parseFloat(v.precio) || 0,
        iva_monto: parseFloat(v.iva) || 0,
      }
    })
    .filter((r) => r.cantidad > 0)
  const totales = totalesFactura(renglonesCapturados)

  function onProveedor(id: string) {
    const p = proveedores.find((x) => x.id === id)
    let vence = f.fecha_vencimiento
    if (p && p.dias_credito > 0 && !vence) {
      vence = sumarDiasCalendario(f.fecha_emision, p.dias_credito) ?? vence
    }
    setOrdenId(''); setEdit({})
    setF({ ...f, proveedor_id: id, categoria: p?.categoria_default ?? f.categoria, fecha_vencimiento: vence })
  }

  function onOrden(id: string) {
    setOrdenId(id); setEdit({})
    const o = ordenesDelProveedor.find((x) => x.id === id)
    setF((prev) => ({
      ...prev,
      moneda: o?.moneda ?? '',
      concepto: o && !prev.concepto.trim() ? `Factura de la orden ${o.numero ?? o.concepto}` : prev.concepto,
    }))
  }

  async function guardar() {
    const conOrden = !!orden
    if (conOrden) {
      if (renglonesCapturados.length === 0) {
        notify({ variant: 'warning', title: 'Atención', text: 'Indica al menos un renglón con cantidad a facturar.' })
        return
      }
      const malo = renglonesCapturados
        .map((r) => facturaRenglonSchema.safeParse(r))
        .find((r) => !r.success)
      if (malo && !malo.success) {
        notify({ variant: 'warning', title: 'Atención', text: malo.error.issues[0]?.message ?? 'Renglón inválido.' })
        return
      }
    }
    const parsed = facturaProveedorFormSchema.safeParse({
      proveedor_id: f.proveedor_id,
      project_id: projectId,
      numero_factura: f.numero_factura.trim() || null,
      fecha_emision: f.fecha_emision,
      fecha_vencimiento: f.fecha_vencimiento || null,
      concepto: f.concepto,
      categoria: f.categoria,
      // Con orden, la moneda de la factura es la de la orden: otra distinta nunca cuadra.
      moneda: conOrden ? (orden!.moneda ?? null) : (f.moneda.trim() || null),
      monto_total: conOrden ? totales.total : parseFloat(f.monto_total),
      iva_monto: conOrden ? totales.iva : (parseFloat(f.iva_monto) || 0),
      notas: f.notas.trim() || null,
      orden_compra_id: conOrden ? orden!.id : null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      const creada = await crear.mutateAsync({
        ...parsed.data,
        clave_idempotencia: claveIdempotencia.current,
        ...(conOrden ? { renglones: renglonesCapturados } : {}),
      })
      notify({
        variant: 'success', title: creada.reutilizada ? 'Ya estaba registrada' : 'Registrada',
        text: creada.reutilizada
          ? 'Esta factura ya se había registrado con estos mismos datos; no se creó otra.'
          : conOrden
          ? 'Factura registrada contra la orden. Al aprobarla se cuadra con lo ordenado y lo recibido.'
          : 'Factura registrada. Apruébala para devengar el gasto.',
      })
      onClose()
    } catch (e) {
      // Los mensajes del servidor (COMPRAS_FACTURA_*) están escritos para leerse tal cual:
      // número repetido, clave ya usada con otro contenido, renglón ajeno, etc. El de número repetido mide ~270
      // caracteres (qué factura es la equivalente y cómo escribir el número): el aviso de 3,5 s por omisión no alcanza
      // para leerlo, así que este error dura lo suficiente para entender qué hacer.
      notify({
        variant: 'error', title: 'Error', duration: DURACION_ERROR_LARGO_MS,
        text: e instanceof Error ? textoErrorServidor(e.message) : 'No se pudo registrar.',
      })
    }
  }

  return (
    <EditModal title="Registrar factura de proveedor" onClose={onClose} size={orden ? 'lg' : 'md'}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending} style={btnPrimario}>Registrar</button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Proveedor *">
            <select value={f.proveedor_id} onChange={(e) => onProveedor(e.target.value)} style={{ ...input, width: '100%' }}>
              <option value="">Selecciona…</option>
              {proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
        </div>
        {f.proveedor_id && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Campo label="Orden de compra (opcional)">
              <select value={ordenId} onChange={(e) => onOrden(e.target.value)} style={{ ...input, width: '100%' }}
                      aria-label="Orden de compra a facturar">
                <option value="">Sin orden (gasto directo)</option>
                {ordenesDelProveedor.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero ?? 'Sin número'} · {o.concepto} · {formatCurrency(o.total, o.moneda ?? monedaBase)}
                  </option>
                ))}
              </select>
            </Campo>
            {ordenesDelProveedor.length === 0 && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--at-ink-soft)' }}>
                Este proveedor no tiene órdenes con algo recibido por facturar en esta contabilidad.
              </p>
            )}
          </div>
        )}
        <Campo label="No. de factura">
          <input value={f.numero_factura} onChange={(e) => setF({ ...f, numero_factura: e.target.value })} style={input} />
        </Campo>

        <Campo label="Fecha de emisión">
          <input type="date" value={f.fecha_emision} onChange={(e) => setF({ ...f, fecha_emision: e.target.value })} style={input} />
        </Campo>
        <Campo label="Vencimiento">
          <input type="date" value={f.fecha_vencimiento} onChange={(e) => setF({ ...f, fecha_vencimiento: e.target.value })} style={input} />
        </Campo>
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Concepto *">
            <input value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} style={{ ...input, width: '100%' }} />
          </Campo>
        </div>
        <Campo label="Categoría de gasto">
          <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} style={input}>
            {CATEGORIAS_GASTO_CXP.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        {!orden && (
          <>
            <Campo label={`Moneda (vacío = ${monedaBase})`}>
              <input value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value.toUpperCase() })} style={input} maxLength={3} placeholder={monedaBase} />
            </Campo>
            <Campo label="Monto total *">
              <input type="number" min="0" step="0.01" value={f.monto_total} onChange={(e) => setF({ ...f, monto_total: e.target.value })} style={{ ...input, textAlign: 'right' }} />
            </Campo>
            <Campo label="IVA incluido">
              <input type="number" min="0" step="0.01" value={f.iva_monto} onChange={(e) => setF({ ...f, iva_monto: e.target.value })} style={{ ...input, textAlign: 'right' }} />
            </Campo>
          </>
        )}
        {orden && (
          <div style={{ gridColumn: '1 / -1' }}>
            <strong style={{ fontSize: 12 }}>Qué se factura de {orden.numero ?? 'la orden'}</strong>
            {cargandoLineas && <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Cargando renglones…</p>}
            {!cargandoLineas && renglonesOC.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Todo lo recibido de esta orden ya está facturado.</p>
            )}
            {renglonesOC.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                      <th style={{ padding: 4 }}>Renglón</th>
                      <th style={{ padding: 4, width: 90 }}>Por facturar</th>
                      <th style={{ padding: 4, width: 100 }}>A facturar</th>
                      <th style={{ padding: 4, width: 100 }}>Precio</th>
                      <th style={{ padding: 4, width: 100 }}>IVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renglonesOC.map((l) => {
                      const v = valorDe(l)
                      return (
                        <tr key={l.id}>
                          <td style={{ padding: 4 }}>{l.descripcion}</td>
                          <td style={{ padding: 4 }}>{l.porFacturar} {l.unidad}</td>
                          <td style={{ padding: 2 }}>
                            <input type="number" min="0" step="0.01" value={v.cantidad}
                                   onChange={(e) => cambiar(l, 'cantidad', e.target.value)}
                                   style={{ ...input, width: '100%' }} aria-label={`Cantidad a facturar de ${l.descripcion}`} />
                          </td>
                          <td style={{ padding: 2 }}>
                            <input type="number" min="0" step="0.01" value={v.precio}
                                   onChange={(e) => cambiar(l, 'precio', e.target.value)}
                                   style={{ ...input, width: '100%' }} aria-label={`Precio facturado de ${l.descripcion}`} />
                          </td>
                          <td style={{ padding: 2 }}>
                            <input type="number" min="0" step="0.01" value={v.iva}
                                   onChange={(e) => cambiar(l, 'iva', e.target.value)}
                                   style={{ ...input, width: '100%' }} aria-label={`IVA facturado de ${l.descripcion}`} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: '6px 0 0' }}>
              Total de la factura: <strong>{formatCurrency(totales.total, orden.moneda ?? monedaBase)}</strong>
              {' '}(IVA {formatCurrency(totales.iva, orden.moneda ?? monedaBase)}). Lo que no cuadre con lo ordenado o recibido se
              mostrará al aprobarla.
            </p>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Notas">
            <textarea value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} style={{ ...input, width: '100%', minHeight: 50 }} />
          </Campo>
        </div>
      </div>
    </EditModal>
  )
}

// ── Modal: orden de pago para una factura ───────────────────────────────────

function OrdenFormModal({ companyId, factura, monedaBase, onClose }: {
  companyId: string
  factura: FacturaProveedorConProveedor
  monedaBase: string
  onClose: () => void
}) {
  const crear = useCrearOrdenPagoMutation(companyId)
  const saldo = saldoFactura(factura)
  // Una clave por apertura del formulario: el doble clic o el reintento tras un corte devuelven LA MISMA orden de
  // pago en vez de crear (y luego pagar) otra. Si la creación falla, no queda nada y la misma clave sirve al reintento.
  const claveIdempotencia = useRef(nuevaClaveIdempotencia('op'))
  const [o, setO] = useState({
    monto: String(saldo),
    metodo_pago: 'transferencia' as MetodoPagoCxP,
    fecha_pago: hoyLocalISO(),
    referencia: '',
    notas: '',
  })

  async function guardar() {
    const monto = parseFloat(o.monto)
    if (monto > saldo) {
      notify({ variant: 'warning', title: 'Atención', text: `El monto excede el saldo pendiente (${formatCurrency(saldo, factura.moneda ?? monedaBase)}).` })
      return
    }
    const parsed = ordenPagoFormSchema.safeParse({
      factura_id: factura.id,
      monto,
      metodo_pago: o.metodo_pago,
      fecha_pago: o.fecha_pago || null,
      referencia: o.referencia.trim() || null,
      notas: o.notas.trim() || null,
      clave_idempotencia: claveIdempotencia.current,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await crear.mutateAsync({ input: parsed.data, proveedorId: factura.proveedor_id, projectId: factura.project_id })
      notify({ variant: 'success', title: 'Solicitada', text: 'Orden de pago creada en borrador; apruébala y márcala pagada para contabilizar.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo crear la orden.' })
    }
  }

  return (
    <EditModal
      title="Nueva orden de pago"
      subtitle={`${factura.proveedores?.nombre ?? ''} · saldo pendiente ${formatCurrency(saldo, factura.moneda ?? monedaBase)}`}
      onClose={onClose}
      size="sm"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void guardar()} disabled={crear.isPending} style={btnPrimario}>Crear orden</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Monto *">
            <input type="number" min="0" step="0.01" value={o.monto} onChange={(e) => setO({ ...o, monto: e.target.value })} style={{ ...input, textAlign: 'right' }} />
          </Campo>
          <Campo label="Método">
            <select value={o.metodo_pago} onChange={(e) => setO({ ...o, metodo_pago: e.target.value as MetodoPagoCxP })} style={input}>
              {METODOS_PAGO_CXP.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Campo>
          <Campo label="Fecha de pago">
            <input type="date" value={o.fecha_pago} onChange={(e) => setO({ ...o, fecha_pago: e.target.value })} style={input} />
          </Campo>
          <Campo label="Referencia">
            <input value={o.referencia} onChange={(e) => setO({ ...o, referencia: e.target.value })} style={input} placeholder="No. cheque / transferencia" />
          </Campo>
        </div>
        <Campo label="Notas">
          <textarea value={o.notas} onChange={(e) => setO({ ...o, notas: e.target.value })} style={{ ...input, minHeight: 50 }} />
        </Campo>
      </div>
    </EditModal>
  )
}
