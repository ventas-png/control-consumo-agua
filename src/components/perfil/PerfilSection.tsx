import { useState, useEffect, type ReactNode, type FormEvent} from 'react'
import type { UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { getDisplayRoleLabel, getDisplayRoleColor } from '../../lib/permissions'

interface Props {
  currentUser: UserSession
  onUpdateProfile: (name: string) => Promise<string | null>
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

function FeedbackMsg({ fb }: { fb: FeedbackState }) {
  if (!fb) return null
  return (
    <div style={{
      marginTop: '10px',
      padding: '9px 14px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: 500,
      background: fb.type === 'success' ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
      color: fb.type === 'success' ? 'var(--at-success)' : 'var(--at-danger)',
      border: `1px solid ${fb.type === 'success' ? 'var(--at-success-border)' : 'var(--at-danger-border)'}`,
    }}>
      {fb.type === 'success' ? '✅' : '⚠️'} {fb.msg}
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      borderRadius: '16px',
      padding: '24px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      border: '1px solid var(--at-line)',
    }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid var(--at-chip)' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function InputField({
  label, id, type = 'text', value, onChange, placeholder, disabled, rightEl
}: {
  label: string
  id?: string
  type?: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  disabled?: boolean
  rightEl?: ReactNode
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            width: '100%',
            padding: rightEl ? '10px 44px 10px 12px' : '10px 12px',
            border: '1.5px solid var(--at-line)',
            borderRadius: '8px',
            fontSize: '14px',
            background: disabled ? 'var(--at-surface-2)' : 'var(--at-surface)',
            color: disabled ? 'var(--at-ink-3)' : 'var(--at-ink)',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
        {rightEl && (
          <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
            {rightEl}
          </span>
        )}
      </div>
    </div>
  )
}

function SubmitBtn({ loading, label, color = 'var(--at-primary)' }: { loading: boolean; label: string; color?: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        padding: '10px 22px',
        background: loading ? 'var(--at-ink-3)' : `linear-gradient(135deg, ${color}, ${color}cc)`,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 600,
        fontSize: '14px',
        cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {loading ? 'Guardando...' : label}
    </button>
  )
}

export function PerfilSection({ currentUser, onUpdateProfile }: Props) {
  const [isOAuthUser, setIsOAuthUser] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const provider = data.user?.app_metadata?.provider
      if (provider && provider !== 'email') setIsOAuthUser(true)
    })
  }, [])

  // — Nombre —
  const [name, setName] = useState(currentUser.name)
  const [nameLoading, setNameLoading] = useState(false)
  const [nameFb, setNameFb] = useState<FeedbackState>(null)

  async function handleNameSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setNameLoading(true)
    setNameFb(null)
    const err = await onUpdateProfile(name.trim())
    setNameFb(err ? { type: 'error', msg: err } : { type: 'success', msg: 'Nombre actualizado correctamente' })
    setNameLoading(false)
  }

  // — Contraseña —
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false })
  const [pwLoading, setPwLoading] = useState(false)
  const [pwFb, setPwFb] = useState<FeedbackState>(null)

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setPwFb(null)
    if (pwNew.length < 8) { setPwFb({ type: 'error', msg: 'La nueva contraseña debe tener al menos 8 caracteres' }); return }
    if (pwNew !== pwConfirm) { setPwFb({ type: 'error', msg: 'La nueva contraseña y la confirmación no coinciden' }); return }
    setPwLoading(true)
    // Verify current password
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: pwCurrent,
    })
    if (signInErr) {
      setPwFb({ type: 'error', msg: 'La contraseña actual es incorrecta' })
      setPwLoading(false)
      return
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: pwNew })
    if (updateErr) {
      setPwFb({ type: 'error', msg: 'Error al actualizar la contraseña. Intente de nuevo.' })
    } else {
      setPwFb({ type: 'success', msg: 'Contraseña actualizada correctamente' })
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
    }
    setPwLoading(false)
  }

  // — 2FA TOTP —
  // Permite al usuario activar un segundo factor usando una app autenticadora
  // (Google Authenticator / Authy / 1Password). Supabase MFA gestiona el
  // secreto y la verificación; nosotros sólo orquestamos enroll → challenge →
  // verify y mostramos el estado.
  type TotpFactor = { id: string; status: 'verified' | 'unverified'; friendly_name?: string | null; created_at?: string }
  const [mfaFactors, setMfaFactors] = useState<TotpFactor[]>([])
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaFb, setMfaFb] = useState<FeedbackState>(null)
  const [enrollState, setEnrollState] = useState<{ factorId: string; qrSvg: string; secret: string; challengeId?: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  const verifiedFactor = mfaFactors.find(f => f.status === 'verified') ?? null

  // Carga inicial de factores. Re-ejecuta cuando el usuario completa o cancela
  // un enrollment para mantener el badge sincronizado.
  useEffect(() => {
    let alive = true
    void supabase.auth.mfa.listFactors().then(({ data }) => {
      if (!alive || !data) return
      const all = (data.all ?? []) as TotpFactor[]
      setMfaFactors(all.filter(f => (f as unknown as { factor_type: string }).factor_type === 'totp'))
    })
    return () => { alive = false }
  }, [enrollState])

  async function handleEnableMfa() {
    setMfaFb(null)
    setMfaLoading(true)
    // Limpia factores TOTP huérfanos (unverified) de intentos previos antes de
    // crear uno nuevo, para evitar que Supabase rechace el enroll con
    // "factor already exists".
    const orphans = mfaFactors.filter(f => f.status === 'unverified')
    for (const o of orphans) {
      await supabase.auth.mfa.unenroll({ factorId: o.id }).catch(() => undefined)
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator (${new Date().toISOString().slice(0, 10)})`,
    })
    if (error || !data) {
      setMfaFb({ type: 'error', msg: error?.message ?? 'No fue posible iniciar el enrolamiento.' })
      setMfaLoading(false)
      return
    }
    setEnrollState({ factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret })
    setMfaLoading(false)
  }

  async function handleVerifyEnroll(e: FormEvent) {
    e.preventDefault()
    if (!enrollState) return
    setMfaFb(null)
    if (!/^\d{6}$/.test(mfaCode.trim())) {
      setMfaFb({ type: 'error', msg: 'El código debe tener 6 dígitos.' })
      return
    }
    setMfaLoading(true)
    let challengeId = enrollState.challengeId
    if (!challengeId) {
      const ch = await supabase.auth.mfa.challenge({ factorId: enrollState.factorId })
      if (ch.error || !ch.data) {
        setMfaFb({ type: 'error', msg: ch.error?.message ?? 'No fue posible crear el desafío.' })
        setMfaLoading(false)
        return
      }
      challengeId = ch.data.id
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrollState.factorId,
      challengeId,
      code: mfaCode.trim(),
    })
    if (error) {
      setMfaFb({ type: 'error', msg: 'Código incorrecto. Revisa la app de autenticación e intenta de nuevo.' })
      setMfaLoading(false)
      return
    }
    setEnrollState(null)
    setMfaCode('')
    setMfaFb({ type: 'success', msg: 'Autenticación en dos pasos activada. La próxima vez que ingreses te pediremos el código de tu app.' })
    setMfaLoading(false)
  }

  async function handleCancelEnroll() {
    if (!enrollState) return
    setMfaLoading(true)
    await supabase.auth.mfa.unenroll({ factorId: enrollState.factorId }).catch(() => undefined)
    setEnrollState(null)
    setMfaCode('')
    setMfaFb(null)
    setMfaLoading(false)
  }

  async function handleDisableMfa() {
    if (!verifiedFactor) return
    const confirm = window.confirm(
      'Vas a desactivar la verificación en dos pasos. Tu cuenta quedará protegida solo con contraseña. ¿Estás seguro?',
    )
    if (!confirm) return
    setMfaFb(null)
    setMfaLoading(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id })
    if (error) {
      setMfaFb({ type: 'error', msg: error.message ?? 'No fue posible desactivar el segundo factor.' })
      setMfaLoading(false)
      return
    }
    setMfaFactors(prev => prev.filter(f => f.id !== verifiedFactor.id))
    setMfaFb({ type: 'success', msg: 'Verificación en dos pasos desactivada.' })
    setMfaLoading(false)
  }

  // — Plan / Suscripción —
  // Read-only por ahora: muestra el plan actual + estado + features.
  // F2.12 agregara "Gestionar suscripcion" con Stripe Billing Portal.
  type SubscriptionRow = {
    status: string
    billing_cycle: string
    current_period_end: string
    trial_end: string | null
    cancel_at_period_end: boolean
    plan: {
      code: string
      name: string
      description: string | null
      price_monthly_cents: number
      currency: string
      features: string[]
    } | null
  }
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [subLoading, setSubLoading] = useState(true)

  useEffect(() => {
    if (!currentUser.company_id) { setSubLoading(false); return }
    let alive = true
    void supabase
      .from('subscriptions')
      .select('status, billing_cycle, current_period_end, trial_end, cancel_at_period_end, plan:billing_plans!inner(code, name, description, price_monthly_cents, currency, features)')
      .eq('company_id', currentUser.company_id)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setSubscription(data as unknown as SubscriptionRow | null)
        setSubLoading(false)
      })
    return () => { alive = false }
  }, [currentUser.company_id])

  // — Correo —
  const [newEmail, setNewEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailFb, setEmailFb] = useState<FeedbackState>(null)

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault()
    setEmailFb(null)
    if (!newEmail.trim() || !newEmail.includes('@')) { setEmailFb({ type: 'error', msg: 'Ingresa un correo electrónico válido' }); return }
    if (newEmail.trim().toLowerCase() === currentUser.email.toLowerCase()) { setEmailFb({ type: 'error', msg: 'El nuevo correo debe ser diferente al actual' }); return }
    setEmailLoading(true)
    const { error } = await supabase.auth.updateUser(
      { email: newEmail.trim().toLowerCase() },
      { emailRedirectTo: window.location.origin }
    )
    if (error) {
      const msg = error.message?.toLowerCase() ?? ''
      if (msg.includes('rate limit') || msg.includes('too many')) {
        setEmailFb({ type: 'error', msg: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' })
      } else if (msg.includes('email') && (msg.includes('taken') || msg.includes('already') || msg.includes('registered'))) {
        setEmailFb({ type: 'error', msg: 'Ese correo electrónico ya está en uso por otra cuenta.' })
      } else {
        setEmailFb({ type: 'error', msg: error.message ?? 'Error al solicitar el cambio de correo. Intente de nuevo.' })
      }
    } else {
      setEmailFb({ type: 'success', msg: `Revisa tu bandeja en ${newEmail} y confirma el cambio desde el enlace enviado` })
      setNewEmail('')
    }
    setEmailLoading(false)
  }

  const eyeBtn = (show: boolean, toggle: () => void) => (
    <button type="button" onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', padding: 0, fontSize: '16px', lineHeight: 1 }}>
      {show ? '🙈' : '👁️'}
    </button>
  )

  const roleColor = getDisplayRoleColor(currentUser)

  return (
    <div style={{ maxWidth: '640px' }}>
      {/* Header card — Avatar + info */}
      <div style={{
        background: 'linear-gradient(135deg, var(--at-ink) 0%, var(--at-ink) 100%)',
        borderRadius: '16px',
        padding: '28px 24px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: '22px', flexShrink: 0,
        }}>
          {getInitials(currentUser.name)}
        </div>
        <div>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '18px' }}>{currentUser.name}</div>
          <div style={{ color: 'var(--at-ink-3)', fontSize: '13px', marginTop: '3px' }}>{currentUser.email}</div>
          <span style={{
            display: 'inline-block', marginTop: '8px',
            background: roleColor + '22',
            color: roleColor,
            border: `1px solid ${roleColor}44`,
            borderRadius: '20px', padding: '2px 10px', fontSize: '11px', fontWeight: 700,
          }}>
            {getDisplayRoleLabel(currentUser)}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Card 1 — Nombre */}
        <Card title="Datos personales">
          <form onSubmit={handleNameSubmit}>
            <InputField id="perfil-email" label="Correo electrónico" value={currentUser.email} disabled />
            <InputField
              id="perfil-name"
              label="Nombre completo"
              value={name}
              onChange={setName}
              placeholder="Tu nombre completo"
            />
            <SubmitBtn loading={nameLoading} label="Guardar nombre" />
            <FeedbackMsg fb={nameFb} />
          </form>
        </Card>

        {/* Card 2 — Contraseña */}
        {isOAuthUser ? (
          <Card title="Cambiar contraseña">
            <div style={{ color: 'var(--at-ink-3)', fontSize: '14px', padding: '8px 0' }}>
              ℹ️ Tu cuenta está vinculada con Google. El cambio de contraseña se gestiona desde tu cuenta de Google.
            </div>
          </Card>
        ) : (
          <Card title="Cambiar contraseña">
            <form onSubmit={handlePasswordSubmit}>
              <InputField
                id="perfil-pw-current"
                label="Contraseña actual"
                type={showPw.current ? 'text' : 'password'}
                value={pwCurrent}
                onChange={setPwCurrent}
                placeholder="••••••••"
                rightEl={eyeBtn(showPw.current, () => setShowPw(s => ({ ...s, current: !s.current })))}
              />
              <InputField
                id="perfil-pw-new"
                label="Nueva contraseña"
                type={showPw.new ? 'text' : 'password'}
                value={pwNew}
                onChange={setPwNew}
                placeholder="Mínimo 8 caracteres"
                rightEl={eyeBtn(showPw.new, () => setShowPw(s => ({ ...s, new: !s.new })))}
              />
              <InputField
                id="perfil-pw-confirm"
                label="Confirmar nueva contraseña"
                type={showPw.confirm ? 'text' : 'password'}
                value={pwConfirm}
                onChange={setPwConfirm}
                placeholder="Repite la nueva contraseña"
                rightEl={eyeBtn(showPw.confirm, () => setShowPw(s => ({ ...s, confirm: !s.confirm })))}
              />
              <SubmitBtn loading={pwLoading} label="Cambiar contraseña" color="var(--at-accent-hover)" />
              <FeedbackMsg fb={pwFb} />
            </form>
          </Card>
        )}

        {/* Card 2b — Autenticación en dos pasos (TOTP) */}
        <Card title="Verificación en dos pasos (2FA)">
          {enrollState ? (
            <form onSubmit={handleVerifyEnroll}>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '12px', lineHeight: 1.5 }}>
                1. Escanea este código con tu app de autenticación (Google Authenticator, Authy, 1Password, etc.).<br />
                2. Ingresa abajo el código de 6 dígitos que muestra la app.
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
                <img
                  src={enrollState.qrSvg}
                  alt="Código QR para configurar autenticación en dos pasos"
                  style={{ width: '180px', height: '180px', border: '1px solid var(--at-line)', borderRadius: '8px', background: 'white', padding: '8px' }}
                />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '14px', textAlign: 'center' }}>
                ¿No puedes escanear?{' '}
                <span style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--at-surface-2)', padding: '2px 6px', borderRadius: '4px', userSelect: 'all' }}>
                  {enrollState.secret}
                </span>
              </div>
              <InputField
                id="perfil-mfa-code"
                label="Código de la app"
                value={mfaCode}
                onChange={(v) => setMfaCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <SubmitBtn loading={mfaLoading} label="Confirmar y activar" color="var(--at-success-strong, var(--at-accent-2))" />
                <button
                  type="button"
                  onClick={handleCancelEnroll}
                  disabled={mfaLoading}
                  style={{ background: 'none', border: 'none', color: 'var(--at-ink-3)', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
                >
                  Cancelar
                </button>
              </div>
              <FeedbackMsg fb={mfaFb} />
            </form>
          ) : verifiedFactor ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <span style={{ background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: 700 }}>
                  ✅ Activa
                </span>
                <span style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
                  {verifiedFactor.friendly_name ?? 'Autenticador TOTP'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '14px', lineHeight: 1.5 }}>
                Al iniciar sesión te pediremos un código de 6 dígitos de tu app de autenticación además de tu contraseña.
              </div>
              <button
                type="button"
                onClick={handleDisableMfa}
                disabled={mfaLoading}
                style={{
                  padding: '8px 16px',
                  background: 'var(--at-danger-tint)',
                  color: 'var(--at-danger)',
                  border: '1px solid var(--at-danger-border)',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: mfaLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {mfaLoading ? 'Procesando…' : 'Desactivar 2FA'}
              </button>
              <FeedbackMsg fb={mfaFb} />
            </>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '14px', lineHeight: 1.5 }}>
                Agrega una capa extra de seguridad: necesitarás un código de 6 dígitos de una app de autenticación además de tu contraseña al iniciar sesión.
              </div>
              <button
                type="button"
                onClick={handleEnableMfa}
                disabled={mfaLoading}
                style={{
                  padding: '10px 22px',
                  background: mfaLoading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-accent-2), var(--at-primary))',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: mfaLoading ? 'not-allowed' : 'pointer',
                }}
              >
                {mfaLoading ? 'Generando…' : '🔐 Activar verificación en dos pasos'}
              </button>
              <FeedbackMsg fb={mfaFb} />
            </>
          )}
        </Card>

        {/* Card 3 — Correo */}
        <Card title="Cambiar correo electrónico">
          <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: 'var(--at-warning-strong)', marginBottom: '16px' }}>
            ℹ️ Se enviará un enlace de confirmación al nuevo correo. El cambio se aplicará solo al confirmar.
          </div>
          <form onSubmit={handleEmailSubmit}>
            <InputField id="perfil-email-current" label="Correo actual" value={currentUser.email} disabled />
            <InputField
              id="perfil-email-new"
              label="Nuevo correo electrónico"
              type="email"
              value={newEmail}
              onChange={setNewEmail}
              placeholder="nuevo@ejemplo.com"
            />
            <SubmitBtn loading={emailLoading} label="Solicitar cambio" color="var(--at-accent-2)" />
            <FeedbackMsg fb={emailFb} />
          </form>
        </Card>

        {/* Card — Plan & Suscripción (read-only en F2.11; F2.12 agrega Stripe portal) */}
        {currentUser.company_id && (
          <Card title="Mi plan">
            {subLoading ? (
              <div style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando…</div>
            ) : !subscription ? (
              <div style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>
                Sin suscripción activa. Comuníquese con su administrador.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
                        {subscription.plan?.name ?? 'Plan'}
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                        background:
                          subscription.status === 'active' ? 'var(--at-success-tint)'
                          : subscription.status === 'trialing' ? 'var(--at-primary-tint, rgba(27,59,54,.1))'
                          : 'var(--at-warning-tint)',
                        color:
                          subscription.status === 'active' ? 'var(--at-success)'
                          : subscription.status === 'trialing' ? 'var(--at-primary-hover)'
                          : 'var(--at-warning-strong)',
                      }}>
                        {subscription.status === 'active' && '✓ Activa'}
                        {subscription.status === 'trialing' && '⏱ Trial'}
                        {subscription.status === 'past_due' && '⚠ Pago pendiente'}
                        {subscription.status === 'incomplete' && '⏳ Incompleta'}
                      </span>
                    </div>
                    {subscription.plan?.description && (
                      <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{subscription.plan.description}</p>
                    )}
                  </div>
                  {subscription.plan && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--at-ink)' }}>
                        ${(subscription.plan.price_monthly_cents / 100).toFixed(2)}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>USD / mes</div>
                    </div>
                  )}
                </div>

                {subscription.plan?.features && subscription.plan.features.length > 0 && (
                  <div style={{ marginTop: '14px' }}>
                    <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.7 }}>
                      {subscription.plan.features.map((f, i) => (<li key={i}>{f}</li>))}
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--at-chip)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  <span>
                    Próxima renovación: <strong style={{ color: 'var(--at-ink-2)' }}>
                      {new Date(subscription.current_period_end).toLocaleDateString('es-GT', { dateStyle: 'long' })}
                    </strong>
                  </span>
                  {subscription.cancel_at_period_end && (
                    <span style={{ color: 'var(--at-warning-strong)', fontWeight: 600 }}>
                      Se cancelará al finalizar el período
                    </span>
                  )}
                  {subscription.trial_end && new Date(subscription.trial_end) > new Date() && (
                    <span>
                      Trial hasta: <strong>{new Date(subscription.trial_end).toLocaleDateString('es-GT')}</strong>
                    </span>
                  )}
                </div>
              </>
            )}
          </Card>
        )}

      </div>
    </div>
  )
}
