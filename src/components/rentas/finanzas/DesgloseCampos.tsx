import type { ConceptoRenta } from '../../../types'
import { BLOQUE_LABEL, BLOQUE_TOTAL_LABEL, BLOQUES, conceptosDeBloque, importesDeFormulario, totalesDesglose } from '../../../domain/rentas/finanzas'
import { formatCurrency } from '../../../lib/format'
import { campo, etiqueta, tenue } from '../ui'

interface Props {
  conceptos: ConceptoRenta[]
  /** Concepto → texto tal como se escribe. */
  valores: Record<string, string>
  onChange: (conceptoId: string, texto: string) => void
  moneda: string
  /** Prefijo de los id de los campos (un formulario por pantalla). */
  idPrefijo: string
}

/**
 * Los dos bloques del desglose de cobro de una reserva —lo que pagó el huésped
 * y lo que recibió el anfitrión— con el total de cada uno calculado al escribir.
 * Un concepto desactivado sólo aparece si la reserva ya traía monto en él.
 */
export function DesgloseCampos({ conceptos, valores, onChange, moneda, idPrefijo }: Props) {
  const importes = importesDeFormulario(valores)
  const totales = importes ? totalesDesglose(conceptos, importes) : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '1rem' }}>
      {BLOQUES.map(bloque => {
        const lista = conceptosDeBloque(conceptos, bloque).filter(c => c.activo || (valores[c.id] ?? '').trim() !== '')
        const total = totales ? (bloque === 'huesped' ? totales.huesped : totales.anfitrion) : null
        return (
          <fieldset key={bloque} style={{ border: '1px solid var(--at-line)', borderRadius: '8px', padding: '0.75rem', margin: 0, minWidth: 0 }}>
            <legend style={{ fontSize: '13px', fontWeight: 600, padding: '0 0.35rem' }}>{BLOQUE_LABEL[bloque]}</legend>
            {lista.length === 0 && <p style={{ ...tenue, margin: 0 }}>Sin conceptos en este bloque.</p>}
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {lista.map(c => (
                <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: '0.5rem', alignItems: 'center' }}>
                  <label htmlFor={`${idPrefijo}-${c.id}`} style={{ ...etiqueta, margin: 0, fontWeight: 400 }}>
                    {c.signo === -1 ? '− ' : ''}{c.nombre}{!c.activo ? ' (desactivado)' : ''}
                  </label>
                  <input id={`${idPrefijo}-${c.id}`} type="text" inputMode="decimal" value={valores[c.id] ?? ''}
                    onChange={e => onChange(c.id, e.target.value)} placeholder="0.00"
                    style={{ ...campo, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--at-line)', fontWeight: 600, fontSize: '14px' }}>
              <span>{BLOQUE_TOTAL_LABEL[bloque]}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{total === null ? '—' : formatCurrency(total, moneda)}</span>
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
