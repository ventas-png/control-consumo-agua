// Pendientes › Otros documentos: lo que NO tiene bandeja propia.
//
// Recibos de agua, cuotas sin clasificar, cobros por el camino general, gastos
// sin factura, pagos a proveedor, recepciones de compra… Cuando a uno de esos
// eventos le falta su cuenta, el generador no asienta y —hasta 20261227000000—
// no dejaba rastro. Ahora cada omisión queda registrada con su motivo y con la
// llamada completa, así que aquí se ve qué falta, se va a corregirlo y se
// reprocesa. La fila desaparece sola cuando el documento se asienta o se anula.
import { useState } from 'react'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { useOmitidosQuery } from '../../domain/contabilidad/queries'
import { useReprocesarOmitidoMutation } from '../../domain/contabilidad/mutations'
import { formatCurrency, formatDateShort } from '../../lib/format'
import {
  CODIGO_OMITIDO_LABELS,
  ORIGEN_OMITIDO_LABELS,
  etiquetaEventoContable,
  type AsientoOmitido,
  type RespuestaReprocesoOmitido,
} from '../../types/contabilidad'
import { AsientoDetalleModal } from './AsientoDetalleModal'
import { btnLink, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
  onIrAConfiguracion?: () => void
  onIrACatalogo?: () => void
}

const TONO = { sin_mapeo: 'warning', cuenta_invalida: 'danger', error: 'danger' } as const

/** Aviso tras reprocesar un documento. */
export function mensajeReprocesoOmitido(r: RespuestaReprocesoOmitido): {
  variant: 'success' | 'info' | 'warning'; title: string; text: string
} {
  if (r.resultado === 'contabilizado') {
    return {
      variant: 'success',
      title: 'Documento contabilizado',
      text: r.asiento_numero != null ? `Se generó la póliza #${r.asiento_numero}.` : 'Se generó el asiento (queda en borrador: revisa el tipo de cambio).',
    }
  }
  if (r.resultado === 'ya_resuelto') {
    return { variant: 'info', title: 'Ya no está pendiente', text: r.motivo ?? 'El documento ya se contabilizó o se anuló.' }
  }
  return {
    variant: 'warning',
    title: r.codigo ? CODIGO_OMITIDO_LABELS[r.codigo] : 'Sigue pendiente',
    text: r.motivo ?? 'El documento sigue sin asiento.',
  }
}

export function OtrosPendientesTab({ companyId, projectId, monedaBase, onIrAConfiguracion, onIrACatalogo }: Props) {
  const { puedeCrear, puedeCambiarEstado } = usePermisosContabilidad()
  const permisoUI = puedeCrear && puedeCambiarEstado
  const consulta = useOmitidosQuery(companyId, projectId)
  const reprocesar = useReprocesarOmitidoMutation(companyId)
  const [enCurso, setEnCurso] = useState<string | null>(null)
  const [asientoAbierto, setAsientoAbierto] = useState<string | null>(null)

  const filas = consulta.data ?? []

  async function onReprocesar(o: AsientoOmitido) {
    setEnCurso(o.id)
    try {
      const r = await reprocesar.mutateAsync(o.id)
      notify(mensajeReprocesoOmitido(r))
      if (r.resultado === 'contabilizado' && r.asiento_id) setAsientoAbierto(r.asiento_id)
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo reprocesar', text: e instanceof Error ? e.message : 'Intenta de nuevo.' })
    } finally {
      setEnCurso(null)
    }
  }

  if (consulta.isLoading) {
    return <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-soft)' }}>Cargando…</p>
  }
  if (consulta.isError) {
    return (
      <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--at-danger)' }}>
        No se pudieron cargar los documentos pendientes{consulta.error instanceof Error ? `: ${consulta.error.message}` : '.'}
      </p>
    )
  }
  if (filas.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-soft)' }}>
        Sin otros documentos pendientes: recibos de agua, cobros, gastos, pagos y recepciones de esta contabilidad tienen su asiento.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--at-line)' }}>
              <th style={{ padding: 6 }}>Documento</th>
              <th style={{ padding: 6 }}>Fecha</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Importe</th>
              <th style={{ padding: 6 }}>Motivo</th>
              <th style={{ padding: 6 }} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {filas.map((o) => (
              <tr key={o.id} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                <td style={{ padding: 6 }}>
                  <div style={{ fontWeight: 600 }}>{o.concepto || '—'}</div>
                  <div style={{ color: 'var(--at-ink-soft)' }}>{ORIGEN_OMITIDO_LABELS[o.origen_tabla] ?? o.origen_tabla}</div>
                </td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{o.fecha ? formatDateShort(o.fecha) : '—'}</td>
                <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {formatCurrency(o.importe, o.moneda_doc || monedaBase)}
                </td>
                <td style={{ padding: 6, maxWidth: 380 }}>
                  <StatusBadge tone={TONO[o.codigo] ?? 'neutral'}>{CODIGO_OMITIDO_LABELS[o.codigo] ?? o.codigo}</StatusBadge>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{o.motivo}</div>
                  {o.eventos_faltan.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
                      {o.eventos_faltan.map((ev) => <li key={ev}>{etiquetaEventoContable(ev)}</li>)}
                    </ul>
                  )}
                  {o.intentos > 1 && (
                    <div style={{ fontSize: 11, marginTop: 4, color: 'var(--at-ink-soft)' }}>{o.intentos} intentos</div>
                  )}
                </td>
                <td style={{ padding: 6 }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {o.codigo === 'sin_mapeo' && onIrAConfiguracion && (
                      <button type="button" style={btnLink} onClick={onIrAConfiguracion}>Completar mapeo</button>
                    )}
                    {o.codigo === 'cuenta_invalida' && onIrACatalogo && (
                      <button type="button" style={btnLink} onClick={onIrACatalogo}>Revisar catálogo</button>
                    )}
                    {permisoUI && (
                      <button
                        type="button"
                        style={btnLink}
                        disabled={enCurso === o.id}
                        aria-busy={enCurso === o.id}
                        onClick={() => void onReprocesar(o)}
                      >
                        {enCurso === o.id ? 'Reprocesando…' : 'Reprocesar'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length >= 500 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Se muestran los 500 más antiguos. Al corregir la configuración y reprocesar aparecerán los siguientes.
        </p>
      )}
      {!permisoUI && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Tu rol puede ver estos pendientes pero no reprocesarlos: hace falta el permiso de crear y publicar pólizas en Contabilidad.
        </p>
      )}
      {asientoAbierto && (
        <AsientoDetalleModal asientoId={asientoAbierto} monedaBase={monedaBase} onClose={() => setAsientoAbierto(null)} />
      )}
    </div>
  )
}
