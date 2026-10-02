// Seguimiento compartido de una orden de compra.
//
// Es la MISMA pantalla para Operaciones, Compras y Contabilidad: lo que cambia es
// lo que el servidor entrega a cada quien (`compras_seguimiento_orden` filtra las
// facturas, los pagos y los importes de facturación para quien no puede ver
// Contabilidad). Aquí no se decide quién ve qué: se muestra lo que llega.
//
// Comprometido, recibido, facturado y pagado son cuatro indicadores DISTINTOS y
// se muestran separados; ninguno es suma de otro.
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { useSeguimientoOrdenQuery } from '../../domain/compras/queries'
import { formatCurrency, formatDateShort } from '../../lib/format'
import { DESTINO_LINEA_LABELS, ESTADO_OC_LABELS, ESTADO_RECEPCION_LABELS } from '../../types/compras'
import type { SeguimientoOrden } from '../../types/compras'

type Tono = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONO_ESTADO: Record<string, Tono> = {
  borrador: 'neutral', aprobada: 'info', emitida: 'info', recibida_parcial: 'warning',
  recibida: 'success', cerrada: 'success', cancelada: 'danger',
}

const celda = { padding: '4px 6px', fontSize: 12 } as const
const cabecera = { ...celda, textAlign: 'left' as const, color: 'var(--at-ink-soft)', fontWeight: 600 }

function Indicador({ titulo, valor, nota, testId }: { titulo: string; valor: string; nota?: string; testId: string }) {
  return (
    <div data-testid={testId} style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '8px 10px', background: 'var(--at-surface)' }}>
      <div style={{ fontSize: 10, color: 'var(--at-ink-soft)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{titulo}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{valor}</div>
      {nota && <div style={{ fontSize: 10, color: 'var(--at-ink-soft)' }}>{nota}</div>}
    </div>
  )
}

