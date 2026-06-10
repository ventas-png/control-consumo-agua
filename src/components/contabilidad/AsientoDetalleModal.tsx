import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { useAsientoDetalleQuery } from '../../domain/contabilidad/queries'
import { useAnularAsientoMutation, usePublicarAsientoMutation } from '../../domain/contabilidad/mutations'
import { formatCurrency, formatDateShort, formatNumber } from '../../lib/format'
import { TIPO_ASIENTO_LABELS } from '../../types/contabilidad'
import { btnPeligro, btnPrimario, btnSecundario } from './ui'

interface Props {
  asientoId: string
  monedaBase: string
  onClose: () => void
}

const TONO_ESTADO = { borrador: 'warning', publicado: 'success', anulado: 'neutral' } as const

export function AsientoDetalleModal({ asientoId, monedaBase, onClose }: Props) {
  const { data: asiento, isLoading } = useAsientoDetalleQuery(asientoId)
  const publicar = usePublicarAsientoMutation()
  const anular = useAnularAsientoMutation()

  async function onPublicar() {
    try {
      await publicar.mutateAsync(asientoId)
      notify({ variant: 'success', title: 'Publicada', text: 'La póliza quedó publicada con folio.' })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo publicar.' })
    }
  }

  async function onAnular() {
    const esPublicado = asiento?.estado === 'publicado'
    const { isConfirmed } = await confirm({
      title: esPublicado ? '¿Anular póliza publicada?' : '¿Anular borrador?',
      text: esPublicado
        ? 'Se generará un asiento de reverso (la póliza original no se borra: queda el rastro auditable).'
        : 'El borrador quedará anulado.',
      confirmText: 'Anular',
      variant: 'danger',
    })
    if (!isConfirmed) return
    try {
      await anular.mutateAsync({ asientoId })
      notify({ variant: 'success', title: 'Anulada', text: esPublicado ? 'Reverso generado.' : 'Borrador anulado.' })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo anular.' })
    }
  }

  return (
    <EditModal
      title={asiento ? `Póliza ${asiento.numero ? `#${asiento.numero}` : '(borrador)'}` : 'Póliza'}
      subtitle={asiento ? `${TIPO_ASIENTO_LABELS[asiento.tipo]} · ${formatDateShort(asiento.fecha)} · ${asiento.origen === 'automatico' ? `automática (${asiento.origen_evento ?? ''})` : 'manual'}` : undefined}
      onClose={onClose}
      size="lg"
      footer={
        asiento && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecundario}>Cerrar</button>
            {asiento.estado !== 'anulado' && !asiento.anulado_por_id && (
              <button onClick={() => void onAnular()} disabled={anular.isPending} style={btnPeligro}>
                Anular
              </button>
            )}
            {asiento.estado === 'borrador' && (
              <button onClick={() => void onPublicar()} disabled={publicar.isPending} style={btnPrimario}>
                Publicar
              </button>
            )}
          </div>
        )
      }
    >
      {isLoading || !asiento ? (
        <p style={{ color: 'var(--at-ink-soft)' }}>Cargando…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge tone={TONO_ESTADO[asiento.estado]}>
              {asiento.anulado_por_id ? 'reversada' : asiento.estado}
            </StatusBadge>
            {asiento.reversa_de_id && <StatusBadge tone="info">es un reverso</StatusBadge>}
            <span style={{ fontSize: 13 }}>{asiento.concepto}</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                <th style={{ padding: 6 }}>Cuenta</th>
                <th style={{ padding: 6 }}>Descripción</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Debe</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Haber</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Moneda origen</th>
              </tr>
            </thead>
            <tbody>
              {asiento.conta_asiento_lineas.map((l) => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--at-line)' }}>
                  <td style={{ padding: 6, fontFamily: 'var(--at-mono, monospace)' }}>
                    {l.conta_cuentas ? `${l.conta_cuentas.codigo} — ${l.conta_cuentas.nombre}` : l.cuenta_id}
                  </td>
                  <td style={{ padding: 6, color: 'var(--at-ink-soft)' }}>{l.descripcion ?? ''}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {l.debe > 0 ? formatCurrency(l.debe, monedaBase) : ''}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {l.haber > 0 ? formatCurrency(l.haber, monedaBase) : ''}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', fontSize: 12, color: 'var(--at-ink-soft)' }}>
                    {l.moneda_origen
                      ? `${formatCurrency(l.monto_origen, l.moneda_origen)} @ ${formatNumber(l.tipo_cambio ?? 0, 4)}`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={2} style={{ padding: 6, textAlign: 'right' }}>Totales</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(asiento.total_debe, monedaBase)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{formatCurrency(asiento.total_haber, monedaBase)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </EditModal>
  )
}
