import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  exportCoursePdf, checkFit, checkTiling, canExportPdf, PAGE_SIZES, MARGIN,
  suggestFitScale, coursePreviewMm, mapToMm, ALL_CONTROLS_ID,
} from '../lib/pdfExport'
import type { PdfExportOptions, CoursePreview, DescMode } from '../lib/pdfExport'
import type { LoadedMap } from '../lib/mapLoader'
import type { MapConfig } from '../types'
import { descriptionSheetPageCount, descriptionSheetSize } from '../lib/pdfDescriptionSheet'
import { downloadBlob } from '../lib/projectFile'

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

function PrintPreview({
  preview,
  pageW,
  pageH,
  printableW,
  printableH,
  offsetX,
  offsetY,
  onOffsetChange,
  sheetW,
  sheetH,
  sheetX,
  sheetY,
  onSheetChange,
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
  sheetW?: number
  sheetH?: number
  sheetX?: number
  sheetY?: number
  onSheetChange?: (x: number, y: number) => void
  mapImage: MapImageInfo | null
  dotColor?: string
}) {
  const dragRef = useRef<{ target: 'map' | 'sheet'; sx: number; sy: number; ox: number; oy: number } | null>(null)

  const { positions, centerX, centerY } = preview

  const showW = Math.max(
    ...positions.map(p => Math.abs(p.x - centerX)),
    printableW / 2,
  ) * 2.8
  const showH = Math.max(
    ...positions.map(p => Math.abs(p.y - centerY)),
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

  // Page outline (full page including margins)
  const fullW = pageW * mmScale
  const fullH = pageH * mmScale
  const fullX = frameX - MARGIN * mmScale
  const fullY = frameY - MARGIN * mmScale

  // Sheet rectangle in page coordinates
  const hasSheet = sheetW != null && sheetH != null && sheetX != null && sheetY != null && onSheetChange != null
  const sRectW = hasSheet ? sheetW! * mmScale : 0
  const sRectH = hasSheet ? sheetH! * mmScale : 0
  const sRectX = hasSheet ? fullX + sheetX! * mmScale : 0
  const sRectY = hasSheet ? fullY + sheetY! * mmScale : 0

  function handlePointerDown(e: React.PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse())

    if (hasSheet &&
      svgPt.x >= sRectX && svgPt.x <= sRectX + sRectW &&
      svgPt.y >= sRectY && svgPt.y <= sRectY + sRectH
    ) {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { target: 'sheet', sx: e.clientX, sy: e.clientY, ox: sheetX!, oy: sheetY! }
      return
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { target: 'map', sx: e.clientX, sy: e.clientY, ox: offsetX, oy: offsetY }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) / mmScale
    const dy = (e.clientY - dragRef.current.sy) / mmScale
    if (dragRef.current.target === 'sheet' && onSheetChange) {
      onSheetChange(dragRef.current.ox + dx, dragRef.current.oy + dy)
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
      {/* Page background */}
      <rect x={fullX} y={fullY} width={fullW} height={fullH} fill="white" stroke="#d1d5db" strokeWidth={1} />
      {/* Map image or tint fallback (clipped to printable area) */}
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
      {/* Page frame (printable area) */}
      <rect
        x={frameX} y={frameY}
        width={frameW} height={frameH}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      {/* Controls */}
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
      {/* Description sheet */}
      {hasSheet && (
        <rect
          x={sRectX} y={sRectY}
          width={sRectW} height={sRectH}
          fill="white" fillOpacity={0.85}
          stroke="#ea580c"
          strokeWidth={1.5}
          rx={1}
          style={{ cursor: 'move' }}
        />
      )}
      {hasSheet && (
        <text
          x={sRectX + sRectW / 2} y={sRectY + sRectH / 2 + 3}
          textAnchor="middle" fontSize={8} fill="#ea580c" opacity={0.8}
          style={{ pointerEvents: 'none' }}
        >
          Descriptions
        </text>
      )}
    </svg>
  )
}

// ── Dialog ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function PdfExportDialog({ onClose }: Props) {
  const project = useStore(s => s.project!)
  const loadedMap = useStore(s => s.loadedMap)

  const [pageSize, setPageSize] = useState('a4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [printScale, setPrintScale] = useState(project.map.scale)
  const [scaleInput, setScaleInput] = useState(String(project.map.scale))
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(project.courses.map(c => c.id)),
  )
  const [allControls, setAllControls] = useState(false)
  const [descModes, setDescModes] = useState<Record<string, DescMode>>({})
  const [scaleOverrides, setScaleOverrides] = useState<Record<string, number>>({})
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({})
  const [sheetPositions, setSheetPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [tiling, setTiling] = useState(false)
  const [previewCourseId, setPreviewCourseId] = useState<string | null>(null)
  const [mapOpacity, setMapOpacity] = useState(1)
  const [exporting, setExporting] = useState(false)

  const options: PdfExportOptions = {
    pageSize,
    orientation,
    printScale,
    scaleOverrides,
    courseIds: [...selectedIds],
    allControls,
    descModes,
    offsets,
    sheetPositions,
    tiling,
    mapOpacity,
  }

  const base = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4
  const pw = orientation === 'landscape' ? base.h : base.w
  const ph = orientation === 'landscape' ? base.w : base.h
  const printableW = pw - 2 * MARGIN
  const printableH = ph - 2 * MARGIN

  const fitScale = suggestFitScale(project, [...selectedIds], pageSize, orientation, allControls)
  const fitInfo = checkFit(project, options)
  const tileInfo = checkTiling(project, options)
  const hasSelection = selectedIds.size > 0 || allControls
  const anyOverflow = fitInfo.some(f => !f.fits)
  const descPages = project.courses
    .filter(c => selectedIds.has(c.id) && descModes[c.id] === 'separate')
    .reduce((sum, c) => sum + descriptionSheetPageCount(c, project.controls, ph), 0)
  const totalPages = (tiling
    ? tileInfo.reduce((sum, t) => sum + t.totalPages, 0)
    : fitInfo.length) + descPages
  const scalable = canExportPdf(project.map)

  const previewIds = [
    ...(allControls ? [ALL_CONTROLS_ID] : []),
    ...project.courses.filter(c => selectedIds.has(c.id)).map(c => c.id),
  ]
  const activePreviewId = previewCourseId && previewIds.includes(previewCourseId)
    ? previewCourseId
    : previewIds[0] ?? null
  const activeScale = activePreviewId && activePreviewId 
    ? scaleOverrides[activePreviewId] ?? printScale
    : printScale
  const preview = activePreviewId
    ? coursePreviewMm(project, activePreviewId, activeScale)
    : null
  const mapImage = useMapPreviewBounds(loadedMap, project.map, activeScale)

  const activeOffset = activePreviewId ? offsets[activePreviewId] ?? { x: 0, y: 0 } : { x: 0, y: 0 }
  const hasOffset = activeOffset.x !== 0 || activeOffset.y !== 0

  const previewCourse = activePreviewId && activePreviewId !== ALL_CONTROLS_ID && descModes[activePreviewId] === 'on-map'
    ? project.courses.find(c => c.id === activePreviewId)
    : null
  const sheetSize = previewCourse
    ? descriptionSheetSize(previewCourse, project.controls)
    : null
  const activeSheetPos = activePreviewId ? sheetPositions[activePreviewId] ?? { x: MARGIN, y: MARGIN } : { x: MARGIN, y: MARGIN }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  async function handleExport() {
    setExporting(true)
    try {
      const blob = await exportCoursePdf(project, options, loadedMap)
      downloadBlob(blob, `${project.meta.name.replace(/\s+/g, '_')}_courses.pdf`)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  function toggleCourse(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

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

        {!scalable && (
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
              value={pageSize}
              onChange={e => setPageSize(e.target.value)}
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
                  onClick={() => setOrientation(o)}
                  className={`px-3 text-sm transition-colors ${
                    orientation === o
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
              value={parseInt(scaleInput)}
              onChange={e => setScaleInput(e.target.value)}
              onBlur={() => {
                const v = parseInt(scaleInput)
                if (!isNaN(v) && v > 0) { setPrintScale(v); setScaleInput(String(v)) }
                else setScaleInput(String(printScale))
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            {printScale !== project.map.scale && (
              <button
                onClick={() => { setPrintScale(project.map.scale); setScaleInput(String(project.map.scale)) }}
                className="text-xs text-orange-600 hover:text-orange-800"
              >
                Reset to 1:{parseInt(project.map.scale.toLocaleString())}
              </button>
            )}
            {fitScale && fitScale !== printScale && (
              <button
                onClick={() => { setPrintScale(fitScale); setScaleInput(String(fitScale)) }}
                className="text-xs text-orange-600 hover:text-orange-800"
              >
                Fit to page (1:{parseInt(fitScale.toLocaleString())})
              </button>
            )}
          </div>
        </div>

        {/* Map opacity */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">
            Map opacity
            <span className="text-gray-400 font-normal"> — {Math.round(mapOpacity * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mapOpacity}
            onChange={e => setMapOpacity(parseFloat(e.target.value))}
            className="w-full accent-orange-600"
          />
        </div>

        {/* Tiling */}
        {anyOverflow && hasSelection && (
          <label className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={tiling}
              onChange={e => setTiling(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-700">Tile across multiple pages</span>
              <span className="text-xs text-gray-500 ml-1">(15 mm overlap)</span>
            </div>
          </label>
        )}

        {/* Print frame preview */}
        {preview && hasSelection && activePreviewId && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500">
                Page position
                <span className="text-gray-400 font-normal"> &mdash; drag to reposition</span>
              </label>
              {hasOffset && (
                <button
                  onClick={() => setOffsets(prev => {
                    const next = { ...prev }
                    delete next[activePreviewId]
                    return next
                  })}
                  className="text-xs text-orange-600 hover:text-orange-800"
                >
                  Re-center
                </button>
              )}
            </div>
            {previewIds.length > 1 && (
              <div className="flex gap-1 flex-wrap">
                {previewIds.map(id => {
                  const course = id === ALL_CONTROLS_ID ? null : project.courses.find(c => c.id === id)
                  const label = id === ALL_CONTROLS_ID ? 'All controls' : (course?.name ?? id)
                  const color = id === ALL_CONTROLS_ID ? '#ea580c' : (course?.color ?? '#7B2FBE')
                  const isActive = id === activePreviewId
                  return (
                    <button
                      key={id}
                      onClick={() => setPreviewCourseId(id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-300'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            {activePreviewId  && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Scale:</span>
                <span className="text-xs text-gray-500">1 :</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={scaleOverrides[activePreviewId] != null ? String(scaleOverrides[activePreviewId]) : ''}
                  placeholder={String(parseInt(String(printScale)))}
                  onChange={e => {
                    const raw = e.target.value
                    if (raw === '') {
                      setScaleOverrides(prev => { const next = { ...prev }; delete next[activePreviewId]; return next })
                    } else {
                      const v = parseInt(raw)
                      if (!isNaN(v) && v > 0) setScaleOverrides(prev => ({ ...prev, [activePreviewId]: v }))
                    }
                  }}
                  onBlur={e => {
                    if (e.target.value === '') return
                    const v = parseInt(e.target.value)
                    if (isNaN(v) || v <= 0) setScaleOverrides(prev => { const next = { ...prev }; delete next[activePreviewId]; return next })
                  }}
                  className="w-20 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                />
                {scaleOverrides[activePreviewId] != null && (
                  <button
                    onClick={() => setScaleOverrides(prev => { const next = { ...prev }; delete next[activePreviewId]; return next })}
                    className="text-[11px] text-orange-600 hover:text-orange-800"
                  >
                    Reset to 1:{parseInt(printScale.toLocaleString())}
                  </button>
                )}
              </div>
            )}
            <PrintPreview
              preview={preview}
              pageW={pw}
              pageH={ph}
              printableW={printableW}
              printableH={printableH}
              offsetX={activeOffset.x}
              offsetY={activeOffset.y}
              onOffsetChange={(x, y) => setOffsets(prev => ({ ...prev, [activePreviewId]: { x, y } }))}
              mapImage={mapImage}
              dotColor={activePreviewId === ALL_CONTROLS_ID ? '#ea580c' : (project.courses.find(c => c.id === activePreviewId)?.color ?? '#7B2FBE')}
              {...(sheetSize ? {
                sheetW: sheetSize.width,
                sheetH: sheetSize.height,
                sheetX: activeSheetPos.x,
                sheetY: activeSheetPos.y,
                onSheetChange: (x: number, y: number) => setSheetPositions(prev => ({ ...prev, [activePreviewId]: { x, y } })),
              } : {})}
            />
          </div>
        )}

        {/* Course selection */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-500">
              Courses
              {hasSelection && (
                <span className="text-gray-400 font-normal">
                  {' '}&mdash; {totalPages} {totalPages === 1 ? 'page' : 'pages'} total
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedIds(new Set(project.courses.map(c => c.id)))}
                className="text-xs text-orange-600 hover:text-orange-800"
              >All</button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600"
              >None</button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto">
            {project.controls.length > 0 && (
              <label className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allControls}
                  onChange={e => setAllControls(e.target.checked)}
                  className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
                />
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-orange-600" />
                <span className="text-sm flex-1 truncate">All controls</span>
                {allControls && (() => {
                  const fit = fitInfo.find(f => f.courseId === ALL_CONTROLS_ID)
                  const tile = tileInfo.find(t => t.courseId === ALL_CONTROLS_ID)
                  if (!fit) return null
                  return (
                    <span className={`text-xs shrink-0 ${
                      fit.fits ? 'text-green-600'
                        : tiling ? 'text-blue-600'
                        : 'text-amber-600'
                    }`}>
                      {fit.fits
                        ? 'fits'
                        : tiling && tile
                          ? `${tile.cols}×${tile.rows} pages`
                          : `${Math.round(fit.widthMm)}×${Math.round(fit.heightMm)} mm`}
                    </span>
                  )
                })()}
              </label>
            )}
            {project.courses.length === 0 && !allControls ? (
              <div className="px-4 py-3 text-sm text-gray-400">No courses to export</div>
            ) : (
              project.courses.map(course => {
                const fit = fitInfo.find(f => f.courseId === course.id)
                const tile = tileInfo.find(t => t.courseId === course.id)
                const checked = selectedIds.has(course.id)
                const courseScale = scaleOverrides[course.id]
                return (
                  <div key={course.id} className="hover:bg-gray-50">
                    <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCourse(course.id)}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
                      />
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ background: course.color }}
                      />
                      <span className="text-sm flex-1 truncate">{course.name}</span>
                      {checked && (
                        <select
                          value={descModes[course.id] ?? 'none'}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            e.stopPropagation()
                            setDescModes(prev => ({ ...prev, [course.id]: e.target.value as DescMode }))
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
                            : tiling ? 'text-blue-600'
                            : 'text-amber-600'
                        }`}>
                          {fit.fits
                            ? `fits${courseScale ? ` (1:${courseScale.toLocaleString()})` : ''}`
                            : tiling && tile
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
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium">Set all descriptions:</span>
            {([['none', 'None'], ['separate', '+ page'], ['on-map', 'On map']] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => {
                  const next: Record<string, DescMode> = { ...descModes }
                  for (const id of selectedIds) next[id] = mode
                  setDescModes(next)
                }}
                className="px-2 py-1 rounded text-xs text-gray-500 hover:bg-orange-50 hover:text-orange-700 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {anyOverflow && !tiling && hasSelection && (
          <p className="text-xs text-amber-600">
            {fitScale
              ? `Some courses exceed the printable area at this scale. Use "Fit to page" above for 1:${fitScale.toLocaleString()}, or enable tiling.`
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
            onClick={handleExport}
            disabled={!hasSelection || !scalable || exporting}
            className="flex-1 bg-orange-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
