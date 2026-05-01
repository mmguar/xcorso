import { useRef, useState } from 'react'
import { useStore } from '../store'
import {
  exportCoursePdf, checkFit, checkTiling, canExportPdf, PAGE_SIZES, MARGIN,
  suggestFitScale, coursePreviewMm, ALL_CONTROLS_ID,
} from '../lib/pdfExport'
import type { PdfExportOptions, CoursePreview } from '../lib/pdfExport'
import { descriptionSheetPageCount } from '../lib/pdfDescriptionSheet'
import { downloadBlob } from '../lib/projectFile'

// ── Print frame preview ────────────────────────────────────────────────────

function PrintPreview({
  preview,
  printableW,
  printableH,
  offsetX,
  offsetY,
  onOffsetChange,
}: {
  preview: CoursePreview
  printableW: number
  printableH: number
  offsetX: number
  offsetY: number
  onOffsetChange: (x: number, y: number) => void
}) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

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

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offsetX, oy: offsetY }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.sx) / mmScale
    const dy = (e.clientY - dragRef.current.sy) / mmScale
    onOffsetChange(dragRef.current.ox + dx, dragRef.current.oy + dy)
  }

  function handlePointerUp() {
    dragRef.current = null
  }

  return (
    <svg
      viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
      className="w-full border border-gray-200 rounded-xl bg-gray-100 select-none touch-none cursor-grab active:cursor-grabbing"
      style={{ maxHeight: 180 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Page frame */}
      <rect
        x={frameX} y={frameY}
        width={frameW} height={frameH}
        fill="white"
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
          fill="#7c3aed"
          opacity={0.7}
        />
      ))}
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(project.courses.map(c => c.id)),
  )
  const [allControls, setAllControls] = useState(false)
  const [includeDescriptions, setIncludeDescriptions] = useState(false)
  const [tiling, setTiling] = useState(false)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [mapOpacity, setMapOpacity] = useState(1)
  const [exporting, setExporting] = useState(false)

  const options: PdfExportOptions = {
    pageSize,
    orientation,
    printScale,
    courseIds: [...selectedIds],
    allControls,
    includeDescriptions,
    tiling,
    offsetX,
    offsetY,
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
  const descPages = includeDescriptions
    ? project.courses
        .filter(c => selectedIds.has(c.id))
        .reduce((sum, c) => sum + descriptionSheetPageCount(c, project.controls, ph), 0)
    : 0
  const totalPages = (tiling
    ? tileInfo.reduce((sum, t) => sum + t.totalPages, 0)
    : fitInfo.length) + descPages
  const scalable = canExportPdf(project.map)

  const previewId = allControls ? ALL_CONTROLS_ID : [...selectedIds][0]
  const preview = previewId
    ? coursePreviewMm(project, previewId, printScale)
    : null

  const hasOffset = offsetX !== 0 || offsetY !== 0

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
              type="number"
              value={printScale}
              min={1}
              onChange={e => {
                const v = parseInt(e.target.value)
                if (!isNaN(v) && v > 0) setPrintScale(v)
              }}
              className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            {printScale !== project.map.scale && (
              <button
                onClick={() => setPrintScale(project.map.scale)}
                className="text-xs text-orange-600 hover:text-orange-800"
              >
                Reset to 1:{project.map.scale.toLocaleString()}
              </button>
            )}
            {fitScale && fitScale !== printScale && (
              <button
                onClick={() => setPrintScale(fitScale)}
                className="text-xs text-orange-600 hover:text-orange-800"
              >
                Fit to page (1:{fitScale.toLocaleString()})
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
        {preview && hasSelection && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500">
                Page position
                <span className="text-gray-400 font-normal"> &mdash; drag to reposition</span>
              </label>
              {hasOffset && (
                <button
                  onClick={() => { setOffsetX(0); setOffsetY(0) }}
                  className="text-xs text-orange-600 hover:text-orange-800"
                >
                  Re-center
                </button>
              )}
            </div>
            <PrintPreview
              preview={preview}
              printableW={printableW}
              printableH={printableH}
              offsetX={offsetX}
              offsetY={offsetY}
              onOffsetChange={(x, y) => { setOffsetX(x); setOffsetY(y) }}
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
                return (
                  <label
                    key={course.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                  >
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
                    {fit && checked && (
                      <span className={`text-xs shrink-0 ${
                        fit.fits ? 'text-green-600'
                          : tiling ? 'text-blue-600'
                          : 'text-amber-600'
                      }`}>
                        {fit.fits
                          ? 'fits'
                          : tiling && tile
                            ? `${tile.cols}×${tile.rows} pages`
                            : `${Math.round(fit.widthMm)}×${Math.round(fit.heightMm)} mm (page: ${Math.round(fit.printableW)}×${Math.round(fit.printableH)})`}
                      </span>
                    )}
                  </label>
                )
              })
            )}
          </div>
        </div>

        {/* Description sheets */}
        {selectedIds.size > 0 && (
          <label className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDescriptions}
              onChange={e => setIncludeDescriptions(e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
            />
            <span className="text-sm font-medium text-gray-700">Include control description sheets</span>
          </label>
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
