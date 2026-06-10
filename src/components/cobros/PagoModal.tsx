import { useState, type FormEvent} from 'react'
import { notify } from '../shared/Dialog'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { createPago } from '../../domain/cobros/mutations'
import { updateRegistro } from '../../domain/agua/mutations'
import type { Registro, Cliente, FormaPago, TipoAplicacion } from '../../types'
import { calcularTotalPagar, puedeTransicionarFactura } from '../../lib/business'
import { FacturaEstadoBadge, FacturaDesglose } from './facturaUi'
import { TimbradoEstadoBadge, TimbradoDatos } from './fiscalUi'
import type { FacturaRow } from '../../domain/facturacion/queries'
import type { DocumentoFiscal } from '../../types/fiscal'

interface Props {
  registro: Registro
  cliente?: Cliente
  moneda: string
  currentUserId: string
  formasPagoLabels: Record<FormaPago, string>
  /** Proyección de Factura (estado/IVA/mora) del registro, si está disponible. */
  factura?: FacturaRow
  /** Último comprobante fiscal del registro (estatus de timbrado), si existe. */
  documentoFiscal?: DocumentoFiscal | null
  onClose: () => void
  onSuccess: (registroId: string, nuevoEstado: Registro['estado'], montoPagado: number) => void
}

export function PagoModal({ registro, cliente, moneda, currentUserId, formasPagoLabels, factura, documentoFiscal, onClose, onSuccess }: Props) {
  // Si hay snapshot de Factura (emitida), el total a cobrar incluye IVA + mora;
  // si no, se cae al cargo base como antes (registros legacy sin emitir).
  const total = factura?.total_a_pagar
    ?? registro.monto_calculado
    ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
  const abonado = registro.monto_pagado ?? 0
  const saldo = Math.max(0, total - abonado)

  const [tipoAplicacion, setTipoAplicacion] = useState<TipoAplicacion>('pago_total')
  const [monto, setMonto] = useState(saldo.toFixed(2))
  const [formaPago, setFormaPago] = useState<FormaPago>('efectivo')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)

  const montoNum = parseFloat(monto) || 0
  const nuevoAbonado = abonado + montoNum
  const esPagoCompleto = nuevoAbonado >= total

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (montoNum <= 0) {
      notify({ variant: 'warning', title: 'Monto inválido', text: 'El monto debe ser mayor a 0' })
      return
    }
    // Tolerancia de medio centavo: `saldo` es float (p.ej. 112.10 - 37.37 =
    // 74.72999…) y el input se prellena con saldo.toFixed(2) = '74.73'. Sin la
    // tolerancia, 74.73 > 74.7299… bloquearía el pago total exacto y la factura
    // nunca se podría liquidar. Un sobrepago real (≥ 0.01) sí se rechaza.
    if (montoNum > saldo + 0.005) {
      notify({ variant: 'warning', title: 'Monto excede el saldo', text: `El saldo pendiente es ${moneda} ${saldo.toFixed(2)}` })
      return
    }

    setSaving(true)
    try {
      // Insertar pago
      const { error: pagoError } = await createPago({
        registro_id: registro.id,
        cliente_id: registro.cliente_id,
        project_id: null,
        monto: montoNum,
        metodo: formaPago,
        referencia: referencia || null,
        numero_documento: numeroDocumento || null,
        tipo_aplicacion: tipoAplicacion,
        estado: 'aplicado',
        notas: notas || null,
        created_by: currentUserId,
      })

      if (pagoError) throw new Error(pagoError)

      // Actualizar estado de registro si se pagó completo
      const nuevoEstado: Registro['estado'] = esPagoCompleto ? 'pagado' : 'pendiente'
      const update: Record<string, unknown> = {
        monto_pagado: nuevoAbonado,
        estado: nuevoEstado,
        fecha_pago: esPagoCompleto ? new Date().toISOString().split('T')[0] : null,
      }
      // T4 · agua:C4 — si el pago liquida una factura emitida/vencida, también
      // transiciona la máquina de estados de la Factura a 'pagada'. La validez de
      // la transición la decide business.ts (no se duplica aquí).
      if (esPagoCompleto && factura && puedeTransicionarFactura(factura.factura_estado, 'pagar').ok) {
        update.factura_estado = 'pagada'
        update.pagada_at = new Date().toISOString()
      }
      const { error: regError } = await updateRegistro(registro.id, update)

      if (regError) throw new Error(regError)

      notify({
        variant: 'success',
        title: esPagoCompleto ? '✅ Pago completo aplicado' : '💳 Abono registrado',
        text: `${moneda} ${montoNum.toFixed(2)} aplicado vía ${formasPagoLabels[formaPago]}${numeroDocumento ? ` · Doc: ${numeroDocumento}` : ''}`,
        duration: 2000,
      })

      onSuccess(registro.id, nuevoEstado, nuevoAbonado)
    } catch (err) {
      console.error(err)
      notify({ variant: 'error', title: 'Error', text: 'No se pudo registrar el pago' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditModal
      title="💰 Aplicar Pago"
      size="sm"
      maxWidth="520px"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            type="submit"
            form="pago-form"
            variant="gradient-primary"
            loading={saving}
            loadingText="Guardando..."
            iconLeft={!saving ? '💰' : undefined}
          >
            Confirmar Pago
          </Button>
        </>
      }
    >
      {/* Info del cargo */}
        <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>
              {cliente?.nombre ?? registro.cliente_nombre}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              {factura && <FacturaEstadoBadge estado={factura.factura_estado} />}
              {/* serv:S11 — estatus de timbrado del comprobante (si existe). */}
              <TimbradoEstadoBadge estado={documentoFiscal?.estado} />
            </div>
          </div>
          {/* serv:S11 — datos del comprobante timbrado (UUID/serie/número). */}
          {documentoFiscal && (
            <TimbradoDatos documento={documentoFiscal} style={{ marginBottom: '12px' }} />
          )}
          {/* Desglose subtotal + IVA + mora = total (cuando la factura tiene snapshot). */}
          {factura && (factura.iva_monto != null || factura.mora_monto != null || factura.total_a_pagar != null) && (
            <div style={{ marginBottom: '12px' }}>
              <FacturaDesglose factura={factura} moneda={moneda} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '13px' }}>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Total a pagar</div>
              <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {total.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Abonado</div>
              <div style={{ fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {abonado.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Saldo</div>
              <div style={{ fontWeight: 700, color: 'var(--at-warning)', fontSize: '16px' }}>{moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        </div>

      <form id="pago-form" onSubmit={handleSubmit}>
        {/* Tipo de aplicación */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Tipo de Aplicación
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {([['pago_total', '✅ Pago Total'], ['abono', '💳 Abono Parcial']] as const).map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => {
                  setTipoAplicacion(val)
                  if (val === 'pago_total') setMonto(saldo.toFixed(2))
                }} style={{
                  flex: 1, padding: '10px', borderRadius: '8px',
                  border: tipoAplicacion === val ? '2px solid var(--at-primary)' : '2px solid var(--at-line)',
                  background: tipoAplicacion === val ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                  color: tipoAplicacion === val ? 'var(--at-primary-hover)' : 'var(--at-ink-2)',
                  fontWeight: tipoAplicacion === val ? 700 : 500,
                  fontSize: '13px', cursor: 'pointer',
                }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Monto */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Monto a Aplicar ({moneda}) *
            </label>
            <input
              type="number" step="0.01" min="0.01" max={saldo}
              value={monto} onChange={e => setMonto(e.target.value)}
              required
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '16px', fontWeight: 700, fontFamily: 'inherit' }}
            />
          </div>

          {/* Forma de pago */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Forma de Pago *
            </label>
            <select
              value={formaPago} onChange={e => setFormaPago(e.target.value as FormaPago)}
              required
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', background: 'var(--at-surface)' }}
            >
              {(Object.entries(formasPagoLabels) as [FormaPago, string][]).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>

          {/* Número de documento */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Número de Documento
              <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--at-ink-3)', marginLeft: '6px' }}>
                (# recibo, ref. transferencia, # cheque, etc.)
              </span>
            </label>
            <input
              type="text" value={numeroDocumento} onChange={e => setNumeroDocumento(e.target.value)}
              placeholder="Ej: TRF-001234 / CHQ-5678"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
            />
          </div>

          {/* Referencia adicional */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Referencia / Banco
            </label>
            <input
              type="text" value={referencia} onChange={e => setReferencia(e.target.value)}
              placeholder="Ej: Banco Industrial, Cuenta XXX"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
            />
          </div>

          {/* Notas */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Notas
            </label>
            <textarea
              value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Observaciones sobre el pago..."
              rows={2}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>

          {/* Preview del resultado */}
          {montoNum > 0 && montoNum <= saldo && (
            <div style={{
              padding: '12px 16px', borderRadius: '8px', marginBottom: '20px',
              background: esPagoCompleto ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
              border: `1px solid ${esPagoCompleto ? 'var(--at-success-border)' : 'var(--at-warning-border)'}`,
              fontSize: '13px', fontWeight: 600,
              color: esPagoCompleto ? 'var(--at-success-strong)' : 'var(--at-warning-strong)',
            }}>
              {esPagoCompleto
                ? `✅ Con este pago el cargo quedará PAGADO COMPLETAMENTE`
                : `💳 Quedará un saldo de ${moneda} ${(saldo - montoNum).toFixed(2)} pendiente`
              }
            </div>
          )}

      </form>
    </EditModal>
  )
}