function Seccion({ titulo, children, testId }: { titulo: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} style={{ marginTop: 14 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>{titulo}</h4>
      {children}
    </section>
  )
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>{children}</p>
}

export function SeguimientoOrdenContenido({ s, monedaBase }: { s: SeguimientoOrden; monedaBase: string }) {
  const moneda = s.orden.moneda ?? monedaBase
  const $ = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatCurrency(n, moneda))
  const ind = s.indicadores
  const verConta = s.contabilidad_visible

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <StatusBadge tone={TONO_ESTADO[s.orden.estado] ?? 'neutral'}>{ESTADO_OC_LABELS[s.orden.estado] ?? s.orden.estado}</StatusBadge>
        {s.orden.revision > 0 && <span style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>Revisión {s.orden.revision}</span>}
        <span style={{ fontSize: 12 }}>
          <strong>{s.orden.proveedor.nombre}</strong>
          {s.orden.proveedor.codigo && <> · {s.orden.proveedor.codigo}</>}
          {s.orden.proveedor.identificacion && <> · {s.orden.proveedor.identificacion}</>}
        </span>
        {s.orden.proveedor.estado && s.orden.proveedor.estado !== 'autorizado' && (
          <StatusBadge tone="warning">Proveedor {s.orden.proveedor.estado}</StatusBadge>
        )}
        {s.orden.contrato && <span style={{ fontSize: 12 }}>Contrato {s.orden.contrato.referencia ?? '—'} ({s.orden.contrato.estado})</span>}
      </div>
      {s.orden.motivo_devolucion && (
        <p style={{ fontSize: 12, margin: '0 0 8px' }}>Última devolución a borrador: <em>{s.orden.motivo_devolucion}</em></p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <Indicador testId="ind-comprometido" titulo="Comprometido" valor={$(ind.comprometido)} nota={`sin IVA ${$(ind.comprometido_neto)}`} />
        <Indicador testId="ind-recibido" titulo="Recibido" valor={$(ind.recibido)} nota={`pendiente ${$(ind.pendiente_por_recibir)} · sin IVA`} />
        {verConta ? (
          <>
            <Indicador testId="ind-facturado" titulo="Facturado" valor={$(ind.facturado)} nota={`pendiente por facturar ${$(ind.pendiente_por_facturar)} (sin IVA)`} />
            <Indicador testId="ind-pagado" titulo="Pagado" valor={$(ind.pagado)} />
          </>
        ) : (
          <div data-testid="sin-contabilidad" style={{ fontSize: 11, color: 'var(--at-ink-soft)', alignSelf: 'center' }}>
            Facturas y pagos solo los ve Contabilidad.
          </div>
        )}
      </div>

      <Seccion titulo="Renglones" testId="seg-lineas">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={cabecera}>Renglón</th><th style={cabecera}>Destino</th><th style={cabecera}>Cuenta</th>
                <th style={cabecera}>Pedido</th><th style={cabecera}>Aceptado</th><th style={cabecera}>Rechazado</th><th style={cabecera}>Pendiente</th>
                {verConta && <th style={cabecera}>Facturado</th>}
              </tr>
            </thead>
            <tbody>
              {s.lineas.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                  <td style={celda}>{l.descripcion}</td>
                  <td style={celda}>{DESTINO_LINEA_LABELS[l.destino] ?? l.destino}</td>
                  <td style={celda}>{l.cuenta ? `${l.cuenta.codigo} ${l.cuenta.nombre}` : '—'}{l.cuenta_origen ? ` (${l.cuenta_origen === 'linea_explicita' ? 'explícita' : 'regla'})` : ''}</td>
                  <td style={celda}>{l.cantidad_ordenada} {l.unidad ?? ''}</td>
                  <td style={celda}>{l.cantidad_aceptada}</td>
                  <td style={celda}>{l.cantidad_rechazada}</td>
                  <td style={celda}>{l.cantidad_pendiente}</td>
                  {verConta && <td style={celda}>{l.cantidad_facturada ?? 0}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion titulo="Recepciones y conformidades" testId="seg-recepciones">
        {s.recepciones.length === 0 ? <Vacio>Todavía no hay recepciones.</Vacio> : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {s.recepciones.map((r) => (
              <li key={r.id}>
                {r.numero ?? 'Sin número'} · {r.tipo === 'servicio' ? 'conformidad de servicio' : 'bienes'} · {formatDateShort(r.fecha)} ·{' '}
                <StatusBadge tone={r.estado === 'registrada' ? 'success' : r.estado === 'anulada' ? 'danger' : 'neutral'}>{ESTADO_RECEPCION_LABELS[r.estado]}</StatusBadge>
                {' '}· aceptado {r.aceptado}{r.rechazado > 0 && <>, rechazado {r.rechazado}</>}
                {r.destino_fisico && <> · {r.destino_fisico}</>}
                {r.tiene_respaldo && <> · con soporte{r.respaldos ? ` (${r.respaldos} archivo${r.respaldos === 1 ? '' : 's'})` : ''}</>}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion titulo="Inventario y activos" testId="seg-inventario">
        {s.movimientos_inventario.length === 0 && s.activos.length === 0 ? <Vacio>Sin movimientos de inventario ni activos.</Vacio> : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {s.movimientos_inventario.map((m) => <li key={m.id}>Entrada de inventario · {m.cantidad} · {formatDateShort(m.fecha)}</li>)}
            {s.activos.map((a) => <li key={a.id}>Activo {a.codigo} · {a.nombre} · {a.estado}</li>)}
          </ul>
        )}
      </Seccion>

      {verConta && (
        <Seccion titulo="Facturas y diferencias" testId="seg-facturas">
          {!s.facturas || s.facturas.length === 0 ? <Vacio>Todavía no hay facturas contra esta orden.</Vacio> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {s.facturas.map((f) => (
                <div key={f.id} style={{ border: '1px solid var(--at-line)', borderRadius: 8, padding: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <strong>{f.numero_factura ?? 'Sin número'}</strong>
                    <span>{formatDateShort(f.fecha_emision)}</span>
                    <StatusBadge tone={f.estado === 'anulada' ? 'danger' : f.estado === 'registrada' ? 'neutral' : 'success'}>{f.estado}</StatusBadge>
                    <span>{formatCurrency(f.monto_total, f.moneda ?? moneda)}</span>
                    <span>pagado {formatCurrency(f.monto_pagado, f.moneda ?? moneda)}</span>
                    <StatusBadge tone={f.contabilizada ? 'success' : 'warning'}>{f.contabilizada ? 'Contabilizada' : 'Sin contabilizar'}</StatusBadge>
                    {f.match_forzado && <StatusBadge tone="warning">Aprobada con diferencias</StatusBadge>}
                  </div>
                  {f.justificacion && <div style={{ marginTop: 4, color: 'var(--at-ink-soft)' }}>Justificación: {f.justificacion}</div>}
                  {f.diferencias.length > 0 && (
                    <ul data-testid={`dif-${f.id}`} style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--at-danger)' }}>
                      {f.diferencias.map((d) => <li key={d.linea}>{d.descripcion}: {d.motivo}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Seccion>
      )}

      {verConta && (
        <Seccion titulo="Pagos" testId="seg-pagos">
          {!s.pagos || s.pagos.length === 0 ? <Vacio>Todavía no hay pagos de las facturas de esta orden.</Vacio> : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {s.pagos.map((p) => (
                <li key={`${p.id}:${p.factura_id}`}>
                  {p.fecha_pago ? formatDateShort(p.fecha_pago) : 'Sin fecha'} · {p.metodo_pago}{p.referencia ? ` ${p.referencia}` : ''} ·{' '}
                  <StatusBadge tone={p.estado === 'pagada' ? 'success' : 'neutral'}>{p.estado}</StatusBadge>{' '}
                  · aplicado a la factura {p.numero_factura ?? '—'}: <strong>{$(p.monto_aplicado)}</strong>
                  {p.contrasena && <> (contraseña {p.contrasena}; el pago total es {$(p.monto_pago)})</>}
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      )}

      <Seccion titulo="Historial" testId="seg-historial">
        {s.eventos.length === 0 ? <Vacio>Sin movimientos registrados.</Vacio> : (
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {s.eventos.map((e, i) => (
              <li key={i}>
                {formatDateShort(e.created_at)} · {e.tipo === 'devolucion' ? 'Devuelta a borrador' : `${ESTADO_OC_LABELS[e.estado_anterior ?? 'borrador'] ?? e.estado_anterior ?? 'Alta'} → ${ESTADO_OC_LABELS[e.estado_nuevo] ?? e.estado_nuevo}`}
                {e.origen === 'sistema' && ' (automático)'}
                {e.motivo && <> — {e.motivo}</>}
              </li>
            ))}
          </ol>
        )}
      </Seccion>
    </div>
  )
}

export function SeguimientoOrdenModal({ ordenId, monedaBase, onClose }: { ordenId: string; monedaBase: string; onClose: () => void }) {
  const { data, isLoading, error } = useSeguimientoOrdenQuery(ordenId)
  return (
    <EditModal title={`Seguimiento de la orden${data?.orden.numero ? ` ${data.orden.numero}` : ''}`} onClose={onClose} size="lg"
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" onClick={onClose} style={{ padding: '6px 14px' }}>Cerrar</button></div>}>
      {isLoading && <p style={{ fontSize: 12 }}>Cargando…</p>}
      {error && <p role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>No se pudo cargar el seguimiento.</p>}
      {!isLoading && !error && !data && <p style={{ fontSize: 12 }}>La orden no existe o no tienes acceso a ella.</p>}
      {data && <SeguimientoOrdenContenido s={data} monedaBase={monedaBase} />}
    </EditModal>
  )
}
