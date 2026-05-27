import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import type { Copy, Lang } from './i18n'

interface NavProps {
  t: Copy
  lang: Lang
  onToggleLang: (lang: Lang) => void
  onLogin: () => void
  onSignup: () => void
}

export function Nav({ t, lang, onToggleLang, onLogin, onSignup }: NavProps) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8)
    fn()
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <nav className={'site-nav ' + (scrolled ? 'scrolled' : '')} aria-label="Main navigation">
      <div className="nav-inner">
        <a href="#top" className="brand">
          <Icon.logo size={30} />
          <span>AdministraTodo</span>
        </a>
        <div className="nav-links" aria-label="Sections">
          <a href="#product">{t.nav.product}</a>
          <a href="#pricing">{t.nav.pricing}</a>
          <a href="#customers">{t.nav.customers}</a>
          <a href="#faq">{t.nav.resources}</a>
        </div>
        <div className="nav-actions">
          <div className="lang-switch" role="group" aria-label="Language">
            <button className={lang === 'es' ? 'on' : ''} onClick={() => onToggleLang('es')} aria-pressed={lang === 'es'}>ES</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => onToggleLang('en')} aria-pressed={lang === 'en'}>EN</button>
          </div>
          <button className="btn-ghost" onClick={onLogin}>{t.nav.login}</button>
          <button className="btn-primary" onClick={onSignup}>
            {t.nav.cta}
            <Icon.arrow_right size={15} />
          </button>
        </div>
      </div>
    </nav>
  )
}

interface LoginModalProps {
  open: boolean
  onClose: () => void
  t: Copy
  onLogin: (email: string, password: string) => Promise<string | null>
  onLoginWithGoogle: () => Promise<string | null>
  onForgotPassword: () => void
  onRegister: () => void
  // Si el usuario tiene un factor TOTP verificado, login() arranca un challenge
  // y deja currentUser en null. El padre nos pasa el challenge activo + cb de
  // verificación/cancelación para renderizar el segundo paso.
  mfaChallenge: { email: string } | null
  onVerifyMfa: (code: string) => Promise<string | null>
  onCancelMfa: () => Promise<void>
}

export function LoginModal({ open, onClose, t, onLogin, onLoginWithGoogle, onForgotPassword, onRegister, mfaChallenge, onVerifyMfa, onCancelMfa }: LoginModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || googleLoading) return
    setError('')
    setLoading(true)
    const err = await onLogin(email, password)
    if (err) setError(err)
    setLoading(false)
  }

  async function handleGoogle() {
    if (loading || googleLoading) return
    setError('')
    setGoogleLoading(true)
    const err = await onLoginWithGoogle()
    if (err) setError(err)
    setGoogleLoading(false)
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault()
    if (mfaLoading) return
    setError('')
    setMfaLoading(true)
    const err = await onVerifyMfa(mfaCode)
    if (err) setError(err)
    else setMfaCode('')
    setMfaLoading(false)
  }

  async function handleCancelMfa() {
    setError('')
    setMfaCode('')
    await onCancelMfa()
  }

  return (
    <div className="modal-veil" onClick={onClose} role="dialog" aria-modal="true" aria-label={t.login.title}>
      <div className="modal-card" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="login-split">
          <div className="login-side">
            <div className="login-side-mark">
              <Icon.logo size={36} />
            </div>
            <div className="login-side-title">
              <span className="kicker">{t.login.side_kicker}</span>
              <h3>{t.login.side_title_a}<br />{t.login.side_title_b}<br />{t.login.side_title_c}</h3>
            </div>
            <ul className="login-side-list">
              <li><Icon.drop size={16} /><span>{t.login.side_list_a}</span></li>
              <li><Icon.building size={16} /><span>{t.login.side_list_b}</span></li>
              <li><Icon.message size={16} /><span>{t.login.side_list_c}</span></li>
            </ul>
            <p className="login-side-foot">{t.login.side_foot}</p>
          </div>

          <div className="login-form">
            {mfaChallenge ? (
              <>
                <header className="login-h">
                  <h2>{t.login.mfa_title}</h2>
                  <p>{t.login.mfa_sub}</p>
                </header>

                <form className="login-fields" onSubmit={handleVerifyMfa}>
                  <label className="field">
                    <span>{t.login.email}</span>
                    <input type="email" value={mfaChallenge.email} disabled autoComplete="username" />
                  </label>
                  <label className="field">
                    <span>{t.login.mfa_code}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      autoFocus
                      style={{ fontSize: '20px', letterSpacing: '6px', textAlign: 'center' }}
                    />
                  </label>
                  {error && <div className="login-error" role="alert">⚠️ {error}</div>}
                  <button type="submit" className="btn-primary btn-block" disabled={mfaLoading || mfaCode.length !== 6}>
                    {mfaLoading ? t.login.mfa_verifying : t.login.mfa_verify}
                  </button>
                  <button type="button" className="link-quiet" onClick={handleCancelMfa} style={{ marginTop: '12px', display: 'block', width: '100%', textAlign: 'center' }}>
                    {t.login.mfa_cancel}
                  </button>
                </form>
              </>
            ) : (
              <>
                <header className="login-h">
                  <h2>{t.login.title}</h2>
                  <p>{t.login.sub}</p>
                </header>

                <button className="btn-google" onClick={handleGoogle} disabled={googleLoading || loading} type="button">
                  <Icon.google />
                  <span>{googleLoading ? t.login.google_loading : t.login.google}</span>
                </button>

                <div className="login-or"><span>{t.login.or}</span></div>

                <form className="login-fields" onSubmit={handleSubmit}>
                  <label className="field">
                    <span>{t.login.email}</span>
                    <input
                      type="email"
                      placeholder="nombre@empresa.com"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t.login.password}</span>
                    <input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  {error && <div className="login-error" role="alert">⚠️ {error}</div>}
                  <div className="login-row">
                    <label className="check">
                      <input type="checkbox" defaultChecked />
                      <span>{t.login.remember}</span>
                    </label>
                    <button type="button" className="link-quiet" onClick={() => { onClose(); onForgotPassword() }}>{t.login.forgot}</button>
                  </div>
                  <button type="submit" className="btn-primary btn-block" disabled={loading || googleLoading}>
                    {loading ? t.login.submitting : t.login.submit}
                  </button>
                </form>

                <div className="login-foot">
                  <div className="login-resident">
                    <div>
                      <strong>{t.login.resident_q}</strong>
                      <span>{t.login.resident_a}</span>
                    </div>
                    <button className="btn-quiet" onClick={() => { onClose(); onRegister() }}>{t.login.resident_cta} <Icon.arrow_right size={14} /></button>
                  </div>
                  <div className="login-newcomer">
                    <span>{t.login.no_account}</span>
                    <button className="link-bold" onClick={() => { onClose(); onRegister() }}>{t.login.signup} <Icon.arrow_right size={13} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
