import { RotateCcw } from 'lucide-react'
import { useStore } from '../../store'

export function AppearancePanel() {
  const appearance = useStore(s => s.editor.appearance)
  const setAppearance = useStore(s => s.setAppearance)

  return (
    <div className="p-3 space-y-4 text-sm">
      {/* Control size */}
      <Section label="Control size">
        <SliderRow
          value={appearance.controlScale}
          min={0.5} max={2.5} step={0.1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => setAppearance({ controlScale: v })}
        />
      </Section>

      {/* Line width */}
      <Section label="Line width">
        <SliderRow
          value={appearance.lineWidth}
          min={0.3} max={3} step={0.1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => setAppearance({ lineWidth: v })}
        />
      </Section>

      {/* Color override */}
      <Section label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={appearance.color || '#a626ff'}
            onChange={e => setAppearance({ color: e.target.value })}
            className="w-7 h-7 rounded border border-gray-200 cursor-pointer p-0"
          />
          <span className="text-xs text-gray-500 flex-1">
            {appearance.color ? 'Custom' : 'Default (per course)'}
          </span>
          {appearance.color && (
            <button
              onClick={() => setAppearance({ color: '' })}
              className="text-[10px] text-gray-400 hover:text-orange-600 transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </Section>

      {/* Outline */}
      <Section label="Outline">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={appearance.outlineEnabled}
            onChange={e => setAppearance({ outlineEnabled: e.target.checked })}
            className="accent-orange-600"
          />
          <span className="text-xs text-gray-600">Enable outline</span>
        </label>
        {appearance.outlineEnabled && (
          <div className="mt-2 space-y-2 pl-1">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={appearance.outlineColor}
                onChange={e => setAppearance({ outlineColor: e.target.value })}
                className="w-6 h-6 rounded border border-gray-200 cursor-pointer p-0"
              />
              <span className="text-xs text-gray-500">Color</span>
            </div>
            <SliderRow
              value={appearance.outlineWidth}
              min={0.2} max={2} step={0.1}
              format={v => `${v.toFixed(1)}mm`}
              onChange={v => setAppearance({ outlineWidth: v })}
            />
          </div>
        )}
      </Section>

      {/* Reset all */}
      <button
        onClick={() => setAppearance({ controlScale: 1, lineWidth: 1, color: '', outlineEnabled: false, outlineColor: '#ffffff', outlineWidth: 0.7 })}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-600 transition-colors pt-1"
      >
        <RotateCcw size={12} />
        Reset to standard
      </button>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-700 mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function SliderRow({ value, min, max, step, format, onChange }: {
  value: number; min: number; max: number; step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-orange-600"
      />
      <span className="text-[11px] text-gray-500 w-10 text-right tabular-nums">{format(value)}</span>
    </div>
  )
}
