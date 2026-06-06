import { useState, type CSSProperties } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { createProject } from '../../domain/onboarding/mutations'
import { notify } from '../shared/Dialog'
import { InputField } from '../shared/InputField'
import type { UserSession } from '../../types'

// F3.11: Setup wizard inicial para empresas nuevas.
//
// Cierra el gap B7 del design critique ("Sin wizards de configuración
// inicial. Onboarding imposible para admin nuevo").
//
// MVP de 4 pasos:
//   1. Welcome (motivación + qué vamos a configurar)
//   2. Tipo de proyecto (agua / condominios / ambos)
//   3. Crear primer proyecto (nombre, moneda, dirección)
//   4. Listo (next steps + CTA contextual)
//
// Diseño: multi-step state machine. Cada step es un componente con
// `<header>` (título + progress bar), `<main>` (form), `<footer>` (atrás/siguiente).
// Accesible: focus trap (Radix Dialog), aria-current step, ESC para cancelar.

type WizardStep = 'welcome' | 'tipo' | 'proyecto' | 'done'

type TipoProyecto = 'agua' | 'condominios' | 'ambos'

interface Props {
  currentUser: UserSession
  /** Trigger element. Default: button "Configurar empresa". */
  trigger?: React.ReactNode
  /** Callback cuando termina exitosamente. */
  onComplete?: () => void
  /** Si true, el wizard se abre automáticamente al montar (para empresas nuevas). */
  autoOpen?: boolean
}

const MONEDAS = [
  { simbolo: 'Q', nombre: 'Quetzal (GTQ)' },
  { simbolo: 'USD', nombre: 'Dólar (USD)' },
  { simbolo: 'MXN', nombre: 'Peso mexicano (MXN)' },
  { simbolo: 'COP', nombre: 'Peso colombiano (COP)' },
  { simbolo: 'PEN', nombre: 'Sol peruano (PEN)' },
  { simbolo: 'CLP', nombre: 'Peso chileno (CLP)' },
  { simbolo: 'ARS', nombre: 'Peso argentino (ARS)' },
]

