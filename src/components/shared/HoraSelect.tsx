import type { CSSProperties } from 'react'

interface Props {
  /** `HH:MM` en 24 horas; '' = sin hora. */
  value: string
  onChange: (value: string) => void
  /** Nombre accesible del grupo («Hora estimada de llegada»). */
  label: string
  /** id del primer selector, para asociarlo a un `<label htmlFor>`. */
  id?: string
  style?: CSSProperties
  disabled?: boolean
}

const HORAS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTOS = ['00', '15', '30', '45']
const dos = (n: number) => String(n).padStart(2, '0')

/** `HH:MM` (24 h) → partes de reloj de 12 horas; null si está vacío o mal formado. */
export function partesDeHora(value: string): { hora: number; minuto: string; pm: boolean } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value)
  if (!m) return null
  const h24 = Number(m[1])
  return { hora: h24 % 12 === 0 ? 12 : h24 % 12, minuto: m[2], pm: h24 >= 12 }
}

/** Partes de reloj de 12 horas → `HH:MM` (24 h). */
export function horaDePartes(hora: number, minuto: string, pm: boolean): string {
  return `${dos((hora % 12) + (pm ? 12 : 0))}:${minuto}`
}

/**
 * Hora por selección, sin teclado: hora, minutos (cada 15) y a. m. / p. m.
 * Pensado para quien captura en garita o recepción desde un teléfono. Elegir
 * «—» en la hora la deja vacía; elegir una hora sobre un campo vacío arranca
 * en :00 y p. m. (lo habitual para un check-in).
 */
export function HoraSelect({ value, onChange, label, id, style, disabled }: Props) {
  const p = partesDeHora(value)
  const base: CSSProperties = { ...style, width: 'auto', flex: '1 1 0', minWidth: 0 }
  // Un minuto guardado que no cae en cuartos (p. ej. 12:20) se conserva como opción.
  const minutos = p && !MINUTOS.includes(p.minuto) ? [...MINUTOS, p.minuto].sort() : MINUTOS
  const fijar = (hora: number, minuto: string, pm: boolean) => onChange(horaDePartes(hora, minuto, pm))

  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
      <select id={id} aria-label={`${label}: hora`} disabled={disabled} style={base} value={p ? String(p.hora) : ''}
        onChange={e => (e.target.value === '' ? onChange('') : fijar(Number(e.target.value), p?.minuto ?? '00', p?.pm ?? true))}>
        <option value="">—</option>
        {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label={`${label}: minutos`} disabled={disabled || !p} style={base} value={p?.minuto ?? '00'}
        onChange={e => p && fijar(p.hora, e.target.value, p.pm)}>
        {minutos.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select aria-label={`${label}: a. m. o p. m.`} disabled={disabled || !p} style={base} value={p?.pm === false ? 'am' : 'pm'}
        onChange={e => p && fijar(p.hora, p.minuto, e.target.value === 'pm')}>
        <option value="am">a. m.</option>
        <option value="pm">p. m.</option>
      </select>
    </div>
  )
}
