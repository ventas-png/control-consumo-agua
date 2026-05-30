import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { InputField, type InputFieldProps } from './InputField'

// ============================================================================
// PromptDialog — modal form generico (F3.4)
// ============================================================================
// Reemplazo accesible de los ~248 Swal con html: + preConfirm:. Composicion:
//
//   - Dialog.Root + Dialog.Portal + Dialog.Overlay (Radix → focus trap,
//     escape, return-focus, role=dialog automaticos)
//   - <InputField> de F3.4 para cada campo (asociacion label-input, errors)
//   - preConfirm async para validacion y conversion de datos antes de cerrar
//
// API:
//   const result = await openPromptDialog({
//     title: 'Nueva empresa',
//     fields: [
//       { name: 'nombre', label: 'Nombre', required: true },
//       { name: 'nit',    label: 'NIT (opcional)' },
//       { name: 'email',  label: 'Email', type: 'email', autoComplete: 'email' },
//     ],
//     submitText: 'Crear',
//     validate: (data) => data.nombre.trim() ? null : 'Nombre es obligatorio',
//   })
//   if (result) {
//     console.log(result.nombre, result.nit, result.email)
//   }
//
// El callsite no necesita document.getElementById ni preConfirm: con strings.
// Validacion y submit son funciones type-safe.
// ============================================================================

export interface PromptFieldDef extends Omit<InputFieldProps, 'value' | 'onChange'> {
  name: string
  /** Valor inicial */
  initialValue?: string
  /** F3.4c: tipo de control. Default 'input' (InputField).
   *   'textarea' = caja multiline accesible
   *   'select' = dropdown con options[]
   */
  control?: 'input' | 'textarea' | 'select'
  /** Solo para control='select' */
  options?: Array<{ value: string; label: string }>
  /** Solo para control='textarea': filas iniciales */
  rows?: number
}

export interface PromptDialogOptions {
  title: string
  description?: string
  fields: PromptFieldDef[]
  submitText?: string
  cancelText?: string
  /** Validacion async. Devolver string con error o null si OK. */
  validate?: (data: Record<string, string>) => string | null | Promise<string | null>
}

type Resolver = (value: Record<string, string> | null) => void

let pendingPrompt: {
  options: PromptDialogOptions
  resolve: Resolver
} | null = null
const listeners = new Set<(p: typeof pendingPrompt) => void>()

export function openPromptDialog(options: PromptDialogOptions): Promise<Record<string, string> | null> {
  return new Promise(resolve => {
    pendingPrompt = { options, resolve }
    listeners.forEach(l => l(pendingPrompt))
  })
}

function closePrompt(result: Record<string, string> | null) {
  if (!pendingPrompt) return
  const r = pendingPrompt
  pendingPrompt = null
  listeners.forEach(l => l(null))
  r.resolve(result)
}

export function PromptDialogRoot() {
  const [state, setState] = useState<typeof pendingPrompt>(pendingPrompt)
  useEffect(() => {
    listeners.add(setState)
    return () => { listeners.delete(setState) }
  }, [])

  // Per-field state — debe vivir DENTRO de un componente hijo para que se
  // resetee cuando cambia options. Renderizamos uno hijo por prompt.
  if (!state) return null
  return <PromptDialogContent key={state.options.title} options={state.options} />
}

