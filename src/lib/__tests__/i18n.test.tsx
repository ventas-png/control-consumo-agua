import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { I18nProvider, useTranslation, LanguageSwitcher } from '../i18n'

beforeEach(() => {
  cleanup()
  localStorage.clear()
  // jsdom's navigator.language defaults to 'en-US'. Para que los tests
  // de "español por default" funcionen, seteamos 'es' explicitamente.
  localStorage.setItem('at:locale', 'es')
})

function TranslatedHeading() {
  const { t } = useTranslation()
  return <h1>{t('auth.login_title')}</h1>
}

function WelcomeName({ name }: { name: string }) {
  const { t } = useTranslation()
  return <span>{t('common.welcome', { name })}</span>
}

describe('i18n', () => {
  it('renderiza traducciones en español (default)', () => {
    render(
      <I18nProvider>
        <TranslatedHeading />
      </I18nProvider>,
    )
    expect(screen.getByText('Iniciar sesión')).toBeTruthy()
  })

  it('LanguageSwitcher cambia a inglés', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <TranslatedHeading />
      </I18nProvider>,
    )
    expect(screen.getByText('Iniciar sesión')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Idioma/), { target: { value: 'en' } })
    expect(screen.getByText('Sign in')).toBeTruthy()
  })

  it('reemplaza {{var}} con params', () => {
    render(
      <I18nProvider>
        <WelcomeName name="Ana" />
      </I18nProvider>,
    )
    expect(screen.getByText('Hola Ana')).toBeTruthy()
  })

  it('reemplaza {{var}} con params en inglés', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <WelcomeName name="Bob" />
      </I18nProvider>,
    )
    fireEvent.change(screen.getByLabelText(/Idioma/), { target: { value: 'en' } })
    expect(screen.getByText('Hi Bob')).toBeTruthy()
  })

  it('persiste el idioma elegido en localStorage', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    )
    act(() => {
      fireEvent.change(screen.getByLabelText(/Idioma/), { target: { value: 'en' } })
    })
    expect(localStorage.getItem('at:locale')).toBe('en')
  })

  it('a11y: select tiene aria-label', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    )
    const select = screen.getByLabelText(/Idioma/)
    expect(select.getAttribute('aria-label')).toBe('Idioma / Language')
  })
})
