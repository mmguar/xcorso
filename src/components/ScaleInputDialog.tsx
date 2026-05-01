import { useEffect, useRef, useState } from 'react'

interface Props {
  onConfirm: (meters: number) => void
  onCancel: () => void
}

export function ScaleInputDialog({ onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit() {
    const m = parseFloat(value)
    if (!isNaN(m) && m > 0) onConfirm(m)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl p-5 w-72 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-gray-800">Scale measurement</h3>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-500">Distance between the two points (metres)</span>
          <input
            ref={inputRef}
            type="number"
            min={0}
            step="any"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            placeholder="e.g. 100"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0}
            className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Set scale
          </button>
        </div>
      </div>
    </div>
  )
}
