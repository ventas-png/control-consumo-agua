import { useEffect, useState } from 'react'
import { COPY, type Lang } from './i18n'
import { Nav, LoginModal } from './Nav'
import { Hero } from './Hero'
import { TrustStrip, ModulesShowcase, FeaturesGrid } from './Sections'
import { PricingSection } from './Pricing'
import { DemoVideo, Testimonials, FAQ, FinalCTA, Footer } from './Social'
import './landing.css'

interface LandingPageProps {
  onLogin: (email: string, password: string) => Promise<string | null>
  onLoginWithGoogle: () => Promise<string | null>
  onForgotPassword: () => void
  onRegister: () => void
  onSignupCompany: () => void
  mfaChallenge: { email: string } | null
  onVerifyMfa: (code: string) => Promise<string | null>
  onCancelMfa: () => Promise<void>
}

function initialLang(): Lang {
  const urlLang = new URLSearchParams(window.location.search).get('lang')
  return urlLang === 'en' ? 'en' : 'es'
}

export function LandingPage({ onLogin, onLoginWithGoogle, onForgotPassword, onRegister, onSignupCompany, mfaChallenge, onVerifyMfa, onCancelMfa }: LandingPageProps) {
  const [loginOpen, setLoginOpen] = useState(false)
  const [lang, setLang] = useState<Lang>(initialLang)

  // Si hay un challenge MFA activo, asegurarnos de que el modal de login esté
  // abierto para mostrar el segundo paso (evita que el usuario quede atrapado
  // si por algún motivo el modal se cerró entre el password OK y el code).
  useEffect(() => {
    if (mfaChallenge) setLoginOpen(true)
  }, [mfaChallenge])

  // Keep <html lang> and the shareable ?lang= URL in sync with the active locale.
  useEffect(() => {
    document.documentElement.lang = lang
    const url = new URL(window.location.href)
    url.searchParams.set('lang', lang)
    window.history.replaceState({}, '', url)
  }, [lang])

  const t = COPY[lang]
  const goPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="at-root">
      <Nav t={t} lang={lang} onToggleLang={setLang} onLogin={() => setLoginOpen(true)} onSignup={goPricing} />
      <main>
        <Hero t={t} onSignup={goPricing} />
        <TrustStrip t={t} />
        <ModulesShowcase t={t} />
        <DemoVideo t={t} />
        <FeaturesGrid t={t} />
        <PricingSection t={t} onCta={onSignupCompany} />
        <Testimonials t={t} />
        <FAQ t={t} />
        <FinalCTA t={t} onSignup={goPricing} />
      </main>
      <Footer t={t} />

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        t={t}
        onLogin={onLogin}
        onLoginWithGoogle={onLoginWithGoogle}
        onForgotPassword={onForgotPassword}
        onRegister={onRegister}
        onSignupCompany={onSignupCompany}
        mfaChallenge={mfaChallenge}
        onVerifyMfa={onVerifyMfa}
        onCancelMfa={onCancelMfa}
      />
    </div>
  )
}
