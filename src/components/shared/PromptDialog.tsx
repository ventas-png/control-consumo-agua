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
              {options.fields.map(field => (
                <InputField
                  key={field.name}
                  {...field}
                  value={values[field.name] ?? ''}
                  onChange={(v) => setValues(prev => ({ ...prev, [field.name]: v }))}
                />
              ))}
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
