import { useState, useEffect, useRef } from 'react'
import type { UserSession } from '../../types'
import { supabase } from '../../lib/supabase'

interface Props {
  currentUser: UserSession
  onUpdateProfile: (name: string) => Promise<string | null>
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Administrador',
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Visualizador',
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#7c3aed',
  admin: '#0ea5e9',
  operator: '#0d9488',
  viewer: '#64748b',
}

type FeedbackState = { type: 'success' | 'error'; msg: string } | null

/* ── Feedback ── */
function FeedbackMsg({ fb }: { fb: FeedbackState }) {
  if (!fb) return null
  const ok = fb.type === 'success'
  return (
    <div style={{
      marginTop: '12px',
      padding: '11px 16px',
      borderRadius: '10px',
      fontSize: '13px',
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      background: ok ? '#f0fdf4' : '#fef2f2',
      color: ok ? '#15803d' : '#dc2626',
      border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
      borderLeft: `4px solid ${ok ? '#22c55e' : '#ef4444'}`,
    }}>
      <span style={{ fontSize: '16px' }}>{ok ? '✅' : '⚠️'}</span>
      {fb.msg}
    </div>
  )
}

/* ── Section Card ── */
function SectionCard({
  accent, icon, title, children,
}: {
  accent: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      background: 'white',
      borderRadius: '16px',
      padding: '0',
      boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
      border: '1px solid #e2e8f0',
      overflow: 'hidden',
      transition: 'box-shadow 0.2s',
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.11)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 16px rgba(0,0,0,0.07)')}
    >
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '18px 24px',
        borderBottom: '1px solid #f1f5f9',
        borderLeft: `4px solid ${accent}`,
        background: `linear-gradient(90deg, ${accent}08 0%, transparent 60%)`,
      }}>
        <span style={{ color: accent, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{title}</span>
      </div>
      <div style={{ padding: '22px 24px' }}>
        {children}
      </div>
    </div>
  )
}

