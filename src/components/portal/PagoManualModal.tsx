import { useState, type ChangeEvent} from 'react'
import { notify } from '../shared/Dialog'
import { createPago, uploadComprobantePago } from '../../domain/cobros/mutations'
import type { Registro, UserSession, FormaPago } from '../../types'
import { calcularTotalPagar } from '../../lib/business'
import { ModalPortal } from '../shared/ModalPortal'

interface Props {
  registro: Registro
  moneda: string
  currentUser: UserSession
  onClose: () => void
  onSuccess: () => void
}

const FORMAS_PAGO: { value: FormaPago; label: string }[] = [
  { value: 'efectivo', label: '💵 Efectivo' },
  { value: 'transferencia', label: '🏦 Transferencia' },
  { value: 'deposito', label: '🏧 Depósito' },
  { value: 'cheque', label: '📄 Cheque' },
  { value: 'tarjeta_credito', label: '💳 Tarjeta de Crédito' },
  { value: 'otro', label: '📎 Otro' },
]

export function PagoManualModal({ registro, moneda, currentUser, onClose, onSuccess }: Props) {
  const [monto, setMonto] = useState('')
  const [formaPago, setFormaPago] = useState<FormaPago>('transferencia')
  const [numeroComprobante, setNumeroComprobante] = useState('')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [adjunto, setAdjunto] = useState<File | null>(null)
  const [previewAdjunto, setPreviewAdjunto] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const total = registro.monto_calculado ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
  const abonado = registro.monto_pagado ?? 0
  const saldo = Math.max(0, total - abonado)

  function handleSelectFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setAdjunto(file)
      const reader = new FileReader()
      reader.onload = ev => {
        setPreviewAdjunto(ev.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  async function handleSubmit() {
    const montoNum = parseFloat(monto) || 0
    if (montoNum <= 0 || montoNum > saldo) {
      notify({ variant: 'warning', title: 'Monto inválido' })
      return
    }
    if (!numeroComprobante.trim()) {
      notify({ variant: 'warning', title: 'Número de comprobante requerido' })
      return
    }

    setLoading(true)

    try {
      // Subir comprobante si existe — guardamos el path bare; el display
      // site (CobrosSection) firma vía useSignedUrl en cada render.
      let comprobantePath: string | null = null
      if (adjunto) {
        const path = `comprobantes/${currentUser.user_id}/${Date.now()}`
        const { error: uploadError } = await uploadComprobantePago(path, adjunto, adjunto.type)

        if (!uploadError) {
          comprobantePath = path
        }
      }

      // Crear pago con estado "pendiente_verificacion"
      const { error } = await createPago({
        registro_id: registro.id,
        cliente_id: registro.cliente_id,
        project_id: null,
        monto: montoNum,
        metodo: formaPago,
        numero_documento: numeroComprobante.trim(),
        referencia: referencia.trim() || null,
        comprobante_url: comprobantePath,
        comprobante_tipo: adjunto ? (adjunto.type.startsWith('image') ? 'imagen' : 'pdf') : null,
        tipo_aplicacion: 'pago_total',
        verification_status: 'pendiente',
        estado: 'pendiente',
        notas: notas.trim() || null,
        created_by: currentUser.user_id,
      })

      if (error) throw new Error(error)

      notify({
        variant: 'success',
        title: '✅ Pago registrado',
        text: `Tu pago de ${moneda} ${montoNum.toFixed(2)} está en revisión. El gestor de cobros verificará tu comprobante en las próximas horas.`,
        duration: 3000,
      })

      onSuccess()
    } catch (err: any) {
      console.error(err)
      notify({
        variant: 'error',
        title: 'Error',
        text: err.message || 'No se pudo registrar el pago',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalPortal>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--at-surface)',
          borderRadius: '16px',
          padding: '32px',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)', margin: 0 }}>📄 Registrar Pago</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--at-ink-3)' }}
          >
            ✕
          </button>
        </div>

        <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Total Cargo</div>
              <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {total.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Saldo Pendiente</div>
              <div style={{ fontWeight: 700, color: 'var(--at-danger)', fontSize: '16px' }}>{moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Monto Pagado ({moneda}) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={saldo}
            value={monto}
            onChange={e => setMonto(e.target.value)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '16px',
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Forma de Pago *
          </label>
          <select
            value={formaPago}
            onChange={e => setFormaPago(e.target.value as FormaPago)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
              background: 'var(--at-surface)',
            }}
          >
            {FORMAS_PAGO.map(fp => (
              <option key={fp.value} value={fp.value}>
                {fp.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Número de Comprobante *
            <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--at-ink-3)', marginLeft: '6px' }}>
              (# cheque, ref. transf., # depósito, etc.)
            </span>
          </label>
          <input
            type="text"
            value={numeroComprobante}
            onChange={e => setNumeroComprobante(e.target.value)}
            placeholder="Ej: CHQ-2025-001234"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Banco / Referencia
          </label>
          <input
            type="text"
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            placeholder="Ej: Banco Industrial, Cuenta 123456"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Adjuntar Comprobante (Imagen/PDF)
          </label>
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={handleSelectFile}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '13px',
            }}
          />
          {previewAdjunto && (
            <div style={{ marginTop: '12px' }}>
              {adjunto?.type.startsWith('image') ? (
                <img src={previewAdjunto} alt="Preview" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '8px', border: '1px solid var(--at-line)' }} />
              ) : (
                <div style={{ padding: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1px solid var(--at-line)', textAlign: 'center', color: 'var(--at-ink-3)' }}>
                  📄 PDF seleccionado
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Notas (opcional)
          </label>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Detalles adicionales sobre el pago..."
            rows={2}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              background: 'var(--at-surface)',
              color: 'var(--at-ink-3)',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flex: 2,
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: loading ? 'var(--at-line-strong)' : 'linear-gradient(135deg, var(--at-success), var(--at-success-strong))',
              color: 'white',
              fontWeight: 700,
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '⏳ Registrando...' : '📤 Registrar Pago'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
