// Seguimiento de compras: UNA pantalla filtrable (proyecto, proveedor, estado, fechas) para
// Operaciones, Compras y Contabilidad. Reutiliza `compras_seguimiento_lista` (una fila por orden)
// y el detalle `compras_seguimiento_orden` (SeguimientoOrdenModal), que enlaza orden, recepciones,
// facturas y pagos sin duplicar registros.
//
// Lo que ve cada quien lo decide el SERVIDOR: sin acceso a Contabilidad, facturado, pagado y los
// pendientes financieros llegan null y la pantalla ni siquiera dibuja esas columnas. Cada fila va
// en la moneda de SU orden: los totales se agrupan POR MONEDA y nunca se suman monedas distintas
// (no hay conversión implícita).
import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import { useProyectosQuery } from '../../domain/agua/queries'
import { useSeguimientoListaQuery } from '../../domain/compras/queries'
import { formatCurrency, formatDateShort } from '../../lib/format'
import { ESTADO_OC_LABELS, type EstadoOrdenCompra, type FilaSeguimiento } from '../../types/compras'
import { Campo, btnLink, input } from '../contabilidad/ui'
import { SeguimientoOrdenModal } from './SeguimientoOrdenModal'

const TONO_ESTADO: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  borrador: 'neutral', aprobada: 'info', emitida: 'info', recibida_parcial: 'warning',
  recibida: 'success', cerrada: 'success', cancelada: 'danger',
}

interface Props {
  companyId: string
  /** Contabilidad activa: null = la de la EMPRESA. Es el alcance inicial del filtro de proyecto. */
  projectId?: string | null
  monedaBase: string
}

export interface TotalMoneda {
  moneda: string
  ordenes: number
  comprometido: number
  recibido: number
  facturado: number | null
  pagado: number | null
  pendientePorRecibir: number
  pendientePorFacturar: number | null
  pendientePorPagar: number | null
}

/** Totales por moneda: las monedas distintas NUNCA se suman entre sí. */
export function totalesPorMoneda(filas: readonly FilaSeguimiento[]): TotalMoneda[] {
  const m = new Map<string, TotalMoneda>()
  for (const f of filas) {
    const t = m.get(f.moneda) ?? {
      moneda: f.moneda, ordenes: 0, comprometido: 0, recibido: 0, facturado: null, pagado: null,
      pendientePorRecibir: 0, pendientePorFacturar: null, pendientePorPagar: null,
    }
    t.ordenes += 1
    t.comprometido += f.comprometido
    t.recibido += f.recibido
    t.pendientePorRecibir += f.pendiente_por_recibir
    if (f.facturado !== null) t.facturado = (t.facturado ?? 0) + f.facturado
    if (f.pagado !== null) t.pagado = (t.pagado ?? 0) + f.pagado
    if (f.pendiente_por_facturar !== null) t.pendientePorFacturar = (t.pendientePorFacturar ?? 0) + f.pendiente_por_facturar
    if (f.pendiente_por_pagar !== null) t.pendientePorPagar = (t.pendientePorPagar ?? 0) + f.pendiente_por_pagar
    m.set(f.moneda, t)
  }
  return [...m.values()].sort((a, b) => a.moneda.localeCompare(b.moneda))
}