/* ── Input ── */
function InputField({
  label, type = 'text', value, onChange, placeholder, disabled, rightEl, accent = '#0ea5e9',
}: {
  label: string
  type?: string
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  disabled?: boolean
  rightEl?: React.ReactNode
  accent?: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{
        display: 'block',
        fontSize: '11px',
        fontWeight: 700,
        color: '#64748b',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: '7px',
      }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%',
            padding: rightEl ? '12px 46px 12px 14px' : '12px 14px',
            border: `1.5px solid ${focused ? accent : disabled ? '#e2e8f0' : '#e2e8f0'}`,
            borderRadius: '10px',
            fontSize: '14px',
            background: disabled ? '#f8fafc' : 'white',
            color: disabled ? '#94a3b8' : '#0f172a',
            boxSizing: 'border-box',
            outline: 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
            boxShadow: focused ? `0 0 0 3px ${accent}20` : 'none',
          }}
        />
        {rightEl && (
          <span style={{ position: 'absolute', right: '13px', top: '50%', transform: 'translateY(-50%)' }}>
            {rightEl}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Button ── */
function ActionBtn({
  loading, label, color = '#0ea5e9', icon,
}: {
  loading: boolean
  label: string
  color?: string
  icon?: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="submit"
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        height: '44px',
        marginTop: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '0 20px',
        background: loading
          ? '#cbd5e1'
          : `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
        color: 'white',
        border: 'none',
        borderRadius: '10px',
        fontWeight: 700,
        fontSize: '14px',
        cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
        filter: hovered && !loading ? 'brightness(1.08)' : 'none',
        transform: hovered && !loading ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: hovered && !loading ? `0 6px 20px ${color}55` : 'none',
      }}
    >
      {loading ? (
        <>
          <span style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2.5px solid rgba(255,255,255,0.4)',
            borderTopColor: 'white',
            display: 'inline-block',
            animation: 'spin 0.7s linear infinite',
          }} />
          Guardando...
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  )
}

/* ── Main component ── */
export function PerfilSection({ currentUser, onUpdateProfile }: Props) {
  const [isOAuthUser, setIsOAuthUser] = useState(false)
  const [memberSince, setMemberSince] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const provider = data.user?.app_metadata?.provider
      if (provider && provider !== 'email') setIsOAuthUser(true)
    })
    supabase
      .from('app_users')
      .select('created_at')
      .eq('id', currentUser.user_id)
      .single()
      .then(({ data }) => {
        if (data?.created_at) {
          setMemberSince(new Date(data.created_at).toLocaleDateString('es-ES', {
            year: 'numeric', month: 'long', day: 'numeric',
          }))
        }
      })
  }, [currentUser.user_id])

  /* — Nombre — */
  const [name, setName] = useState(currentUser.name)
  const [nameLoading, setNameLoading] = useState(false)
  const [nameFb, setNameFb] = useState<FeedbackState>(null)

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setNameLoading(true)
    setNameFb(null)
    const err = await onUpdateProfile(name.trim())
    setNameFb(err ? { type: 'error', msg: err } : { type: 'success', msg: 'Nombre actualizado correctamente' })
    setNameLoading(false)
  }

  /* — Contraseña — */
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [showPw, setShowPw] = useState({ current: false, new: false, confirm: false })
  const [pwLoading, setPwLoading] = useState(false)
  const [pwFb, setPwFb] = useState<FeedbackState>(null)

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPwFb(null)
    if (pwNew.length < 8) { setPwFb({ type: 'error', msg: 'La nueva contraseña debe tener al menos 8 caracteres' }); return }
    if (pwNew !== pwConfirm) { setPwFb({ type: 'error', msg: 'La nueva contraseña y la confirmación no coinciden' }); return }
    setPwLoading(true)
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentUser.email, password: pwCurrent,
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

  /* — Correo — */
  const [newEmail, setNewEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailFb, setEmailFb] = useState<FeedbackState>(null)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailFb(null)
    if (!newEmail.trim() || !newEmail.includes('@')) { setEmailFb({ type: 'error', msg: 'Ingresa un correo electrónico válido' }); return }
    if (newEmail.trim().toLowerCase() === currentUser.email.toLowerCase()) { setEmailFb({ type: 'error', msg: 'El nuevo correo debe ser diferente al actual' }); return }
    setEmailLoading(true)
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() })
    if (error) {
      setEmailFb({ type: 'error', msg: 'Error al solicitar el cambio de correo. Intente de nuevo.' })
    } else {
      setEmailFb({ type: 'success', msg: `Revisa tu bandeja en ${newEmail} y confirma el cambio desde el enlace enviado` })
      setNewEmail('')
    }
    setEmailLoading(false)
  }

  const eyeBtn = (show: boolean, toggle: () => void) => (
    <button type="button" onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, lineHeight: 1 }}>
      {show ? '🙈' : '👁️'}
    </button>
  )

  const accentBlue = '#0ea5e9'
  const accentPurple = '#7c3aed'
  const accentTeal = '#0d9488'
  const roleColor = ROLE_COLORS[currentUser.role] ?? '#64748b'

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ maxWidth: '660px', animation: 'fadeSlideUp 0.4s ease both' }}>

        {/* ── Hero header ── */}
        <div style={{
          position: 'relative',
          background: `linear-gradient(135deg, #0f172a 0%, #1e293b 60%, ${roleColor}33 100%)`,
          borderRadius: '20px',
          padding: '32px 28px',
          marginBottom: '24px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}>
          {/* Decorative circles */}
          {[
            { size: 160, right: '-40px', top: '-40px', opacity: 0.07 },
            { size: 100, right: '60px',  top: '30px',  opacity: 0.05 },
            { size: 70,  right: '10px',  bottom: '10px', opacity: 0.06 },
          ].map((c, i) => (
            <div key={i} style={{
              position: 'absolute',
              width: c.size, height: c.size,
              borderRadius: '50%',
              background: 'white',
              right: c.right, top: c.top,
              bottom: c.bottom,
              opacity: c.opacity,
              pointerEvents: 'none',
            }} />
          ))}

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* Avatar */}
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${accentBlue}, #0d9488)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 800, fontSize: '26px', flexShrink: 0,
              boxShadow: `0 0 0 4px rgba(255,255,255,0.15), 0 0 0 8px rgba(255,255,255,0.06)`,
            }}>
              {getInitials(currentUser.name)}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'white', fontWeight: 800, fontSize: '20px', letterSpacing: '-0.3px' }}>
                {currentUser.name}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentUser.email}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  background: roleColor,
                  color: 'white',
                  borderRadius: '20px', padding: '3px 12px',
                  fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
                }}>
                  {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                </span>
                {memberSince && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    color: '#64748b', fontSize: '12px',
                  }}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Miembro desde {memberSince}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Card 1 — Datos personales */}
          <SectionCard
            accent={accentBlue}
            title="Datos personales"
            icon={
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
          >
            <form onSubmit={handleNameSubmit}>
              <InputField label="Correo electrónico" value={currentUser.email} disabled accent={accentBlue} />
              <InputField
                label="Nombre completo"
                value={name}
                onChange={setName}
                placeholder="Tu nombre completo"
                accent={accentBlue}
              />
              <ActionBtn
                loading={nameLoading}
                label="Guardar cambios"
                color={accentBlue}
                icon={
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                }
              />
              <FeedbackMsg fb={nameFb} />
            </form>
          </SectionCard>

          {/* Card 2 — Contraseña */}
          <SectionCard
            accent={accentPurple}
            title="Cambiar contraseña"
            icon={
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            }
          >
            {isOAuthUser ? (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '14px 16px', borderRadius: '10px',
                background: '#f8fafc', border: '1px solid #e2e8f0',
                color: '#64748b', fontSize: '14px',
              }}>
                <svg width="20" height="20" fill="none" stroke="#94a3b8" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Tu cuenta está vinculada con Google. El cambio de contraseña se gestiona desde tu cuenta de Google.
              </div>
            ) : (
              <form onSubmit={handlePasswordSubmit}>
                <InputField
                  label="Contraseña actual"
                  type={showPw.current ? 'text' : 'password'}
                  value={pwCurrent}
                  onChange={setPwCurrent}
                  placeholder="••••••••"
                  accent={accentPurple}
                  rightEl={eyeBtn(showPw.current, () => setShowPw(s => ({ ...s, current: !s.current })))}
                />
                <InputField
                  label="Nueva contraseña"
                  type={showPw.new ? 'text' : 'password'}
                  value={pwNew}
                  onChange={setPwNew}
                  placeholder="Mínimo 8 caracteres"
                  accent={accentPurple}
                  rightEl={eyeBtn(showPw.new, () => setShowPw(s => ({ ...s, new: !s.new })))}
                />
                <InputField
                  label="Confirmar nueva contraseña"
                  type={showPw.confirm ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={setPwConfirm}
                  placeholder="Repite la nueva contraseña"
                  accent={accentPurple}
                  rightEl={eyeBtn(showPw.confirm, () => setShowPw(s => ({ ...s, confirm: !s.confirm })))}
                />
                <ActionBtn
                  loading={pwLoading}
                  label="Cambiar contraseña"
                  color={accentPurple}
                  icon={
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  }
                />
                <FeedbackMsg fb={pwFb} />
              </form>
            )}
          </SectionCard>

          {/* Card 3 — Correo */}
          <SectionCard
            accent={accentTeal}
            title="Cambiar correo electrónico"
            icon={
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
          >
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: '10px', padding: '12px 14px',
              fontSize: '13px', color: '#92400e', marginBottom: '18px',
            }}>
              <svg width="16" height="16" fill="none" stroke="#d97706" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: '1px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Se enviará un enlace de confirmación al nuevo correo. El cambio se aplicará solo al confirmar desde ese enlace.
            </div>
            <form onSubmit={handleEmailSubmit}>
              <InputField label="Correo actual" value={currentUser.email} disabled accent={accentTeal} />
              <InputField
                label="Nuevo correo electrónico"
                type="email"
                value={newEmail}
                onChange={setNewEmail}
                placeholder="nuevo@ejemplo.com"
                accent={accentTeal}
              />
              <ActionBtn
                loading={emailLoading}
                label="Solicitar cambio"
                color={accentTeal}
                icon={
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                }
              />
              <FeedbackMsg fb={emailFb} />
            </form>
          </SectionCard>

        </div>
      </div>
    </>
  )
}
