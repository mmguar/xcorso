import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useStore } from '../../store'
import {
  PAGE_SIZES, MARGIN, canExportPdf, exportCoursePdf,
  checkFitForCourseObj, checkTilingForCourseObj, suggestFitScaleForCourseObj,
} from '../../lib/pdfExport'
import { defaultControlLabel, computeSubmaps, submapLayoutView } from '../../lib/courseUtils'
import { downloadBlob } from '../../lib/projectFile'
import { setDescTranslator } from '../../lib/pdfDescriptionSheet'
import { getLayoutDefaults } from '../../store/layoutSlice'
import type { PageSizeKey, Control, DescMode } from '../../types'
import type { PdfExportOptions } from '../../lib/pdfExport'

const PAGE_SIZE_KEYS: PageSizeKey[] = ['a4', 'a3', 'letter', 'legal']
const DESC_OPTIONS: { value: DescMode; label: string }[] = [
  { value: 'none', label: 'layout.descNone' },
  { value: 'on-map', label: 'layout.descOnMap' },
  { value: 'separate', label: 'layout.descSeparate' },
  { value: 'both', label: 'layout.descBoth' },
]

function ScaleInput({
  value: externalValue,
  onChange,
  disabled,
  className = '',
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  className?: string
}) {
  const [value, setValue] = useState(String(externalValue))
  const prevScale = useRef(externalValue)
  if (externalValue !== prevScale.current) { // eslint-disable-line react-hooks/refs -- sync prop→state
    prevScale.current = externalValue // eslint-disable-line react-hooks/refs
    setValue(String(externalValue))
  }
  function commit() {
    const v = parseInt(value)
    if (v > 0 && isFinite(v) && v !== externalValue) {
      onChange(v)
    } else {
      setValue(String(externalValue))
    }
  }
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-xs text-gray-500">1:</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-20 px-2 py-1 text-xs border border-gray-200 rounded focus:border-orange-400 focus:outline-none disabled:opacity-40"
      />
    </div>
  )
}