export function SeguimientoComprasPanel({ companyId, projectId, monedaBase }: Props) {
  const { data: proyectos = [] } = useProyectosQuery(companyId)
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  // Alcance: 'todos' = todo lo que el usuario puede ver; 'empresa' = contabilidad de la empresa; uuid = ese proyecto.
  const [alcance, setAlcance] = useState<string>(projectId ?? 'empresa')
  const [proveedorId, setProveedorId] = useState('')
  const [estado, setEstado] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [verOrden, setVerOrden] = useState<string | null>(null)

  const { data: filas = [], isLoading, isError, error } = useSeguimientoListaQuery(companyId, {
    projectId: alcance !== 'todos' && alcance !== 'empresa' ? alcance : null,
    soloEmpresa: alcance === 'empresa',
    proveedorId: proveedorId || null,
    estado: estado || null,
    desde: desde || null,
    hasta: hasta || null,
  })

  // Si el servidor no entregó importes de facturación, no se dibujan esas columnas.
  const verFinanzas = filas.some((f) => f.facturado !== null)
  const totales = useMemo(() => totalesPorMoneda(filas), [filas])
  const $ = (n: number | null, moneda: string) => (n === null ? '—' : formatCurrency(n, moneda))

  const columnas: DataTableColumn<FilaSeguimiento>[] = [
    { key: 'numero', header: 'N.º', accessor: (f) => f.numero ?? '', render: (f) => f.numero ?? '—', width: 100, sortable: true },
    { key: 'proveedor', header: 'Proveedor', accessor: (f) => f.proveedor, sortable: true },
    { key: 'concepto', header: 'Concepto', accessor: (f) => f.concepto, hideOnMobile: true },
    { key: 'fecha', header: 'Fecha', accessor: (f) => f.fecha, render: (f) => formatDateShort(f.fecha), width: 100, hideOnMobile: true, sortable: true },
    {
      key: 'estado', header: 'Estado', accessor: (f) => f.estado, width: 130,
      render: (f) => <StatusBadge tone={TONO_ESTADO[f.estado] ?? 'neutral'}>{ESTADO_OC_LABELS[f.estado] ?? f.estado}</StatusBadge>,
    },
    { key: 'moneda', header: 'Moneda', accessor: (f) => f.moneda, width: 80 },
    { key: 'comprometido', header: 'Comprometido', accessor: (f) => f.comprometido, numeric: true, render: (f) => $(f.comprometido, f.moneda), width: 120 },
    { key: 'recibido', header: 'Recibido', accessor: (f) => f.recibido, numeric: true, render: (f) => $(f.recibido, f.moneda), width: 110 },
    ...(verFinanzas ? [
      { key: 'facturado', header: 'Facturado', accessor: (f: FilaSeguimiento) => f.facturado ?? 0, numeric: true, render: (f: FilaSeguimiento) => $(f.facturado, f.moneda), width: 110 },
      { key: 'pagado', header: 'Pagado', accessor: (f: FilaSeguimiento) => f.pagado ?? 0, numeric: true, render: (f: FilaSeguimiento) => $(f.pagado, f.moneda), width: 110 },
    ] as DataTableColumn<FilaSeguimiento>[] : []),
    { key: 'pend_rec', header: 'Pend. recibir', accessor: (f) => f.pendiente_por_recibir, numeric: true, render: (f) => $(f.pendiente_por_recibir, f.moneda), width: 120 },
    ...(verFinanzas ? [
      { key: 'pend_fac', header: 'Pend. facturar', accessor: (f: FilaSeguimiento) => f.pendiente_por_facturar ?? 0, numeric: true, render: (f: FilaSeguimiento) => $(f.pendiente_por_facturar, f.moneda), width: 120 },
      { key: 'dif_precio', header: 'Dif. de precio', accessor: (f: FilaSeguimiento) => f.diferencia_precio_facturada ?? 0, numeric: true, render: (f: FilaSeguimiento) => $(f.diferencia_precio_facturada, f.moneda), width: 120 },
      { key: 'pend_pag', header: 'Pend. pagar', accessor: (f: FilaSeguimiento) => f.pendiente_por_pagar ?? 0, numeric: true, render: (f: FilaSeguimiento) => $(f.pendiente_por_pagar, f.moneda), width: 110 },
    ] as DataTableColumn<FilaSeguimiento>[] : []),
    {
      key: 'acciones', header: '', width: 90,
      render: (f) => <button style={btnLink} onClick={(e) => { e.stopPropagation(); setVerOrden(f.orden_id) }}>Ver detalle</button>,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }} data-testid="seguimiento-panel">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Campo label="Proyecto">
          <select value={alcance} onChange={(e) => setAlcance(e.target.value)} style={input} aria-label="Filtrar por proyecto">
            <option value="todos">Todos los que puedo ver</option>
            <option value="empresa">Contabilidad de la empresa</option>
            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Proveedor">
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} style={input} aria-label="Filtrar por proveedor">
            <option value="">Todos</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Estado">
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={input} aria-label="Filtrar por estado">
            <option value="">Todos</option>
            {(Object.keys(ESTADO_OC_LABELS) as EstadoOrdenCompra[]).map((e) => <option key={e} value={e}>{ESTADO_OC_LABELS[e]}</option>)}
          </select>
        </Campo>
        <Campo label="Desde">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={input} aria-label="Fecha desde" />
        </Campo>
        <Campo label="Hasta">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={input} aria-label="Fecha hasta" />
        </Campo>
      </div>

      {isError && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--at-danger)' }}>{error instanceof Error ? error.message : 'No se pudo cargar el seguimiento.'}</p>}

      {totales.length > 0 && (
        <div data-testid="totales-por-moneda" style={{ display: 'grid', gap: 8 }}>
          {totales.map((t) => (
            <div key={t.moneda} data-testid={`total-${t.moneda}`} style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '8px 10px', background: 'var(--at-surface)', fontSize: 12 }}>
              <strong>{t.moneda}</strong> · {t.ordenes} orden{t.ordenes === 1 ? '' : 'es'} ·{' '}
              comprometido {$(t.comprometido, t.moneda)} · recibido {$(t.recibido, t.moneda)}
              {t.facturado !== null && <> · facturado {$(t.facturado, t.moneda)}</>}
              {t.pagado !== null && <> · pagado {$(t.pagado, t.moneda)}</>}
              {' '}· pendiente por recibir {$(t.pendientePorRecibir, t.moneda)}
              {t.pendientePorFacturar !== null && <> · por facturar {$(t.pendientePorFacturar, t.moneda)}</>}
              {t.pendientePorPagar !== null && <> · por pagar {$(t.pendientePorPagar, t.moneda)}</>}
            </div>
          ))}
          {totales.length > 1 && (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--at-ink-soft)' }}>
              Hay órdenes en {totales.length} monedas: cada una se totaliza por separado. No se convierten ni se suman entre sí.
            </p>
          )}
        </div>
      )}
      {filas.length >= 500 && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--at-warning)' }}>Se muestran las 500 órdenes más recientes: acota con los filtros.</p>
      )}

      <DataTable<FilaSeguimiento>
        data={filas}
        columns={columnas}
        rowKey="orden_id"
        isLoading={isLoading}
        searchableKeys={['proveedor', 'concepto', (f) => f.numero ?? '']}
        searchPlaceholder="Buscar orden…"
        emptyState={{ title: 'Sin órdenes', description: 'Ninguna orden coincide con los filtros. Cada fila se muestra en la moneda de su orden.' }}
      />
      {!verFinanzas && filas.length > 0 && (
        <p data-testid="sin-finanzas" style={{ margin: 0, fontSize: 11, color: 'var(--at-ink-soft)' }}>
          Facturas, pagos y los pendientes por facturar y pagar solo los ve Contabilidad.
        </p>
      )}

      {verOrden && <SeguimientoOrdenModal ordenId={verOrden} monedaBase={monedaBase} onClose={() => setVerOrden(null)} />}
    </div>
  )
}
