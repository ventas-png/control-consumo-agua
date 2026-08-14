import { useMemo, useState } from 'react'
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
import { facturaProveedorFormSchema, ordenPagoFormSchema, saldoFactura } from '../../domain/cxp/schemas'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
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
  const { puedeCrear, puedeCambiarEstado, puedeAutorizar } = usePermisosContabilidad()
  const [vista, setVista] = useState<Vista>('facturas')
  const [nuevaFactura, setNuevaFactura] = useState(false)
  const [ordenPara, setOrdenPara] = useState<FacturaProveedorConProveedor | null>(null)

  const { data: facturas = [], isLoading: cargandoFacturas } = useFacturasProveedorQuery(companyId)
  const { data: ordenes = [], isLoading: cargandoOrdenes } = useOrdenesPagoQuery(companyId)
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
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo completar la acción.' })
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
          {f.estado === 'registrada' && puedeAutorizar && (
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
          {f.estado !== 'anulada' && f.monto_pagado === 0 && puedeCambiarEstado && (
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
          {o.estado === 'borrador' && puedeAutorizar && (
            <button onClick={() => void accion(() => aprobarOrden.mutateAsync(o.id), 'Orden aprobada.')} style={btnLink}>Aprobar</button>
          )}
          {o.estado === 'aprobada' && puedeCambiarEstado && (
            <button onClick={() => void accion(() => pagarOrden.mutateAsync({ ordenId: o.id }), 'Orden pagada: asiento generado y saldo de la factura actualizado.')} style={btnLink}>
              Marcar pagada
            </button>
          )}
          {o.estado !== 'anulada' && puedeCambiarEstado && (
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
            ? <button onClick={() => setNuevaFactura(true)} style={btnPrimario}>+ Registrar factura</button>
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
            description: 'Crea órdenes desde la pestaña Facturas (botón Pagar). Un operador puede solicitarlas; aprobar y marcar pagada es de administradores.',
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
    </div>
  )
}

// ── Modal: registrar factura ────────────────────────────────────────────────

function FacturaFormModal({ companyId, projectId, monedaBase, onClose }: {
  companyId: string
  projectId: string | null
  monedaBase: string
  onClose: () => void
}) {
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  const crear = useCrearFacturaProveedorMutation(companyId)
  const [f, setF] = useState({
    proveedor_id: '', numero_factura: '',
    fecha_emision: hoyLocalISO(), fecha_vencimiento: '',
    concepto: '', categoria: 'otros', moneda: '', monto_total: '', iva_monto: '', notas: '',
  })

  function onProveedor(id: string) {
    const p = proveedores.find((x) => x.id === id)
    let vence = f.fecha_vencimiento
    if (p && p.dias_credito > 0 && !vence) {
      const d = new Date(f.fecha_emision + 'T12:00:00')
      d.setDate(d.getDate() + p.dias_credito)
      vence = d.toISOString().slice(0, 10)
    }
    setF({ ...f, proveedor_id: id, categoria: p?.categoria_default ?? f.categoria, fecha_vencimiento: vence })
  }

  async function guardar() {
    const parsed = facturaProveedorFormSchema.safeParse({
      proveedor_id: f.proveedor_id,
      project_id: projectId,
      numero_factura: f.numero_factura.trim() || null,
      fecha_emision: f.fecha_emision,
      fecha_vencimiento: f.fecha_vencimiento || null,
      concepto: f.concepto,
      categoria: f.categoria,
      moneda: f.moneda.trim() || null,
      monto_total: parseFloat(f.monto_total),
      iva_monto: parseFloat(f.iva_monto) || 0,
      notas: f.notas.trim() || null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await crear.mutateAsync(parsed.data)
      notify({ variant: 'success', title: 'Registrada', text: 'Factura registrada. Apruébala para devengar el gasto.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo registrar.' })
    }
  }

  return (
    <EditModal title="Registrar factura de proveedor" onClose={onClose} size="md"
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
        <Campo label={`Moneda (vacío = ${monedaBase})`}>
          <input value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value.toUpperCase() })} style={input} maxLength={3} placeholder={monedaBase} />
        </Campo>
        <Campo label="Monto total *">
          <input type="number" min="0" step="0.01" value={f.monto_total} onChange={(e) => setF({ ...f, monto_total: e.target.value })} style={{ ...input, textAlign: 'right' }} />
        </Campo>
        <Campo label="IVA incluido">
          <input type="number" min="0" step="0.01" value={f.iva_monto} onChange={(e) => setF({ ...f, iva_monto: e.target.value })} style={{ ...input, textAlign: 'right' }} />
        </Campo>
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
