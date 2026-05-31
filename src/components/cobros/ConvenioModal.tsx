import { useState, type FormEvent} from 'react'
import { notify } from '../shared/Dialog'
import { supabase } from '../../lib/supabase'
import type { Registro, Cliente } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  moneda: string
  currentUserId: string
  onClose: () => void
  onSuccess: () => void
}

export function ConvenioModal({ registros, clientes, moneda, currentUserId, onClose, onSuccess }: Props) {
  const totalCargos = registros.reduce((acc, r) => {
    return acc + (r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total)
  }, 0)

  // Un convenio es sobre un solo cliente (todos los seleccionados deben ser del mismo)
  const clienteId = registros[0]?.cliente_id
  const cliente = clientes.find(c => c.id === clienteId)

  const [numeroConvenio, setNumeroConvenio] = useState(`CONV-${Date.now().toString().slice(-6)}`)
  const [descripcion, setDescripcion] = useState('')
  const [cuotasPactadas, setCuotasPactadas] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!numeroConvenio.trim()) return

    setSaving(true)
    try {
      const { error } = await supabase.from('convenios_pago').insert({
        cliente_id: clienteId,
        numero_convenio: numeroConvenio.trim(),
        descripcion: descripcion || null,
        monto_total: totalCargos,
        monto_pagado: 0,
        cuotas_pactadas: cuotasPactadas ? parseInt(cuotasPactadas) : null,
        fecha_inicio: new Date().toISOString().split('T')[0],
        fecha_vencimiento: fechaVencimiento || null,
        estado: 'activo',
        registro_ids: registros.map(r => r.id),
        notas: notas || null,
        created_by: currentUserId,
      })

      if (error) throw error

      // Marcar los registros como mora para que el cobrador haga seguimiento
      await supabase.from('registros')
        .update({ estado: 'mora' })
        .in('id', registros.map(r => r.id))

      notify({
        variant: 'success',
        title: '🤝 Convenio creado',
        text: `Convenio #${numeroConvenio} por ${moneda} ${totalCargos.toFixed(2)}`,
        duration: 2000,
      })

      onSuccess()
    } catch (err) {
      console.error(err)
      notify({ variant: 'error', title: 'Error', text: 'No se pudo crear el convenio' })
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
        background: 'var(--at-surface)', borderRadius: '16px', padding: '32px',
        width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)', margin: 0 }}>🤝 Crear Convenio de Pago</h2>
          <button onClick={onClose} aria-label="Cerrar modal" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>✕</button>
        </div>

        {/* Resumen de cargos */}
        <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '8px' }}>{cliente?.nombre}</div>
          <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            {registros.length} cargo{registros.length !== 1 ? 's' : ''} incluido{registros.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--at-accent)' }}>
            Total: {moneda} {totalCargos.toFixed(2)}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
              Número de Convenio *
            </label>
            <input
              type="text" value={numeroConvenio} onChange={e => setNumeroConvenio(e.target.value)}
              required
              style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
              Descripción del convenio
            </label>
            <input
              type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej: Acuerdo de pago en 3 cuotas mensuales"
              style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
                Cuotas Pactadas
              </label>
              <input
                type="number" min="1" value={cuotasPactadas} onChange={e => setCuotasPactadas(e.target.value)}
                placeholder="Ej: 3"
                style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
                Fecha de Vencimiento
              </label>
              <input
                type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)}
                style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
              Notas / Condiciones
            </label>
            <textarea
              value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Condiciones especiales, acuerdos adicionales..."
              rows={3}
              style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '13px', borderRadius: '8px', border: '1.5px solid var(--at-line)',
              background: 'var(--at-surface)', color: 'var(--at-ink-3)', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving} style={{
              flex: 2, padding: '13px', borderRadius: '8px', border: 'none',
              background: saving ? 'var(--at-line-strong)' : 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))',
              color: 'white', fontWeight: 700, fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer',
            }}>
              {saving ? '⏳ Creando...' : '🤝 Crear Convenio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