function PromptDialogContent({ options }: { options: PromptDialogOptions }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(options.fields.map(f => [f.name, f.initialValue ?? '']))
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (options.validate) {
      setSubmitting(true)
      try {
        const msg = await options.validate(values)
        if (msg) {
          setError(msg)
          setSubmitting(false)
          return
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error de validación')
        setSubmitting(false)
        return
      }
      setSubmitting(false)
    }
    closePrompt(values)
  }

  return (
    <Dialog.Root open={true} onOpenChange={(open) => { if (!open) closePrompt(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9998,
          animation: 'at-dialog-overlay-in 120ms ease-out',
        }} />
        <Dialog.Content
          style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--at-surface)', borderRadius: '16px',
            padding: '24px 28px', maxWidth: '480px', width: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)', zIndex: 9999,
            animation: 'at-dialog-content-in 160ms ease-out',
          }}
        >
          <form onSubmit={handleSubmit}>
            <Dialog.Title style={{
              margin: '0 0 6px', fontSize: '18px', fontWeight: 700,
              color: 'var(--at-ink)',
            }}>
              {options.title}
            </Dialog.Title>
            {options.description && (
              <Dialog.Description style={{
                margin: '0 0 18px', fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.5,
              }}>
                {options.description}
              </Dialog.Description>
            )}
            <div style={{ marginTop: options.description ? 0 : '14px' }}>
              {options.fields.map(field => {
                const val = values[field.name] ?? ''
                const setVal = (v: string) => setValues(prev => ({ ...prev, [field.name]: v }))
                if (field.control === 'textarea') {
                  return <TextareaField key={field.name} def={field} value={val} onChange={setVal} />
                }
                if (field.control === 'select') {
                  return <SelectField key={field.name} def={field} value={val} onChange={setVal} />
                }
                return <InputField key={field.name} {...field} value={val} onChange={setVal} />
              })}
            </div>
            {error && (
              <p
                role="alert"
                style={{
                  margin: '12px 0', padding: '10px 12px',
                  background: 'var(--at-danger-tint)', borderRadius: '8px',
                  border: '1px solid var(--at-danger-border)',
                  color: 'var(--at-danger)', fontSize: '13px', fontWeight: 600,
                }}
              >
                ⚠️ {error}
              </p>
            )}
            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              gap: '10px', marginTop: '18px',
            }}>
              <Dialog.Close asChild>
                <button
                  type="button"
                  onClick={() => closePrompt(null)}
                  style={{
                    padding: '9px 18px', borderRadius: '10px',
                    border: '1.5px solid var(--at-line)', background: 'var(--at-surface)',
                    color: 'var(--at-ink-2)', fontSize: '14px', fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {options.cancelText ?? 'Cancelar'}
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '9px 18px', borderRadius: '10px', border: 'none',
                  background: 'var(--at-primary)', color: 'white',
                  fontSize: '14px', fontWeight: 700,
                  cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                }}
              >
                {submitting ? 'Procesando…' : (options.submitText ?? 'Aceptar')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Helper para callsites que solo necesitan un valor simple (1 campo):
export async function openTextPrompt(opts: {
  title: string
  description?: string
  label: string
  initialValue?: string
  placeholder?: string
  required?: boolean
  validate?: (v: string) => string | null
}): Promise<string | null> {
  const result = await openPromptDialog({
    title: opts.title,
    description: opts.description,
    fields: [{
      name: 'value',
      label: opts.label,
      initialValue: opts.initialValue,
      placeholder: opts.placeholder,
      required: opts.required,
      autoFocus: true,
    }],
    validate: opts.validate ? (data) => opts.validate!(data.value ?? '') : undefined,
  })
  return result?.value ?? null
}

// Provider con animaciones — usar en main.tsx alongside DialogProvider.
// Actualmente el DialogProvider de F3.2 ya incluye los keyframes
// at-dialog-overlay-in / at-dialog-content-in, asi que PromptDialogRoot
// los hereda sin agregar nada nuevo. Solo hay que montar PromptDialogRoot.

// ─────────────────────────────────────────────────────────────────────────────
// TextareaField y SelectField — controles adicionales para PromptDialog.
// Comparten el wrapper a11y de InputField (label, aria-required, aria-invalid,
// aria-describedby) pero rinden textarea/select internamente.
// ─────────────────────────────────────────────────────────────────────────────

import { useId as useIdF3c } from 'react'

function TextareaField({ def, value, onChange }: { def: PromptFieldDef; value: string; onChange: (v: string) => void }) {
  const reactId = useIdF3c()
  const id = def.id ?? `field-${reactId}`
  const helpId = def.helpText ? `${id}-help` : undefined
  const errorId = def.error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div style={{ marginBottom: '14px' }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
        {def.label}
        {def.required && <span aria-hidden="true" style={{ color: 'var(--at-danger)', marginLeft: '4px' }}>*</span>}
      </label>
      <textarea
        id={id}
        name={def.name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={def.placeholder}
        required={def.required}
        disabled={def.disabled}
        rows={def.rows ?? 3}
        maxLength={def.maxLength}
        aria-required={def.required || undefined}
        aria-invalid={!!def.error || undefined}
        aria-describedby={describedBy}
        autoFocus={def.autoFocus}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 12px',
          border: `1.5px solid ${def.error ? 'var(--at-danger)' : 'var(--at-line)'}`,
          borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit',
          background: def.disabled ? 'var(--at-surface-2)' : 'var(--at-surface)',
          color: def.disabled ? 'var(--at-ink-3)' : 'var(--at-ink)',
          outline: 'none', resize: 'vertical', minHeight: '70px',
        }}
      />
      {def.helpText && !def.error && (
        <p id={helpId} style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}>{def.helpText}</p>
      )}
      {def.error && (
        <p id={errorId} role="alert" style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600 }}>{def.error}</p>
      )}
    </div>
  )
}

function SelectField({ def, value, onChange }: { def: PromptFieldDef; value: string; onChange: (v: string) => void }) {
  const reactId = useIdF3c()
  const id = def.id ?? `field-${reactId}`
  const helpId = def.helpText ? `${id}-help` : undefined
  const errorId = def.error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  const options = def.options ?? []
  return (
    <div style={{ marginBottom: '14px' }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
        {def.label}
        {def.required && <span aria-hidden="true" style={{ color: 'var(--at-danger)', marginLeft: '4px' }}>*</span>}
      </label>
      <select
        id={id}
        name={def.name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={def.required}
        disabled={def.disabled}
        aria-required={def.required || undefined}
        aria-invalid={!!def.error || undefined}
        aria-describedby={describedBy}
        autoFocus={def.autoFocus}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 12px',
          border: `1.5px solid ${def.error ? 'var(--at-danger)' : 'var(--at-line)'}`,
          borderRadius: '8px', fontSize: '14px',
          background: def.disabled ? 'var(--at-surface-2)' : 'var(--at-surface)',
          color: def.disabled ? 'var(--at-ink-3)' : 'var(--at-ink)',
          outline: 'none',
        }}
      >
        {!def.required && <option value="">— Seleccionar —</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {def.helpText && !def.error && (
        <p id={helpId} style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-ink-3)' }}>{def.helpText}</p>
      )}
      {def.error && (
        <p id={errorId} role="alert" style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600 }}>{def.error}</p>
      )}
    </div>
  )
}
