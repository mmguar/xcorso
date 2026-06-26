import { useState, useRef, useEffect, useCallback } from 'react'
import { sendCode, verifyCode, TERMS_VERSION } from '../lib/sync'
import { useStore } from '../store'
import { useT, useLocale } from '../i18n'

const TURNSTILE_SITE_KEY = '0x4AAAAAADnxI0hcBbrG9wCc'

interface Props {
  onClose: () => void
}

export function LoginModal({ onClose }: Props) {
  const t = useT()
  const { locale } = useLocale()
  const termsUrl = locale === 'en' ? '/terms.html' : `/terms-${locale}.html`
  const setCloudUser = useStore(s => s.setCloudUser)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const cfToken = useRef('')

  const onToken = useCallback((token: string) => { cfToken.current = token }, [])

  useEffect(() => {
    if (!turnstileRef.current) return
    let cancelled = false
    function tryRender() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (window as any).turnstile
      if (!t) { if (!cancelled) setTimeout(tryRender, 200); return }
      widgetId.current = t.render(turnstileRef.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'normal',
        appearance: 'interaction-only',
        callback: onToken,
        'expired-callback': () => { cfToken.current = '' },
      })
    }
    tryRender()
    return () => {
      cancelled = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (window as any).turnstile
      if (widgetId.current && t) t.remove(widgetId.current)
    }
  }, [onToken])

  useEffect(() => { inputRef.current?.focus() }, [step])

  async function handleSendCode() {
    if (!email.includes('@')) { setError(t('login.errInvalidEmail')); return }
    setLoading(true); setError(null)
    const result = await sendCode(email.trim().toLowerCase(), cfToken.current || undefined)
    setLoading(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ts = (window as any).turnstile
    if (widgetId.current && ts) ts.reset(widgetId.current)
    if (result.ok) setStep('code')
    else if (result.throttled) setError(t('login.errThrottle'))
    else if (result.blocked) setError(t('login.errBlocked'))
    else setError(t('login.errSendFailed'))
  }

  async function handleVerify() {
    if (code.length < 6) { setError(t('login.errCodeLength')); return }
    setLoading(true); setError(null)
    const user = await verifyCode(email.trim().toLowerCase(), code.trim(), TERMS_VERSION)
    setLoading(false)
    if (user) { setCloudUser(user); onClose() }
    else setError(t('login.errInvalidCode'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-5 w-80 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">
          {step === 'email' ? t('login.signIn') : t('login.enterCode')}
        </h3>

        {step === 'email' ? (
          <>
            <p className="text-xs text-gray-500">{t('login.sendPrompt')}</p>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && agreed) handleSendCode() }}
              placeholder={t('login.emailPlaceholder')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <label className="flex items-start gap-2 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-orange-600" />
              <span>
                {t('login.agree')}{' '}
                <a href={termsUrl} target="_blank" rel="noopener" className="text-orange-600 underline hover:text-orange-800">{t('login.terms')}</a>
              </span>
            </label>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500">{t('login.checkEmail', { email })}</p>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') handleVerify() }}
              placeholder={t('login.codePlaceholder')}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-center tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </>
        )}

        <div ref={turnstileRef} />

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={step === 'code' ? () => { setStep('email'); setCode(''); setError(null) } : onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {step === 'code' ? t('login.back') : t('login.cancel')}
          </button>
          <button
            onClick={step === 'email' ? handleSendCode : handleVerify}
            disabled={loading || (step === 'email' && !agreed)}
            className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-40"
          >
            {loading ? t('login.sending') : step === 'email' ? t('login.sendCode') : t('login.verify')}
          </button>
        </div>
      </div>
    </div>
  )
}
