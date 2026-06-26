/* eslint-disable react-refresh/only-export-components -- hooks co-located with provider */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import en from './en.json'

type Params = Record<string, string | number>
export type TFn = (key: string, params?: Params) => string

const I18nContext = createContext<{ t: TFn; locale: string; setLocale: (l: string) => void }>({
  t: (key) => key,
  locale: 'en',
  setLocale: () => {},
})

function interpolate(s: string, params?: Params): string {
  if (!params) return s
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] != null ? String(params[k]) : `{{${k}}}`)
}

const STORAGE_KEY = 'xcorso_locale'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return stored
    const nav = navigator.language.split('-')[0]
    return nav || 'en'
  })
  const [strings, setStrings] = useState<Record<string, string>>(en)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale)
    if (locale === 'en') return
    // ponytail: dynamic import per locale, add files as src/i18n/{locale}.json
    let stale = false
    import(`./${locale}.json`)
      .then(m => { if (!stale) setStrings({ ...en, ...m.default }) })
      .catch(() => { if (!stale) setStrings(en) })
    return () => { stale = true; setStrings(en) }
  }, [locale])

  const t: TFn = useCallback(
    (key, params) => interpolate(strings[key] ?? key, params),
    [strings],
  )

  const setLocale = useCallback((l: string) => setLocaleState(l), [])

  return <I18nContext.Provider value={{ t, locale, setLocale }}>{children}</I18nContext.Provider>
}

export function useT() {
  return useContext(I18nContext).t
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext)
  return { locale, setLocale }
}

// ponytail: add entries here as translation files are created
export const LOCALES: { code: string; label: string }[] = [
  { code: 'en', label: 'en' },
  { code: 'it', label: 'it' },
]

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useLocale()
  return (
    <select
      value={locale}
      onChange={e => setLocale(e.target.value)}
      className={`text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-600 focus:outline-none focus:border-orange-400 ${className}`}
    >
      {LOCALES.map(l => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  )
}
