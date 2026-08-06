import { hoyLocalISO } from '../../lib/format'
import { useState, type FormEvent} from 'react'
import { notify } from '../shared/Dialog'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { createConvenio } from '../../domain/cobros/mutations'
import { marcarRegistrosMora } from '../../domain/agua/mutations'
import type { Registro, Cliente } from '../../types'
import { calcularTotalPagar, generarCalendarioConvenio, type FrecuenciaConvenio } from '../../lib/business'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  moneda: string
  currentUserId: string
  onClose: () => void
  onSuccess: () => void
}

export function ConvenioModal({ registros, clientes, moneda, currentUserId, onClose, onSuccess }: Props) {
  // Saldo (no el cargo bruto): se descuenta lo ya abonado para no incluir en el
  // convenio montos que el cliente ya pagó parcialmente.
  const totalCargos = registros.reduce((acc, r) => {
    const cargo = r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
    return acc + Math.max(0, cargo - (r.monto_pagado ?? 0))
  }, 0)

  // Un convenio es sobre un solo cliente (todos los seleccionados deben ser del mismo)
  const clienteId = registros[0]?.cliente_id
  const cliente = clientes.find(c => c.id === clienteId)

  const [numeroConvenio, setNumeroConvenio] = useState(`CONV-${Date.now().toString().slice(-6)}`)
  const [descripcion, setDescripcion] = useState('')
  const [cuotasPactadas, setCuotasPactadas] = useState('')
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState(hoyLocalISO())
  const [frecuencia, setFrecuencia] = useState<FrecuenciaConvenio>('mensual')
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)

  // Calendario de cuotas (P1): se genera al vuelo desde total + nº cuotas + fecha +
  // frecuencia. La última cuota absorbe el residual de redondeo (suma exacta).
  const numCuotas = parseInt(cuotasPactadas) || 0
  const calendario = numCuotas > 0
    ? generarCalendarioConvenio(totalCargos, numCuotas, fechaPrimeraCuota, frecuencia)
    : []

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!numeroConvenio.trim()) return

    setSaving(true)
    try {
      const { error } = await createConvenio({
        cliente_id: clienteId,
        numero_convenio: numeroConvenio.trim(),
        descripcion: descripcion || null,
        monto_total: totalCargos,
        monto_pagado: 0,
        cuotas_pactadas: numCuotas || null,
        // Calendario (P1): fecha_inicio = primera cuota; vencimiento = última cuota.
        cuotas: calendario.length ? calendario : null,
        fecha_inicio: fechaPrimeraCuota || hoyLocalISO(),
        fecha_vencimiento: calendario.length
          ? calendario[calendario.length - 1].fecha_vencimiento
          : (fechaPrimeraCuota || null),
        estado: 'activo',
        registro_ids: registros.map(r => r.id),
        notas: notas || null,
        created_by: currentUserId,
      })

      if (error) throw new Error(error)

      // Marcar los registros como mora para que el cobrador haga seguimiento
      await marcarRegistrosMora(registros.map(r => r.id))

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
    <EditModal
      title="🤝 Crear Convenio de Pago"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            type="submit"
            form="convenio-form"
            variant="gradient-accent"
            loading={saving}
            loadingText="Creando..."
            iconLeft={!saving ? '🤝' : undefined}
          >
            Crear Convenio
          </Button>
        </>
      }
    >
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

      <form id="convenio-form" onSubmit={handleSubmit}>
        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="conv-numero" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
            Número de Convenio *
          </label>
          <input
            id="conv-numero"
            type="text" value={numeroConvenio} onChange={e => setNumeroConvenio(e.target.value)}
            required
            style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="conv-descripcion" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
            Descripción del convenio
          </label>
          <input
            id="conv-descripcion"
            type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)}
            placeholder="Ej: Acuerdo de pago en 3 cuotas mensuales"
            style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
          <div>
            <label htmlFor="conv-cuotas" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
              Número de cuotas
            </label>
            <input
              id="conv-cuotas"
              type="number" min="1" value={cuotasPactadas} onChange={e => setCuotasPactadas(e.target.value)}
              placeholder="Ej: 3"
              style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label htmlFor="conv-frecuencia" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
              Frecuencia
            </label>
            <select
              id="conv-frecuencia"
              value={frecuencia} onChange={e => setFrecuencia(e.target.value as FrecuenciaConvenio)}
              style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' }}
            >
              <option value="mensual">Mensual</option>
              <option value="quincenal">Quincenal</option>
              <option value="semanal">Semanal</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label htmlFor="conv-primera" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
            Fecha de la primera cuota
          </label>
          <input
            id="conv-primera"
            type="date" value={fechaPrimeraCuota} onChange={e => setFechaPrimeraCuota(e.target.value)}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>

        {calendario.length > 0 && (
          <div style={{ marginBottom: '16px', border: '1px solid var(--at-line)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', background: 'var(--at-surface-2)', fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>
              📅 Calendario de pago — {calendario.length} cuota{calendario.length !== 1 ? 's' : ''}
            </div>
            <div style={{ maxHeight: '168px', overflowY: 'auto' }}>
              {calendario.map(c => (
                <div key={c.numero} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '7px 12px', fontSize: '13px', borderTop: '1px solid var(--at-line)' }}>
                  <span style={{ color: 'var(--at-ink-3)', minWidth: '58px' }}>Cuota {c.numero}</span>
                  <span style={{ color: 'var(--at-ink-2)' }}>{new Date(c.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-GT')}</span>
                  <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {c.monto.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="conv-notas" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
            Notas / Condiciones
          </label>
          <textarea
            id="conv-notas"
            value={notas} onChange={e => setNotas(e.target.value)}
            placeholder="Condiciones especiales, acuerdos adicionales..."
            rows={3}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      </form>
    </EditModal>
  )
}
