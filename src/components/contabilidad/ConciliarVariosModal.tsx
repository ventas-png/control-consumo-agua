// Conciliar un movimiento del banco eligiendo los documentos a mano: uno, o
// varios cuya suma sea el importe del movimiento (el depósito del día que junta
// las cuotas de varias casas; la transferencia que paga varias órdenes). La
// regla —misma contabilidad, en firme, sin conciliar, suma exacta— la aplica el
// RPC banco_conciliar_varios; aquí se busca, se marca y se ve cuánto falta.
import { useMemo, useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useCandidatosConciliacionQuery } from '../../domain/bancos/queries'
import { useConciliarVariosMutation } from '../../domain/bancos/mutations'
import { formatCurrency, formatDateShort } from '../../lib/format'
import type { BancoMovimiento } from '../../types/bancos'
import { btnPrimario, btnSecundario, input } from './ui'

interface Props {
  movimiento: BancoMovimiento
  moneda: string
  onClose: () => void
}

const centavos = (n: number) => Math.round(n * 100) / 100

export function ConciliarVariosModal({ movimiento, moneda, onClose }: Props) {
  const [buscar, setBuscar] = useState('')
  const [filtro, setFiltro] = useState('')
  // id → monto: lo marcado se conserva aunque una búsqueda posterior lo oculte.
  const [marcados, setMarcados] = useState<Record<string, number>>({})
  const { data: candidatos = [], isLoading, isError, error } = useCandidatosConciliacionQuery(movimiento.id, filtro)
  const conciliar = useConciliarVariosMutation()

  const objetivo = Math.abs(movimiento.monto)
  const esDeposito = movimiento.monto > 0
  const suma = useMemo(() => centavos(Object.values(marcados).reduce((s, m) => s + m, 0)), [marcados])
  const falta = centavos(objetivo - suma)
  const n = Object.keys(marcados).length
  const cuadra = n > 0 && Math.abs(falta) <= 0.01

  function alternar(id: string, monto: number) {
    setMarcados((m) => {
      const sig = { ...m }
      if (id in sig) delete sig[id]
      else sig[id] = monto
      return sig
    })
  }

  async function confirmar() {
    try {
      await conciliar.mutateAsync({ movimientoId: movimiento.id, documentoIds: Object.keys(marcados) })
      notify({ variant: 'success', title: 'Movimiento conciliado', text: `Contra ${n} documento(s) por ${formatCurrency(suma, moneda)}.` })
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo conciliar', text: e instanceof Error ? e.message : 'Intente de nuevo.' })
    }
  }

  return (
    <EditModal
      title={esDeposito ? 'Conciliar depósito: elegir cobros' : 'Conciliar retiro: elegir pagos a proveedores'}
      onClose={onClose}
      maxWidth="820px"
      footer={
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <span role="status" style={{ marginRight: 'auto', fontSize: 13, color: cuadra ? 'var(--at-success-strong)' : 'var(--at-ink-2)' }}>
            {n} elegido(s) · suman <strong>{formatCurrency(suma, moneda)}</strong> de {formatCurrency(objetivo, moneda)}
            {n > 0 && !cuadra && (falta > 0
              ? <> · faltan <strong>{formatCurrency(falta, moneda)}</strong></>
              : <> · sobran <strong>{formatCurrency(-falta, moneda)}</strong></>)}
            {cuadra && ' · cuadra ✓'}
          </span>
          <button onClick={onClose} style={btnSecundario}>Cancelar</button>
          <button onClick={() => void confirmar()} disabled={!cuadra || conciliar.isPending} style={{ ...btnPrimario, opacity: cuadra ? 1 : 0.5 }}>
            {conciliar.isPending ? 'Conciliando…' : 'Conciliar'}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--at-ink-3)', lineHeight: 1.55 }}>
        Movimiento del {formatDateShort(movimiento.fecha)} por <strong>{formatCurrency(movimiento.monto, moneda)}</strong>
        {movimiento.descripcion ? <> — {movimiento.descripcion}</> : null}
        {movimiento.referencia ? <> (ref. {movimiento.referencia})</> : null}. Marque{' '}
        {esDeposito ? 'los cobros' : 'las órdenes de pago'} que lo componen: la suma debe ser exactamente su importe.
        Si la diferencia es una comisión o un interés, concilie esa parte con «Ajuste».
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); setFiltro(buscar) }}
        style={{ display: 'flex', gap: 8, marginBottom: 10 }}
      >
        <input
          aria-label="Buscar documento"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          style={{ ...input, flex: 1 }}
          placeholder="Buscar por nombre, referencia o monto…"
        />
        <button type="submit" style={btnSecundario}>Buscar</button>
      </form>

      {isLoading ? (
        <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)' }}>Buscando documentos…</p>
      ) : isError ? (
        <p role="alert" style={{ fontSize: 13.5, color: 'var(--at-danger)' }}>
          No se pudieron cargar los documentos: {error instanceof Error ? error.message : 'error desconocido'}
        </p>
      ) : candidatos.length === 0 ? (
        <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)' }}>
          No hay {esDeposito ? 'cobros verificados' : 'órdenes de pago pagadas'} sin conciliar en esta contabilidad
          {filtro ? ' con esa búsqueda' : ' en los 90 días alrededor del movimiento'}.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--at-line)', textAlign: 'left' }}>
                <th style={{ padding: '8px 6px', width: 32 }} />
                <th style={{ padding: '8px 6px' }}>Fecha</th>
                <th style={{ padding: '8px 6px' }}>Documento</th>
                <th style={{ padding: '8px 6px' }}>Referencia</th>
                <th style={{ padding: '8px 6px', textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {candidatos.map((c) => {
                const marcado = c.candidato_id in marcados
                return (
                  <tr
                    key={c.candidato_id}
                    onClick={() => alternar(c.candidato_id, c.monto)}
                    style={{ borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: marcado ? 'var(--at-primary-tint)' : undefined }}
                  >
                    <td style={{ padding: '8px 6px' }}>
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(c.candidato_id, c.monto)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Elegir ${c.descripcion ?? 'documento'} por ${formatCurrency(c.monto, moneda)}`}
                      />
                    </td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{formatDateShort(c.fecha)}</td>
                    <td style={{ padding: '8px 6px' }}>{c.descripcion ?? '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{c.referencia ?? '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(c.monto, moneda)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </EditModal>
  )
}
