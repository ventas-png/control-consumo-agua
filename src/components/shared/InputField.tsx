import { useId, type ReactNode, type ChangeEvent } from 'react'

// ============================================================================
// InputField — input accesible reusable (F3.4)
// ============================================================================
// Reemplazo gradual de los ~1224 <input>s sueltos en el codebase. Garantiza:
//
//   - label-input asociado (htmlFor + id auto-generado con useId)
//   - aria-invalid + aria-describedby en estados con error
//   - autoComplete propagado
//   - Required field marcado con aria-required y "*" visible
//   - Help text con id propio para aria-describedby
//
// Tambien sirve de pilar para los form prompts complejos que faltan migrar
// de Swal (~248). En lugar de Swal con html: + preConfirm, se hace un
// <PromptDialog> usando Radix Dialog + InputField (proxima PR F3.4b).
//
// Diseño: API minimalista (no replica todas las features de "shadcn-ui form")
// porque la app tiene su CSS propio y queremos cero acoplamiento.
// ============================================================================

export interface InputFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'tel' | 'number' | 'password' | 'url' | 'date' | 'time' | 'month' | 'week' | 'datetime-local'
  placeholder?: string
  required?: boolean
  disabled?: boolean
  error?: string
  helpText?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url'
  pattern?: string
  maxLength?: number
  min?: string | number
  max?: string | number
  step?: string | number
  /** Elemento decorativo a la izquierda (icono). aria-hidden. */
  prefix?: ReactNode
  /** Elemento a la derecha (boton de toggle, indicador). Si interactivo, debe tener aria-label propio. */
  suffix?: ReactNode
  /** id explicito; default es uno generado con useId */
  id?: string
  name?: string
  autoFocus?: boolean
}

export function InputField({
  label, value, onChange, type = 'text', placeholder, required, disabled,
  error, helpText, autoComplete, inputMode, pattern, maxLength, min, max, step,
  prefix, suffix, id: providedId, name, autoFocus,
}: InputFieldProps) {
  const reactId = useId()
  const id = providedId ?? `field-${reactId}`
  const helpId = helpText ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div style={{ marginBottom: '14px' }}>
      <label
        htmlFor={id}
        style={{
          display: 'block', fontSize: '13px', fontWeight: 600,
          color: 'var(--at-ink-2)', marginBottom: '6px',
        }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--at-danger)', marginLeft: '4px' }}>*</span>
        )}
      </label>
      <div style={{ position: 'relative' }}>
        {prefix && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', left: '12px', top: '50%',
              transform: 'translateY(-50%)', opacity: 0.6, pointerEvents: 'none',
            }}
          >
            {prefix}
          </span>
        )}
        <input
          id={id}
          name={name}
          type={type}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          inputMode={inputMode}
          pattern={pattern}
          maxLength={maxLength}
          min={min}
          max={max}
          step={step}
          autoFocus={autoFocus}
          aria-required={required || undefined}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          style={{
            width: '100%',
            padding: prefix && suffix ? '10px 44px' : prefix ? '10px 12px 10px 40px'
              : suffix ? '10px 40px 10px 12px' : '10px 12px',
            border: `1.5px solid ${error ? 'var(--at-danger)' : 'var(--at-line)'}`,
            borderRadius: '8px',
            fontSize: '14px',
            background: disabled ? 'var(--at-surface-2)' : 'var(--at-surface)',
            color: disabled ? 'var(--at-ink-3)' : 'var(--at-ink)',
            boxSizing: 'border-box',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
        />
        {suffix && (
          <span style={{
            position: 'absolute', right: '12px', top: '50%',
            transform: 'translateY(-50%)',
          }}>
            {suffix}
          </span>
        )}
      </div>
      {helpText && !error && (
        <p
          id={helpId}
          style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}
        >
          {helpText}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600 }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
