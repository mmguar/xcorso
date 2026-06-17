import { useState, useRef, useEffect } from 'react'
import { sendCode, verifyCode } from '../lib/sync'
import { useStore } from '../store'

interface Props {
  onClose: () => void
}

export function LoginModal({ onClose }: Props) {
  const setCloudUser = useStore(s => s.setCloudUser)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [step])

  async function handleSendCode() {
    if (!email.includes('@')) { setError('Enter a valid email'); return }
    setLoading(true); setError(null)
    const ok = await sendCode(email.trim().toLowerCase())
    setLoading(false)
    if (ok) setStep('code')
    else setError('Failed to send code')
  }

  async function handleVerify() {
    if (code.length < 6) { setError('Enter the 6-digit code'); return }
    setLoading(true); setError(null)
    const user = await verifyCode(email.trim().toLowerCase(), code.trim())
    setLoading(false)
    if (user) { setCloudUser(user); onClose() }
    else setError('Invalid or expired code')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-80 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-gray-800">
          {step === 'email' ? 'Sign in to sync' : 'Enter code'}
        </h3>

        {step === 'email' ? (
          <>
            <p className="text-xs text-gray-500">We'll send a login code to your email.</p>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendCode() }}
              placeholder="you@example.com"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500">Check <strong>{email}</strong> for a 6-digit code.</p>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') handleVerify() }}
              placeholder="000000"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-center tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={step === 'code' ? () => { setStep('email'); setCode(''); setError(null) } : onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {step === 'code' ? 'Back' : 'Cancel'}
          </button>
          <button
            onClick={step === 'email' ? handleSendCode : handleVerify}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-40"
          >
            {loading ? 'Sending...' : step === 'email' ? 'Send code' : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  )
}
