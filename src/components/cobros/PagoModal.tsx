import { useState, type FormEvent} from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { Registro, Cliente, FormaPago, TipoAplicacion } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  registro: Registro
  cliente?: Cliente
  moneda: string
  currentUserId: string
  formasPagoLabels: Record<FormaPago, string>
  onClose: () => void
  onSuccess: (registroId: string, nuevoEstado: Registro['estado'], montoPagado: number) => void
}

export function PagoModal({ registro, cliente, moneda, currentUserId, formasPagoLabels, onClose, onSuccess }: Props) {
  const total = registro.monto_calculado ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
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
      void Swal.fire({ icon: 'warning', title: 'Monto inválido', text: 'El monto debe ser mayor a 0' })
      return
    }
    if (montoNum > saldo) {
      void Swal.fire({ icon: 'warning', title: 'Monto excede el saldo', text: `El saldo pendiente es ${moneda} ${saldo.toFixed(2)}` })
      return
    }

    setSaving(true)
    try {
      // Insertar pago
      const { error: pagoError } = await supabase.from('pagos').insert({
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

      if (pagoError) throw pagoError

      // Actualizar estado de registro si se pagó completo
      const nuevoEstado: Registro['estado'] = esPagoCompleto ? 'pagado' : 'pendiente'
      const { error: regError } = await supabase.from('registros').update({
        monto_pagado: nuevoAbonado,
        estado: nuevoEstado,
        fecha_pago: esPagoCompleto ? new Date().toISOString().split('T')[0] : null,
      }).eq('id', registro.id)

      if (regError) throw regError

      void Swal.fire({
        icon: 'success',
        title: esPagoCompleto ? '✅ Pago completo aplicado' : '💳 Abono registrado',
        html: `<b>${moneda} ${montoNum.toFixed(2)}</b> aplicado vía <b>${formasPagoLabels[formaPago]}</b>${numeroDocumento ? `<br>Doc: <b>${numeroDocumento}</b>` : ''}`,
        timer: 2000,
        showConfirmButton: false,
      })

      onSuccess(registro.id, nuevoEstado, nuevoAbonado)
    } catch (err) {
      console.error(err)
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo registrar el pago' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '16px',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'white', borderRadius: '16px', padding: '32px',
        width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#15291F', margin: 0 }}>💰 Aplicar Pago</h2>
          <button onClick={onClose} aria-label="Cerrar modal" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#7E9389', padding: '4px' }}>✕</button>
        </div>

        {/* Info del cargo */}
        <div style={{ background: '#FAF7EF', borderRadius: '12px', padding: '16px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#15291F', marginBottom: '8px' }}>
            {cliente?.nombre ?? registro.cliente_nombre}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '13px' }}>
            <div>
              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Cargo total</div>
              <div style={{ fontWeight: 700, color: '#15291F' }}>{moneda} {total.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Abonado</div>
              <div style={{ fontWeight: 700, color: '#10b981' }}>{moneda} {abonado.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Saldo</div>
              <div style={{ fontWeight: 700, color: '#f59e0b', fontSize: '16px' }}>{moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Tipo de aplicación */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E5A4C', marginBottom: '8px' }}>
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
                  background: tipoAplicacion === val ? '#EEF2EC' : 'white',
                  color: tipoAplicacion === val ? '#102622' : '#3E5A4C',
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
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E5A4C', marginBottom: '8px' }}>
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
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E5A4C', marginBottom: '8px' }}>
              Forma de Pago *
            </label>
            <select
              value={formaPago} onChange={e => setFormaPago(e.target.value as FormaPago)}
              required
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', background: 'white' }}
            >
              {(Object.entries(formasPagoLabels) as [FormaPago, string][]).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>

          {/* Número de documento */}
          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E5A4C', marginBottom: '8px' }}>
              Número de Documento
              <span style={{ fontSize: '11px', fontWeight: 400, color: '#7E9389', marginLeft: '6px' }}>
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
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E5A4C', marginBottom: '8px' }}>
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
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#3E5A4C', marginBottom: '8px' }}>
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
              background: esPagoCompleto ? '#f0fdf4' : '#fffbeb',
              border: `1px solid ${esPagoCompleto ? '#bbf7d0' : '#fde68a'}`,
              fontSize: '13px', fontWeight: 600,
              color: esPagoCompleto ? '#15803d' : '#b45309',
            }}>
              {esPagoCompleto
                ? `✅ Con este pago el cargo quedará PAGADO COMPLETAMENTE`
                : `💳 Quedará un saldo de ${moneda} ${(saldo - montoNum).toFixed(2)} pendiente`
              }
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '13px', borderRadius: '8px', border: '1.5px solid var(--at-line)',
              background: 'white', color: '#7E9389', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '13px', borderRadius: '8px', border: 'none',
              background: saving ? '#C7C2B0' : 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))',
              color: 'white', fontWeight: 700, fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer',
            }}>
              {saving ? '⏳ Guardando...' : '💰 Confirmar Pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
