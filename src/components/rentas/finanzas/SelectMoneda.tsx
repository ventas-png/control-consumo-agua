import { MONEDAS_RENTA } from '../../../domain/rentas/finanzas'
import { campo } from '../ui'

interface Props {
  id: string
  value: string
  onChange: (moneda: string) => void
  /** Otras monedas que deben poder elegirse aunque no estén en el catálogo (un dato ya guardado). */
  extra?: readonly string[]
  ariaLabel?: string
  disabled?: boolean
}

/** Selector de moneda (código ISO); dólares primero. */
export function SelectMoneda({ id, value, onChange, extra = [], ariaLabel, disabled }: Props) {
  const opciones = [...new Set([...MONEDAS_RENTA, ...extra, value])].filter(Boolean)
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)} aria-label={ariaLabel} disabled={disabled}
      style={{ ...campo, width: ariaLabel ? 'auto' : undefined }}>
      {opciones.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  )
}
