// F3.17: i18n infrastructure MVP — sin dependencias externas.
//
// Por qué propio vs react-i18next:
//   - i18next + react-i18next + i18next-browser-languagedetector =
//     ~50KB minified gzip de dependencia. Para un MVP donde solo
//     tenemos 2 idiomas y unas pocas docenas de strings inicialmente,
//     no justifica el costo.
//   - Esta implementación: ~3KB, type-safe via TypeScript, hot-reload
//     vía Vite (los JSON son módulos importados).
//
// API:
//   import { useTranslation } from '../lib/i18n'
//   const { t, lang, setLang } = useTranslation()
//   <h1>{t('login.title')}</h1>
//   <button onClick={() => setLang('en')}>EN</button>
//
// Cuando crezcamos a >500 strings o >3 idiomas, migrar a react-i18next
// será trivial — la API `t(key)` es compatible.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { es } from './locales/es'
import { en } from './locales/en'

export type Locale = 'es' | 'en'
export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
]

const DICTIONARIES = { es, en } as const

// El tipo de las keys lo deriva del diccionario español (default).
// flatten<Es, 'es' | 'en'> → 'login.title' | 'login.submit' | etc.
type DotPath<T, P extends string = ''> = T extends Record<string, any>
  ? {
      [K in keyof T]: T[K] extends string
        ? P extends ''
          ? `${K & string}`
          : `${P}.${K & string}`
        : DotPath<T[K], P extends '' ? `${K & string}` : `${P}.${K & string}`>
    }[keyof T]
  : never

export type TranslationKey = DotPath<typeof es>

const LOCAL_STORAGE_KEY = 'at:locale'

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'es'
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY) as Locale | null
  if (stored && (stored === 'es' || stored === 'en')) return stored
  const browser = navigator.language?.split('-')[0]
  return browser === 'en' ? 'en' : 'es'
}

function get(dict: unknown, path: string): string | undefined {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k]
    }
    return undefined
  }, dict) as string | undefined
}

interface I18nContextValue {
  lang: Locale
  setLang: (l: Locale) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Locale>(detectInitialLocale())

  const setLang = useCallback((l: Locale) => {
    setLangState(l)
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, l)
      document.documentElement.setAttribute('lang', l)
    }
  }, [])

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    const dict = DICTIONARIES[lang]
    let value = get(dict, key)
    // Fallback al diccionario español si la key no existe en el actual
    if (value === undefined && lang !== 'es') {
      value = get(DICTIONARIES.es, key)
    }
    if (value === undefined) {
      // Devolver la key como fallback final para que el dev lo note en runtime
      console.warn(`[i18n] Missing translation: ${key}`)
      return key
    }
    // Reemplazo simple de {{var}} → params.var
    if (params) {
      return value.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? `{{${k}}}`))
    }
    return value
  }, [lang])

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useTranslation debe usarse dentro de <I18nProvider>')
  }
  return ctx
}

/**
 * LanguageSwitcher — botón de cambio de idioma accesible.
 * Acepta children opcional para overrides de rendering, default un select.
 */
export function LanguageSwitcher() {
  const { lang, setLang } = useTranslation()
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as Locale)}
      aria-label="Idioma / Language"
      style={{
        padding: '6px 10px',
        border: '1.5px solid var(--at-line)',
        borderRadius: '8px',
        fontSize: '13px',
        background: 'var(--at-surface)',
        color: 'var(--at-ink)',
        cursor: 'pointer',
      }}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </select>
  )
}
