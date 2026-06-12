// ToggleSwitch — switch accesible reutilizable (extraído de los toggles de
// servicio duplicados que vivían inline en SuperAdminSection).
interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Gradiente del track encendido (par de tokens CSS). */
  onColors?: [string, string]
  /** Color del label cuando está encendido. */
  onLabelColor?: string
  disabled?: boolean
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  onColors = ['var(--at-primary)', 'var(--at-primary-hover)'],
  onLabelColor = 'var(--at-accent-2)',
  disabled = false,
}: Props) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none',
      opacity: disabled ? 0.5 : 1,
    }}>
      <span style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={ev => onChange(ev.target.checked)}
          aria-label={label}
          style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
        />
        <span style={{
          position: 'absolute', inset: 0,
          background: checked ? `linear-gradient(135deg, ${onColors[0]}, ${onColors[1]})` : 'var(--at-line)',
          borderRadius: '20px',
          transition: 'background 0.2s',
        }} />
        <span style={{
          position: 'absolute',
          top: '3px',
          left: checked ? '19px' : '3px',
          width: '14px', height: '14px',
          background: 'var(--at-surface)',
          borderRadius: '50%',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }} />
      </span>
      <span style={{
        fontSize: '12px',
        color: checked ? onLabelColor : 'var(--at-ink-2)',
        fontWeight: 500, whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </label>
  )
}