function MmInput({
  value: externalValue,
  onChange,
  disabled,
  max,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  max: number
}) {
  const display = Math.round(externalValue * 10) / 10
  const [text, setText] = useState(String(display))
  const prevVal = useRef(externalValue)
  if (externalValue !== prevVal.current) { // eslint-disable-line react-hooks/refs -- sync prop→state
    prevVal.current = externalValue // eslint-disable-line react-hooks/refs
    setText(String(Math.round(externalValue * 10) / 10))
  }
  function commit() {
    const v = parseFloat(text)
    if (isFinite(v) && v >= 0 && v <= max) {
      const rounded = Math.round(v * 10) / 10
      if (rounded !== display) onChange(rounded)
      else setText(String(display))
    } else {
      setText(String(display))
    }
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-14 px-1.5 py-0.5 text-xs border border-gray-200 rounded focus:border-orange-400 focus:outline-none disabled:opacity-40 text-right tabular-nums"
      />
      <span className="text-[10px] text-gray-400">mm</span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{children}</label>
}

function OverrideTag() {
  const t = useT()
  return <span className="text-[9px] text-orange-600 font-medium ml-1">{t('layout.override')}</span>
}

function GeneralSection() {
  const t = useT()
  useStore(s => s.project!) // re-render on project changes; defaults read below
  const loadedMap = useStore(s => s.loadedMap)
  const updateLayoutDefaults = useStore(s => s.updateLayoutDefaults)
  const defaults = getLayoutDefaults(useStore.getState)
  const [open, setOpen] = useState(true)
  const isSvgMap = loadedMap?.type === 'svg'

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        <span className="text-sm font-medium text-gray-700 flex-1">{t('layout.general')}</span>
        <span className="text-[10px] text-gray-400 tabular-nums">
          {PAGE_SIZES[defaults.pageSize]?.label} · 1:{defaults.printScale.toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100">
          {/* Page size */}
          <div>
            <SectionLabel>{t('layout.pageSize')}</SectionLabel>
            <div className="flex gap-1 mt-1">
              {PAGE_SIZE_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => updateLayoutDefaults({ pageSize: key })}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    defaults.pageSize === key
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                  }`}
                >
                  {PAGE_SIZES[key].label}
                </button>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div>
            <SectionLabel>{t('layout.orientation')}</SectionLabel>
            <div className="flex gap-1 mt-1">
              {(['portrait', 'landscape'] as const).map(o => (
                <button
                  key={o}
                  onClick={() => updateLayoutDefaults({ orientation: o })}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    defaults.orientation === o
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                  }`}
                >
                  {t('layout.' + o)}
                </button>
              ))}
            </div>
          </div>

          {/* Map scale */}
          <div>
            <SectionLabel>{t('layout.mapScale')}</SectionLabel>
            <ScaleInput
              value={defaults.printScale}
              onChange={v => updateLayoutDefaults({ printScale: v })}
              className="mt-1"
            />
          </div>

          {/* Map opacity */}
          <div>
            <SectionLabel>
              {t('layout.mapOpacity')}
              <span className="text-gray-400 font-normal normal-case tracking-normal"> — {Math.round(defaults.mapOpacity * 100)}%</span>
            </SectionLabel>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={defaults.mapOpacity}
              onChange={e => updateLayoutDefaults({ mapOpacity: parseFloat(e.target.value) })}
              className="w-full accent-orange-600 mt-1"
            />
          </div>

          {/* Resolution */}
          {isSvgMap && (
            <div className="flex items-center gap-2">
              <SectionLabel>{t('layout.resolution')}</SectionLabel>
              <select
                value={defaults.rasterDpi}
                disabled={defaults.mapRendering === 'vector'}
                onChange={e => updateLayoutDefaults({ rasterDpi: Number(e.target.value) })}
                className="text-[11px] border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-orange-400 disabled:opacity-40"
              >
                <option value={150}>150 DPI</option>
                <option value={200}>200 DPI</option>
                <option value={300}>300 DPI</option>
                <option value={600}>600 DPI</option>
              </select>
              <label className="flex items-center gap-1 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={defaults.mapRendering === 'vector'}
                  onChange={e => updateLayoutDefaults({ mapRendering: e.target.checked ? 'vector' : 'raster' })}
                  className="accent-orange-600"
                />
                <span className="text-[11px] text-gray-500">{t('layout.fullSvg')}</span>
              </label>
            </div>
          )}

          {/* Map overprint — multiply the map's own colours (raster mode only) */}
          {isSvgMap && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!defaults.mapOverprint}
                disabled={defaults.mapRendering === 'vector'}
                onChange={e => updateLayoutDefaults({ mapOverprint: e.target.checked })}
                className="accent-orange-600 disabled:opacity-40"
              />
              <span className="text-[11px] text-gray-500">
                {t('layout.mapOverprint')}
                {defaults.mapRendering === 'vector' && <span className="text-gray-400"> {t('layout.rasterOnly')}</span>}
              </span>
            </label>
          )}

          {/* Map border */}
          {(() => {
            const base = PAGE_SIZES[defaults.pageSize] ?? PAGE_SIZES.a4
            const pw = defaults.orientation === 'landscape' ? base.h : base.w
            const ph = defaults.orientation === 'landscape' ? base.w : base.h
            const border = defaults.mapBorder
            return (
              <div>
                <SectionLabel>{t('layout.mapBorder')}</SectionLabel>
                <div className="flex items-center gap-2 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!border}
                      onChange={e => {
                        updateLayoutDefaults({
                          mapBorder: e.target.checked
                            ? { color: '#000000', strokeWidth: 0.35, x: MARGIN, y: MARGIN, width: pw - 2 * MARGIN, height: ph - 2 * MARGIN }
                            : undefined,
                        })
                      }}
                      className="accent-orange-600"
                    />
                    <span className="text-xs text-gray-600">{t('layout.enabled')}</span>
                  </label>
                  {border && (
                    <>
                      <input
                        type="color"
                        value={border.color}
                        onChange={e => updateLayoutDefaults({
                          mapBorder: { ...border, color: e.target.value },
                        })}
                        className="w-6 h-6 rounded border border-gray-200 cursor-pointer p-0"
                      />
                      <MmInput
                        value={border.strokeWidth}
                        onChange={v => updateLayoutDefaults({
                          mapBorder: { ...border, strokeWidth: v },
                        })}
                        max={20}
                      />
                    </>
                  )}
                </div>
                {border && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 w-10">{t('layout.left')}</span>
                      <MmInput
                        value={border.x}
                        onChange={v => updateLayoutDefaults({
                          mapBorder: { ...border, x: v, width: pw - v - (pw - border.x - border.width) },
                        })}
                        max={pw - 20 - (pw - border.x - border.width)}
                      />
                      <span className="text-[10px] text-gray-500 w-10 text-right">{t('layout.right')}</span>
                      <MmInput
                        value={Math.round((pw - border.x - border.width) * 10) / 10}
                        onChange={v => updateLayoutDefaults({
                          mapBorder: { ...border, width: pw - border.x - v },
                        })}
                        max={pw - 20 - border.x}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 w-10">{t('layout.top')}</span>
                      <MmInput
                        value={border.y}
                        onChange={v => updateLayoutDefaults({
                          mapBorder: { ...border, y: v, height: ph - v - (ph - border.y - border.height) },
                        })}
                        max={ph - 20 - (ph - border.y - border.height)}
                      />
                      <span className="text-[10px] text-gray-500 w-10 text-right">{t('layout.bottom')}</span>
                      <MmInput
                        value={Math.round((ph - border.y - border.height) * 10) / 10}
                        onChange={v => updateLayoutDefaults({
                          mapBorder: { ...border, height: ph - border.y - v },
                        })}
                        max={ph - 20 - border.y}
                      />
                    </div>
                    <button
                      onClick={() => updateLayoutDefaults({
                        mapBorder: { ...border, x: (pw - border.width) / 2, y: (ph - border.height) / 2 },
                      })}
                      className="text-[10px] text-gray-400 hover:text-orange-600 transition-colors"
                    >
                      {t('layout.recenter')}
                    </button>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function CourseCard({ courseId, includedOverride, onToggleIncluded }: { courseId: string; includedOverride?: boolean; onToggleIncluded?: () => void }) {
  const t = useT()
  const project = useStore(s => s.project!)
  const course = project.courses.find(c => c.id === courseId)!
  const controls = project.controls
  const layout = course.layout
  const defaults = getLayoutDefaults(useStore.getState)

  const layoutCourseId = useStore(s => s.editor.layoutCourseId)
  const layoutSubmapIndex = useStore(s => s.editor.layoutSubmapIndex)
  const enterLayoutMode = useStore(s => s.enterLayoutMode)
  const exitLayoutMode = useStore(s => s.exitLayoutMode)
  const setLayoutSubmap = useStore(s => s.setLayoutSubmap)
  const updateCourseLayout = useStore(s => s.updateCourseLayout)
  const addClueSheetBreak = useStore(s => s.addClueSheetBreak)
  const removeClueSheetBreak = useStore(s => s.removeClueSheetBreak)

  const isActive = courseId === layoutCourseId
  const included = includedOverride ?? (layout?.included !== false)
  const descMode = layout?.descMode ?? 'none'

  // Per-submap layout scoping. The expanded controls edit the submap selected in
  // layout mode (submap 0 when the course has no exchanges/flips).
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const submaps = useMemo(() => computeSubmaps(course), [course])
  const hasSubmaps = submaps.length > 1
  const activeSubmap = isActive ? Math.min(layoutSubmapIndex, submaps.length - 1) : 0
  const sub = layout ? (submapLayoutView(layout, activeSubmap) ?? layout) : undefined
  // Course sliced to the active submap's controls — for fit checks and clue sheets.
  const submapCourse = useMemo(
    () => (hasSubmaps && submaps[activeSubmap] ? { ...course, controls: submaps[activeSubmap].controls } : course),
    [course, hasSubmaps, submaps, activeSubmap],
  )

  const effectivePageSize = sub?.pageSize ?? defaults.pageSize
  const effectiveOrientation = sub?.orientation ?? defaults.orientation
  const effectivePrintScale = sub?.printScale ?? defaults.printScale

  const isPageSizeOverride = sub != null && sub.pageSize !== defaults.pageSize
  const isOrientationOverride = sub != null && sub.orientation !== defaults.orientation
  const isScaleOverride = sub != null && sub.printScale !== defaults.printScale
  const isBorderOverride = sub != null && (
    (!!sub.mapBorder !== !!defaults.mapBorder) ||
    (sub.mapBorder && defaults.mapBorder && (
      sub.mapBorder.x !== defaults.mapBorder.x ||
      sub.mapBorder.y !== defaults.mapBorder.y ||
      sub.mapBorder.color !== defaults.mapBorder.color ||
      sub.mapBorder.strokeWidth !== defaults.mapBorder.strokeWidth
    ))
  )

  const effectiveBorder = sub?.mapBorder

  const fitInfo = useMemo(() =>
    checkFitForCourseObj(submapCourse, project.controls, project.map, effectivePageSize, effectiveOrientation, effectivePrintScale, effectiveBorder, sub?.mapCenter, project.spec),
    [submapCourse, project.controls, project.map, effectivePageSize, effectiveOrientation, effectivePrintScale, effectiveBorder, sub?.mapCenter, project.spec],
  )

  const tileInfo = useMemo(() =>
    fitInfo && !fitInfo.fits
      ? checkTilingForCourseObj(submapCourse, project.controls, project.map, effectivePageSize, effectiveOrientation, effectivePrintScale, effectiveBorder, project.spec)
      : null,
    [submapCourse, project.controls, project.map, effectivePageSize, effectiveOrientation, effectivePrintScale, effectiveBorder, fitInfo, project.spec],
  )

  const suggestedScale = useMemo(() =>
    fitInfo && !fitInfo.fits
      ? suggestFitScaleForCourseObj(submapCourse, project.controls, project.map, effectivePageSize, effectiveOrientation, effectiveBorder, project.spec)
      : null,
    [submapCourse, project.controls, project.map, effectivePageSize, effectiveOrientation, effectiveBorder, fitInfo, project.spec],
  )

  function toggleIncluded() {
    if (onToggleIncluded) {
      onToggleIncluded()
      return
    }
    if (!layout) {
      useStore.getState().ensureAllCourseLayouts()
    }
    // `included` reflects the displayed checkbox state whether or not a layout
    // exists yet, so a toggle always writes its inverse.
    updateCourseLayout(courseId, { included: !included })
  }

  function handleClick() {
    if (!layout) {
      enterLayoutMode(courseId)
      return
    }
    if (isActive) {
      // Leave layout mode but keep the course selected — matches the
      // courses-tab exit path; deselection stays an explicit user action.
      exitLayoutMode()
    } else {
      enterLayoutMode(courseId)
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden transition-colors ${
      !included ? 'border-gray-100 bg-gray-50/50' : isActive ? 'border-orange-200' : 'border-gray-200'
    }`}>
      {/* Header row */}
      <div className={`flex items-center gap-2 px-3 py-2 ${!included ? 'opacity-50' : ''}`}>
        <input
          type="checkbox"
          checked={included}
          onChange={toggleIncluded}
          className="accent-orange-600 shrink-0"
        />
        <button
          onClick={handleClick}
          className={`flex items-center gap-2 flex-1 min-w-0 text-left transition-colors rounded px-1 -mx-1 ${
            isActive ? 'bg-orange-50' : 'hover:bg-gray-50'
          }`}
        >
          {isActive
            ? <ChevronDown size={12} className="text-gray-400 shrink-0" />
            : <ChevronRight size={12} className="text-gray-400 shrink-0" />}
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: course.color }}
          />
          <span className="text-sm font-medium text-gray-800 flex-1 truncate">
            {course.name}
          </span>
        </button>
        {/* Quick descMode select for collapsed cards — the expanded card shows
            the same setting as a button row, so hide it there. */}
        {included && layout && !isActive && (
          <select
            value={descMode}
            onClick={e => e.stopPropagation()}
            onChange={e => {
              updateCourseLayout(courseId, { descMode: e.target.value as DescMode })
            }}
            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-500 bg-white focus:outline-none focus:border-orange-400 shrink-0"
          >
            {DESC_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{t(o.label)}</option>
            ))}
          </select>
        )}
        {included && fitInfo && (
          <span className={`text-[10px] shrink-0 tabular-nums ${
            fitInfo.fits && fitInfo.fitsAtCenter !== false ? 'text-green-600' : 'text-amber-600'
          }`}>
            {fitInfo.fits
              // "can fit": right size, but the current map position crops it.
              ? (fitInfo.fitsAtCenter !== false ? t('layout.fits') : t('layout.canFit'))
              : `${Math.round(fitInfo.widthMm)}×${Math.round(fitInfo.heightMm)}mm`}
          </span>
        )}
      </div>

      {/* Summary line (collapsed, non-active) */}
      {included && layout && !isActive && (isPageSizeOverride || isOrientationOverride || isScaleOverride) && (
        <div className="px-3 pb-1.5 -mt-1">
          <span className="text-[10px] text-orange-500 tabular-nums">
            {PAGE_SIZES[effectivePageSize]?.label} · {effectiveOrientation === 'landscape' ? 'L' : 'P'} · 1:{effectivePrintScale.toLocaleString()} *
          </span>
        </div>
      )}

      {/* Expanded section (active course) */}
      {isActive && layout && sub && included && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100 bg-orange-50/30">
          {/* Submap selector (exchange/flip courses) */}
          {hasSubmaps && (
            <div>
              <SectionLabel>{t('layout.maps')}</SectionLabel>
              <div className="flex gap-1 mt-1 flex-wrap">
                {submaps.map(sm => (
                  <button
                    key={sm.index}
                    onClick={() => setLayoutSubmap(sm.index)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors ${
                      activeSubmap === sm.index
                        ? 'bg-orange-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                    }`}
                  >
                    {sm.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Page size */}
          <div>
            <SectionLabel>{t('layout.pageSize')}{isPageSizeOverride && <OverrideTag />}</SectionLabel>
            <div className="flex gap-1 mt-1">
              {PAGE_SIZE_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => updateCourseLayout(courseId, { pageSize: key }, activeSubmap)}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    sub.pageSize === key
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                  }`}
                >
                  {PAGE_SIZES[key].label}
                </button>
              ))}
              {isPageSizeOverride && (
                <button
                  onClick={() => updateCourseLayout(courseId, { pageSize: defaults.pageSize }, activeSubmap)}
                  className="text-[10px] text-orange-600 hover:text-orange-800 ml-1"
                >
                  {t('common.reset')}
                </button>
              )}
            </div>
          </div>

          {/* Orientation */}
          <div>
            <SectionLabel>{t('layout.orientation')}{isOrientationOverride && <OverrideTag />}</SectionLabel>
            <div className="flex gap-1 mt-1">
              {(['portrait', 'landscape'] as const).map(o => (
                <button
                  key={o}
                  onClick={() => updateCourseLayout(courseId, { orientation: o }, activeSubmap)}
                  className={`px-2 py-1 text-[11px] rounded capitalize transition-colors ${
                    sub.orientation === o
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                  }`}
                >
                  {t('layout.' + o)}
                </button>
              ))}
              {isOrientationOverride && (
                <button
                  onClick={() => updateCourseLayout(courseId, { orientation: defaults.orientation }, activeSubmap)}
                  className="text-[10px] text-orange-600 hover:text-orange-800 ml-1"
                >
                  {t('common.reset')}
                </button>
              )}
            </div>
          </div>

          {/* Print scale */}
          <div>
            <SectionLabel>{t('layout.printScale')}{isScaleOverride && <OverrideTag />}</SectionLabel>
            <div className="flex items-center gap-2 mt-1">
              <ScaleInput
                value={sub.printScale}
                onChange={v => updateCourseLayout(courseId, { printScale: v }, activeSubmap)}
              />
              {isScaleOverride && (
                <button
                  onClick={() => updateCourseLayout(courseId, { printScale: defaults.printScale }, activeSubmap)}
                  className="text-[10px] text-orange-600 hover:text-orange-800"
                >
                  {t('common.reset')}
                </button>
              )}
            </div>
          </div>

          {/* Fit warning + tiling */}
          {fitInfo && !fitInfo.fits && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5">
              <p className="text-[11px] text-amber-700">
                {t('layout.doesntFit')}
              </p>
              {suggestedScale && (
                <button
                  onClick={() => updateCourseLayout(courseId, { printScale: suggestedScale }, activeSubmap)}
                  className="text-[11px] text-orange-600 hover:text-orange-800 font-medium"
                >
                  {t('layout.fitAt', { scale: suggestedScale.toLocaleString() })}
                </button>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sub.tiling === true}
                  onChange={e => updateCourseLayout(courseId, { tiling: e.target.checked }, activeSubmap)}
                  className="accent-orange-600"
                />
                <span className="text-[11px] text-amber-700">
                  {t('layout.tilePages')}
                  {tileInfo && tileInfo.totalPages > 1 && (
                    <span className="text-amber-500"> {t('layout.tileInfo', { cols: tileInfo.cols, rows: tileInfo.rows })}</span>
                  )}
                </span>
              </label>
            </div>
          )}

          {/* Clue sheet / description mode */}
          <div>
            <SectionLabel>{t('layout.clueSheet')}</SectionLabel>
            <div className="flex gap-1 mt-1 flex-wrap">
              {DESC_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => updateCourseLayout(courseId, { descMode: o.value })}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    descMode === o.value
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                  }`}
                >
                  {t(o.label)}
                </button>
              ))}
            </div>
          </div>

          {/* Clue sheet breaks (when on-map or both) — scoped to the active submap */}
          {(descMode === 'on-map' || descMode === 'both') && (() => {
            const controlMap = new Map(controls.map((c: Control) => [c.id, c]))
            const resolved = submapCourse.controls
              .map(cc => controlMap.get(cc.controlId))
              .filter((c): c is Control => c != null)
            if (resolved.length < 3) return null

            const breaks = sub.clueSheetBreaks ?? []
            const breakSet = new Set(breaks)
            const eligible = resolved
              .map((ctrl, i) => ({ ctrl, i }))
              .filter(({ i }) => i > 0 && i < resolved.length - 1 && !breakSet.has(i))
            const partCount = breaks.length + 1
            const boundaries = [0, ...breaks, resolved.length]

            return (
              <div className="ml-3 space-y-1.5">
                {breaks.length > 0 && (
                  <div className="space-y-1">
                    {Array.from({ length: partCount }, (_, p) => {
                      const start = boundaries[p]
                      const end = boundaries[p + 1] - 1
                      const startLabel = defaultControlLabel(resolved[start])
                      const endLabel = defaultControlLabel(resolved[end])
                      return (
                        <div key={p} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                          <span className="tabular-nums">{t('layout.part', { n: p + 1 })}</span>
                          <span className="text-gray-400">{startLabel} &rarr; {endLabel}</span>
                          {p > 0 && (
                            <button
                              onClick={() => removeClueSheetBreak(courseId, p - 1, activeSubmap)}
                              className="ml-auto w-4 h-4 rounded-full bg-gray-200 hover:bg-red-400 text-gray-500 hover:text-white flex items-center justify-center"
                            >
                              <X size={8} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {eligible.length > 0 && (
                  <select
                    value=""
                    onChange={e => {
                      const idx = parseInt(e.target.value)
                      if (!isNaN(idx)) addClueSheetBreak(courseId, idx, activeSubmap)
                    }}
                    className="text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-500 focus:outline-none focus:border-orange-400 w-full"
                  >
                    <option value="">{t('layout.splitAfter')}</option>
                    {eligible.map(({ ctrl, i }) => (
                      <option key={i} value={i}>
                        {defaultControlLabel(ctrl)} ({ctrl.type === 'start' ? 'start' : `#${resolved.slice(0, i + 1).filter(c => c.type === 'control').length}`})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })()}

          {/* Map border */}
          {(() => {
            const base = PAGE_SIZES[effectivePageSize] ?? PAGE_SIZES.a4
            const pw = effectiveOrientation === 'landscape' ? base.h : base.w
            const ph = effectiveOrientation === 'landscape' ? base.w : base.h
            const cb = sub.mapBorder
            return (
              <div>
                <SectionLabel>{t('layout.mapBorder')}{isBorderOverride && <OverrideTag />}</SectionLabel>
                <div className="flex items-center gap-2 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!cb}
                      onChange={e => {
                        if (e.target.checked) {
                          const db = defaults.mapBorder
                          updateCourseLayout(courseId, {
                            mapBorder: db
                              ? { ...db }
                              : { color: course.color, strokeWidth: 0.35, x: MARGIN, y: MARGIN, width: pw - 2 * MARGIN, height: ph - 2 * MARGIN },
                          }, activeSubmap)
                        } else {
                          updateCourseLayout(courseId, { mapBorder: undefined }, activeSubmap)
                        }
                      }}
                      className="accent-orange-600"
                    />
                    <span className="text-xs text-gray-600">{t('layout.enabled')}</span>
                  </label>
                  {cb && (
                    <>
                      <input
                        type="color"
                        value={cb.color}
                        onChange={e => updateCourseLayout(courseId, {
                          mapBorder: { ...cb, color: e.target.value },
                        }, activeSubmap)}
                        className="w-6 h-6 rounded border border-gray-200 cursor-pointer p-0"
                      />
                      <MmInput
                        value={cb.strokeWidth}
                        onChange={v => updateCourseLayout(courseId, {
                          mapBorder: { ...cb, strokeWidth: v },
                        }, activeSubmap)}
                        max={20}
                      />
                    </>
                  )}
                  {isBorderOverride && (
                    <button
                      onClick={() => {
                        if (defaults.mapBorder) {
                          updateCourseLayout(courseId, {
                            mapBorder: { ...defaults.mapBorder },
                          }, activeSubmap)
                        } else {
                          updateCourseLayout(courseId, { mapBorder: undefined }, activeSubmap)
                        }
                      }}
                      className="text-[10px] text-orange-600 hover:text-orange-800 ml-auto"
                    >
                      {t('common.reset')}
                    </button>
                  )}
                </div>
                {cb && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 w-10">{t('layout.left')}</span>
                      <MmInput
                        value={cb.x}
                        onChange={v => updateCourseLayout(courseId, {
                          mapBorder: { ...cb, x: v, width: pw - v - (pw - cb.x - cb.width) },
                        }, activeSubmap)}
                        max={pw - 20 - (pw - cb.x - cb.width)}
                      />
                      <span className="text-[10px] text-gray-500 w-10 text-right">{t('layout.right')}</span>
                      <MmInput
                        value={Math.round((pw - cb.x - cb.width) * 10) / 10}
                        onChange={v => updateCourseLayout(courseId, {
                          mapBorder: { ...cb, width: pw - cb.x - v },
                        }, activeSubmap)}
                        max={pw - 20 - cb.x}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 w-10">{t('layout.top')}</span>
                      <MmInput
                        value={cb.y}
                        onChange={v => updateCourseLayout(courseId, {
                          mapBorder: { ...cb, y: v, height: ph - v - (ph - cb.y - cb.height) },
                        }, activeSubmap)}
                        max={ph - 20 - (ph - cb.y - cb.height)}
                      />
                      <span className="text-[10px] text-gray-500 w-10 text-right">{t('layout.bottom')}</span>
                      <MmInput
                        value={Math.round((ph - cb.y - cb.height) * 10) / 10}
                        onChange={v => updateCourseLayout(courseId, {
                          mapBorder: { ...cb, height: ph - cb.y - v },
                        }, activeSubmap)}
                        max={ph - 20 - cb.y}
                      />
                    </div>
                    <button
                      onClick={() => updateCourseLayout(courseId, {
                        mapBorder: { ...cb, x: (pw - cb.width) / 2, y: (ph - cb.height) / 2 },
                      }, activeSubmap)}
                      className="text-[10px] text-gray-400 hover:text-orange-600 transition-colors"
                    >
                      {t('layout.recenter')}
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Reset to (sub)map center — border-aware, see resetLayoutCenter */}
          <button
            onClick={() => useStore.getState().resetLayoutCenter(courseId, activeSubmap)}
            className="text-[11px] text-gray-400 hover:text-orange-600 transition-colors"
          >
            {hasSubmaps ? t('layout.resetMapCenter') : t('layout.resetCourseCenter')}
          </button>
        </div>
      )}
    </div>
  )
}

export function LayoutPanel() {
  const t = useT()
  const project = useStore(s => s.project!)
  const courses = project.courses
  const loadedMap = useStore(s => s.loadedMap)
  const ensureAllCourseLayouts = useStore(s => s.ensureAllCourseLayouts)
  const isViewer = useStore(s => s.projectRole) === 'viewer'
  const scalable = canExportPdf(project.map)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [allControls, setAllControls] = useState(true)
  const allControlsMulticolor = useStore(s => s.project!.allControlsMulticolor ?? false)
  const allControlsLinkId = useStore(s => s.project!.allControlsLinkId ?? false)
  const setAllControlsFlags = useStore(s => s.setAllControlsFlags)
  const [viewerExclusions, setViewerExclusions] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (courses.length > 0) ensureAllCourseLayouts()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when course count changes, not on every action ref update
  }, [courses.length])

  function isIncluded(c: typeof courses[0]) {
    if (isViewer) return !viewerExclusions.has(c.id)
    return c.layout?.included !== false
  }

  const includedCount = courses.filter(isIncluded).length
  const hasControls = project.controls.length > 0

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const currentProject = useStore.getState().project!
      const defaults = getLayoutDefaults(useStore.getState)
      const includedCourses = currentProject.courses.filter(c =>
        isViewer ? !viewerExclusions.has(c.id) : c.layout?.included !== false
      )

      // Scale, clue-sheet positions, page size, border and centring are all read
      // per-submap directly from each course's layout inside exportCoursePdf, so
      // only the course-level description mode needs to be threaded through here.
      const descModes: Record<string, DescMode> = {}
      for (const c of includedCourses) {
        if (!c.layout) continue
        descModes[c.id] = c.layout.descMode ?? 'none'
      }

      const options: PdfExportOptions = {
        pageSize: defaults.pageSize,
        orientation: defaults.orientation,
        printScale: defaults.printScale,
        courseIds: includedCourses.map(c => c.id),
        allControls,
        allControlsMulticolor: allControls && allControlsMulticolor,
        allControlsLinkId: allControls && allControlsLinkId,
        descModes,
        mapOpacity: defaults.mapOpacity,
        mapRendering: loadedMap?.type === 'svg' ? defaults.mapRendering : undefined,
        rasterDpi: defaults.mapRendering === 'raster' ? defaults.rasterDpi : undefined,
        mapOverprint: defaults.mapRendering === 'raster' && !!defaults.mapOverprint,
        overprint: (currentProject.overprintMode ?? 'simulated') === 'none' ? 0 : (currentProject.overprint ?? 1),
        overprintMode: currentProject.overprintMode ?? 'simulated',
      }

      setDescTranslator(t)
      const currentMap = useStore.getState().loadedMap
      const blob = await exportCoursePdf(currentProject, options, currentMap)
      downloadBlob(blob, `${currentProject.meta.name.replace(/\s+/g, '_')}_courses.pdf`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // A stale dev/PWA page can fail to fetch the lazily-loaded pdf modules;
      // only a reload picks up the fresh chunks.
      setExportError(/dynamically imported module|outdated optimize dep|Importing a module script failed/i.test(msg)
        ? t('layout.exportFailed')
        : t('layout.exportError', { error: msg }))
    } finally {
      setExporting(false)
    }
  }

  if (courses.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        {t('layout.createCourseFirst')}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1.5">
      <GeneralSection />

      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
          {t('layout.courses')}
          <span className="text-gray-400 font-normal normal-case tracking-normal"> {t('layout.included', { included: includedCount, total: courses.length })}</span>
        </span>
      </div>

      {hasControls && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <input
              type="checkbox"
              checked={allControls}
              onChange={e => setAllControls(e.target.checked)}
              className="accent-orange-600 shrink-0"
            />
            <div className="w-3 h-3 rounded-full shrink-0 bg-orange-600" />
            <span className="text-sm font-medium text-gray-800 flex-1">{t('layout.allControls')}</span>
          </div>
          {allControls && (
            <div className="flex items-center gap-3 px-3 py-1.5 border-t border-gray-100 bg-gray-50">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={allControlsMulticolor} onChange={e => setAllControlsFlags({ multicolor: e.target.checked })} className="accent-orange-600" />
                {t('layout.multicolor')}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={allControlsLinkId} onChange={e => setAllControlsFlags({ linkId: e.target.checked })} className="accent-orange-600" />
                {t('layout.linkId')}
              </label>
            </div>
          )}
        </div>
      )}

      {courses.map(course => (
        <CourseCard
          key={course.id}
          courseId={course.id}
          includedOverride={isViewer ? !viewerExclusions.has(course.id) : undefined}
          onToggleIncluded={isViewer ? () => setViewerExclusions(s => {
            const next = new Set(s)
            if (next.has(course.id)) next.delete(course.id); else next.add(course.id)
            return next
          }) : undefined}
        />
      ))}

      {/* Export */}
      <div className="pt-2 border-t border-gray-100 sticky bottom-0 bg-white pb-1">
        {!scalable && (
          <p className="text-[11px] text-amber-600 mb-2">
            {t('layout.noScaleCalibration')}
          </p>
        )}
        {exportError && (
          <p className="text-[11px] text-red-600 mb-2">{exportError}</p>
        )}
        <button
          data-tour="export-pdf"
          onClick={handleExport}
          disabled={!scalable || (includedCount === 0 && !allControls) || exporting}
          className="w-full bg-orange-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? t('layout.exporting') : t('layout.exportPdf')}
        </button>
      </div>
    </div>
  )
}
