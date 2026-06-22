import { RotateCcw } from 'lucide-react'
import { useStore } from '../../store'
import type { OverprintMode } from '../../types'

const OVERPRINT_OPTIONS: { value: OverprintMode; label: string; hint: string }[] = [
  { value: 'simulated', label: 'Simulated overprint', hint: 'Purple multiplies over the map' },
  { value: 'none', label: 'No overprint', hint: 'Always printed on top' },
  { value: 'below', label: 'Below black/brown/blue', hint: 'Purple under 100% map colours (HD & export)' },
]

export function AppearancePanel() {
  const appearance = useStore(s => s.editor.appearance)
  const setAppearance = useStore(s => s.setAppearance)
  const overprint = useStore(s => s.project?.overprint ?? 1)
  const setOverprint = useStore(s => s.setOverprint)
  const overprintMode = useStore(s => s.project?.overprintMode ?? 'simulated')
  const setOverprintMode = useStore(s => s.setOverprintMode)
  const labelSubmapStart = useStore(s => s.project?.labelSubmapStart ?? false)
  const updateLabelSubmapStart = useStore(s => s.updateLabelSubmapStart)

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

      {/* Overprint — how course / control / annotation ink sits over the map */}
      <Section label="Overprint">
        <div className="space-y-1">
          {OVERPRINT_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="overprint-mode"
                checked={overprintMode === opt.value}
                onChange={() => setOverprintMode(opt.value)}
                className="accent-orange-600 mt-0.5"
              />
              <span className="text-xs text-gray-600 leading-tight">
                {opt.label}
                <span className="block text-[10px] text-gray-400">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {overprintMode !== 'none' && (
          <div className="mt-2 pl-1">
            <div className="text-[10px] text-gray-400 mb-1">Intensity</div>
            <SliderRow
              value={overprint}
              min={0} max={1} step={0.05}
              format={v => `${Math.round(v * 100)}%`}
              onChange={v => setOverprint(v)}
            />
          </div>
        )}
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

      {/* Submap labelling */}
      <Section label="Submaps">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={labelSubmapStart}
            onChange={e => updateLabelSubmapStart(e.target.checked)}
            className="accent-orange-600"
          />
          <span className="text-xs text-gray-600">Label first control of submap</span>
        </label>
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
