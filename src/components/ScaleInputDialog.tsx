import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

interface Props {
  onConfirm: (meters: number) => void
  onCancel: () => void
}

export function ScaleInputDialog({ onConfirm, onCancel }: Props) {
  const t = useT()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // ponytail: block backdrop dismiss on the same tick that opens the dialog (touch devices fire a click from the pointerup that triggered mount)
  const ready = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    requestAnimationFrame(() => { ready.current = true })
  }, [])

  function handleSubmit() {
    const m = parseFloat(value)
    if (!isNaN(m) && m > 0) onConfirm(m)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (ready.current) onCancel() }}>
      <div
        className="bg-white rounded-xl shadow-xl p-5 w-72 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-800">{t('scale.title')}</h3>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-500">{t('scale.label')}</span>
          <input
            ref={inputRef}
            type="number"
            min={0}
            step="any"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder={t('scale.placeholder')}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {t('scale.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0}
            className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('scale.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
