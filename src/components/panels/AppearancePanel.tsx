import { RotateCcw } from 'lucide-react'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import type { OverprintMode } from '../../types'
import { IOF_PURPLE } from '../../lib/courseUtils'

const OVERPRINT_OPTIONS: { value: OverprintMode; label: string; hint: string }[] = [
  { value: 'simulated', label: 'appearance.simulated', hint: 'appearance.simulatedHint' },
  { value: 'none', label: 'appearance.noOverprint', hint: 'appearance.noOverprintHint' },
  { value: 'below', label: 'appearance.belowBlack', hint: 'appearance.belowBlackHint' },
]

export function AppearancePanel() {
  const t = useT()
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
      <Section label={t('appearance.controlSize')}>
        <SliderRow
          value={appearance.controlScale}
          min={0.5} max={2.5} step={0.1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => setAppearance({ controlScale: v })}
        />
      </Section>

      {/* Overprint — how course / control / annotation ink sits over the map */}
      <Section label={t('appearance.overprint')}>
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
                {t(opt.label)}
                <span className="block text-[10px] text-gray-400">{t(opt.hint)}</span>
              </span>
            </label>
          ))}
        </div>
        {overprintMode !== 'none' && (
          <div className="mt-2 pl-1">
            <div className="text-[10px] text-gray-400 mb-1">{t('appearance.intensity')}</div>
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
      <Section label={t('appearance.lineWidth')}>
        <SliderRow
          value={appearance.lineWidth}
          min={0.3} max={3} step={0.1}
          format={v => `${Math.round(v * 100)}%`}
          onChange={v => setAppearance({ lineWidth: v })}
        />
      </Section>

      {/* Color override */}
      <Section label={t('appearance.color')}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={appearance.color || IOF_PURPLE}
            onChange={e => setAppearance({ color: e.target.value })}
            className="w-7 h-7 rounded border border-gray-200 cursor-pointer p-0"
          />
          <span className="text-xs text-gray-500 flex-1">
            {appearance.color ? t('appearance.custom') : t('appearance.defaultPerCourse')}
          </span>
          {appearance.color && (
            <button
              onClick={() => setAppearance({ color: '' })}
              className="text-[10px] text-gray-400 hover:text-orange-600 transition-colors"
            >
              {t('appearance.reset')}
            </button>
          )}
        </div>
      </Section>

      {/* Outline */}
      <Section label={t('appearance.outline')}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={appearance.outlineEnabled}
            onChange={e => setAppearance({ outlineEnabled: e.target.checked })}
            className="accent-orange-600"
          />
          <span className="text-xs text-gray-600">{t('appearance.enableOutline')}</span>
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
              <span className="text-xs text-gray-500">{t('appearance.color')}</span>
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
      <Section label={t('appearance.submaps')}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={labelSubmapStart}
            onChange={e => updateLabelSubmapStart(e.target.checked)}
            className="accent-orange-600"
          />
          <span className="text-xs text-gray-600">{t('appearance.labelSubmap')}</span>
        </label>
      </Section>

      {/* Reset all */}
      <button
        onClick={() => setAppearance({ controlScale: 1, lineWidth: 1, color: '', outlineEnabled: false, outlineColor: '#ffffff', outlineWidth: 0.7 })}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-600 transition-colors pt-1"
      >
        <RotateCcw size={12} />
        {t('appearance.resetStandard')}
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
