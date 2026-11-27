import { useEffect, useState } from 'react'
import { mostrarVentaDePlanes } from '../../lib/ventaDePlanes'
import { estaInstalada } from '../../lib/pwaInstall'
import { COPY, type Lang } from './i18n'
import { warmUpSupabase } from '../../lib/supabase'
import { Nav, LoginModal } from './Nav'
import { Hero } from './Hero'
import { TrustStrip, ModulesShowcase, FeaturesGrid } from './Sections'
import { PricingSection } from './Pricing'
import { DemoVideo, Testimonials, FAQ, FinalCTA, Footer } from './Social'
import './landing.css'

interface LandingPageProps {
  onLogin: (email: string, password: string) => Promise<string | null>
  onLoginWithGoogle: () => Promise<string | null>
  onLoginWithApple: () => Promise<string | null>
  onForgotPassword: () => void
  onRegister: () => void
  onSignupCompany: () => void
  mfaChallenge: { email: string } | null
  onVerifyMfa: (code: string) => Promise<string | null>
  onCancelMfa: () => Promise<void>
  // Error del flujo OAuth detectado al volver del redirect (callback fallido o
  // sesión que no se pudo construir). Abre el modal de login mostrándolo — sin
  // esto el usuario rebota de Google a la landing sin ninguna explicación.
  initialAuthError?: string | null
}

function initialLang(): Lang {
  const urlLang = new URLSearchParams(window.location.search).get('lang')
  return urlLang === 'en' ? 'en' : 'es'
}

export function LandingPage({ onLogin, onLoginWithGoogle, onLoginWithApple, onForgotPassword, onRegister, onSignupCompany, mfaChallenge, onVerifyMfa, onCancelMfa, initialAuthError }: LandingPageProps) {
  // Instalada como app (PWA): quien la abre desde su pantalla de inicio ya viene
  // a entrar, así que arranca con el login abierto en vez de la página comercial.
  // A diferencia de la app nativa (ver `soloLogin` abajo) el modal se puede
  // cerrar: en la web sí está permitido mostrar precios y vender el plan.
  const [loginOpen, setLoginOpen] = useState(estaInstalada)
  const [lang, setLang] = useState<Lang>(initialLang)

  // Si hay un challenge MFA activo, asegurarnos de que el modal de login esté
  // abierto para mostrar el segundo paso (evita que el usuario quede atrapado
  // si por algún motivo el modal se cerró entre el password OK y el code).
  useEffect(() => {
    if (mfaChallenge) setLoginOpen(true)
  }, [mfaChallenge])

  // Un error de OAuth al volver del redirect debe verse: abrir el modal de
  // login, que lo renderiza como error inicial.
  useEffect(() => {
    if (initialAuthError) setLoginOpen(true)
  }, [initialAuthError])

  // Keep <html lang> and the shareable ?lang= URL in sync with the active locale.
  useEffect(() => {
    document.documentElement.lang = lang
    const url = new URL(window.location.href)
    url.searchParams.set('lang', lang)
    window.history.replaceState({}, '', url)
  }, [lang])

  // Despierta la instancia de Supabase mientras el visitante mira la landing,
  // para que el login no pague el cold start (ver warmUpSupabase en lib/supabase).
  useEffect(() => {
    warmUpSupabase()
  }, [])

  const t = COPY[lang]
  const goPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
  const openLogin = () => {
    // Re-ping al abrir el modal: si la landing quedó abierta un rato, la
    // instancia pudo volver a dormirse antes de que el usuario decida entrar.
    warmUpSupabase()
    setLoginOpen(true)
  }

  // App nativa: sin landing comercial, login directo y fijo. La landing es la
  // página de venta del plan (precios, "Empezar gratis") y la app no puede
  // venderlo (ver lib/ventaDePlanes); además, quien abre la app ya viene a entrar.
  const soloLogin = !mostrarVentaDePlanes()

  const loginModal = (
    <LoginModal
      open={soloLogin || loginOpen}
      dismissable={!soloLogin}
      onClose={() => setLoginOpen(false)}
      t={t}
      onLogin={onLogin}
      onLoginWithGoogle={onLoginWithGoogle}
      onLoginWithApple={onLoginWithApple}
      onForgotPassword={onForgotPassword}
      onRegister={onRegister}
      onSignupCompany={onSignupCompany}
      mfaChallenge={mfaChallenge}
      onVerifyMfa={onVerifyMfa}
      onCancelMfa={onCancelMfa}
      initialError={initialAuthError ?? undefined}
    />
  )

  if (soloLogin) return <div className="at-root">{loginModal}</div>

  return (
    <div className="at-root">
      <Nav t={t} lang={lang} onToggleLang={setLang} onLogin={openLogin} onSignup={goPricing} />
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

      {loginModal}
    </div>
  )
}