export function SetupWizard({ currentUser, trigger, onComplete, autoOpen = false }: Props) {
  const [open, setOpen] = useState(autoOpen)
  const [step, setStep] = useState<WizardStep>('welcome')
  const [tipo, setTipo] = useState<TipoProyecto>('condominios')
  const [nombre, setNombre] = useState('')
  const [moneda, setMoneda] = useState('Q')
  const [direccion, setDireccion] = useState('')
  const [saving, setSaving] = useState(false)

  const totalSteps = 4
  const currentIdx = { welcome: 1, tipo: 2, proyecto: 3, done: 4 }[step]

  function reset() {
    setStep('welcome')
    setTipo('condominios')
    setNombre('')
    setMoneda('Q')
    setDireccion('')
  }

  function handleClose() {
    setOpen(false)
    setTimeout(reset, 200) // wait for animation
  }

  async function handleCrearProyecto() {
    if (!nombre.trim()) {
      notify({ variant: 'warning', title: 'Requerido', text: 'El nombre del proyecto es obligatorio.' })
      return
    }
    setSaving(true)
    const { error } = await createProject({
      company_id: currentUser.company_id,
      nombre: nombre.trim(),
      moneda,
      direccion: direccion.trim() || null,
      estado: 'activo',
    })
    setSaving(false)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error })
      return
    }
    setStep('done')
  }

  function handleFinish() {
    setOpen(false)
    setTimeout(() => {
      reset()
      onComplete?.()
    }, 200)
  }

  const progressBar = (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuenow={currentIdx}
      aria-label={`Paso ${currentIdx} de ${totalSteps}`}
      style={{
        display: 'flex', gap: '6px', marginTop: '12px',
      }}
    >
      {Array.from({ length: totalSteps }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1, height: '4px', borderRadius: '2px',
            background: i < currentIdx ? 'var(--at-primary)' : 'var(--at-line)',
            transition: 'background 0.2s',
          }}
        />
      ))}
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(o) => o ? setOpen(true) : handleClose()}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)', zIndex: 9998,
          animation: 'at-dialog-overlay-in 120ms ease-out',
        }} />
        <Dialog.Content
          aria-describedby="wizard-desc"
          style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--at-surface)', borderRadius: '16px',
            padding: '28px 32px',
            maxWidth: '560px', width: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
            boxShadow: '0 24px 60px rgba(0,0,0,0.3)', zIndex: 9999,
            animation: 'at-dialog-content-in 160ms ease-out',
          }}
        >
          {/* Header con título + progress */}
          <header style={{ marginBottom: '20px' }}>
            <Dialog.Title style={{
              margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)',
            }}>
              {step === 'welcome' && '👋 Configurar tu empresa'}
              {step === 'tipo' && '📦 Tipo de proyecto'}
              {step === 'proyecto' && '🏢 Crear primer proyecto'}
              {step === 'done' && '🎉 ¡Listo!'}
            </Dialog.Title>
            {progressBar}
          </header>

          {/* Body */}
          <main id="wizard-desc" style={{ minHeight: '280px' }}>
            {step === 'welcome' && (
              <div>
                <p style={{ margin: '0 0 16px', fontSize: '15px', color: 'var(--at-ink-2)', lineHeight: 1.6 }}>
                  Hola <strong>{currentUser.name}</strong>, te ayudaremos a configurar
                  tu empresa en menos de 3 minutos. Vamos a:
                </p>
                <ul style={listStyle}>
                  <li>📦 Elegir el tipo de proyecto que gestionas</li>
                  <li>🏢 Crear tu primer proyecto / condominio</li>
                  <li>💰 Definir la moneda y datos básicos</li>
                </ul>
                <p style={{ margin: '16px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
                  Luego podrás agregar unidades, residentes, configurar cuotas y mucho más.
                </p>
              </div>
            )}

            {step === 'tipo' && (
              <div>
                <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--at-ink-2)' }}>
                  ¿Qué tipo de proyecto vas a gestionar? Esto define las herramientas que verás.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <RadioCard
                    selected={tipo === 'condominios'}
                    onSelect={() => setTipo('condominios')}
                    icon="🏢"
                    title="Condominios"
                    desc="Gestión de cuotas, residentes, visitantes, amenidades, áreas comunes."
                  />
                  <RadioCard
                    selected={tipo === 'agua'}
                    onSelect={() => setTipo('agua')}
                    icon="💧"
                    title="Control de agua potable"
                    desc="Lectura de medidores, facturación de consumo, rutas de cobro."
                  />
                  <RadioCard
                    selected={tipo === 'ambos'}
                    onSelect={() => setTipo('ambos')}
                    icon="🔀"
                    title="Ambos"
                    desc="Condominio que también gestiona su propio servicio de agua."
                  />
                </div>
              </div>
            )}

            {step === 'proyecto' && (
              <div>
                <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--at-ink-2)' }}>
                  Datos del primer {tipo === 'agua' ? 'sistema de agua' : 'condominio'}.
                  Podrás agregar más proyectos después.
                </p>
                <InputField
                  label="Nombre"
                  value={nombre}
                  onChange={setNombre}
                  placeholder={tipo === 'agua' ? 'Ej: Sector Norte' : 'Ej: Residencial Las Flores'}
                  required
                  autoFocus
                />
                <div style={{ marginBottom: '14px' }}>
                  <label htmlFor="wizard-moneda" style={labelStyle}>
                    Moneda <span aria-hidden="true" style={{ color: 'var(--at-danger)' }}>*</span>
                  </label>
                  <select
                    id="wizard-moneda"
                    value={moneda}
                    onChange={(e) => setMoneda(e.target.value)}
                    style={selectStyle}
                  >
                    {MONEDAS.map(m => (
                      <option key={m.simbolo} value={m.simbolo}>{m.nombre}</option>
                    ))}
                  </select>
                </div>
                <InputField
                  label="Dirección"
                  value={direccion}
                  onChange={setDireccion}
                  placeholder="Ej: Av. Principal 123"
                  helpText="Opcional, puedes agregarla después."
                />
              </div>
            )}

            {step === 'done' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '64px', marginBottom: '14px' }}>🎉</div>
                <p style={{ margin: '0 0 14px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
                  Tu empresa está configurada
                </p>
                <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'var(--at-ink-2)' }}>
                  Creamos el proyecto <strong>{nombre}</strong>. Ahora puedes:
                </p>
                <ul style={{ ...listStyle, textAlign: 'left', maxWidth: '380px', margin: '0 auto' }}>
                  <li>🏠 Agregar las unidades (apartamentos, casas, locales)</li>
                  <li>👥 Invitar a los residentes y al personal</li>
                  <li>💳 Configurar cuotas, rubros, alícuotas</li>
                  <li>📊 Empezar a registrar pagos y consumos</li>
                </ul>
              </div>
            )}
          </main>

          {/* Footer */}
          <footer style={{
            display: 'flex', justifyContent: 'space-between', gap: '10px',
            marginTop: '20px', paddingTop: '16px',
            borderTop: '1px solid var(--at-line)',
          }}>
            <button
              type="button"
              onClick={step === 'welcome' ? handleClose : () => setStep(prevStep(step))}
              style={btnSecondary}
            >
              {step === 'welcome' ? 'Cerrar' : '← Atrás'}
            </button>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '12px', color: 'var(--at-ink-3)' }}>
              Paso {currentIdx} de {totalSteps}
            </div>
            <button
              type="button"
              onClick={() => {
                if (step === 'welcome') setStep('tipo')
                else if (step === 'tipo') setStep('proyecto')
                else if (step === 'proyecto') handleCrearProyecto()
                else handleFinish()
              }}
              disabled={saving}
              style={btnPrimary}
            >
              {step === 'welcome' && '🚀 Empezar'}
              {step === 'tipo' && 'Siguiente →'}
              {step === 'proyecto' && (saving ? 'Creando…' : 'Crear proyecto')}
              {step === 'done' && '✓ Empezar a usar'}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function prevStep(s: WizardStep): WizardStep {
  if (s === 'tipo') return 'welcome'
  if (s === 'proyecto') return 'tipo'
  if (s === 'done') return 'proyecto'
  return 'welcome'
}

