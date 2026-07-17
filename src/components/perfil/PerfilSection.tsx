import { useState, useEffect, type ReactNode, type FormEvent} from 'react'
import type { UserSession } from '../../types'
import {
  fetchCurrentAuthProvider,
  signInWithPassword,
  updatePassword,
  updateUserEmail,
} from '../../domain/auth/account'
import {
  listMfaFactors,
  enrollTotpFactor,
  challengeMfaFactor,
  verifyMfaFactor,
  unenrollMfaFactor,
} from '../../domain/auth/mfaActions'
import { createCheckoutSession, createBillingPortalSession } from '../../domain/shared/mutations'
import { estimarTotalMensualCents } from '../../lib/businessBilling'
import { trackFunnel, FUNNEL } from '../../lib/analytics'
import {
  fetchActiveSubscription,
  fetchActiveBillingPlans,
  fetchMonthlyTotalBreakdown,
} from '../../domain/facturacion/billing'
import { logSecurityEvent } from '../../lib/security'
import { getDisplayRoleLabel, getDisplayRoleColor } from '../../lib/permissions'
import { PreferenciasRegionales } from './PreferenciasRegionales'
import { SesionesActivas } from './SesionesActivas'
import { LegalYPrivacidad } from './LegalYPrivacidad'

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

function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} style={{
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
    void fetchCurrentAuthProvider().then(provider => {
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
    const { error: signInErr } = await signInWithPassword(currentUser.email, pwCurrent)
    if (signInErr) {
      setPwFb({ type: 'error', msg: 'La contraseña actual es incorrecta' })
      setPwLoading(false)
      return
    }
    const { error: updateErr } = await updatePassword(pwNew)
    if (updateErr) {
      setPwFb({ type: 'error', msg: 'Error al actualizar la contraseña. Intente de nuevo.' })
    } else {
      setPwFb({ type: 'success', msg: 'Contraseña actualizada correctamente' })
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
      // plat:P11 — audita el cambio de contraseña del usuario autenticado. El
      // edge fija el user_id desde el JWT; el trigger de security_logs dispara
      // la notificación de seguridad "tu contraseña fue cambiada".
      void logSecurityEvent('password_changed', {})
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
    void listMfaFactors().then(({ data }) => {
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
      await unenrollMfaFactor(o.id).catch(() => undefined)
    }
    const { data, error } = await enrollTotpFactor(`Authenticator (${new Date().toISOString().slice(0, 10)})`)
    if (error || !data) {
      setMfaFb({ type: 'error', msg: error ?? 'No fue posible iniciar el enrolamiento.' })
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
      const ch = await challengeMfaFactor(enrollState.factorId)
      if (ch.error || !ch.data) {
        setMfaFb({ type: 'error', msg: ch.error ?? 'No fue posible crear el desafío.' })
        setMfaLoading(false)
        return
      }
      challengeId = ch.data.id
    }
    const { error } = await verifyMfaFactor(enrollState.factorId, challengeId, mfaCode.trim())
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
    await unenrollMfaFactor(enrollState.factorId).catch(() => undefined)
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
    const { error } = await unenrollMfaFactor(verifiedFactor.id)
    if (error) {
      setMfaFb({ type: 'error', msg: error ?? 'No fue posible desactivar el segundo factor.' })
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
  // F1 (C5): el plan trae también los componentes del precio POR USO y sus
  // topes, para proyectar el total con el uso actual del tenant (el precio
  // plano subestimaba la factura real — sorpresa en el primer cobro).
  const [availablePlans, setAvailablePlans] = useState<Array<{
    code: string; name: string; price_monthly_cents: number; price_yearly_cents: number | null
    description: string | null; features: string[]
    base_activation_cents: number; extra_project_cents: number
    unit_primary_cents: number; unit_extra_cents: number
    max_projects: number | null; max_units: number | null
  }>>([])
  // F1 (C7): sin prices YEARLY en Stripe, el botón "Anual" creaba un checkout
  // roto. Gate en una constante: cuando existan los prices, esto se voltea.
  const YEARLY_DISPONIBLE = false
  const [showPlanPicker, setShowPlanPicker] = useState(false)
  const [billingActionLoading, setBillingActionLoading] = useState(false)
  const [billingFb, setBillingFb] = useState<FeedbackState>(null)

  // Pricing por uso (F2.14): RPC calcula total mensual basado en uso real
  // (proyectos creados, unidades en primary vs extras). Devuelve desglose
  // para que la UI muestre lo mismo que la pricing card del landing.
  type UsageBreakdown = {
    total_cents: number
    base_activation_cents: number
    extra_projects_subtotal: number
    primary_units_subtotal: number
    extra_units_subtotal: number
    extra_projects_count: number
    primary_units_count: number
    extra_units_count: number
  }
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdown | null>(null)

  useEffect(() => {
    if (!currentUser.company_id) { setSubLoading(false); return }
    let alive = true
    void fetchActiveSubscription<SubscriptionRow>(currentUser.company_id).then(data => {
      if (!alive) return
      setSubscription(data)
      setSubLoading(false)
    })
    void fetchActiveBillingPlans<typeof availablePlans[number]>().then(data => {
      if (alive && data.length) setAvailablePlans(data)
    })
    void fetchMonthlyTotalBreakdown<UsageBreakdown>(currentUser.company_id).then(row => {
      if (!alive || !row) return
      setUsageBreakdown(row)
    })
    return () => { alive = false }
  }, [currentUser.company_id])

  // F4.1.2: si llegamos aqui via promptUpgrade (CTA "Ver planes" desde un
  // limite alcanzado en EmpresaSection / UnidadesSection), abrir el plan
  // picker y hacer scroll al card. El flag se setea en sessionStorage por
  // promptUpgrade.ts y se consume aqui en el primer mount.
  useEffect(() => {
    let flag: string | null = null
    try {
      flag = sessionStorage.getItem('at:open-billing-on-mount')
      if (flag) sessionStorage.removeItem('at:open-billing-on-mount')
    } catch {
      // sessionStorage no disponible (private mode) — no-op
    }
    if (!flag) return
    setShowPlanPicker(true)
    // Esperar a que el card monte (subLoading → false) antes de scroll.
    const t = setTimeout(() => {
      document.getElementById('billing-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 300)
    return () => clearTimeout(t)
  }, [])

  // Detecta retornos del checkout via query param (?checkout=success|canceled)
  // y muestra feedback. Quita el param de la URL para que no se repita en refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ck = params.get('checkout')
    if (!ck) return
    if (ck === 'success') {
      setBillingFb({ type: 'success', msg: 'Pago procesado. La suscripción se activará en unos segundos.' })
    } else if (ck === 'canceled') {
      setBillingFb({ type: 'error', msg: 'Cambio de plan cancelado. Tu suscripción actual no se modificó.' })
    }
    params.delete('checkout')
    params.delete('session')
    const newSearch = params.toString()
    const url = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash
    window.history.replaceState({}, '', url)
  }, [])

  async function handleChangePlan(planCode: string, cycle: 'monthly' | 'yearly') {
    setBillingFb(null)
    setBillingActionLoading(true)
    trackFunnel(FUNNEL.checkoutIniciado, { origen: 'perfil', plan_destino: planCode, ciclo: cycle })
    try {
      const { url, swapped, error } = await createCheckoutSession({ plan_code: planCode, billing_cycle: cycle, return_path: '/perfil' })
      if (error) {
        setBillingFb({ type: 'error', msg: error ?? 'No se pudo crear la sesión de pago.' })
        return
      }
      // P0 #1: la company ya tenía suscripción activa → el plan se cambió
      // in-place (sin redirigir ni crear una segunda suscripción). Refrescamos
      // la suscripción para reflejar el nuevo plan.
      if (swapped) {
        trackFunnel(FUNNEL.planActualizado, { origen: 'perfil', plan_destino: planCode })
        setShowPlanPicker(false)
        setBillingFb({ type: 'success', msg: 'Tu plan se actualizó. El ajuste se prorratea en tu próxima factura.' })
        if (currentUser.company_id) {
          const fresh = await fetchActiveSubscription<SubscriptionRow>(currentUser.company_id)
          setSubscription(fresh)
        }
        return
      }
      if (!url) {
        setBillingFb({ type: 'error', msg: 'Respuesta inválida del servidor.' })
        return
      }
      window.location.href = url
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setBillingFb({ type: 'error', msg: `Error: ${msg}` })
    } finally {
      setBillingActionLoading(false)
    }
  }

  async function handleManageBilling() {
    setBillingFb(null)
    setBillingActionLoading(true)
    try {
      const { url, error } = await createBillingPortalSession()
      if (error) {
        setBillingFb({ type: 'error', msg: error ?? 'No se pudo abrir el portal.' })
        return
      }
      if (!url) {
        setBillingFb({ type: 'error', msg: 'Respuesta inválida del servidor.' })
        return
      }
      window.location.href = url
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setBillingFb({ type: 'error', msg: `Error: ${msg}` })
    } finally {
      setBillingActionLoading(false)
    }
  }

  const canManageBilling = currentUser.role === 'company_owner' || currentUser.role === 'admin'

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
    const { error } = await updateUserEmail(newEmail.trim().toLowerCase(), window.location.origin)
    if (error) {
      const msg = error.toLowerCase()
      if (msg.includes('rate limit') || msg.includes('too many')) {
        setEmailFb({ type: 'error', msg: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' })
      } else if (msg.includes('email') && (msg.includes('taken') || msg.includes('already') || msg.includes('registered'))) {
        setEmailFb({ type: 'error', msg: 'Ese correo electrónico ya está en uso por otra cuenta.' })
      } else {
        setEmailFb({ type: 'error', msg: error ?? 'Error al solicitar el cambio de correo. Intente de nuevo.' })
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

        {/* Card 1b — Preferencias regionales (plat:P18) */}
        <Card title="Preferencias regionales">
          <PreferenciasRegionales userId={currentUser.user_id} />
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

        {/* Card 2c — Sesiones activas (plat:P9) */}
        <Card title="Sesiones activas">
          <SesionesActivas />
        </Card>

        {/* Card 2d — Legal y privacidad (plat:P33/P34) */}
        <Card title="Legal y privacidad">
          <LegalYPrivacidad />
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
          <Card title="Mi plan" id="billing-section">
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
                        ${((usageBreakdown?.total_cents ?? subscription.plan.price_monthly_cents) / 100).toFixed(2)}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>USD / mes</div>
                    </div>
                  )}
                </div>

                {/* Desglose del cobro por uso (F2.14): mismo formato que la
                    pricing card del landing. Solo se muestra cuando hay uso
                    real (proyectos extra o unidades) para no contaminar el
                    caso comun "trial empty workspace". */}
                {usageBreakdown && usageBreakdown.total_cents > usageBreakdown.base_activation_cents && (
                  <div style={{ marginTop: '14px', padding: '12px 14px', background: 'var(--at-surface-2)', borderRadius: '10px', fontSize: '12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>Desglose del mes</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--at-ink-3)' }}>Activación del plan</span>
                        <span style={{ color: 'var(--at-ink)', fontWeight: 600 }}>${(usageBreakdown.base_activation_cents / 100).toFixed(2)}</span>
                      </div>
                      {usageBreakdown.primary_units_count > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--at-ink-3)' }}>{usageBreakdown.primary_units_count} unidad{usageBreakdown.primary_units_count === 1 ? '' : 'es'} (proyecto principal)</span>
                          <span style={{ color: 'var(--at-ink)', fontWeight: 600 }}>${(usageBreakdown.primary_units_subtotal / 100).toFixed(2)}</span>
                        </div>
                      )}
                      {usageBreakdown.extra_projects_count > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--at-ink-3)' }}>{usageBreakdown.extra_projects_count} proyecto{usageBreakdown.extra_projects_count === 1 ? '' : 's'} adicional{usageBreakdown.extra_projects_count === 1 ? '' : 'es'}</span>
                          <span style={{ color: 'var(--at-ink)', fontWeight: 600 }}>${(usageBreakdown.extra_projects_subtotal / 100).toFixed(2)}</span>
                        </div>
                      )}
                      {usageBreakdown.extra_units_count > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--at-ink-3)' }}>{usageBreakdown.extra_units_count} unidad{usageBreakdown.extra_units_count === 1 ? '' : 'es'} en proyectos adicionales</span>
                          <span style={{ color: 'var(--at-ink)', fontWeight: 600 }}>${(usageBreakdown.extra_units_subtotal / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--at-line)' }}>
                        <span style={{ color: 'var(--at-ink)', fontWeight: 700 }}>Total mensual</span>
                        <span style={{ color: 'var(--at-ink)', fontWeight: 800 }}>${(usageBreakdown.total_cents / 100).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

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

                {canManageBilling && (
                  <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--at-chip)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setShowPlanPicker(v => !v)}
                      disabled={billingActionLoading}
                      style={{
                        padding: '8px 16px', borderRadius: '8px',
                        border: '1.5px solid var(--at-primary)', background: 'var(--at-surface)',
                        color: 'var(--at-primary)', fontSize: '13px', fontWeight: 600,
                        cursor: billingActionLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {showPlanPicker ? 'Ocultar planes' : 'Cambiar plan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleManageBilling()}
                      disabled={billingActionLoading}
                      style={{
                        padding: '8px 16px', borderRadius: '8px',
                        background: billingActionLoading ? 'var(--at-ink-3)' : 'var(--at-primary)',
                        color: 'white', border: 'none', fontSize: '13px', fontWeight: 600,
                        cursor: billingActionLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {billingActionLoading ? 'Cargando…' : 'Gestionar suscripción'}
                    </button>
                  </div>
                )}

                {showPlanPicker && canManageBilling && availablePlans.length > 0 && (
                  <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {availablePlans.map(p => {
                      const isCurrent = p.code === subscription.plan?.code
                      // F1 (C5): proyección del total mensual de ESTE plan con el
                      // uso actual del tenant (misma aritmética que la BD). El
                      // precio de lista es "desde" — la base sin proyectos/unidades
                      // extra; lo que se cobra es base + uso.
                      const proyectosActuales = (usageBreakdown?.extra_projects_count ?? 0) + 1
                      const totalConUsoCents = usageBreakdown
                        ? estimarTotalMensualCents(
                            p,
                            proyectosActuales,
                            usageBreakdown.primary_units_count,
                            usageBreakdown.extra_units_count,
                          )
                        : null
                      // El plan no cubre el uso actual → el downgrade sorprendería
                      // (topes por debajo de lo ya creado). Aviso + botón deshabilitado.
                      const unidadesActuales = (usageBreakdown?.primary_units_count ?? 0) + (usageBreakdown?.extra_units_count ?? 0)
                      const noCubreUso = usageBreakdown != null && (
                        (p.max_projects != null && proyectosActuales > p.max_projects) ||
                        (p.max_units != null && unidadesActuales > p.max_units)
                      )
                      return (
                        <div key={p.code} style={{
                          padding: '14px 16px', borderRadius: '10px',
                          border: `1.5px solid ${isCurrent ? 'var(--at-primary)' : 'var(--at-line)'}`,
                          background: isCurrent ? 'var(--at-primary-tint, rgba(27,59,54,.05))' : 'var(--at-surface-2)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>
                                {p.name} {isCurrent && <span style={{ fontSize: '11px', color: 'var(--at-primary)', fontWeight: 600 }}>(actual)</span>}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                                desde ${(p.price_monthly_cents / 100).toFixed(2)}/mes
                                {totalConUsoCents != null && totalConUsoCents !== p.price_monthly_cents && (
                                  <span> · con tu uso actual: <strong style={{ color: 'var(--at-ink-2)' }}>${(totalConUsoCents / 100).toFixed(2)}/mes</strong></span>
                                )}
                              </div>
                              {noCubreUso && (
                                <div style={{ fontSize: '11.5px', color: 'var(--at-warning-strong)', marginTop: '3px' }}>
                                  No cubre tu uso actual ({proyectosActuales} proyecto{proyectosActuales !== 1 ? 's' : ''} · {unidadesActuales} unidades)
                                </div>
                              )}
                            </div>
                            {!isCurrent && (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => void handleChangePlan(p.code, 'monthly')}
                                  disabled={billingActionLoading || noCubreUso}
                                  title={noCubreUso ? 'Este plan tiene topes por debajo de tu uso actual.' : undefined}
                                  style={{
                                    padding: '6px 12px', borderRadius: '6px',
                                    background: (billingActionLoading || noCubreUso) ? 'var(--at-ink-3)' : 'var(--at-primary)',
                                    color: 'white', border: 'none',
                                    fontSize: '12px', fontWeight: 600,
                                    cursor: (billingActionLoading || noCubreUso) ? 'not-allowed' : 'pointer',
                                  }}
                                >Mensual</button>
                                {/* F1 (C7): "Anual" oculto hasta que existan los
                                    prices yearly en Stripe (checkout roto). */}
                                {YEARLY_DISPONIBLE && p.price_yearly_cents && (
                                  <button
                                    type="button"
                                    onClick={() => void handleChangePlan(p.code, 'yearly')}
                                    disabled={billingActionLoading}
                                    style={{
                                      padding: '6px 12px', borderRadius: '6px',
                                      background: 'var(--at-accent-2)', color: 'white', border: 'none',
                                      fontSize: '12px', fontWeight: 600,
                                      cursor: billingActionLoading ? 'not-allowed' : 'pointer',
                                    }}
                                  >Anual</button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <FeedbackMsg fb={billingFb} />
              </>
            )}
          </Card>
        )}

      </div>
    </div>
  )
}
