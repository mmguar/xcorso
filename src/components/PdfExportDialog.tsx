import { useMemo, useRef } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { PAGE_SIZES, MARGIN, ALL_CONTROLS_ID, mapToMm, parseSubmapPreviewId } from '../lib/pdfExport'
import type { CoursePreview, DescMode } from '../lib/pdfExport'
import type { LoadedMap } from '../lib/mapLoader'
import type { MapConfig } from '../types'
import { usePdfExportState } from './usePdfExportState'

// ── Map image bounds (mm on paper) ────────────────────────────────────────

interface MapImageInfo {
  url: string; x: number; y: number; w: number; h: number
}

function useMapPreviewBounds(
  loadedMap: LoadedMap | null,
  map: MapConfig,
  printScale: number,
): MapImageInfo | null {
  return useMemo(() => {
    if (!loadedMap) return null
    const url = loadedMap.rasterUrl ?? (typeof loadedMap.content === 'string' ? loadedMap.content : null)
    if (!url) return null
    const { bounds } = loadedMap
    const tl = mapToMm({ x: bounds.minX, y: bounds.minY }, map, printScale)
    const br = mapToMm({ x: bounds.maxX, y: bounds.maxY }, map, printScale)
    return { url, x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
  }, [loadedMap, map, printScale])
}

// ── Print frame preview ────────────────────────────────────────────────────

interface SheetPart {
  width: number; height: number; x: number; y: number
}

function PrintPreview({
  preview,
  pageW,
  pageH,
  printableW,
  printableH,
  offsetX,
  offsetY,
  onOffsetChange,
  sheetParts,
  onSheetPartChange,
  mapImage,
  dotColor = '#7c3aed',
}: {
  preview: CoursePreview
  pageW: number
  pageH: number
  printableW: number
  printableH: number
  offsetX: number
  offsetY: number
  onOffsetChange: (x: number, y: number) => void
  sheetParts?: SheetPart[]
  onSheetPartChange?: (partIndex: number, x: number, y: number) => void
  mapImage: MapImageInfo | null
  dotColor?: string
}) {
  const dragRef = useRef<{ target: 'map' | 'sheet'; partIndex: number; sx: number; sy: number; ox: number; oy: number } | null>(null)

  const { positions, fadedPositions, centerX, centerY } = preview

  const allPos = fadedPositions ? [...positions, ...fadedPositions] : positions
  const showW = Math.max(
    ...allPos.map(p => Math.abs(p.x - centerX)),
    printableW / 2,
  ) * 2.8
  const showH = Math.max(
    ...allPos.map(p => Math.abs(p.y - centerY)),
    printableH / 2,
  ) * 2.8

  const PREVIEW_W = 280
  const mmScale = Math.min(PREVIEW_W / showW, 180 / showH)
  const PREVIEW_H = showH * mmScale
  const pcx = PREVIEW_W / 2
  const pcy = PREVIEW_H / 2

  const frameW = printableW * mmScale
  const frameH = printableH * mmScale
  const frameX = pcx + offsetX * mmScale - frameW / 2
  const frameY = pcy + offsetY * mmScale - frameH / 2

  const fullW = pageW * mmScale
  const fullH = pageH * mmScale
  const fullX = frameX - MARGIN * mmScale
  const fullY = frameY - MARGIN * mmScale

  const hasSheets = sheetParts != null && sheetParts.length > 0 && onSheetPartChange != null
  const sheetRects = hasSheets
    ? sheetParts!.map(p => ({
        x: fullX + p.x * mmScale,
        y: fullY + p.y * mmScale,
        w: p.width * mmScale,
        h: p.height * mmScale,
        ox: p.x,
        oy: p.y,
      }))
    : []

  function handlePointerDown(e: React.PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse())

    for (let i = sheetRects.length - 1; i >= 0; i--) {
      const r = sheetRects[i]
      if (svgPt.x >= r.x && svgPt.x <= r.x + r.w && svgPt.y >= r.y && svgPt.y <= r.y + r.h) {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { target: 'sheet', partIndex: i, sx: e.clientX, sy: e.clientY, ox: r.ox, oy: r.oy }
        return
      }
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { target: 'map', partIndex: 0, sx: e.clientX, sy: e.clientY, ox: offsetX, oy: offsetY }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) / mmScale
    const dy = (e.clientY - dragRef.current.sy) / mmScale
    if (dragRef.current.target === 'sheet' && onSheetPartChange) {
      onSheetPartChange(dragRef.current.partIndex, dragRef.current.ox + dx, dragRef.current.oy + dy)
    } else {
      onOffsetChange(dragRef.current.ox + dx, dragRef.current.oy + dy)
    }
  }

  function handlePointerUp() {
    dragRef.current = null
  }

  return (
    <svg
      viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
      className="w-full border border-gray-200 rounded-xl bg-gray-100 select-none touch-none cursor-grab active:cursor-grabbing"
      style={{ maxHeight: 220 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <rect x={fullX} y={fullY} width={fullW} height={fullH} fill="white" stroke="#d1d5db" strokeWidth={1} />
      <clipPath id="printable-clip">
        <rect x={frameX} y={frameY} width={frameW} height={frameH} />
      </clipPath>
      {mapImage ? (
        <image
          href={mapImage.url}
          x={pcx + (mapImage.x - centerX) * mmScale}
          y={pcy + (mapImage.y - centerY) * mmScale}
          width={mapImage.w * mmScale}
          height={mapImage.h * mmScale}
          preserveAspectRatio="none"
          clipPath="url(#printable-clip)"
          opacity={0.5}
        />
      ) : (
        <rect x={frameX} y={frameY} width={frameW} height={frameH} fill="#f3e8ff" opacity={0.5} />
      )}
      <rect
        x={frameX} y={frameY}
        width={frameW} height={frameH}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      {fadedPositions?.map((c, i) => (
        <circle
          key={`f${i}`}
          cx={pcx + (c.x - centerX) * mmScale}
          cy={pcy + (c.y - centerY) * mmScale}
          r={2.5}
          fill={dotColor}
          opacity={0.2}
        />
      ))}
      {positions.map((c, i) => (
        <circle
          key={i}
          cx={pcx + (c.x - centerX) * mmScale}
          cy={pcy + (c.y - centerY) * mmScale}
          r={3}
          fill={dotColor}
          opacity={0.7}
        />
      ))}
      {sheetRects.map((r, i) => (
        <g key={`sheet${i}`}>
          <rect
            x={r.x} y={r.y}
            width={r.w} height={r.h}
            fill="white" fillOpacity={0.85}
            stroke="#ea580c"
            strokeWidth={1.5}
            rx={1}
            style={{ cursor: 'move' }}
          />
          <text
            x={r.x + r.w / 2} y={r.y + r.h / 2 + 3}
            textAnchor="middle" fontSize={8} fill="#ea580c" opacity={0.8}
            style={{ pointerEvents: 'none' }}
          >
            {sheetRects.length > 1 ? `Desc ${i + 1}/${sheetRects.length}` : 'Descriptions'}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ── Dialog ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function PdfExportDialog({ onClose }: Props) {
  const s = usePdfExportState(onClose)
  const mapImage = useMapPreviewBounds(s.loadedMap, s.project.map, s.activeScale)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900">Export Course PDF</h2>

        {!s.scalable && (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Map has no scale calibration. Use the Measure Scale tool first so the
            PDF can be printed at the correct size.
          </p>
        )}

        {/* Page size + orientation */}
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Page size</label>
            <select
              value={s.pageSize}
              onChange={e => s.setPageSize(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {Object.entries(PAGE_SIZES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Orientation</label>
            <div className="flex border border-gray-200 rounded-lg overflow-hidden h-[38px]">
              {(['portrait', 'landscape'] as const).map(o => (
                <button
                  key={o}
                  onClick={() => s.setOrientation(o)}
                  className={`px-3 text-sm transition-colors ${
                    s.orientation === o
                      ? 'bg-orange-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {o === 'portrait' ? 'Portrait' : 'Landscape'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Print scale */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Print scale</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">1 :</span>
            <input
              type="text"
              inputMode="numeric"
              value={s.scaleInput}
              onChange={e => s.setScaleInput(e.target.value)}
              onBlur={s.handleScaleBlur}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            {s.printScale !== s.project.map.scale && (
              <button onClick={s.resetScale} className="text-xs text-orange-600 hover:text-orange-800">
                Reset to 1:{s.project.map.scale}
              </button>
            )}
            {s.fitScale && s.fitScale !== s.printScale && (
              <button onClick={s.applyFitScale} className="text-xs text-orange-600 hover:text-orange-800">
                Fit to page (1:{s.fitScale})
              </button>
            )}
          </div>
        </div>

        {/* Map opacity */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">
            Map opacity
            <span className="text-gray-400 font-normal"> — {Math.round(s.mapOpacity * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={s.mapOpacity}
            onChange={e => s.setMapOpacity(parseFloat(e.target.value))}
            className="w-full accent-orange-600"
          />
        </div>

        {/* Map rendering */}
        {s.isSvgMap && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 shrink-0">Resolution</label>
            <select
              value={s.rasterDpi}
              disabled={s.mapRendering === 'vector'}
              onChange={e => s.setRasterDpi(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40"
            >
              <option value={150}>150 DPI</option>
              <option value={200}>200 DPI</option>
              <option value={300}>300 DPI</option>
              <option value={600}>600 DPI</option>
            </select>
            <span className="text-xs text-gray-400 flex-1">
              {s.mapRendering === 'vector'
                ? ''
                : s.rasterDpi <= 200 ? 'smaller file' : s.rasterDpi >= 600 ? 'large file' : 'print quality'}
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={s.mapRendering === 'vector'}
                onChange={e => s.setMapRendering(e.target.checked ? 'vector' : 'raster')}
                className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
              />
              <span className="text-xs text-gray-500">Full SVG</span>
            </label>
          </div>
        )}

        {/* Tiling */}
        {s.anyOverflow && s.hasSelection && (
          <label className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={s.tiling}
              onChange={e => s.setTiling(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">Tile across multiple pages</span>
              <span className="text-xs text-gray-500 ml-1">(15 mm overlap)</span>
            </div>
          </label>
        )}

        {/* Print frame preview */}
        {s.preview && s.hasSelection && s.activePreviewId && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500">
                Page position
                <span className="text-gray-400 font-normal"> &mdash; drag to reposition</span>
              </label>
              {s.hasOffset && (
                <button onClick={s.resetOffset} className="text-xs text-orange-600 hover:text-orange-800">
                  {s.activeLayout ? 'Reset to layout' : 'Re-center'}
                </button>
              )}
            </div>
            {s.previewIds.length > 1 && (
              <div className="flex gap-1 flex-wrap items-center">
                {s.previewIds.map((id, idx) => {
                  const parsed = parseSubmapPreviewId(id)
                  const realCourseId = parsed ? parsed.courseId : id
                  const course = id === ALL_CONTROLS_ID ? null : s.project.courses.find(c => c.id === realCourseId)
                  const label = id === ALL_CONTROLS_ID
                    ? 'All controls'
                    : parsed
                      ? `${course?.name ?? realCourseId} — Map ${parsed.submapIndex + 1}`
                      : (course?.name ?? id)
                  const color = id === ALL_CONTROLS_ID ? '#ea580c' : (course?.color ?? '#a626ff')
                  const isActive = id === s.activePreviewId

                  const isFirstSubmap = parsed && (idx === 0 || parseSubmapPreviewId(s.previewIds[idx - 1])?.courseId !== parsed.courseId)
                  const locked = parsed ? s.isSubmapLocked(parsed.courseId) : false

                  return (
                    <div key={id} className="flex items-center">
                      {isFirstSubmap && (
                        <button
                          onClick={() => s.toggleSubmapLock(parsed!.courseId)}
                          className="p-0.5 text-gray-400 hover:text-gray-600 mr-0.5"
                          title={locked ? 'Unlock submap positions' : 'Lock submap positions'}
                        >
                          {locked ? <Lock size={12} /> : <Unlock size={12} />}
                        </button>
                      )}
                      <button
                        onClick={() => s.setPreviewCourseId(id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-300'
                            : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        {label}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {s.activePreviewId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Scale:</span>
                <span className="text-xs text-gray-500">1 :</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={s.scaleOverrides[s.activePreviewId] != null ? String(s.scaleOverrides[s.activePreviewId]) : ''}
                  placeholder={String(s.printScale)}
                  onChange={e => s.setActiveScaleOverride(e.target.value)}
                  onBlur={e => s.blurActiveScaleOverride(e.target.value)}
                  className="w-20 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                {s.scaleOverrides[s.activePreviewId] != null && (
                  <button
                    onClick={s.resetActiveScaleOverride}
                    className="text-[11px] text-orange-600 hover:text-orange-800"
                  >
                    Reset to 1:{s.printScale}
                  </button>
                )}
              </div>
            )}
            <PrintPreview
              preview={s.activeLayout && s.preview ? {
                ...s.preview,
                centerX: mapToMm(s.activeLayout.mapCenter, s.project.map, s.activeScale).x,
                centerY: mapToMm(s.activeLayout.mapCenter, s.project.map, s.activeScale).y,
              } : s.preview!}
              pageW={s.activePw}
              pageH={s.activePh}
              printableW={s.activePrintableW}
              printableH={s.activePrintableH}
              offsetX={s.activeOffset.x}
              offsetY={s.activeOffset.y}
              onOffsetChange={s.setActiveOffset}
              mapImage={mapImage}
              dotColor={s.activePreviewId === ALL_CONTROLS_ID ? '#ea580c' : (s.project.courses.find(c => c.id === (parseSubmapPreviewId(s.activePreviewId)?.courseId ?? s.activePreviewId))?.color ?? '#a626ff')}
              {...(s.sheetParts ? {
                sheetParts: s.sheetParts,
                onSheetPartChange: s.setSheetPartPos,
              } : {})}
            />
          </div>
        )}

        {/* Course selection */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-500">
              Courses
              {s.hasSelection && (
                <span className="text-gray-400 font-normal">
                  {' '}&mdash; {s.totalPages} {s.totalPages === 1 ? 'page' : 'pages'} total
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <button onClick={s.selectAll} className="text-xs text-orange-600 hover:text-orange-800">All</button>
              <button onClick={s.selectNone} className="text-xs text-gray-400 hover:text-gray-600">None</button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto">
            {s.project.controls.length > 0 && (
              <label className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={s.allControls}
                  onChange={e => s.setAllControls(e.target.checked)}
                  className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
                />
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-orange-600" />
                <span className="text-sm flex-1 truncate">All controls</span>
                {s.allControls && (() => {
                  const fit = s.fitInfo.find(f => f.courseId === ALL_CONTROLS_ID)
                  const tile = s.tileInfo.find(t => t.courseId === ALL_CONTROLS_ID)
                  if (!fit) return null
                  return (
                    <span className={`text-xs shrink-0 ${
                      fit.fits ? 'text-green-600'
                        : s.tiling ? 'text-blue-600'
                        : 'text-amber-600'
                    }`}>
                      {fit.fits
                        ? 'fits'
                        : s.tiling && tile
                          ? `${tile.cols}×${tile.rows} pages`
                          : `${Math.round(fit.widthMm)}×${Math.round(fit.heightMm)} mm`}
                    </span>
                  )
                })()}
              </label>
            )}
            {s.project.courses.length === 0 && !s.allControls ? (
              <div className="px-4 py-3 text-sm text-gray-400">No courses to export</div>
            ) : (
              s.project.courses.map(course => {
                const fit = s.fitInfo.find(f => f.courseId === course.id)
                const tile = s.tileInfo.find(t => t.courseId === course.id)
                const checked = s.selectedIds.has(course.id)
                const courseScale = s.scaleOverrides[course.id]
                return (
                  <div key={course.id} className="hover:bg-gray-50">
                    <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => s.toggleCourse(course.id)}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
                      />
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: course.color }}
                      />
                      <span className="text-sm flex-1 truncate">{course.name}</span>
                      {checked && (
                        <select
                          value={s.descModes[course.id] ?? 'none'}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            e.stopPropagation()
                            s.setDescModes(prev => ({ ...prev, [course.id]: e.target.value as DescMode }))
                          }}
                          className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-500 bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
                        >
                          <option value="none">No desc</option>
                          <option value="separate">+ desc page</option>
                          <option value="on-map">Desc on map</option>
                        </select>
                      )}
                      {fit && checked && (
                        <span className={`text-xs shrink-0 ${
                          fit.fits ? 'text-green-600'
                            : s.tiling ? 'text-blue-600'
                            : 'text-amber-600'
                        }`}>
                          {fit.fits
                            ? `fits${courseScale ? ` (1:${courseScale.toLocaleString()})` : ''}`
                            : s.tiling && tile
                              ? `${tile.cols}×${tile.rows} pages`
                              : `${Math.round(fit.widthMm)}×${Math.round(fit.heightMm)} mm`}
                        </span>
                      )}
                    </label>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Bulk description mode */}
        {s.selectedIds.size > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium">Set all descriptions:</span>
            {([['none', 'None'], ['separate', '+ page'], ['on-map', 'On map']] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => s.setAllDescModes(mode)}
                className="px-2 py-1 rounded text-xs text-gray-500 hover:bg-orange-50 hover:text-orange-700 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {s.anyOverflow && !s.tiling && s.hasSelection && (
          <p className="text-xs text-amber-600">
            {s.fitScale
              ? `Some courses exceed the printable area at this scale. Use "Fit to page" above for 1:${s.fitScale.toLocaleString()}, or enable tiling.`
              : 'Some courses exceed the printable area and no common scale fits on a single page. Enable tiling, or try a larger page size or landscape orientation.'}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={s.handleExport}
            disabled={!s.hasSelection || !s.scalable || s.exporting}
            className="flex-1 bg-orange-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {s.exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
