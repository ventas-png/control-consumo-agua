// Seguimiento de UN contrato de proveedor: sus órdenes, recepciones, facturas y pagos.
//
// Lo que se muestra es lo que el servidor entrega a esta persona (`compras_contrato_seguimiento`): quien no ve
// Contabilidad no recibe facturado, pagado, pendiente por facturar, diferencias de precio, facturas ni pagos.
// Aquí no se decide quién ve qué.
//
// Cinco cosas DISTINTAS que nunca se suman como si fueran equivalentes:
//   contratado    lo que dice el contrato (monto máximo original, ampliaciones y vigente; o importe periódico);
//   comprometido  órdenes aprobadas, emitidas, recibidas o cerradas;
//   recibido      lo aceptado en recepciones registradas;
//   facturado     facturas aprobadas;
//   pagado        lo aplicado a esas facturas.
// Cada moneda va aparte. Un contrato sin monto máximo NO tiene límite total: se dice así, sin inventar un total.
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { useSeguimientoContratoQuery } from '../../domain/proveedores/contratosCompras'
import { formatCurrency, formatDateShort } from '../../lib/format'
import { ESTADO_OC_LABELS } from '../../types/compras'
import {
  ESTADO_CONTRATO_LABELS,
  MODALIDAD_LABELS,
  PERIODICIDAD_LABELS,
  type EstadoContratoProveedor,
  type SeguimientoContrato,
} from '../../types/proveedores'

type Tono = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONO_ESTADO: Record<string, Tono> = {
  borrador: 'neutral', aprobada: 'info', emitida: 'info', recibida_parcial: 'warning',
  recibida: 'success', cerrada: 'success', cancelada: 'danger',
}
const TONO_CONTRATO: Record<EstadoContratoProveedor, Tono> = {
  borrador: 'neutral', activo: 'success', suspendido: 'warning', vencido: 'warning', terminado: 'neutral', cancelado: 'danger',
}

const celda = { padding: '4px 6px', fontSize: 12 } as const
const cabecera = { ...celda, textAlign: 'left' as const, color: 'var(--at-ink-soft)', fontWeight: 600 }

const CAUSAS: Record<string, string> = { vigencia: 'contrato fuera de vigencia', monto: 'monto máximo rebasado', 'monto,vigencia': 'fuera de vigencia y monto rebasado' }

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

