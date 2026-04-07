import { useState, useEffect } from 'react'
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
  collector: 'Gestor de Cobros',
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#7c3aed',
  admin: '#0ea5e9',
  operator: '#0d9488',
  viewer: '#64748b',
  collector: '#f59e0b',
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
      background: fb.type === 'success' ? '#f0fdf4' : '#fef2f2',
      color: fb.type === 'success' ? '#16a34a' : '#dc2626',
      border: `1px solid ${fb.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
    }}>
      {fb.type === 'success' ? '✅' : '⚠️'} {fb.msg}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'white',
      borderRadius: '16px',
      padding: '24px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      border: '1px solid #e2e8f0',
    }}>
      <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
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
  rightEl?: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
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
            border: '1.5px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '14px',
            background: disabled ? '#f8fafc' : 'white',
            color: disabled ? '#94a3b8' : '#0f172a',
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

function SubmitBtn({ loading, label, color = '#0ea5e9' }: { loading: boolean; label: string; color?: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        padding: '10px 22px',
        background: loading ? '#94a3b8' : `linear-gradient(135deg, ${color}, ${color}cc)`,
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

  async function handleNameSubmit(e: React.FormEvent) {
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

  async function handlePasswordSubmit(e: React.FormEvent) {
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

  // — Correo —
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
    <button type="button" onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: '16px', lineHeight: 1 }}>
      {show ? '🙈' : '👁️'}
    </button>
  )

  return (
    <div style={{ maxWidth: '640px' }}>
      {/* Header card — Avatar + info */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
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
          background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 800, fontSize: '22px', flexShrink: 0,
        }}>
          {getInitials(currentUser.name)}
        </div>
        <div>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '18px' }}>{currentUser.name}</div>
          <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '3px' }}>{currentUser.email}</div>
          <span style={{
            display: 'inline-block', marginTop: '8px',
            background: ROLE_COLORS[currentUser.role] + '22',
            color: ROLE_COLORS[currentUser.role],
            border: `1px solid ${ROLE_COLORS[currentUser.role]}44`,
            borderRadius: '20px', padding: '2px 10px', fontSize: '11px', fontWeight: 700,
          }}>
            {ROLE_LABELS[currentUser.role] ?? currentUser.role}
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
            <div style={{ color: '#64748b', fontSize: '14px', padding: '8px 0' }}>
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
              <SubmitBtn loading={pwLoading} label="Cambiar contraseña" color="#7c3aed" />
              <FeedbackMsg fb={pwFb} />
            </form>
          </Card>
        )}

        {/* Card 3 — Correo */}
        <Card title="Cambiar correo electrónico">
          <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#92400e', marginBottom: '16px' }}>
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
            <SubmitBtn loading={emailLoading} label="Solicitar cambio" color="#0d9488" />
            <FeedbackMsg fb={emailFb} />
          </form>
        </Card>

      </div>
    </div>
  )
}