function RadioCard({ selected, onSelect, icon, title, desc }: {
  selected: boolean
  onSelect: () => void
  icon: string
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '14px',
        padding: '14px 16px',
        border: `2px solid ${selected ? 'var(--at-primary)' : 'var(--at-line)'}`,
        borderRadius: '12px',
        background: selected ? 'var(--at-primary-tint)' : 'var(--at-surface)',
        textAlign: 'left', cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '28px', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', marginBottom: '3px' }}>
          {title}
        </div>
        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
    </button>
  )
}

const listStyle: CSSProperties = {
  margin: '0', padding: '0 0 0 4px',
  fontSize: '14px', color: 'var(--at-ink-2)',
  lineHeight: 1.9, listStyle: 'none',
}

const labelStyle: CSSProperties = {
  display: 'block', fontSize: '13px', fontWeight: 600,
  color: 'var(--at-ink-2)', marginBottom: '6px',
}

const selectStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px',
  fontSize: '14px',
  background: 'var(--at-surface)',
  color: 'var(--at-ink)',
  outline: 'none',
}

const btnSecondary: CSSProperties = {
  padding: '9px 16px', borderRadius: '8px',
  border: '1.5px solid var(--at-line)',
  background: 'var(--at-surface)',
  color: 'var(--at-ink-2)',
  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
}

const btnPrimary: CSSProperties = {
  padding: '9px 18px', borderRadius: '8px', border: 'none',
  background: 'var(--at-primary)',
  color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
}