function Tabla({ cols, children, minWidth = 560 }: { cols: string[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>
        <thead><tr>{cols.map((c) => <th key={c} style={cabecera}>{c}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function SeguimientoContratoContenido({ s }: { s: SeguimientoContrato }) {
  const c = s.contrato
  const verConta = s.contabilidad_visible
  const monedaContrato = c.moneda ?? ''
  const $ = (n: number | null | undefined, m: string) => (n === null || n === undefined ? '—' : formatCurrency(n, m))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <StatusBadge tone={TONO_CONTRATO[c.estado] ?? 'neutral'}>{ESTADO_CONTRATO_LABELS[c.estado] ?? c.estado}</StatusBadge>
        <span data-testid="contrato-vigencia">
          <StatusBadge tone={c.vigente ? 'success' : 'warning'}>{c.vigente ? 'Vigente hoy' : 'No vigente hoy'}</StatusBadge>
        </span>
        <span style={{ fontSize: 12 }}>
          <strong>{c.proveedor.nombre}</strong>{c.proveedor.codigo && <> · {c.proveedor.codigo}</>}
        </span>
        {c.proveedor.estado && c.proveedor.estado !== 'autorizado' && <StatusBadge tone="warning">Proveedor {c.proveedor.estado}</StatusBadge>}
        {c.referencia && <span style={{ fontSize: 12 }}>Ref. {c.referencia}</span>}
      </div>

      <Seccion titulo="Contratado" testId="seg-contratado">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
          <div style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-soft)', textTransform: 'uppercase' }}>Vigencia</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {formatDateShort(c.fecha_inicio)} → {c.indefinido ? 'indefinida' : formatDateShort(c.fecha_fin as string)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>
              {c.modalidad ? MODALIDAD_LABELS[c.modalidad] : '—'}{c.periodicidad ? ` · ${PERIODICIDAD_LABELS[c.periodicidad]}` : ''}
            </div>
          </div>
          {c.importe_periodico != null && (
            <div data-testid="seg-importe-periodico" style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-soft)', textTransform: 'uppercase' }}>Importe periódico</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{$(c.importe_periodico, monedaContrato)}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>{c.periodicidad ? PERIODICIDAD_LABELS[c.periodicidad] : ''}</div>
            </div>
          )}
          {c.sin_limite_total ? (
            <div data-testid="seg-sin-limite" style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-soft)', textTransform: 'uppercase' }}>Monto máximo</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Sin límite total</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>El contrato no define un tope: no se calcula uno.</div>
            </div>
          ) : (
            <div data-testid="seg-monto-maximo" style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-soft)', textTransform: 'uppercase' }}>Monto máximo vigente</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{$(c.monto_maximo_vigente, monedaContrato)}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>
                original {$(c.monto_maximo_original, monedaContrato)} + ampliaciones {$(c.ampliaciones_total, monedaContrato)}
              </div>
            </div>
          )}
        </div>
      </Seccion>

      <Seccion titulo="Por moneda (cada indicador aparte: comprometido ≠ recibido ≠ facturado ≠ pagado)" testId="seg-por-moneda">
        {s.por_moneda.length === 0 ? <Vacio>El contrato aún no tiene órdenes.</Vacio> : s.por_moneda.map((m) => (
          <div key={m.moneda} data-testid={`moneda-${m.moneda}`} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{m.moneda} · {m.ordenes} orden(es)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {[
                ['comprometido', 'Comprometido', m.comprometido],
                ['recibido', 'Recibido', m.recibido],
                ...(verConta ? [['facturado', 'Facturado', m.facturado], ['pagado', 'Pagado', m.pagado]] as const : []),
                ['pend-recibir', 'Pendiente por recibir', m.pendiente_por_recibir],
                ...(verConta ? [['pend-facturar', 'Pendiente por facturar', m.pendiente_por_facturar], ['dif-precio', 'Diferencia de precio', m.diferencia_precio_facturada]] as const : []),
                ...(m.disponible != null ? [['disponible', 'Disponible del contrato', m.disponible]] as const : []),
              ].map(([k, t, v]) => (
                <div key={k as string} data-testid={`ind-${m.moneda}-${k as string}`} style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '6px 10px' }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-soft)', textTransform: 'uppercase' }}>{t as string}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{$(v as number | null, m.moneda)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!verConta && <p data-testid="sin-contabilidad" style={{ fontSize: 11, color: 'var(--at-ink-soft)', margin: '4px 0 0' }}>Facturas y pagos solo los ve Contabilidad.</p>}
      </Seccion>

      <Seccion titulo="Órdenes del contrato" testId="seg-ordenes">
        {s.ordenes.length === 0 ? <Vacio>Sin órdenes todavía.</Vacio> : (
          <Tabla cols={['Orden', 'Concepto', 'Estado', 'Valor', 'Comprometido', 'Recibido', ...(verConta ? ['Facturado', 'Pagado'] : []), 'Excepción']} minWidth={780}>
            {s.ordenes.map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                <td style={celda}>{o.numero ?? '—'}</td>
                <td style={celda}>{o.concepto}</td>
                <td style={celda}><StatusBadge tone={TONO_ESTADO[o.estado] ?? 'neutral'}>{(ESTADO_OC_LABELS as Record<string, string>)[o.estado] ?? o.estado}</StatusBadge></td>
                <td style={celda}>{$(o.valor_orden, o.moneda)}</td>
                <td style={celda}>{o.compromete ? $(o.comprometido, o.moneda) : <span title="Un borrador o una orden cancelada no compromete monto">no compromete</span>}</td>
                <td style={celda}>{$(o.recibido, o.moneda)}</td>
                {verConta && <td style={celda}>{$(o.facturado, o.moneda)}</td>}
                {verConta && <td style={celda}>{$(o.pagado, o.moneda)}</td>}
                <td style={celda}>{o.con_excepcion ? 'Sí' : '—'}</td>
              </tr>
            ))}
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Recepciones" testId="seg-recepciones">
        {s.recepciones.length === 0 ? <Vacio>Sin recepciones.</Vacio> : (
          <Tabla cols={['Recepción', 'Orden', 'Fecha', 'Estado', 'Aceptado', 'Rechazado']}>
            {s.recepciones.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                <td style={celda}>{r.numero ?? '—'}</td><td style={celda}>{r.orden_numero ?? '—'}</td>
                <td style={celda}>{formatDateShort(r.fecha)}</td><td style={celda}>{r.estado}</td>
                <td style={celda}>{r.aceptado}</td><td style={celda}>{r.rechazado}</td>
              </tr>
            ))}
          </Tabla>
        )}
      </Seccion>

      {verConta && (
        <>
          <Seccion titulo="Facturas" testId="seg-facturas">
            {s.facturas.length === 0 ? <Vacio>Sin facturas.</Vacio> : (
              <Tabla cols={['Factura', 'Orden', 'Estado', 'Total', 'Pagado', 'Saldo']}>
                {s.facturas.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                    <td style={celda}>{f.numero_factura}</td><td style={celda}>{f.orden_numero ?? '—'}</td><td style={celda}>{f.estado}</td>
                    <td style={celda}>{$(f.monto_total, f.moneda ?? monedaContrato)}</td>
                    <td style={celda}>{$(f.monto_pagado, f.moneda ?? monedaContrato)}</td>
                    <td style={celda}>{$(f.saldo, f.moneda ?? monedaContrato)}</td>
                  </tr>
                ))}
              </Tabla>
            )}
          </Seccion>
          <Seccion titulo="Pagos" testId="seg-pagos">
            {s.pagos.length === 0 ? <Vacio>Sin pagos.</Vacio> : (
              <Tabla cols={['Pago', 'Factura', 'Orden', 'Estado', 'Monto', 'Fecha']}>
                {s.pagos.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                    <td style={celda}>{p.referencia ?? p.metodo_pago ?? '—'}</td><td style={celda}>{p.numero_factura ?? '—'}</td>
                    <td style={celda}>{p.orden_numero ?? '—'}</td><td style={celda}>{p.estado}</td>
                    <td style={celda}>{$(p.monto_aplicado ?? p.monto_pago, monedaContrato)}</td>
                    <td style={celda}>{p.fecha_pago ? formatDateShort(p.fecha_pago) : '—'}</td>
                  </tr>
                ))}
              </Tabla>
            )}
          </Seccion>
        </>
      )}

      <Seccion titulo="Ampliaciones documentadas" testId="seg-ampliaciones">
        {s.ampliaciones.length === 0 ? <Vacio>Sin ampliaciones de monto.</Vacio> : (
          <Tabla cols={['Fecha', 'Antes', 'Incremento', 'Después', 'Motivo']}>
            {s.ampliaciones.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                <td style={celda}>{formatDateShort(a.created_at)}</td>
                <td style={celda}>{$(a.monto_anterior, a.moneda ?? monedaContrato)}</td>
                <td style={celda}>{$(a.incremento, a.moneda ?? monedaContrato)}</td>
                <td style={celda}>{$(a.monto_nuevo, a.moneda ?? monedaContrato)}</td>
                <td style={celda}>{a.motivo}{a.referencia_documento ? ` (${a.referencia_documento})` : ''}</td>
              </tr>
            ))}
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Excepciones autorizadas" testId="seg-excepciones">
        {s.excepciones.length === 0 ? <Vacio>Ninguna orden se aprobó ni se emitió por excepción.</Vacio> : (
          <Tabla cols={['Fecha', 'Orden', 'Etapa', 'Cubre', 'Motivo']}>
            {s.excepciones.map((x) => (
              <tr key={x.id} style={{ borderTop: '1px solid var(--at-line)' }}>
                <td style={celda}>{formatDateShort(x.created_at)}</td><td style={celda}>{x.orden_numero ?? '—'}</td>
                <td style={celda}>{x.etapa === 'aprobar' ? 'Aprobar' : 'Emitir'}</td>
                <td style={celda}>{CAUSAS[x.causas] ?? x.causas}</td><td style={celda}>{x.motivo}</td>
              </tr>
            ))}
          </Tabla>
        )}
      </Seccion>

      <Seccion titulo="Renovaciones" testId="seg-renovaciones">
        {c.renovado_de && <p style={{ margin: '0 0 4px', fontSize: 12 }}>Este contrato renueva a otro anterior, que conserva sus condiciones, documentos e historial.</p>}
        {s.renovaciones.length === 0 ? <Vacio>Sin renovaciones.</Vacio> : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {s.renovaciones.map((r) => (
              <li key={r.id}>{r.referencia ?? 'Sin referencia'} · {ESTADO_CONTRATO_LABELS[r.estado as EstadoContratoProveedor] ?? r.estado} · {r.fecha_inicio} → {r.fecha_fin ?? 'sin fin'}</li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  )
}

interface Props {
  contratoId: string
  onClose: () => void
}

export function ContratoSeguimientoModal({ contratoId, onClose }: Props) {
  const { data, isLoading, error } = useSeguimientoContratoQuery(contratoId)
  return (
    <EditModal title="Seguimiento del contrato" subtitle="Órdenes, recepciones, facturas y pagos vinculados al contrato" onClose={onClose} size="xl">
      {isLoading && <p role="status">Cargando…</p>}
      {error && <p role="alert" style={{ color: 'var(--at-danger)' }}>{(error as Error).message}</p>}
      {!isLoading && !error && data === null && <p role="status">No tienes acceso a este contrato o ya no existe.</p>}
      {data && <SeguimientoContratoContenido s={data} />}
    </EditModal>
  )
}
