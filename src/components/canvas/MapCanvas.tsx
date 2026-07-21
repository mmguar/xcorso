import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { useRenderTracker } from '../../lib/perf'
import { MapCanvasLayer } from './MapCanvasLayer'
import { MapLayer } from './MapLayer'
import { FpsCounter } from './FpsCounter'
import { ControlsLayer } from './ControlsLayer'
import { LegsLayer } from './LegsLayer'
import { AllCoursesLegsLayer } from './AllCoursesLegsLayer'
import { AllCoursesLegend } from './AllCoursesLegend'
import { DragLegsLayer } from './DragLegsLayer'
import type { DragLegsHandle } from './DragLegsLayer'
import { AnnotationsLayer } from './AnnotationsLayer'
import { MeasureLayer } from './MeasureLayer'
import { northArrowHeight, northArrowGeometry, crossingPointTotalHH } from '../../lib/symbolGeometry'
import { OverlaysLayer } from './OverlaysLayer'
import { PageOverlay } from './PageOverlay'
import type { LoadedMap } from '../../lib/mapLoader'
import { rasterizeSvgOverprint } from '../../lib/mapLoader'
import { ScaleInputDialog } from '../ScaleInputDialog'
import { unitsPerMm, resolveVariation, defaultLabelOffset, buildSequenceMap, formatSequenceLabel, defaultControlLabel, computeSubmaps, submapLayoutView, IOF_PURPLE } from '../../lib/courseUtils'
import type { AnnotationType, MapPoint, Viewport, Control, MapConfig, AppearanceSettings, EventSpec, Course } from '../../types'
import { resolveSpec, getSymbolDims, symbolScaleFactor, getAnnotationDims, controlSymbolRadiusMm } from '../../lib/symbolSpec'
import { PAGE_SIZES, mmToMap, clueSheetHiddenRestartView } from '../../lib/pdfExport'
import { descriptionSheetSize, descriptionSheetPartSizes } from '../../lib/pdfDescriptionSheet'
import {
  screenToMap, pxToMap,
  findControlAt, findBendPointAt, findMarkedRouteEndAt, findMapIssueAt,
  findMeasureLegAt, findMeasurePointAt,
  findAnnotationAt, findOverlayAt, findLabelAt,
  findCrossingPointRotationHandle, findCrossingPointResizeHandle, findNorthArrowRotationHandle, findNorthArrowResizeHandle, findOobVertexHandle,
} from './hitTesting'

/** Effective print scale for overlay sizing: the active layout submap's scale
 * in layout mode, else the project-wide layout default. Undefined → map scale.
 * Must match the printScaleOverride passed to OverlaysLayer. */
function overlayPrintScaleOf(st: ReturnType<typeof useStore.getState>): number | undefined {
  const proj = st.project!
  if (st.editor.layoutMode && st.editor.layoutCourseId) {
    const lc = proj.courses.find(c => c.id === st.editor.layoutCourseId)
    if (lc?.layout) return (submapLayoutView(lc.layout, st.editor.layoutSubmapIndex) ?? lc.layout).printScale
  }
  return proj.layoutDefaults?.printScale
}

/** Map units per mm for overlay geometry, adjusted like OverlaysLayer so hit
 * boxes and handles line up with what is rendered. */
function overlayUpmOf(st: ReturnType<typeof useStore.getState>): number {
  const proj = st.project!
  const upm = unitsPerMm(proj.map)
  const ps = overlayPrintScaleOf(st)
  return ps ? upm * ps / proj.map.scale : upm
}

/** Whether this submap's clue sheet gets a trailing map-flip row — must match
 * the export's logic (pdfExport) so on-map preview boxes size identically. */
function layoutTrailingFlip(course: Course, submapIndex: number): boolean {
  const submaps = computeSubmaps(course)
  if (submaps.length <= 1 || submapIndex >= submaps.length - 1) return false
  const controls = submaps[submapIndex]?.controls
  const mode = controls?.[controls.length - 1]?.exchangeMode
  return mode === 'flip' || mode === 'exchange'
}

/** Clue-sheet course + breaks exactly as the export prints them: the submap's
 * control slice, minus the restart row (with shifted breaks) when
 * project.clueSheetHideSubmapRestart is set. */
function clueSheetPreviewView(course: Course, submapIndex: number, hideRestart: boolean, breaks: number[] | undefined): { course: Course; breaks: number[] | undefined } {
  const submaps = computeSubmaps(course)
  const isSub = submaps.length > 1 && submaps[submapIndex] != null
  let controls = isSub ? submaps[submapIndex].controls : course.controls
  if (isSub && submapIndex > 0 && hideRestart) {
    ;({ controls, breaks } = clueSheetHiddenRestartView(controls, breaks))
  }
  return { course: controls === course.controls ? course : { ...course, controls }, breaks }
}
import type { MeasurePointHit } from './hitTesting'
import { handleGapTap, handleGapRebuildTap, handleGapRightClick, handleBendTap, handleBendRightClick } from './toolHandlers'
import { computeCourseDistances, resolveCourseLength, formatDistance, legKey } from '../../lib/distance'
import { projectOnPolyline, flattenSmooth } from '../../lib/geometry'

const TAP_PX    = 8
const MIN_SCALE = 0.05
const MAX_SCALE = 50
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function MapScaleInput({ scale }: { scale: number }) {
  const [value, setValue] = useState(String(scale))
  const prevScale = useRef(scale)
  if (scale !== prevScale.current) { // eslint-disable-line react-hooks/refs -- sync prop→state
    prevScale.current = scale // eslint-disable-line react-hooks/refs
    setValue(String(scale))
  }
  function commit() {
    const v = parseInt(value)
    if (v > 0 && isFinite(v) && v !== scale) {
      useStore.getState().setMapScale(v, 'manual')
    } else {
      setValue(String(scale))
    }
  }
  return (
    <>
      <div className="w-px h-4 bg-gray-300" />
      <span className="text-[10px] text-gray-400 select-none">1:</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-14 px-1 py-0.5 text-[11px] border border-gray-200 rounded focus:border-orange-400 focus:outline-none bg-white tabular-nums"
      />
    </>
  )
}

function LayoutScaleLabel({ printScale, mapScale }: { printScale: number; mapScale: number }) {
  const mismatch = printScale !== mapScale
  return (
    <>
      <div className="w-px h-4 bg-gray-300" />
      <span className={`text-[11px] select-none tabular-nums ${mismatch ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
        1:{printScale}
      </span>
    </>
  )
}

function MeasureBanner({ total }: { total: number }) {
  const t = useT()
  return (
    <div className="absolute top-[var(--ui-top)] left-1/2 -translate-x-1/2 flex items-center gap-3 bg-teal-700/90 text-white text-sm px-3 py-1.5 rounded-full shadow z-10">
      <span className="font-medium">{formatDistance(total)}</span>
      <span className="text-teal-100 text-xs hidden sm:inline md:hidden">{t('measure.hintTouch')}</span>
      <span className="text-teal-100 text-xs hidden md:inline">{t('measure.hintDesktop')}</span>
      <button
        onClick={() => useStore.getState().exitMeasureMode()}
        className="bg-white/20 hover:bg-white/30 transition-colors rounded-full px-2.5 py-0.5 text-xs font-semibold"
      >
        {t('measure.done')}
      </button>
    </div>
  )
}

function MeasureLegPanel({ course, controls }: { course: Course; controls: Control[] }) {
  const t = useT()
  const hidden = useStore(s => s.editor.measureHiddenLegs)
  const toggleMeasureLeg = useStore(s => s.toggleMeasureLeg)
  const setMeasureHiddenLegs = useStore(s => s.setMeasureHiddenLegs)
  const hiddenSet = new Set(hidden)

  const seqMap = course.type === 'linear' ? buildSequenceMap(course, controls) : null
  const cm = new Map(controls.map(c => [c.id, c]))
  const label = (id: string): string => {
    const c = cm.get(id)
    if (!c) return '?'
    if (seqMap && c.type === 'control') {
      const s = seqMap.get(id)
      return s ? formatSequenceLabel(s) : defaultControlLabel(c)
    }
    return defaultControlLabel(c)
  }

  // One row per distinct leg (repeated legs in a loop share a checkbox).
  const legs: { key: string; from: string; to: string }[] = []
  const seen = new Set<string>()
  for (let i = 1; i < course.controls.length; i++) {
    const fromId = course.controls[i - 1].controlId
    const toId = course.controls[i].controlId
    const key = legKey(fromId, toId)
    if (seen.has(key)) continue
    seen.add(key)
    legs.push({ key, from: label(fromId), to: label(toId) })
  }
  if (legs.length === 0) return null

  const allKeys = legs.map(l => l.key)
  const allShown = hidden.length === 0

  return (
    <div data-ui-panel className="absolute top-[var(--ui-top)] right-2 w-40 max-h-[60vh] flex flex-col bg-white/90 backdrop-blur-sm rounded-lg shadow border border-gray-200 z-10 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-100">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{t('measure.legs')}</span>
        <button
          onClick={() => setMeasureHiddenLegs(allShown ? allKeys : [])}
          className="text-[10px] font-medium text-teal-700 hover:text-teal-900"
        >
          {allShown ? t('measure.hideAll') : t('measure.showAll')}
        </button>
      </div>
      <div className="overflow-y-auto panel-scroll py-1">
        {legs.map(l => (
          <div
            key={l.key}
            onClick={() => toggleMeasureLeg(l.key)}
            className="flex items-center gap-2 px-2 py-0.5 text-xs text-gray-600 cursor-pointer hover:bg-gray-50 select-none"
          >
            <input
              type="checkbox"
              checked={!hiddenSet.has(l.key)}
              readOnly
              tabIndex={-1}
              className="accent-orange-600 pointer-events-none"
            />
            <span className="tabular-nums">{l.from} → {l.to}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DebugHitboxes({ controls, map, vp, selectedCourseId, appearance, projectSpec }: {
  controls: Control[]
  map: MapConfig
  vp: Viewport
  selectedCourseId: string | null
  appearance: AppearanceSettings
  projectSpec?: EventSpec
}) {
  const project = useStore(s => s.project!)
  const upm = unitsPerMm(map)
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  const spec = resolveSpec(projectSpec, course?.spec)
  const dims = getSymbolDims(spec)
  const controlScale = appearance.controlScale
  const sf = symbolScaleFactor(spec, map.scale)

  const seqMap = course?.type === 'linear' ? buildSequenceMap(course, project.controls) : null

  return (
    <g style={{ pointerEvents: 'none' }}>
      {controls.map(c => {
        const symbolR = controlSymbolRadiusMm(c.type, dims) * upm * sf * controlScale
        return (
          <circle key={`hit-${c.id}`} cx={c.position.x} cy={c.position.y} r={symbolR}
            fill="rgba(255,255,0,0.15)" stroke="rgba(255,255,0,0.5)" strokeWidth={pxToMap(1, vp)} />
        )
      })}
      {project.annotations.filter(a => a.type === 'crossing_point').map(ann => {
        const p = ann.points[0]
        if (!p) return null
        const annSf = sf * upm
        const d = getAnnotationDims(annSf)
        const handleR = 1 * upm * sf
        const rotation = (ann.rotation ?? 0) * Math.PI / 180
        const totalHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
        const handleLocalY = -(totalHH + handleR * 2)
        const handleX = p.x - handleLocalY * Math.sin(rotation)
        const handleY = p.y + handleLocalY * Math.cos(rotation)
        const resizeLocalY = totalHH + handleR * 2
        const resizeX = p.x - resizeLocalY * Math.sin(rotation)
        const resizeY = p.y + resizeLocalY * Math.cos(rotation)
        return (
          <g key={`ann-${ann.id}`}>
            <circle cx={p.x} cy={p.y} r={totalHH}
              fill="rgba(255,0,255,0.1)" stroke="rgba(255,0,255,0.5)" strokeWidth={pxToMap(1, vp)} />
            <circle cx={handleX} cy={handleY} r={handleR}
              fill="rgba(255,128,0,0.1)" stroke="rgba(255,128,0,0.5)" strokeWidth={pxToMap(1, vp)} />
            <circle cx={resizeX} cy={resizeY} r={handleR}
              fill="rgba(0,128,255,0.1)" stroke="rgba(0,128,255,0.5)" strokeWidth={pxToMap(1, vp)} />
          </g>
        )
      })}
      {controls.map(c => {
        const cc = course?.controls.find(cc => cc.controlId === c.id)
        const offset = cc?.labelOffset ?? c.labelOffset ?? defaultLabelOffset(c.type, upm, controlScale, spec, map.scale)
        const lx = c.position.x + offset.x
        const ly = c.position.y + offset.y
        const fontSize = dims.labelH * upm * controlScale * sf
        let labelText: string
        if (seqMap && c.type === 'control') {
          const seqs = seqMap.get(c.id)
          labelText = seqs ? formatSequenceLabel(seqs) : defaultControlLabel(c)
        } else {
          labelText = defaultControlLabel(c)
        }
        const textW = labelText.length * fontSize * 0.6
        const textH = fontSize * 0.75
        return (
          <rect key={`lhit-${c.id}`}
            x={lx} y={ly - textH}
            width={textW} height={textH}
            fill="rgba(255,255,0,0.15)" stroke="rgba(255,255,0,0.5)" strokeWidth={pxToMap(1, vp)} />
        )
      })}
    </g>
  )
}

interface Props { loadedMap: LoadedMap }

export function MapCanvas({ loadedMap }: Props) {
  useRenderTracker('MapCanvas')
  const divRef = useRef<HTMLDivElement>(null)

  const [vp, setVpState] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
    const vpRef = useRef<Viewport>(vp)
  const fitScaleRef = useRef<number>(MIN_SCALE)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const hdSvgRef = useRef<SVGSVGElement>(null)
  const hdMapGRef = useRef<SVGGElement>(null)
  const overlayGRef = useRef<SVGGElement>(null)
  const overlayMultGRef = useRef<SVGGElement>(null)
  const courseGRef = useRef<SVGGElement>(null)
  const courseMultGRef = useRef<SVGGElement>(null)
  const topOverlayGRef = useRef<SVGGElement>(null)
  const aboveBorderGRef = useRef<SVGGElement>(null)
  const dragLegsRef = useRef<DragLegsHandle>(null)
  const rectCacheRef = useRef<DOMRect | null>(null)
  const canvasPixelRef = useRef<[number, number]>([1, 1])

  const layoutPanningRef = useRef(false)
  const pageOverlayRef = useRef<HTMLDivElement>(null)
  // Viewport the PageOverlay was last rendered with — syncTransform applies the
  // delta to the live viewport so the page frame tracks wheel zoom per-frame
  // instead of snapping into place on idle.
  const pageOverlayVpRef = useRef<Viewport>(vp)
  // The native-listener effect below runs with [] deps, so any handler it keeps
  // alive sees the first render's closure. Route loadedMap through a ref so the
  // captured syncTransform still uses the current bounds after "Replace map".
  // (Updated in a layout effect declared before useLayoutEffect(syncTransform),
  // so the post-render sync always sees the fresh bounds first.)
  const loadedMapRef = useRef(loadedMap)
  useLayoutEffect(() => { loadedMapRef.current = loadedMap }, [loadedMap])
  function syncTransform() {
    const v = vpRef.current
    const t = `translate(${v.x}px,${v.y}px) scale(${v.scale})`
    if (mapDivRef.current) {
      const [cpw, cph] = canvasPixelRef.current
      const b = loadedMapRef.current.bounds
      mapDivRef.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.scale}) translate(${b.minX}px,${b.minY}px) scale(${b.width / cpw},${b.height / cph})`
    }
    if (hdMapGRef.current) hdMapGRef.current.style.transform = t
    if (overlayGRef.current) overlayGRef.current.style.transform = t
    if (overlayMultGRef.current) overlayMultGRef.current.style.transform = t
    if (courseGRef.current) courseGRef.current.style.transform = t
    if (courseMultGRef.current) courseMultGRef.current.style.transform = t
    if (topOverlayGRef.current) topOverlayGRef.current.style.transform = t
    // In layout mode during a map pan, overlays are page-relative — freeze them
    // so they don't slide with the map. setLayoutMapCenter shifts their map coords
    // on pointer-up, and the post-render syncTransform applies the final transform.
    if (aboveBorderGRef.current && !layoutPanningRef.current) aboveBorderGRef.current.style.transform = t
    // Same freeze rule for the page overlay. It renders in screen space from the
    // React vp state, so map it to the live viewport with the delta transform —
    // during centre-anchored layout zoom this scales the page frame in step with
    // the map; the post-render sync resets it to identity.
    if (pageOverlayRef.current && !layoutPanningRef.current) {
      const v0 = pageOverlayVpRef.current
      const k = v.scale / v0.scale
      pageOverlayRef.current.style.transform = `translate(${v.x - k * v0.x}px,${v.y - k * v0.y}px) scale(${k})`
    }
  }
  function setVp(next: Viewport) {
    vpRef.current = next
    setVpState(next)
  }

  // ── Store ──────────────────────────────────────────────────────────────────
  const controls = useStore(s => s.project!.controls)
  const courses = useStore(s => s.project!.courses)
  const projectRevision = useStore(s => s.projectRevision)
  const annotations = useStore(s => s.project!.annotations)
  const map = useStore(s => s.project!.map)
  const scaleBars = useStore(s => s.project!.scaleBars)
  const textLabels = useStore(s => s.project!.textLabels)
  const imageOverlays = useStore(s => s.project!.imageOverlays)
  const projectSpec = useStore(s => s.project!.spec)
  const activeTool = useStore(s => s.editor.activeTool)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const courseViewMode = useStore(s => s.editor.courseViewMode)
  const isAllCoursesView = courseViewMode === 'all-courses'
  const allCoursesHidden = useStore(s => s.editor.allCoursesHidden)
  const selectedOverlayId = useStore(s => s.editor.selectedOverlayId)
  const selectedAnnotationId = useStore(s => s.editor.selectedAnnotationId)
  const appearance = useStore(s => s.editor.appearance)
  const pendingAnnotationPoints = useStore(s => s.editor.pendingAnnotationPoints)
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const measureMode = useStore(s => s.editor.measureMode)
  const measureCourseId = useStore(s => s.editor.measureCourseId)
  const measureHiddenLegs = useStore(s => s.editor.measureHiddenLegs)
  const measuredLegs = useStore(s => s.project!.measuredLegs)
  const clueSheetFontSize = useStore(s => s.project!.clueSheetFontSize)
const clueSheetHideSubmapRestart = useStore(s => s.project!.clueSheetHideSubmapRestart ?? false)
const layoutDefaultPrintScale = useStore(s => s.project!.layoutDefaults?.printScale)
  const layoutMode = useStore(s => s.editor.layoutMode)
  const layoutCourseId = useStore(s => s.editor.layoutCourseId)
  const layoutSubmapIndex = useStore(s => s.editor.layoutSubmapIndex)
  const layoutSnapRequest = useStore(s => s.editor.layoutSnapRequest)
  const layoutCourse = useStore(s => {
    if (!s.editor.layoutCourseId) return null
    return s.project?.courses.find(c => c.id === s.editor.layoutCourseId) ?? null
  })

  const [useRaster, setUseRaster] = useState(true)
  const mapOverprint = useStore(s => s.project?.layoutDefaults?.mapOverprint ?? false)
  // Overprint-simulated raster, generated lazily when the option is enabled.
  // Only meaningful for OCAD (svg) maps in raster mode; HD/vector shows as usual.
  // The render gates on `mapOverprint` too, so a stale url here is never shown.
  const [overprintRasterUrl, setOverprintRasterUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!mapOverprint || loadedMap.type !== 'svg') return
    let cancelled = false
    let url: string | undefined
    rasterizeSvgOverprint(loadedMap.content as SVGElement, loadedMap.bounds).then(u => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return }
      url = u
      setOverprintRasterUrl(u ?? null)
    })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [mapOverprint, loadedMap])
  const [measureStart, setMeasureStart] = useState<MapPoint | null>(null)
  const measureStartRef = useRef<MapPoint | null>(null)
  const [scaleDialogPoints, setScaleDialogPoints] = useState<{ p1: MapPoint; p2: MapPoint } | null>(null)
  // A half-finished calibration must not survive a tool switch — the stale
  // first point would silently pair with the next measure-scale click.
  useEffect(() => {
    if (activeTool !== 'measure-scale' && measureStartRef.current) {
      measureStartRef.current = null
      setMeasureStart(null)
      setScaleDialogPoints(null)
    }
  }, [activeTool])
  // After dropping a control that is shared across courses, offer to split it
  // off into a new control for the selected course (see the drag-commit path).
  const [splitPrompt, setSplitPrompt] = useState<
    { controlId: string; courseId: string; courseName: string; courseCount: number; newPos: MapPoint; origPos: MapPoint; sx: number; sy: number } | null
  >(null)
  const gapRingRef = useRef<SVGGElement>(null)
  const [oobCursorPoint, setOobCursorPoint] = useState<MapPoint | null>(null)

  // ponytail: dismiss split prompt on any interaction outside it or any store change
  useEffect(() => {
    if (!splitPrompt) return
    const dismiss = () => setSplitPrompt(null)
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-split-prompt]')) return
      dismiss()
    }
    document.addEventListener('pointerdown', onDown, true)
    const unsub = useStore.subscribe(dismiss)
    return () => { document.removeEventListener('pointerdown', onDown, true); unsub() }
  }, [splitPrompt])

  // ── Fit to screen on map load ──────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    canvasPixelRef.current = [1, 1]
    const { width, height } = el.getBoundingClientRect()
    const mw = loadedMap.bounds.width
    const mh = loadedMap.bounds.height
    const scale = Math.min((width * 0.9) / mw, (height * 0.9) / mh)
    fitScaleRef.current = scale * 0.5
    setVp({
      x: (width - mw * scale) / 2 - loadedMap.bounds.minX * scale,
      y: (height - mh * scale) / 2 - loadedMap.bounds.minY * scale,
      scale,
    })
  }, [loadedMap])

  // ── Snap viewport to layout page ────────────────────────────────────────
  // useLayoutEffect (not useEffect) so the re-centre is flushed before paint —
  // otherwise undo/redo paints one frame with the restored mapCenter but the old
  // viewport, which shows as a page jump before the correction lands.
  const prevLayoutRef = useRef<{ courseId: string | null; printScale: number; pageSize: string; orientation: string; snap: number } | null>(null)
  useLayoutEffect(() => {
    if (!layoutMode || !layoutCourse?.layout) {
      prevLayoutRef.current = null
      return
    }
    const layout = submapLayoutView(layoutCourse.layout, layoutSubmapIndex) ?? layoutCourse.layout
    // Re-fit/recenter only when the page or scale changes, or on an explicit snap
    // request (entering layout mode, switching submap, and after undo/redo — see
    // store undo/redo). Plain map moves update mapCenter silently and keep the
    // viewport in sync, so they intentionally don't re-trigger this.
    const key = { courseId: layoutCourseId, printScale: layout.printScale, pageSize: layout.pageSize, orientation: layout.orientation, snap: layoutSnapRequest }
    const prev = prevLayoutRef.current
    if (prev && prev.courseId === key.courseId && prev.printScale === key.printScale && prev.pageSize === key.pageSize && prev.orientation === key.orientation && prev.snap === key.snap) return
    prevLayoutRef.current = key

    const el = divRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const { width, height } = rect
    // On mobile the panel overlaps the canvas top — fit and center the page in
    // the visible strip below it (same compensation as the centerRequest path).
    const mp = document.querySelector<HTMLElement>('[data-mobile-panel]')
    const overlap = mp ? Math.max(0, mp.getBoundingClientRect().bottom - rect.top) : 0

    const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
    const pageW = layout.orientation === 'landscape' ? base.h : base.w
    const pageH = layout.orientation === 'landscape' ? base.w : base.h
    const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, map, layout.printScale).x
    const halfHMap = mmToMap({ x: 0, y: pageH / 2 }, map, layout.printScale).y
    const pageWidthMapUnits = halfWMap * 2
    const pageHeightMapUnits = halfHMap * 2

    const desiredScale = Math.min(
      (width * 0.85) / pageWidthMapUnits,
      ((height - overlap) * 0.85) / pageHeightMapUnits,
    )
    setVp({
      x: width / 2 - layout.mapCenter.x * desiredScale,
      y: (overlap + height) / 2 - layout.mapCenter.y * desiredScale,
      scale: desiredScale,
    })
  }, [layoutMode, layoutCourseId, layoutSubmapIndex, layoutCourse, map, layoutSnapRequest])

  useEffect(() => {
    if (!layoutMode) return
    let timer: ReturnType<typeof setTimeout>
    function snap() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        useStore.setState(s => ({ editor: { ...s.editor, layoutSnapRequest: s.editor.layoutSnapRequest + 1 } }))
      }, 200)
    }
    // Observe the canvas div (covers window resize AND the desktop side panel
    // opening/closing — they're flex siblings) plus the mobile panel, which
    // overlays the canvas without resizing it.
    const ro = new ResizeObserver(snap)
    if (divRef.current) ro.observe(divRef.current)
    const mp = document.querySelector<HTMLElement>('[data-mobile-panel]')
    if (mp) ro.observe(mp)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [layoutMode])

  // ── Pan to a requested control (sidebar / clue sheet click) ──────────────
  const centerRequest = useStore(s => s.editor.centerRequest)
  useLayoutEffect(() => {
    if (!centerRequest) return
    const el = divRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.width / 2
    let cy = rect.height / 2
    // On mobile, the panel overlaps the canvas top — shift center into visible area
    const mp = document.querySelector<HTMLElement>('[data-mobile-panel]')
    if (mp) {
      const overlap = Math.max(0, mp.getBoundingClientRect().bottom - rect.top)
      cy = (overlap + rect.height) / 2
    }
    const v = vpRef.current
    setVp({ ...v, x: cx - centerRequest.point.x * v.scale, y: cy - centerRequest.point.y * v.scale })
  }, [centerRequest])

  // Keep <g> transforms in sync after any React re-render
  useLayoutEffect(syncTransform)

  // ── Cache bounding rect via ResizeObserver ─────────────────────────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    rectCacheRef.current = el.getBoundingClientRect()
    const ro = new ResizeObserver(() => { rectCacheRef.current = el.getBoundingClientRect() })
    ro.observe(el)
    const onScroll = () => { rectCacheRef.current = el.getBoundingClientRect() }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { ro.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])

  // ── All native event listeners in one place ────────────────────────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    const div = el

    const pos  = new Map<number, { x: number; y: number }>()
    const down = new Map<number, { x: number; y: number }>()
    let pinchDist = 0
    // True from the moment a second pointer joins the gesture until every
    // pointer lifts — suppresses tap actions for accidental multi-finger taps.
    let multiTouch = false
    let vpDirty = false
    let wheelTimer: ReturnType<typeof setTimeout> | null = null
    let pendingRaf = 0

    function getRect(): DOMRect {
      return rectCacheRef.current ?? div.getBoundingClientRect()
    }

    let dragControlId: string | null = null
    let dragOffset: { dx: number; dy: number } | null = null
    let dragStarted = false
    let dragOrigPos: { x: number; y: number } | null = null
    // The dragged control is rendered in both the solid and multiply overprint
    // passes; transform every copy so they move together.
    let dragControlEls: SVGGElement[] = []
    let pendingControlPos: { x: number; y: number } | null = null
    let pendingControlRaf = 0

    // Non-control drags mutate the store on every pointermove; touch/Pencil can
    // deliver 120 events/s and each set re-renders every canvas layer. Coalesce
    // to one mutation per frame (latest wins), flushed on pointerup/cancel
    // before drag state is reset.
    let pendingDragMutation: (() => void) | null = null
    let pendingDragMutationRaf = 0
    function scheduleDragMutation(fn: () => void) {
      pendingDragMutation = fn
      if (!pendingDragMutationRaf) {
        pendingDragMutationRaf = requestAnimationFrame(() => {
          pendingDragMutationRaf = 0
          const run = pendingDragMutation
          pendingDragMutation = null
          run?.()
        })
      }
    }
    function flushDragMutation() {
      if (pendingDragMutationRaf) { cancelAnimationFrame(pendingDragMutationRaf); pendingDragMutationRaf = 0 }
      const run = pendingDragMutation
      pendingDragMutation = null
      run?.()
    }

    // Commit the previewed border rect (drag/resize) to the project on pointerup.
    function commitBorderDrag(rect: { x: number; y: number; width: number; height: number } | null) {
      const st = useStore.getState()
      st.setLayoutDragPreview(null)
      if (!rect || !st.editor.layoutCourseId) return
      const smIdx = st.editor.layoutSubmapIndex
      const course = st.project?.courses.find(c => c.id === st.editor.layoutCourseId)
      const layout = course?.layout ? submapLayoutView(course.layout, smIdx) : undefined
      if (!layout?.mapBorder) return
      st.moveCourseLayout(st.editor.layoutCourseId, { mapBorder: { ...layout.mapBorder, ...rect } }, smIdx)
    }

    // Adopt the map point under the canvas center as the layout's mapCenter —
    // shared by pointerup (pan/pinch end) and wheel-zoom idle in layout mode.
    // Must match the snap effect's page position, including the mobile-panel
    // overlap compensation, or each pan would nudge the page.
    function commitLayoutMapCenter() {
      const st = useStore.getState()
      if (!st.editor.layoutMode || !st.editor.layoutCourseId) return
      const rect = getRect()
      const mp = document.querySelector<HTMLElement>('[data-mobile-panel]')
      const overlap = mp ? Math.max(0, mp.getBoundingClientRect().bottom - rect.top) : 0
      const v = vpRef.current
      const centerX = (rect.width / 2 - v.x) / v.scale
      const centerY = ((overlap + rect.height) / 2 - v.y) / v.scale
      const course = st.project?.courses.find(c => c.id === st.editor.layoutCourseId)
      const oldCenter = course?.layout ? submapLayoutView(course.layout, st.editor.layoutSubmapIndex)?.mapCenter : null
      if (!oldCenter || Math.abs(centerX - oldCenter.x) > 1 || Math.abs(centerY - oldCenter.y) > 1) {
        st.beginLayoutDrag()
        st.setLayoutMapCenter(st.editor.layoutCourseId, { x: centerX, y: centerY }, st.editor.layoutSubmapIndex)
      }
    }

    let dragBend: { courseId: string; courseControlId: string; bendIndex: number; nav?: boolean } | null = null
    let dragBendStarted = false

    let dragMRE: { courseId: string; courseControlId: string } | null = null
    let dragMREStarted = false

    let dragMapIssue: { courseId: string; courseControlId: string } | null = null
    let dragMapIssueStarted = false

    let dragMeasure: MeasurePointHit | null = null
    let dragMeasureStarted = false

    let dragOverlay: { id: string; kind: 'scalebar' | 'text' | 'image'; dx: number; dy: number } | null = null
    let dragOverlayStarted = false

    let dragResize: { id: string; origWidthMap: number; origHeightMap: number; posX: number; posY: number } | null = null
    let dragResizeStarted = false

    let dragLabel: { courseId: string | null; courseControlId: string | null; controlId: string; dx: number; dy: number } | null = null
    let dragLabelStarted = false

    // nx/ny track the latest (clamped) position shown in the drag preview so
    // pointerup can commit it to the project in a single mutation.
    let dragLayoutEl: { element: string; sx: number; sy: number; ox: number; oy: number; wMm: number; hMm: number; nx: number; ny: number } | null = null
    let dragLayoutElStarted = false

    let dragBorderResize: { sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; last: { x: number; y: number; width: number; height: number } | null } | null = null
    let dragBorderResizeStarted = false

    let dragBorderTranslate: { sx: number; sy: number; ox: number; oy: number; last: { x: number; y: number; width: number; height: number } | null } | null = null
    let dragBorderTranslateStarted = false

    let dragRotation: { annId: string; center: MapPoint } | null = null
    let dragRotationStarted = false

    let dragAnnotation: { annId: string; dx: number; dy: number } | null = null
    let dragAnnotationStarted = false

    let dragAnnResize: { annId: string; centerX: number; centerY: number; origScale: number; origHandleDist: number } | null = null
    let dragAnnResizeStarted = false

    let dragCrossElongate: { annId: string; centerX: number; centerY: number; baseHH: number } | null = null
    let dragCrossElongateStarted = false

    let dragOobVertex: { annId: string; vertexIndex: number } | null = null
    let dragOobVertexStarted = false

    let dragPendingVertex: { vertexIndex: number } | null = null
    let dragPendingVertexStarted = false

    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressFired = false
    function clearLongPress() {
      if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null }
    }

    let panning = false
    function startPanning() {
      if (panning) return
      panning = true
      if (hdSvgRef.current) hdSvgRef.current.style.display = 'none'
    }
    function stopPanning() {
      if (!panning) return
      panning = false
      if (hdSvgRef.current) hdSvgRef.current.style.display = ''
    }

    // ── Wheel ────────────────────────────────────────────────────────────────
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      // Layout mode allows wheel zoom too: it changes screen magnification
      // only (never the print scale), like zooming a print preview.
      const inLayout = useStore.getState().editor.layoutMode
      const rect = getRect()
      let cx = e.clientX - rect.left
      let cy = e.clientY - rect.top
      if (inLayout) {
        // Anchor at the visible-strip centre, not the cursor: the page frame is
        // glued to the screen centre (commitLayoutMapCenter re-adopts it on
        // idle), so any other anchor would make the page jump there afterwards.
        const mp = document.querySelector<HTMLElement>('[data-mobile-panel]')
        const overlap = mp ? Math.max(0, mp.getBoundingClientRect().bottom - rect.top) : 0
        cx = rect.width / 2
        cy = (overlap + rect.height) / 2
      }
      const v = vpRef.current
      const raw = e.deltaMode === 0 ? e.deltaY : e.deltaY * 30
      const factor = raw > 0 ? 0.85 : 1 / 0.85
      const minScale = Math.min(fitScaleRef.current, MIN_SCALE)
      const ns = clamp(v.scale * factor, minScale, MAX_SCALE)
      const ratio = ns / v.scale
      vpRef.current = { scale: ns, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) }
      startPanning()
      // No layoutPanningRef freeze here: with a centre-anchored zoom the page
      // frame is fixed in map coords, so page-relative overlays and the page
      // overlay all track the plain viewport transform correctly.
      // Coalesce the DOM write into a single rAF — trackpad pinch / momentum
      // scroll fire many wheel events per frame, and one syncTransform per frame
      // is enough. (Shares pendingRaf with the pointer-move path.)
      if (!pendingRaf) pendingRaf = requestAnimationFrame(() => { pendingRaf = 0; syncTransform() })
      if (wheelTimer) clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        wheelTimer = null
        if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0 }
        syncTransform()
        setVpState(vpRef.current)
        stopPanning()
        commitLayoutMapCenter()
      }, 150)
    }

    // ── Pointer down ─────────────────────────────────────────────────────────
    function onDown(e: PointerEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || (e.target instanceof HTMLElement && e.target.closest('[data-ui-panel]'))) return
      // Any fresh gesture on the canvas dismisses a pending split offer. (Taps on
      // the offer's own buttons are HTMLButtonElements, handled by the guard above.)
      setSplitPrompt(null)
      // Refresh the cached rect at the start of every gesture. ResizeObserver only
      // fires on size changes and the scroll listener only on window scroll, so a
      // position-only shift of the canvas (header settling, layout reflow) would
      // otherwise leave rect.top stale — making every hit-test land below the
      // cursor, i.e. the handle's hitbox feeling offset toward the top.
      rectCacheRef.current = div.getBoundingClientRect()
      div.setPointerCapture(e.pointerId)
      pos.set(e.pointerId, { x: e.clientX, y: e.clientY })
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pos.size === 2) {
        const [a, b] = [...pos.values()]
        pinchDist = Math.hypot(b.x - a.x, b.y - a.y)
      }
      if (pos.size >= 2) multiTouch = true

      longPressFired = false
      if (e.pointerType === 'touch' && pos.size === 1 && !useStore.getState().editor.layoutMode) {
        const state = useStore.getState()
        const rect = getRect()
        const proj = state.project
        const cid = state.editor.selectedCourseId
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top

        if (state.editor.measureMode) {
          // handled separately above
        } else if (state.editor.activeTool === 'gap' && proj && cid) {
          longPressTimer = setTimeout(() => {
            longPressTimer = null
            longPressFired = true
            handleGapRightClick(sx, sy, vpRef.current, proj, cid)
          }, 500)
        } else if (state.editor.activeTool === 'bend' && proj && cid) {
          longPressTimer = setTimeout(() => {
            longPressTimer = null
            longPressFired = true
            handleBendRightClick(sx, sy, vpRef.current, proj, cid)
          }, 500)
        } else if (cid && proj && !proj.locked) {
          const hit = findControlAt(sx, sy, vpRef.current, proj, cid, state.editor.appearance.controlScale, 0, state.editor.selectedSubmapIndex)
          if (hit) {
            longPressTimer = setTimeout(() => {
              longPressTimer = null
              longPressFired = true
              const course = useStore.getState().project?.courses.find(c => c.id === cid)
              if (!course) return
              for (let i = course.controls.length - 1; i >= 0; i--) {
                if (course.controls[i].controlId === hit.id) {
                  useStore.getState().removeControlFromCourse(cid, course.controls[i].id)
                  return
                }
              }
            }, 500)
          }
        }
      }

      const state = useStore.getState()
      if (state.editor.layoutMode) {
        if (pos.size !== 1) return
        const proj = state.project
        if (!proj) return
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top

        const course = proj.courses.find(c => c.id === state.editor.layoutCourseId)
        const smIdx = state.editor.layoutSubmapIndex
        const layout = course?.layout ? submapLayoutView(course.layout, smIdx) : undefined
        // Course slice for this submap (for clue-sheet box sizing).
        const submapCourse = course
          ? (() => { const sm = computeSubmaps(course); return sm.length > 1 && sm[smIdx] ? { ...course, controls: sm[smIdx].controls } : course })()
          : undefined
        if (layout && course && submapCourse) {
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pageW = layout.orientation === 'landscape' ? base.h : base.w
          const pageH = layout.orientation === 'landscape' ? base.w : base.h
          const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, proj.map, layout.printScale).x

          const halfHMap = mmToMap({ x: 0, y: pageH / 2 }, proj.map, layout.printScale).y
          const pageTLx = layout.mapCenter.x - halfWMap
          const pageTLy = layout.mapCenter.y - halfHMap
          const pageWMap = halfWMap * 2
          const mmToMapU = pageWMap / pageW

          // Hit test border resize handle (bottom-right corner)
          if (layout.mapBorder) {
            const handleMapX = pageTLx + (layout.mapBorder.x + layout.mapBorder.width) * mmToMapU
            const handleMapY = pageTLy + (layout.mapBorder.y + layout.mapBorder.height) * mmToMapU
            const handleSx = handleMapX * vpRef.current.scale + vpRef.current.x
            const handleSy = handleMapY * vpRef.current.scale + vpRef.current.y
            // Generous hit radius (2× the drawn handle) — finger-sized on touch.
            const HANDLE_HIT = 12
            if (Math.abs(sx - handleSx) < HANDLE_HIT && Math.abs(sy - handleSy) < HANDLE_HIT) {
              dragBorderResize = { sx: e.clientX, sy: e.clientY, ox: layout.mapBorder.x, oy: layout.mapBorder.y, ow: layout.mapBorder.width, oh: layout.mapBorder.height, last: null }
              dragBorderResizeStarted = false
              return
            }
          }

          // Hit test layout elements (clue sheet, title) — before border translate so elements on top of border margin are draggable
          const sheetView = clueSheetPreviewView(course, smIdx, !!proj.clueSheetHideSubmapRestart, layout.clueSheetBreaks)
          const breaks = sheetView.breaks
          const trailingFlip = layoutTrailingFlip(course, smIdx)
          const elements: Array<{ key: string; el: { x: number; y: number; visible: boolean }; wMm: number; hMm: number }> = []
          if (breaks && breaks.length > 0) {
            const sizes = descriptionSheetPartSizes(sheetView.course, proj.controls, breaks, trailingFlip, proj.clueSheetFontSize)
            const positions = [layout.clueSheet, ...(layout.clueSheetParts ?? [])]
            for (let i = 0; i < sizes.length; i++) {
              const el = positions[i] ?? layout.clueSheet
              elements.push({ key: i === 0 ? 'clueSheet' : `clueSheetPart:${i - 1}`, el, wMm: sizes[i].width, hMm: sizes[i].height })
            }
          } else {
            const sheet = descriptionSheetSize(sheetView.course, proj.controls, trailingFlip, proj.clueSheetFontSize)
            elements.push({ key: 'clueSheet', el: layout.clueSheet, wMm: sheet.width, hMm: sheet.height })
          }
          for (const { key, el, wMm, hMm } of elements) {
            if (!el.visible) continue
            const elMapX = pageTLx + el.x * mmToMapU
            const elMapY = pageTLy + el.y * mmToMapU
            const elScreenX = elMapX * vpRef.current.scale + vpRef.current.x
            const elScreenY = elMapY * vpRef.current.scale + vpRef.current.y
            const elW = wMm * mmToMapU * vpRef.current.scale
            const elH = hMm * mmToMapU * vpRef.current.scale
            if (sx >= elScreenX && sx <= elScreenX + elW && sy >= elScreenY && sy <= elScreenY + elH) {
              dragLayoutEl = { element: key, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, wMm, hMm, nx: el.x, ny: el.y }
              dragLayoutElStarted = false
              return
            }
          }

          // Hit test overlays (scale bars, text labels) — before border translate
          {
            const overlayHit = findOverlayAt(sx, sy, vpRef.current, proj, layout.overlayPositions, layout.printScale)
            if (overlayHit) {
              let oPos: { x: number; y: number } | undefined
              const overridePos = layout.overlayPositions?.[overlayHit.id]
              if (overridePos) {
                oPos = overridePos
              } else if (overlayHit.kind === 'scalebar') {
                oPos = proj.scaleBars.find(s => s.id === overlayHit.id)?.position
              } else if (overlayHit.kind === 'text') {
                oPos = proj.textLabels.find(t => t.id === overlayHit.id)?.position
              } else {
                oPos = proj.imageOverlays.find(o => o.id === overlayHit.id)?.position
              }
              if (oPos) {
                const mmPerMapU = pageW / pageWMap
                const mmX = (oPos.x - pageTLx) * mmPerMapU
                const mmY = (oPos.y - pageTLy) * mmPerMapU
                dragLayoutEl = { element: `overlay:${overlayHit.id}`, sx: e.clientX, sy: e.clientY, ox: mmX, oy: mmY, wMm: 0, hMm: 0, nx: mmX, ny: mmY }
                dragLayoutElStarted = false
                return
              }
            }
          }

          // Hit test grey margin strips (inside page, outside border) for border translate — last so elements on top take priority
          if (layout.mapBorder) {
            const borderMapX1 = pageTLx + layout.mapBorder.x * mmToMapU
            const borderMapY1 = pageTLy + layout.mapBorder.y * mmToMapU
            const borderMapX2 = borderMapX1 + layout.mapBorder.width * mmToMapU
            const borderMapY2 = borderMapY1 + layout.mapBorder.height * mmToMapU
            const pageSx1 = pageTLx * vpRef.current.scale + vpRef.current.x
            const pageSy1 = pageTLy * vpRef.current.scale + vpRef.current.y
            const pageSx2 = (pageTLx + pageWMap) * vpRef.current.scale + vpRef.current.x
            const pageSy2 = (pageTLy + pageH * mmToMapU) * vpRef.current.scale + vpRef.current.y
            const bSx1 = borderMapX1 * vpRef.current.scale + vpRef.current.x
            const bSy1 = borderMapY1 * vpRef.current.scale + vpRef.current.y
            const bSx2 = borderMapX2 * vpRef.current.scale + vpRef.current.x
            const bSy2 = borderMapY2 * vpRef.current.scale + vpRef.current.y
            const inPage = sx >= pageSx1 && sx <= pageSx2 && sy >= pageSy1 && sy <= pageSy2
            const inBorder = sx >= bSx1 && sx <= bSx2 && sy >= bSy1 && sy <= bSy2
            if (inPage && !inBorder) {
              dragBorderTranslate = { sx: e.clientX, sy: e.clientY, ox: layout.mapBorder.x, oy: layout.mapBorder.y, last: null }
              dragBorderTranslateStarted = false
              return
            }
          }
        }
        return
      }
      const { activeTool } = state.editor
      const proj = state.project
      if (!proj) return
      // ponytail: locked projects allow pan/zoom only — no drag initiation
      if (proj.locked) return

      // Measure mode: grab a route handle if hit; otherwise fall through to pan.
      if (state.editor.measureMode) {
        if (pos.size === 1) {
          const rect = getRect()
          const hidden = new Set(state.editor.measureHiddenLegs)
          const ptHit = findMeasurePointAt(e.clientX - rect.left, e.clientY - rect.top, vpRef.current, proj, state.editor.measureCourseId, hidden)
          if (ptHit) {
            dragMeasure = ptHit
            dragMeasureStarted = false
            // Touch has no right-click — long-press removes the handle.
            if (e.pointerType === 'touch') {
              longPressTimer = setTimeout(() => {
                longPressTimer = null
                longPressFired = true
                useStore.getState().removeMeasurePoint(ptHit.fromControlId, ptHit.toControlId, ptHit.index)
                dragMeasure = null
                dragMeasureStarted = false
              }, 500)
            }
          }
        }
        return
      }

      if (activeTool === 'out-of-bounds' && pos.size === 1 && state.editor.pendingAnnotationPoints.length > 0) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const mapPt = screenToMap(sx, sy, vpRef.current)
        const upm = unitsPerMm(proj.map)
        // Same sf-scaled radius as the drawn pending handles.
        const handleR = 1 * upm * symbolScaleFactor(resolveSpec(proj.spec), proj.map.scale)
        for (let i = 0; i < state.editor.pendingAnnotationPoints.length; i++) {
          const p = state.editor.pendingAnnotationPoints[i]
          if (Math.hypot(mapPt.x - p.x, mapPt.y - p.y) < handleR) {
            dragPendingVertex = { vertexIndex: i }
            dragPendingVertexStarted = false
            return
          }
        }
      }
      if (pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const miHit = findMapIssueAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
        if (miHit?.kind === 'delete') {
          useStore.getState().removeMapIssue(miHit.courseId, miHit.courseControlId)
          return
        } else if (miHit?.kind === 'add') {
          useStore.getState().addMapIssue(miHit.courseId, miHit.courseControlId)
          return
        } else if (miHit?.kind === 'bar') {
          dragMapIssue = { courseId: miHit.courseId, courseControlId: miHit.courseControlId }
          dragMapIssueStarted = false
          return
        }
      }
      if (activeTool === 'bend' && pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const mreHit = findMarkedRouteEndAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
        if (mreHit) {
          dragMRE = mreHit
          dragMREStarted = false
        } else {
          const bpHit = findBendPointAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
          if (bpHit) {
            dragBend = bpHit
            dragBendStarted = false
          }
        }
      }
      if (activeTool === 'select' && pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        let handleHit = false
        const mreHitSel = findMarkedRouteEndAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
        if (mreHitSel) {
          dragMRE = mreHitSel
          dragMREStarted = false
          handleHit = true
        }
        // Pre-start first bend handle + divider — always visible, allow dragging in select mode
        if (!handleHit) {
          const bpHitSel = findBendPointAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
          const selCrs = state.editor.selectedCourseId ? proj.courses.find(c => c.id === state.editor.selectedCourseId) : null
          if (bpHitSel && selCrs && bpHitSel.courseControlId === selCrs.controls[0]?.id && bpHitSel.bendIndex === 0) {
            dragBend = bpHitSel
            dragBendStarted = false
            handleHit = true
          }
        }
        const labelHit = !handleHit && findLabelAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId, state.editor.appearance.controlScale, state.editor.selectedSubmapIndex)
        if (labelHit) {
          const mapPt = screenToMap(sx, sy, vpRef.current)
          dragLabel = { courseId: labelHit.courseId, courseControlId: labelHit.courseControlId, controlId: labelHit.controlId, dx: mapPt.x - labelHit.labelX, dy: mapPt.y - labelHit.labelY }
          dragLabelStarted = false
        } else {
          // Annotation/overlay handles take priority over controls
          const rotHit = findCrossingPointRotationHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (rotHit && rotHit.points[0]) {
            dragRotation = { annId: rotHit.id, center: rotHit.points[0] }
            dragRotationStarted = false
            return
          }

          const crossResizeHit = findCrossingPointResizeHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (crossResizeHit && crossResizeHit.points[0]) {
            const crUpm = unitsPerMm(proj.map)
            const crSpec = resolveSpec(proj.spec)
            const crSf = symbolScaleFactor(crSpec, proj.map.scale)
            const crD = getAnnotationDims(crSf * crUpm)
            // Handle sits crossH + 2·handleR beyond centre; subtract that so grabbing doesn't jump.
            dragCrossElongate = { annId: crossResizeHit.id, centerX: crossResizeHit.points[0].x, centerY: crossResizeHit.points[0].y, baseHH: crD.crossH + 2 * crUpm }
            dragCrossElongateStarted = false
            return
          }

          const naRotHit = findNorthArrowRotationHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (naRotHit && naRotHit.points[0]) {
            dragRotation = { annId: naRotHit.id, center: naRotHit.points[0] }
            dragRotationStarted = false
            return
          }

          const naResizeHit = findNorthArrowResizeHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (naResizeHit && naResizeHit.points[0]) {
            const naUpm = unitsPerMm(proj.map)
            const naSpec = resolveSpec(proj.spec)
            const naH = northArrowHeight(naUpm, proj.map.scale, naSpec, naResizeHit.scale ?? 1)
            const geo = northArrowGeometry(naH, naUpm)
            const origHandleDist = Math.hypot(geo.resizeHandleLocalX, geo.resizeHandleLocalY)
            dragAnnResize = { annId: naResizeHit.id, centerX: naResizeHit.points[0].x, centerY: naResizeHit.points[0].y, origScale: naResizeHit.scale ?? 1, origHandleDist }
            dragAnnResizeStarted = false
            return
          }

          const selectedImg = state.editor.selectedOverlayId
            ? proj.imageOverlays.find(o => o.id === state.editor.selectedOverlayId)
            : null
          if (selectedImg) {
            const upmVal = overlayUpmOf(state)
            const handleMapX = selectedImg.position.x + selectedImg.widthMm * upmVal
            const handleMapY = selectedImg.position.y + selectedImg.heightMm * upmVal
            const handleSx = handleMapX * vpRef.current.scale + vpRef.current.x
            const handleSy = handleMapY * vpRef.current.scale + vpRef.current.y
            const HANDLE_HIT = 1.5 * upmVal * vpRef.current.scale
            if (Math.abs(sx - handleSx) < HANDLE_HIT && Math.abs(sy - handleSy) < HANDLE_HIT) {
              dragResize = {
                id: selectedImg.id,
                origWidthMap: selectedImg.widthMm * upmVal,
                origHeightMap: selectedImg.heightMm * upmVal,
                posX: selectedImg.position.x,
                posY: selectedImg.position.y,
              }
              dragResizeStarted = false
              return
            }
          }

          // Out-of-bounds vertex handle (when selected)
          const oobVtx = findOobVertexHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (oobVtx) {
            dragOobVertex = { annId: oobVtx.ann.id, vertexIndex: oobVtx.vertexIndex }
            dragOobVertexStarted = false
            return
          }

          // Annotations and overlays take priority over controls.
          // Out-of-bounds areas are large fills, so they only drag once selected
          // (a plain click selects them); crossing points and north arrows are
          // small handle-like objects and drag directly.
          const annHit = findAnnotationAt(sx, sy, vpRef.current, proj)
          if (annHit && annHit.points[0]) {
            const draggable = annHit.type === 'crossing_point' || annHit.type === 'north_arrow'
              || annHit.type === 'forbidden_route' || annHit.type === 'oob_boundary'
              || (annHit.type === 'out_of_bounds' && annHit.id === state.editor.selectedAnnotationId)
            if (draggable) {
              const mapPt2 = screenToMap(sx, sy, vpRef.current)
              dragAnnotation = { annId: annHit.id, dx: mapPt2.x - annHit.points[0].x, dy: mapPt2.y - annHit.points[0].y }
              dragAnnotationStarted = false
              return
            }
          }

          // Pressing outside the selected out-of-bounds area — not on it and not
          // on its vertex handles (ruled out above) — deselects it, whether the
          // gesture ends up a tap or a pan.
          const selAnn = state.editor.selectedAnnotationId
            ? proj.annotations.find(a => a.id === state.editor.selectedAnnotationId)
            : null
          if (selAnn?.type === 'out_of_bounds' && (!annHit || annHit.id !== selAnn.id)) {
            state.setSelectedAnnotation(null)
          }

          const overlayHit = findOverlayAt(sx, sy, vpRef.current, proj, undefined, overlayPrintScaleOf(state))
          if (overlayHit) {
            const mapPt = screenToMap(sx, sy, vpRef.current)
            let oPos: { x: number; y: number } | undefined
            if (overlayHit.kind === 'scalebar') {
              oPos = proj.scaleBars.find(s => s.id === overlayHit.id)?.position
            } else if (overlayHit.kind === 'text') {
              oPos = proj.textLabels.find(t => t.id === overlayHit.id)?.position
            } else {
              oPos = proj.imageOverlays.find(o => o.id === overlayHit.id)?.position
            }
            if (oPos) {
              dragOverlay = { id: overlayHit.id, kind: overlayHit.kind, dx: mapPt.x - oPos.x, dy: mapPt.y - oPos.y }
              dragOverlayStarted = false
              return
            }
          }

          // Controls. When a course is selected, only its own controls are
          // draggable — controls belonging solely to other courses are locked
          // (the gesture falls through to a pan), matching label drag behaviour.
          const hit = findControlAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId, state.editor.appearance.controlScale, 0, state.editor.selectedSubmapIndex)
          const selCourse = state.editor.selectedCourseId ? proj.courses.find(c => c.id === state.editor.selectedCourseId) : null
          const hitInCourse = hit && (!selCourse || selCourse.controls.some(cc => cc.controlId === hit.id))
          if (hit && hitInCourse) {
            const mapPt = screenToMap(sx, sy, vpRef.current)
            dragControlId = hit.id
            dragOffset = { dx: mapPt.x - hit.position.x, dy: mapPt.y - hit.position.y }
            dragStarted = false
          }
        }
      }
    }

    // ── Pointer move ─────────────────────────────────────────────────────────
    function onMove(e: PointerEvent) {
      if (!pos.has(e.pointerId)) return
      const prev = pos.get(e.pointerId)!
      pos.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (longPressTimer) {
        const start = down.get(e.pointerId)
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_PX) {
          clearLongPress()
        }
      }

      if (dragBorderResize && pos.size === 1) {
        if (!dragBorderResizeStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginLayoutDrag()
          dragBorderResizeStarted = true
        }
        const st = useStore.getState()
        const course = st.project?.courses.find(c => c.id === st.editor.layoutCourseId)
        const smIdx = st.editor.layoutSubmapIndex
        const layout = course?.layout ? submapLayoutView(course.layout, smIdx) : undefined
        if (layout?.mapBorder) {
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pageW = layout.orientation === 'landscape' ? base.h : base.w
          const pageH = layout.orientation === 'landscape' ? base.w : base.h
          const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, st.project!.map, layout.printScale).x
          const pageWMap = halfWMap * 2
          const pxToMm = pageW / (pageWMap * vpRef.current.scale)

          const dw = (e.clientX - dragBorderResize.sx) * pxToMm
          const dh = (e.clientY - dragBorderResize.sy) * pxToMm
          const minSize = 20
          const newW = Math.max(minSize, Math.min(pageW, dragBorderResize.ow + dw * 2))
          const newH = Math.max(minSize, Math.min(pageH, dragBorderResize.oh + dh * 2))
          const newX = dragBorderResize.ox - (newW - dragBorderResize.ow) / 2
          const newY = dragBorderResize.oy - (newH - dragBorderResize.oh) / 2
          const clampedX = Math.max(0, newX)
          const clampedY = Math.max(0, newY)
          const rect = { x: clampedX, y: clampedY, width: Math.min(newW, pageW - clampedX), height: Math.min(newH, pageH - clampedY) }
          dragBorderResize.last = rect
          scheduleDragMutation(() => st.setLayoutDragPreview({ type: 'border', ...rect }))
        }
        return
      }

      if (dragBorderTranslate && pos.size === 1) {
        if (!dragBorderTranslateStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginLayoutDrag()
          dragBorderTranslateStarted = true
        }
        const st = useStore.getState()
        const course = st.project?.courses.find(c => c.id === st.editor.layoutCourseId)
        const smIdx = st.editor.layoutSubmapIndex
        const layout = course?.layout ? submapLayoutView(course.layout, smIdx) : undefined
        if (layout?.mapBorder) {
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pageW = layout.orientation === 'landscape' ? base.h : base.w
          const pageH = layout.orientation === 'landscape' ? base.w : base.h
          const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, st.project!.map, layout.printScale).x
          const pageWMap = halfWMap * 2
          const pxToMm = pageW / (pageWMap * vpRef.current.scale)

          const dx = (e.clientX - dragBorderTranslate.sx) * pxToMm
          const dy = (e.clientY - dragBorderTranslate.sy) * pxToMm
          const bw = layout.mapBorder.width
          const bh = layout.mapBorder.height
          const newX = Math.max(0, Math.min(pageW - bw, dragBorderTranslate.ox + dx))
          const newY = Math.max(0, Math.min(pageH - bh, dragBorderTranslate.oy + dy))
          const rect = { x: newX, y: newY, width: bw, height: bh }
          dragBorderTranslate.last = rect
          scheduleDragMutation(() => st.setLayoutDragPreview({ type: 'border', ...rect }))
        }
        return
      }

      if (dragLayoutEl && pos.size === 1) {
        if (!dragLayoutElStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginLayoutDrag()
          dragLayoutElStarted = true
        }
        const st = useStore.getState()
        const course = st.project?.courses.find(c => c.id === st.editor.layoutCourseId)
        const smIdx = st.editor.layoutSubmapIndex
        const layout = course?.layout ? submapLayoutView(course.layout, smIdx) : undefined
        if (layout) {
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pageW = layout.orientation === 'landscape' ? base.h : base.w
          const pageH = layout.orientation === 'landscape' ? base.w : base.h
          const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, st.project!.map, layout.printScale).x
          const pageWMap = halfWMap * 2
          const mmToPx = (pageWMap * vpRef.current.scale) / pageW

          const dx = (e.clientX - dragLayoutEl.sx) / mmToPx
          const dy = (e.clientY - dragLayoutEl.sy) / mmToPx
          const element = dragLayoutEl.element
          if (element.startsWith('overlay:')) {
            // Overlays live in OverlaysLayer (map coords) — keep the direct
            // store write; only clue sheets go through the cheap preview path.
            const newX = dragLayoutEl.ox + dx
            const newY = dragLayoutEl.oy + dy
            scheduleDragMutation(() => st.updateLayoutElement(st.editor.layoutCourseId!, element, { x: newX, y: newY }, smIdx))
          } else {
            // Clamp onto the page so the sheet can't be dragged off and lost.
            const newX = Math.max(0, Math.min(pageW - dragLayoutEl.wMm, dragLayoutEl.ox + dx))
            const newY = Math.max(0, Math.min(pageH - dragLayoutEl.hMm, dragLayoutEl.oy + dy))
            dragLayoutEl.nx = newX
            dragLayoutEl.ny = newY
            scheduleDragMutation(() => st.setLayoutDragPreview({ type: 'element', key: element, x: newX, y: newY }))
          }
        }
        return
      }

      if (dragMeasure && pos.size === 1) {
        if (!dragMeasureStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveMeasurePoint()
          dragMeasureStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const { fromControlId, toControlId, index } = dragMeasure
        scheduleDragMutation(() => useStore.getState().moveMeasurePoint(fromControlId, toControlId, index, mapPt))
        return
      }

      if (dragMapIssue && pos.size === 1) {
        if (!dragMapIssueStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveMapIssue()
          dragMapIssueStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const { courseId, courseControlId } = dragMapIssue
        const st = useStore.getState()
        const course = st.project?.courses.find(c => c.id === courseId)
        const cc = course?.controls.find(c => c.id === courseControlId)
        if (cc?.legBendPoints?.length && st.project) {
          const startCtrl = st.project.controls.find(c => c.id === cc.controlId)
          if (startCtrl) {
            const pts = flattenSmooth([...cc.legBendPoints, startCtrl.position])
            const t = projectOnPolyline(mapPt, pts)
            scheduleDragMutation(() => useStore.getState().moveMapIssue(courseId, courseControlId, t))
          }
        }
        return
      }

      if (dragMRE && pos.size === 1) {
        if (!dragMREStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveMarkedRouteEnd()
          dragMREStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const { courseId, courseControlId } = dragMRE
        scheduleDragMutation(() => useStore.getState().moveMarkedRouteEnd(courseId, courseControlId, mapPt))
        return
      }

      if (dragBend && pos.size === 1) {
        if (!dragBendStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          const _db = dragBend
          const st = useStore.getState()
          const _p = st.project
          const _course = _p?.courses.find(c => c.id === _db.courseId)
          let _bl = 'Move bend'
          if (_course && _p) {
            const _ci = _course.controls.findIndex(cc => cc.id === _db.courseControlId)
            const _from = _ci >= 0 ? _p.controls.find(c => c.id === _course.controls[_ci].controlId) : undefined
            const _to = _ci >= 0 && _ci + 1 < _course.controls.length ? _p.controls.find(c => c.id === _course.controls[_ci + 1].controlId) : undefined
            if (_from && _to) _bl = `Move bend ${defaultControlLabel(_from)}-${defaultControlLabel(_to)} ${_course.name}`
          }
          st.beginMoveLegBendPoint(_bl)
          dragBendStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const { courseId, courseControlId, bendIndex, nav } = dragBend
        scheduleDragMutation(() => useStore.getState().moveLegBendPoint(courseId, courseControlId, bendIndex, mapPt, nav ? 'nav' : 'taped'))
        return
      }

      if (dragLabel && pos.size === 1) {
        if (!dragLabelStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          const _dl = dragLabel
          const _lc = useStore.getState().project?.controls.find(c => c.id === _dl.controlId)
          const _lcName = _lc ? defaultControlLabel(_lc) : '?'
          const _courseName = _dl.courseId ? useStore.getState().project?.courses.find(c => c.id === _dl.courseId)?.name : undefined
          const _ll = _courseName ? `Move label ${_lcName} ${_courseName}` : `Move label ${_lcName}`
          if (_dl.courseId && _dl.courseControlId) useStore.getState().beginMoveCourseLabel(_ll)
          else useStore.getState().beginMoveControlLabel(_ll)
          dragLabelStarted = true
          useStore.getState().setDraggingLabel(dragLabel.controlId)
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const ctrl = useStore.getState().project?.controls.find(c => c.id === dragLabel!.controlId)
        if (ctrl) {
          const offset = { x: mapPt.x - dragLabel.dx - ctrl.position.x, y: mapPt.y - dragLabel.dy - ctrl.position.y }
          const { courseId, courseControlId, controlId } = dragLabel
          scheduleDragMutation(() => {
            if (courseId && courseControlId) {
              useStore.getState().moveCourseLabel(courseId, courseControlId, offset)
            } else {
              useStore.getState().moveControlLabel(controlId, offset)
            }
          })
        }
        return
      }

      if (dragControlId && pos.size === 1) {
        if (!dragStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          clearLongPress()
          const _ctrl = useStore.getState().project?.controls.find(c => c.id === dragControlId)
          useStore.getState().beginMoveControl(_ctrl ? `Move ${defaultControlLabel(_ctrl)}` : undefined)
          useStore.getState().setDraggingControl(dragControlId)
          dragStarted = true
          const ctrl = useStore.getState().project?.controls.find(c => c.id === dragControlId)
          dragOrigPos = ctrl ? { ...ctrl.position } : null
          const sel = `[data-control-id="${dragControlId}"]`
          dragControlEls = [courseGRef.current, courseMultGRef.current]
            .map(g => g?.querySelector(sel) as SVGGElement | null)
            .filter((el): el is SVGGElement => el != null)
          dragLegsRef.current?.begin(dragControlId)
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        pendingControlPos = { x: mapPt.x - dragOffset!.dx, y: mapPt.y - dragOffset!.dy }
        if (!pendingControlRaf) {
          pendingControlRaf = requestAnimationFrame(() => {
            pendingControlRaf = 0
            if (pendingControlPos && dragOrigPos && dragControlEls.length) {
              const dx = pendingControlPos.x - dragOrigPos.x
              const dy = pendingControlPos.y - dragOrigPos.y
              for (const el of dragControlEls) el.style.transform = `translate(${dx}px,${dy}px)`
            }
            if (pendingControlPos) {
              dragLegsRef.current?.update(pendingControlPos)
            }
          })
        }
        return
      }

      if (dragAnnotation && pos.size === 1) {
        if (!dragAnnotationStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          const st = useStore.getState()
          const _ann = st.project?.annotations.find(a => a.id === dragAnnotation!.annId)
          st.beginMoveAnnotation(_ann ? `Move ${_ann.type.replace(/_/g, ' ')}` : undefined)
          st.setSelectedAnnotation(dragAnnotation.annId)
          st.setSelectedControl(null)
          st.setSelectedOverlay(null)
          dragAnnotationStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const annPos = { x: mapPt.x - dragAnnotation.dx, y: mapPt.y - dragAnnotation.dy }
        const movedAnnId = dragAnnotation.annId
        scheduleDragMutation(() => useStore.getState().moveAnnotation(movedAnnId, annPos))
        return
      }

      if (dragRotation && pos.size === 1) {
        if (!dragRotationStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginRotateAnnotation()
          dragRotationStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const dx = mapPt.x - dragRotation.center.x
        const dy = mapPt.y - dragRotation.center.y
        const angle = Math.atan2(dx, -dy) * 180 / Math.PI
        const rotAnnId = dragRotation.annId
        scheduleDragMutation(() => useStore.getState().rotateAnnotation(rotAnnId, angle))
        return
      }

      if (dragAnnResize && pos.size === 1) {
        if (!dragAnnResizeStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginResizeAnnotation()
          dragAnnResizeStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const distFromCenter = Math.hypot(mapPt.x - dragAnnResize.centerX, mapPt.y - dragAnnResize.centerY)
        const newScale = Math.max(0.3, dragAnnResize.origScale * distFromCenter / dragAnnResize.origHandleDist)
        const resizeAnnId = dragAnnResize.annId
        scheduleDragMutation(() => useStore.getState().resizeAnnotation(resizeAnnId, newScale))
        return
      }

      if (dragCrossElongate && pos.size === 1) {
        if (!dragCrossElongateStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginElongateAnnotation()
          dragCrossElongateStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const proj2 = useStore.getState().project!
        const rotation = (proj2.annotations.find(a => a.id === dragCrossElongate!.annId)?.rotation ?? 0) * Math.PI / 180
        const dx = mapPt.x - dragCrossElongate.centerX
        const dy = mapPt.y - dragCrossElongate.centerY
        const projectedDist = dx * (-Math.sin(rotation)) + dy * Math.cos(rotation)
        const upm = unitsPerMm(proj2.map)
        const newElongation = Math.max(0, (projectedDist - dragCrossElongate.baseHH) / upm)
        const elongAnnId = dragCrossElongate.annId
        scheduleDragMutation(() => useStore.getState().elongateAnnotation(elongAnnId, newElongation))
        return
      }

      if (dragPendingVertex && pos.size === 1) {
        if (!dragPendingVertexStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          dragPendingVertexStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const pendingVertexIndex = dragPendingVertex.vertexIndex
        scheduleDragMutation(() => useStore.getState().movePendingAnnotationPoint(pendingVertexIndex, mapPt))
        return
      }

      if (dragOobVertex && pos.size === 1) {
        if (!dragOobVertexStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveAnnotationVertex()
          dragOobVertexStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const { annId: oobAnnId, vertexIndex: oobVertexIndex } = dragOobVertex
        scheduleDragMutation(() => useStore.getState().moveAnnotationVertex(oobAnnId, oobVertexIndex, mapPt))
        return
      }

      if (dragResize && pos.size === 1) {
        if (!dragResizeStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveOverlay()
          dragResizeStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const relX = mapPt.x - dragResize.posX
        const relY = mapPt.y - dragResize.posY
        const wOrig = dragResize.origWidthMap
        const hOrig = dragResize.origHeightMap
        const diagLen = Math.hypot(wOrig, hOrig)
        const proj = (relX * wOrig + relY * hOrig) / diagLen
        const st = useStore.getState()
        const upmVal = overlayUpmOf(st)
        const minMap = 5 * upmVal
        const minProj = Math.hypot(minMap, minMap * (hOrig / wOrig))
        const clampedProj = Math.max(minProj, proj)
        const scale = clampedProj / diagLen
        const newW = wOrig * scale / upmVal
        const newH = hOrig * scale / upmVal
        const resizeOverlayId = dragResize.id
        scheduleDragMutation(() => st.resizeImageOverlay(resizeOverlayId, newW, newH))
        return
      }

      if (dragOverlay && pos.size === 1) {
        if (!dragOverlayStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveOverlay()
          dragOverlayStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const newPos = { x: mapPt.x - dragOverlay.dx, y: mapPt.y - dragOverlay.dy }
        const { id: overlayId, kind: overlayKind } = dragOverlay
        scheduleDragMutation(() => {
          if (overlayKind === 'scalebar') {
            useStore.getState().moveScaleBar(overlayId, newPos)
          } else if (overlayKind === 'text') {
            useStore.getState().moveTextLabel(overlayId, newPos)
          } else {
            useStore.getState().moveImageOverlay(overlayId, newPos)
          }
        })
        return
      }

      if (pos.size === 1) {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        const v = vpRef.current
        vpRef.current = { ...v, x: v.x + dx, y: v.y + dy }
        if (!vpDirty) {
          startPanning()
          if (useStore.getState().editor.layoutMode) layoutPanningRef.current = true
        }
        vpDirty = true
      } else if (pos.size === 2 && !useStore.getState().editor.layoutMode) {
        const [a, b] = [...pos.values()]
        const dist = Math.hypot(b.x - a.x, b.y - a.y)
        const rect = getRect()
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const cx = mid.x - rect.left
        const cy = mid.y - rect.top
        const v = vpRef.current
        const minScale = Math.min(fitScaleRef.current, MIN_SCALE)
        // pinchDist is 0 when both touches landed on the same pixel — skip the
        // zoom for that frame instead of dividing by zero.
        const ns = pinchDist > 0 ? clamp(v.scale * (dist / pinchDist), minScale, MAX_SCALE) : v.scale
        const ratio = ns / v.scale
        vpRef.current = { scale: ns, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) }
        if (!vpDirty) startPanning()
        vpDirty = true
        pinchDist = dist
      }
      if (vpDirty && !pendingRaf) {
        pendingRaf = requestAnimationFrame(() => { pendingRaf = 0; syncTransform() })
      }
    }

    // ── Pointer up / tap ──────────────────────────────────────────────────────
    function onUp(e: PointerEvent) {
      clearLongPress()
      const start = down.get(e.pointerId)
      pos.delete(e.pointerId)
      down.delete(e.pointerId)

      if (vpDirty && pos.size === 0) {
        vpDirty = false
        layoutPanningRef.current = false
        if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0 }
        syncTransform()
        setVpState(vpRef.current)
        stopPanning()
        commitLayoutMapCenter()
      }

      if (longPressFired) { longPressFired = false; return }

      // Other pointers still down: this lift is part of a multi-touch gesture
      // (or an accidental extra finger). Keep all drag state for the remaining
      // pointer and defer commit/reset/tap to the last pointerup. Re-baseline
      // the pinch distance when dropping from 3+ pointers to exactly 2.
      if (pos.size > 0) {
        if (pos.size === 2) {
          const [a, b] = [...pos.values()]
          pinchDist = Math.hypot(b.x - a.x, b.y - a.y)
        }
        return
      }
      const wasMultiTouch = multiTouch
      multiTouch = false

      // Apply the last coalesced drag mutation before the reset chain below
      // clears the drag state it belongs to.
      flushDragMutation()

      if (dragLayoutEl && dragLayoutElStarted) {
        // Clue-sheet drags only previewed (editor state) — commit the final
        // clamped position to the project now, in one mutation.
        if (!dragLayoutEl.element.startsWith('overlay:')) {
          const st = useStore.getState()
          if (st.editor.layoutCourseId) {
            st.updateLayoutElement(st.editor.layoutCourseId, dragLayoutEl.element, { x: dragLayoutEl.nx, y: dragLayoutEl.ny }, st.editor.layoutSubmapIndex)
          }
          st.setLayoutDragPreview(null)
        }
        dragLayoutEl = null; dragLayoutElStarted = false; return
      }
      dragLayoutEl = null; dragLayoutElStarted = false

      if (dragLabel && dragLabelStarted) { useStore.getState().setDraggingLabel(null); dragLabel = null; dragLabelStarted = false; return }
      dragLabel = null; dragLabelStarted = false

      if (dragMeasure && dragMeasureStarted) { dragMeasure = null; dragMeasureStarted = false; return }
      dragMeasure = null; dragMeasureStarted = false

      if (dragMapIssue && dragMapIssueStarted) { dragMapIssue = null; dragMapIssueStarted = false; return }
      dragMapIssue = null; dragMapIssueStarted = false

      if (dragMRE && dragMREStarted) { dragMRE = null; dragMREStarted = false; return }
      dragMRE = null; dragMREStarted = false

      if (dragBend && dragBendStarted) { dragBend = null; dragBendStarted = false; return }
      dragBend = null; dragBendStarted = false

      if (dragControlId && dragStarted) {
        if (pendingControlRaf) { cancelAnimationFrame(pendingControlRaf); pendingControlRaf = 0 }
        const splitId = dragControlId
        const splitNewPos = pendingControlPos
        const splitOrigPos = dragOrigPos
        if (pendingControlPos) { useStore.getState().moveControl(dragControlId, pendingControlPos); pendingControlPos = null }
        if (dragControlEls.length) { for (const el of dragControlEls) el.style.transform = ''; dragControlEls = [] }
        dragLegsRef.current?.end()
        dragOrigPos = null
        useStore.getState().setDraggingControl(null)
        dragControlId = null; dragOffset = null; dragStarted = false
        // The drag above moved the control in *every* course it belongs to. If it
        // is shared and the selected course holds it, offer to split it off into a
        // new control for just that course (the move stays as the default).
        if (splitNewPos && splitOrigPos) {
          const st = useStore.getState()
          const cid = st.editor.selectedCourseId
          const proj = st.project
          if (cid && proj) {
            const containing = proj.courses.filter(c => c.controls.some(cc => cc.controlId === splitId))
            const selCourse = containing.find(c => c.id === cid)
            if (selCourse && containing.length >= 2) {
              const rect = getRect()
              setSplitPrompt({
                controlId: splitId, courseId: cid, courseName: selCourse.name, courseCount: containing.length,
                newPos: splitNewPos, origPos: splitOrigPos, sx: e.clientX - rect.left, sy: e.clientY - rect.top,
              })
            }
          }
        }
        return
      }
      dragControlId = null; dragOffset = null; dragStarted = false

      if (dragBorderResize && dragBorderResizeStarted) {
        commitBorderDrag(dragBorderResize.last)
        dragBorderResize = null; dragBorderResizeStarted = false; return
      }
      dragBorderResize = null; dragBorderResizeStarted = false

      if (dragBorderTranslate && dragBorderTranslateStarted) {
        commitBorderDrag(dragBorderTranslate.last)
        dragBorderTranslate = null; dragBorderTranslateStarted = false; return
      }
      dragBorderTranslate = null; dragBorderTranslateStarted = false

      if (dragAnnotation && dragAnnotationStarted) { dragAnnotation = null; dragAnnotationStarted = false; return }
      dragAnnotation = null; dragAnnotationStarted = false

      if (dragRotation && dragRotationStarted) { dragRotation = null; dragRotationStarted = false; return }
      dragRotation = null; dragRotationStarted = false

      if (dragAnnResize && dragAnnResizeStarted) { dragAnnResize = null; dragAnnResizeStarted = false; return }
      dragAnnResize = null; dragAnnResizeStarted = false

      if (dragCrossElongate && dragCrossElongateStarted) { dragCrossElongate = null; dragCrossElongateStarted = false; return }
      dragCrossElongate = null; dragCrossElongateStarted = false

      if (dragPendingVertex && dragPendingVertexStarted) { dragPendingVertex = null; dragPendingVertexStarted = false; return }
      dragPendingVertex = null; dragPendingVertexStarted = false

      if (dragOobVertex && dragOobVertexStarted) { dragOobVertex = null; dragOobVertexStarted = false; return }
      dragOobVertex = null; dragOobVertexStarted = false

      if (dragResize && dragResizeStarted) { dragResize = null; dragResizeStarted = false; return }
      dragResize = null; dragResizeStarted = false

      if (dragOverlay && dragOverlayStarted) { dragOverlay = null; dragOverlayStarted = false; return }
      dragOverlay = null; dragOverlayStarted = false

      if (wasMultiTouch) return
      if (!start) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_PX) return

      // ── It's a tap ──────────────────────────────────────────────────────────
      if (useStore.getState().editor.layoutMode) return

      const rect = getRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const mapPt = screenToMap(sx, sy, vpRef.current)
      const state = useStore.getState()
      const { activeTool, selectedCourseId } = state.editor
      const proj = state.project
      if (!proj) return

      // Measure mode: tap on a route segment inserts a handle there. Tapping an
      // existing handle does nothing (it's a drag/long-press target).
      if (state.editor.measureMode) {
        const hidden = new Set(state.editor.measureHiddenLegs)
        if (findMeasurePointAt(sx, sy, vpRef.current, proj, state.editor.measureCourseId, hidden)) return
        const legHit = findMeasureLegAt(sx, sy, vpRef.current, proj, state.editor.measureCourseId, hidden)
        if (legHit) state.addMeasurePoint(legHit.fromControlId, legHit.toControlId, mapPt, legHit.segmentIndex)
        return
      }

      const ms = measureStartRef.current
      const hitControl = findControlAt(sx, sy, vpRef.current, proj, selectedCourseId, state.editor.appearance.controlScale, 0, state.editor.selectedSubmapIndex)

      if (activeTool === 'gap') {
        if (state.editor.gapRebuild) {
          handleGapRebuildTap(sx, sy, vpRef.current, proj, selectedCourseId)
        } else {
          handleGapTap(sx, sy, vpRef.current, proj, selectedCourseId)
        }
        return
      }

      if (activeTool === 'bend') {
        handleBendTap(sx, sy, vpRef.current, proj, selectedCourseId)
        return
      }

      if (activeTool === 'delete') {
        if (hitControl) {
          state.deleteControl(hitControl.id)
        } else {
          const hitOverlay = findOverlayAt(sx, sy, vpRef.current, proj, undefined, overlayPrintScaleOf(state))
          if (hitOverlay) {
            if (hitOverlay.kind === 'scalebar') state.deleteScaleBar(hitOverlay.id)
            else if (hitOverlay.kind === 'text') state.deleteTextLabel(hitOverlay.id)
            else state.deleteImageOverlay(hitOverlay.id)
          } else {
            const hitAnn = findAnnotationAt(sx, sy, vpRef.current, proj)
            if (hitAnn) state.deleteAnnotation(hitAnn.id)
          }
        }
        return
      }

      if (hitControl) {
        if (selectedCourseId) {
          state.addControlToCourse(selectedCourseId, hitControl.id)
        } else {
          state.setSelectedControl(hitControl.id)
          state.setSelectedOverlay(null)
          state.setSelectedAnnotation(null)
        }
        return
      }

      if (!selectedCourseId && activeTool === 'select') {
        const overlayHit = findOverlayAt(sx, sy, vpRef.current, proj, undefined, overlayPrintScaleOf(state))
        if (overlayHit) {
          state.setSelectedOverlay(overlayHit.id)
          state.setSelectedControl(null)
          state.setSelectedAnnotation(null)
          return
        }
        const annHit = findAnnotationAt(sx, sy, vpRef.current, proj)
        if (annHit && (annHit.type === 'crossing_point' || annHit.type === 'north_arrow' || annHit.type === 'out_of_bounds' || annHit.type === 'forbidden_route' || annHit.type === 'oob_boundary')) {
          state.setSelectedAnnotation(annHit.id)
          state.setSelectedControl(null)
          state.setSelectedOverlay(null)
          return
        }
        state.setSelectedAnnotation(null)
      }

      if (selectedCourseId) {
        state.setSelectedControl(null)
        return
      }

      switch (activeTool) {
        case 'place-start':   state.addControl('start',   mapPt); break
        case 'place-finish':  state.addControl('finish',  mapPt); break
        case 'place-control': state.addControl('control', mapPt); break
        case 'forbidden-route': state.addAnnotationPoint(mapPt); break
        case 'out-of-bounds': state.addAnnotationPoint(mapPt); break
        case 'out-of-bounds-boundary': state.addAnnotationPoint(mapPt); break
        case 'crossing-point':
          state.addAnnotationPoint(mapPt)
          state.commitAnnotation('crossing_point')
          state.setActiveTool('select')
          break
        case 'place-north-arrow':
          state.addAnnotationPoint(mapPt)
          state.commitAnnotation('north_arrow')
          state.setActiveTool('select')
          break
        case 'place-scalebar':
          state.addScaleBar(mapPt, proj.map.scale)
          state.setActiveTool('select')
          break
        case 'place-text':
          state.addTextLabel(mapPt)
          state.setActiveTool('select')
          break
        case 'place-image': {
          const pi = state.editor.pendingImage
          if (pi) {
            // addImageOverlay clears pendingImage itself when the add succeeds.
            state.addImageOverlay(mapPt, pi.dataUrl, pi.filename, pi.naturalWidth, pi.naturalHeight)
            state.setActiveTool('select')
          }
          break
        }
        case 'measure-scale':
          if (!ms) {
            measureStartRef.current = mapPt
            setMeasureStart(mapPt)
          } else {
            setScaleDialogPoints({ p1: ms, p2: mapPt })
          }
          break
        case 'select':
          state.setSelectedControl(null)
          state.setSelectedOverlay(null)
          break
      }
    }

    function onCancel(e: PointerEvent) {
      clearLongPress()
      flushDragMutation()
      // A cancelled layout drag discards the preview — nothing was committed.
      if (dragLayoutElStarted || dragBorderResizeStarted || dragBorderTranslateStarted) {
        useStore.getState().setLayoutDragPreview(null)
      }
      dragMeasure = null; dragMeasureStarted = false
      dragLayoutEl = null; dragLayoutElStarted = false
      if (dragLabelStarted) useStore.getState().setDraggingLabel(null)
      dragLabel = null; dragLabelStarted = false
      dragAnnResize = null; dragAnnResizeStarted = false
      dragCrossElongate = null; dragCrossElongateStarted = false
      dragOobVertex = null; dragOobVertexStarted = false
      dragPendingVertex = null; dragPendingVertexStarted = false
      dragBend = null; dragBendStarted = false
      dragMRE = null; dragMREStarted = false
      dragMapIssue = null; dragMapIssueStarted = false
      dragOverlay = null; dragOverlayStarted = false
      dragResize = null; dragResizeStarted = false
      dragRotation = null; dragRotationStarted = false
      dragAnnotation = null; dragAnnotationStarted = false
      dragBorderResize = null; dragBorderResizeStarted = false
      dragBorderTranslate = null; dragBorderTranslateStarted = false
      if (dragStarted) {
        if (pendingControlRaf) { cancelAnimationFrame(pendingControlRaf); pendingControlRaf = 0 }
        if (pendingControlPos && dragControlId) { useStore.getState().moveControl(dragControlId, pendingControlPos); pendingControlPos = null }
        if (dragControlEls.length) { for (const el of dragControlEls) el.style.transform = ''; dragControlEls = [] }
        dragLegsRef.current?.end()
        dragOrigPos = null
        useStore.getState().setDraggingControl(null)
      }
      dragControlId = null; dragOffset = null; dragStarted = false
      pos.delete(e.pointerId)
      down.delete(e.pointerId)
      if (pos.size === 2) {
        const [a, b] = [...pos.values()]
        pinchDist = Math.hypot(b.x - a.x, b.y - a.y)
      }
      if (pos.size === 0) multiTouch = false
      if (vpDirty && pos.size === 0) {
        vpDirty = false
        layoutPanningRef.current = false
        if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0 }
        syncTransform()
        setVpState(vpRef.current)
        stopPanning()
      }
    }

    function onDblClick() {
      const { activeTool, pendingAnnotationPoints } = useStore.getState().editor
      if (activeTool === 'forbidden-route' && pendingAnnotationPoints.length >= 2) {
        useStore.getState().commitAnnotation('forbidden_route')
        useStore.getState().setActiveTool('select')
      } else if (activeTool === 'out-of-bounds' && pendingAnnotationPoints.length >= 3) {
        useStore.getState().commitAnnotation('out_of_bounds')
        useStore.getState().setActiveTool('select')
      } else if (activeTool === 'out-of-bounds-boundary' && pendingAnnotationPoints.length >= 2) {
        useStore.getState().commitAnnotation('oob_boundary')
        useStore.getState().setActiveTool('select')
      }
    }

    // ── Right-click ────────────────────────────────────────────────────────
    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const state = useStore.getState()
      const { activeTool, selectedCourseId } = state.editor
      const proj = state.project
      if (!proj) return
      const rect = getRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      // Measure mode: right-click removes a handle, or clears the whole leg.
      if (state.editor.measureMode) {
        const hidden = new Set(state.editor.measureHiddenLegs)
        const ptHit = findMeasurePointAt(sx, sy, vpRef.current, proj, state.editor.measureCourseId, hidden)
        if (ptHit) { state.removeMeasurePoint(ptHit.fromControlId, ptHit.toControlId, ptHit.index); return }
        const legHit = findMeasureLegAt(sx, sy, vpRef.current, proj, state.editor.measureCourseId, hidden)
        if (legHit) state.clearMeasureLeg(legHit.fromControlId, legHit.toControlId)
        return
      }

      if (activeTool === 'gap') {
        handleGapRightClick(sx, sy, vpRef.current, proj, selectedCourseId)
        return
      }

      if (activeTool === 'bend') {
        handleBendRightClick(sx, sy, vpRef.current, proj, selectedCourseId)
        return
      }

      if (!selectedCourseId) return
      const hit = findControlAt(sx, sy, vpRef.current, proj, selectedCourseId, state.editor.appearance.controlScale, 0, state.editor.selectedSubmapIndex)
      if (!hit) return

      const course = proj.courses.find(c => c.id === selectedCourseId)
      if (!course) return
      for (let i = course.controls.length - 1; i >= 0; i--) {
        if (course.controls[i].controlId === hit.id) {
          state.removeControlFromCourse(selectedCourseId, course.controls[i].id)
          return
        }
      }
    }

    function updateOobPreview(e: PointerEvent) {
      const state = useStore.getState().editor
      if (state.activeTool !== 'out-of-bounds' || state.pendingAnnotationPoints.length === 0 || e.pointerType === 'touch') {
        setOobCursorPoint(null)
        return
      }
      const rect = getRect()
      const cursor = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
      setOobCursorPoint(cursor)
    }

    function updateGapRing(e: PointerEvent) {
      if (e.pointerType === 'touch') return
      const g = gapRingRef.current
      if (!g) return
      if (useStore.getState().editor.activeTool !== 'gap') {
        g.style.display = 'none'
        return
      }
      const rect = getRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      g.setAttribute('transform', `translate(${sx},${sy})`)
      g.style.display = ''
    }
    function onLeave() {
      const g = gapRingRef.current
      if (g) g.style.display = 'none'
      setOobCursorPoint(null)
    }

    div.addEventListener('wheel',        onWheel,   { passive: false })
    div.addEventListener('pointerdown',  onDown)
    div.addEventListener('pointermove',  onMove)
    div.addEventListener('pointermove',  updateGapRing)
    div.addEventListener('pointermove',  updateOobPreview)
    div.addEventListener('pointerup',    onUp)
    div.addEventListener('pointercancel', onCancel)
    div.addEventListener('dblclick',     onDblClick)
    div.addEventListener('contextmenu',  onContextMenu)
    div.addEventListener('pointerleave', onLeave)

    return () => {
      if (wheelTimer) clearTimeout(wheelTimer)
      if (pendingRaf) cancelAnimationFrame(pendingRaf)
      if (pendingControlRaf) cancelAnimationFrame(pendingControlRaf)
      div.removeEventListener('wheel',        onWheel)
      div.removeEventListener('pointerdown',  onDown)
      div.removeEventListener('pointermove',  onMove)
      div.removeEventListener('pointermove',  updateGapRing)
      div.removeEventListener('pointermove',  updateOobPreview)
      div.removeEventListener('pointerup',    onUp)
      div.removeEventListener('pointercancel', onCancel)
      div.removeEventListener('dblclick',     onDblClick)
      div.removeEventListener('contextmenu',  onContextMenu)
      div.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  function getAnnotationType(): AnnotationType | null {
    if (activeTool === 'forbidden-route')    return 'forbidden_route'
    if (activeTool === 'crossing-point')     return 'crossing_point'
    if (activeTool === 'out-of-bounds')      return 'out_of_bounds'
    if (activeTool === 'out-of-bounds-boundary') return 'oob_boundary'
    if (activeTool === 'place-north-arrow')  return 'north_arrow'
    return null
  }

  const mapSaturation = useStore(s => s.editor.mapSaturation)
  const overprint = useStore(s => s.project?.overprint ?? 1)
  const overprintMode = useStore(s => s.project?.overprintMode ?? 'simulated')
  const gapSize = useStore(s => s.editor.gapSize)
  const gapRebuild = useStore(s => s.editor.gapRebuild)
  const selectedVariationId = useStore(s => s.editor.selectedVariationId)
  const selectedCourseRaw = courses.find(c => c.id === selectedCourseId) ?? null
  const selectedCourse = useMemo(() => {
    if (!selectedCourseRaw || !selectedVariationId) return selectedCourseRaw
    const variation = selectedCourseRaw.variations?.find(v => v.id === selectedVariationId)
    if (!variation) return selectedCourseRaw
    const resolved = resolveVariation(selectedCourseRaw, variation)
    return { ...selectedCourseRaw, controls: resolved }
  }, [selectedCourseRaw, selectedVariationId])
  const isCourseMode = !!selectedCourseId

  // Measure mode: the (master) course being measured + its live measured total.
  const measureCourse = measureMode ? (courses.find(c => c.id === measureCourseId) ?? null) : null
  const measureHiddenSet = useMemo(() => new Set(measureHiddenLegs), [measureHiddenLegs])
  const measureDim = measureMode ? 0.25 : 1
  const measureTotal = measureCourse
    ? resolveCourseLength(measureCourse, computeCourseDistances(measureCourse, controls, map, measuredLegs))
    : 0

  const layoutControls = useMemo(() => {
    if (!layoutMode || !selectedCourse) return controls
    const ids = new Set(selectedCourse.controls.map(cc => cc.controlId))
    return controls.filter(c => ids.has(c.id))
  }, [layoutMode, selectedCourse, controls])

  const cursor = layoutMode ? 'grab'
    : measureMode ? 'crosshair'
    : activeTool === 'bend' ? 'crosshair'
    : activeTool === 'gap' ? 'none'
    : isCourseMode ? 'default'
    : activeTool === 'select' ? 'grab'
    : 'crosshair'

  // Overprint crossfade: t=0 → solid knockout ink, t=1 → full multiply overprint.
  // The multiply pass lives in its own sibling <svg> (a direct child of the
  // container) so its backdrop is the map — putting mix-blend-mode inside the
  // transformed group would blend against an empty backdrop instead.
  //
  // 'none'      → solid ink on top (no multiply).
  // 'below'     → only achievable in HD (vector): draw ink solid, then redraw the
  //               black/brown/blue map layers on top (see topOverlay below). On the
  //               fast raster screen it falls back to 'simulated'.
  // 'simulated' → multiply pass at the slider intensity.
  const topOverprintColors = loadedMap.topOverprintColors ?? []
  const belowHD = overprintMode === 'below' && !useRaster && loadedMap.type === 'svg' && topOverprintColors.length > 0
  const overprintT = overprintMode === 'none' || belowHD ? 0 : Math.max(0, Math.min(1, overprint))
  const annBase = {
    annotations,
    pendingPoints: pendingAnnotationPoints,
    pendingType: getAnnotationType(),
    cursorPoint: oobCursorPoint,
    map,
    spec: resolveSpec(projectSpec, selectedCourse?.spec),
    selectedAnnotationId,
  }

  return (
    <div
      ref={divRef}
      className="w-full h-full overflow-hidden bg-gray-100 relative"
      // `isolation: isolate` keeps the overprint multiply blending against the
      // map deterministically (otherwise GPU layer promotion drops the backdrop).
      style={{ cursor, touchAction: 'none', userSelect: 'none', isolation: 'isolate' }}
    >
      {/* Map layer — HTML div+canvas for GPU-composited pan/zoom */}
      <div
        ref={mapDivRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          willChange: 'transform',
          transformOrigin: '0 0',
          filter: mapSaturation < 1 ? `saturate(${mapSaturation})` : undefined,
          pointerEvents: 'none',
        }}
      >
        <MapCanvasLayer loadedMap={loadedMap} srcOverride={mapOverprint && useRaster && overprintRasterUrl ? overprintRasterUrl : undefined} onPixelSize={(w, h) => { canvasPixelRef.current = [w, h]; syncTransform() }} />
      </div>
      {/* HD SVG overlay — true vector quality at rest (OCAD HD mode only) */}
      {!useRaster && loadedMap.type === 'svg' && (
        <svg
          key="hd-map"
          ref={hdSvgRef}
          width="100%" height="100%"
          style={{
            display: 'block',
            position: 'absolute',
            inset: 0,
            filter: mapSaturation < 1 ? `saturate(${mapSaturation})` : undefined,
            pointerEvents: 'none',
          }}
        >
          <g ref={hdMapGRef} style={{
            transformOrigin: '0 0',
          }}>
            <MapLayer loadedMap={loadedMap} useRaster={false} />
          </g>
        </svg>
      )}
      {/* Annotations — solid ink pass + chrome (below course and border) */}
      <svg key="overlay" width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0 }}>
        <g ref={overlayGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
          {overprintT < 1 && (
            <g opacity={1 - overprintT}>
              <AnnotationsLayer {...annBase} render="ink" />
            </g>
          )}
          <AnnotationsLayer {...annBase} render="chrome" />
        </g>
      </svg>
      {/* Annotation overprint (multiply) pass — blends with the map below */}
      {overprintT > 0 && (
        <svg key="overlay-mult" width="100%" height="100%"
          style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply', opacity: overprintT }}>
          <g ref={overlayMultGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
            <AnnotationsLayer {...annBase} render="ink" />
          </g>
        </svg>
      )}

      {/* Course layer (controls + labels + legs) — below the border mask.
          Solid ink pass + chrome (drag preview, bend handles, debug). */}
      <svg key="course" width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <g ref={courseGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
          {overprintT < 1 && (
            <g opacity={(1 - overprintT) * measureDim}>
              {isAllCoursesView ? (
                <AllCoursesLegsLayer
                  courses={courses}
                  controls={controls}
                  map={map}
                  appearance={appearance}
                  projectSpec={projectSpec}
                  hiddenIds={allCoursesHidden}
                  _rev={projectRevision}
                />
              ) : (
                <LegsLayer
                  course={selectedCourse}
                  controls={controls}
                  map={map}
                  appearance={appearance}
                  projectSpec={projectSpec}
                  selectedSubmapIndex={selectedSubmapIndex}
                  _rev={projectRevision}
                />
              )}
              <ControlsLayer
                controls={layoutControls}
                course={selectedCourse}
                _rev={projectRevision}
              />
            </g>
          )}
          {/* Measure-mode route polylines + handles (chrome, full strength). */}
          {measureMode && (
            <MeasureLayer
              course={measureCourse}
              controls={controls}
              map={map}
              measuredLegs={measuredLegs}
              hiddenLegs={measureHiddenSet}
              spec={resolveSpec(projectSpec, measureCourse?.spec)}
              controlScale={appearance.controlScale}
            />
          )}
          {/* Drag preview — chrome, always solid so it stays visible mid-drag. */}
          <DragLegsLayer
            ref={dragLegsRef}
            courses={courses}
            selectedCourse={selectedCourse}
            controls={controls}
            map={map}
            appearance={appearance}
            projectSpec={projectSpec}
            viewportScale={vp.scale}
          />
          {/* Handles outside overprint multiply: divider always, bend handles in bend mode */}
          {!layoutMode && (
            <LegsLayer
              course={selectedCourse}
              controls={controls}
              map={map}
              showBendHandles={activeTool === 'bend'}
              handlesOnly
              appearance={appearance}
              projectSpec={projectSpec}
              selectedSubmapIndex={selectedSubmapIndex}
              _rev={projectRevision}
            />
          )}
          {import.meta.env.DEV && (
            <DebugHitboxes controls={controls} map={map} vp={vp} selectedCourseId={selectedCourseId} appearance={appearance} projectSpec={projectSpec} />
          )}
        </g>
        {activeTool === 'gap' && (() => {
          const upm = unitsPerMm(map)
          const gapSpec = resolveSpec(projectSpec, selectedCourse?.spec)
          const sf = symbolScaleFactor(gapSpec, map.scale)
          const controlR = getSymbolDims(gapSpec).controlR * upm * sf * appearance.controlScale * vp.scale
          const arcLen = controlR * gapSize * Math.PI / 180
          const cursorR = arcLen / 2
          const cursorColor = gapRebuild ? '#16a34a' : '#ea580c'
          return (
            <g ref={gapRingRef} style={{ pointerEvents: 'none', display: 'none' }}>
              <circle
                r={cursorR}
                fill={cursorColor}
                fillOpacity={0.25}
                stroke={cursorColor}
                strokeWidth={1}
              />
            </g>
          )
        })()}
      </svg>
      {/* Course overprint (multiply) pass — legs + controls + labels blend with the map */}
      {overprintT > 0 && (
        <svg key="course-mult" width="100%" height="100%"
          style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply', opacity: overprintT * measureDim }}>
          <g ref={courseMultGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
            {isAllCoursesView ? (
              <AllCoursesLegsLayer
                courses={courses}
                controls={controls}
                map={map}
                appearance={appearance}
                projectSpec={projectSpec}
                hiddenIds={allCoursesHidden}
                _rev={projectRevision}
              />
            ) : (
              <LegsLayer
                course={selectedCourse}
                controls={controls}
                map={map}
                appearance={appearance}
                projectSpec={projectSpec}
                selectedSubmapIndex={selectedSubmapIndex}
                _rev={projectRevision}
              />
            )}
            <ControlsLayer
              controls={layoutControls}
              course={selectedCourse}
              _rev={projectRevision}
            />
          </g>
        </svg>
      )}

      {/* 'Below' overprint (HD only): redraw the black/brown/blue map layers on
          top of the course ink so the purple sits beneath them in the stack. */}
      {belowHD && (
        <svg key="top-overprint" width="100%" height="100%"
          style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply', filter: mapSaturation < 1 ? `saturate(${mapSaturation})` : undefined }}>
          <g ref={topOverlayGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
            <MapLayer loadedMap={loadedMap} useRaster={false} keepColors={topOverprintColors} transparent />
          </g>
        </svg>
      )}

      {/* Layout mode page overlay (border mask) */}
      {/* eslint-disable-next-line react-hooks/refs -- reading cached DOM rect / recording the rendered vp is harmless */}
      {layoutMode && layoutCourse?.layout && (() => {
        const submaps = computeSubmaps(layoutCourse)
        const submapLayout = submapLayoutView(layoutCourse.layout, layoutSubmapIndex) ?? layoutCourse.layout
        const submapCourse = submaps.length > 1 && submaps[layoutSubmapIndex]
          ? { ...layoutCourse, controls: submaps[layoutSubmapIndex].controls }
          : layoutCourse
        const sheetView = clueSheetPreviewView(layoutCourse, layoutSubmapIndex, clueSheetHideSubmapRestart, submapLayout.clueSheetBreaks)
        pageOverlayVpRef.current = vp
        return (
          <div ref={pageOverlayRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', transformOrigin: '0 0', willChange: 'transform' }}>
            <PageOverlay
              layout={submapLayout}
              map={map}
              viewport={vp}
              canvasW={rectCacheRef.current?.width ?? 800}
              canvasH={rectCacheRef.current?.height ?? 600}
              course={submapCourse}
              controls={controls}
              cellSize={clueSheetFontSize}
              trailingFlip={layoutTrailingFlip(layoutCourse, layoutSubmapIndex)}
              clueSheetCourse={sheetView.course}
              clueSheetBreaks={sheetView.breaks}
              projectSpec={projectSpec}
            />
          </div>
        )
      })()}

      {/* Overlays — above the border mask, always visible */}
      <svg key="above-border" width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <g ref={aboveBorderGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
          {(() => {
            // Drags write through submapLayoutView(layout, layoutSubmapIndex)
            // (see layoutSlice), so render from the same view — reading the
            // top-level layout here would show submap 0's positions while
            // edits land invisibly on the active submap.
            const layoutView = layoutCourse?.layout
              ? submapLayoutView(layoutCourse.layout, layoutSubmapIndex) ?? layoutCourse.layout
              : undefined
            return (
              <OverlaysLayer
                scaleBars={scaleBars}
                textLabels={textLabels}
                imageOverlays={imageOverlays}
                map={map}
                selectedOverlayId={selectedOverlayId}
                positionOverrides={layoutView?.overlayPositions}
                printScaleOverride={layoutView?.printScale ?? layoutDefaultPrintScale}
              />
            )
          })()}
          {/* Handles layer — renders above everything so they're always clickable */}
          {(() => {
            const upm = unitsPerMm(map)
            const spec = resolveSpec(projectSpec, selectedCourse?.spec)
            // Handles scale with the symbol scale factor like every other
            // symbol — flat mm × upm is invisible on low-upm bitmap/PDF maps.
            const sf = symbolScaleFactor(spec, map.scale)
            const strokeW = 0.2 * upm * sf
            const elements: React.ReactNode[] = []

            if (selectedAnnotationId) {
              const ann = annotations.find(a => a.id === selectedAnnotationId)
              if (ann?.type === 'crossing_point' && ann.points[0]) {
                const d = getAnnotationDims(sf * upm)
                const { x, y } = ann.points[0]
                const totalHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
                const handleR = 1 * upm * sf
                const rotation = ann.rotation ?? 0
                elements.push(
                  <g key="cp-handles" transform={`rotate(${rotation}, ${x}, ${y})`}>
                    <circle
                      cx={x} cy={y - totalHH - handleR * 2}
                      r={handleR}
                      fill={IOF_PURPLE} stroke="white" strokeWidth={strokeW}
                    />
                    <rect
                      x={x - handleR} y={y + totalHH + handleR}
                      width={handleR * 2} height={handleR * 2}
                      rx={strokeW * 2}
                      fill={IOF_PURPLE} stroke="white" strokeWidth={strokeW}
                    />
                  </g>
                )
              }
              if (ann?.type === 'north_arrow' && ann.points[0]) {
                const h = northArrowHeight(upm, map.scale, spec, ann.scale ?? 1)
                const geo = northArrowGeometry(h, upm, sf)
                const { x, y } = ann.points[0]
                const rotation = ann.rotation ?? 0
                const color = ann.color ?? '#38bdf8'
                const rightX = x + geo.halfBase
                const baseY = y + geo.baseLocalY
                elements.push(
                  <g key="na-handles" transform={`rotate(${rotation}, ${x}, ${y})`}>
                    <circle
                      cx={x + geo.rotHandleLocalX} cy={y + geo.rotHandleLocalY}
                      r={geo.handleR}
                      fill={color} stroke="white" strokeWidth={strokeW}
                    />
                    <rect
                      x={rightX - geo.handleR} y={baseY - geo.handleR}
                      width={geo.handleR * 2} height={geo.handleR * 2}
                      rx={strokeW * 2}
                      fill={color} stroke="white" strokeWidth={strokeW}
                    />
                  </g>
                )
              }
              if (ann?.type === 'out_of_bounds' && ann.points.length >= 3) {
                const handleR = 1 * upm * sf
                elements.push(
                  <g key="oob-handles">
                    {ann.points.map((p, i) => (
                      <circle key={i}
                        cx={p.x} cy={p.y} r={handleR}
                        fill={IOF_PURPLE} stroke="white" strokeWidth={strokeW}
                        style={{ cursor: 'move' }}
                      />
                    ))}
                  </g>
                )
              }
            }

            if (activeTool === 'out-of-bounds' && pendingAnnotationPoints.length > 0) {
              const handleR = 1 * upm * sf
              elements.push(
                <g key="pending-oob-handles">
                  {pendingAnnotationPoints.map((p, i) => (
                    <circle key={i}
                      cx={p.x} cy={p.y} r={handleR}
                      fill={IOF_PURPLE} stroke="white" strokeWidth={strokeW}
                      style={{ cursor: 'move' }}
                    />
                  ))}
                </g>
              )
            }

            if (selectedOverlayId) {
              const selImg = imageOverlays.find(o => o.id === selectedOverlayId)
              if (selImg) {
                // Same print-scale adjustment as OverlaysLayer so the handle
                // sits on the rendered image corner.
                const imgUpm = overlayUpmOf(useStore.getState())
                const w = selImg.widthMm * imgUpm
                const h = selImg.heightMm * imgUpm
                const handleSize = 3 * imgUpm
                elements.push(
                  <rect key="img-resize"
                    x={selImg.position.x + w - handleSize / 2}
                    y={selImg.position.y + h - handleSize / 2}
                    width={handleSize} height={handleSize}
                    fill="#ea580c" stroke="white" strokeWidth={strokeW}
                  />
                )
              }
            }

            return elements.length > 0 ? <g style={{ pointerEvents: 'none' }}>{elements}</g> : null
          })()}
        </g>
      </svg>

      {/* Saturation slider + HD toggle */}
      <div className="absolute top-[var(--ui-top)] left-2 flex flex-col gap-1 z-10">
        <div className="flex items-center gap-1.5 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm border border-gray-200">
          <span className="text-[10px] text-gray-400 select-none">Map</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mapSaturation}
            onChange={e => useStore.getState().setMapSaturation(parseFloat(e.target.value))}
            className="w-16 h-1 accent-orange-600"
          />
          {loadedMap.type === 'svg' && loadedMap.rasterUrl && (
            <>
              <div className="w-px h-4 bg-gray-300" />
              <button
                onClick={() => setUseRaster(r => !r)}
                title={useRaster ? 'Switch to full-quality SVG (slower)' : 'Switch to raster (faster)'}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                  useRaster ? 'text-gray-400' : 'text-orange-600 bg-orange-50'
                }`}
              >
                HD
              </button>
            </>
          )}
          {layoutMode && layoutCourse?.layout
            ? <LayoutScaleLabel printScale={layoutCourse.layout.printScale} mapScale={map.scale} />
            : map.scale > 0 && <MapScaleInput scale={map.scale} />
          }
        </div>
        {isAllCoursesView && <AllCoursesLegend courses={courses} hiddenIds={allCoursesHidden} />}
      </div>

      {measureStart && !scaleDialogPoints && (
        <div className="absolute top-[var(--ui-top)] left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1 rounded-full pointer-events-none z-10">
          Click second point, then enter real distance
        </div>
      )}

      {measureMode && <MeasureBanner total={measureTotal} />}

      {measureMode && measureCourse && (
        <MeasureLegPanel course={measureCourse} controls={controls} />
      )}

      {scaleDialogPoints && (
        <ScaleInputDialog
          onConfirm={m => {
            useStore.getState().setMapScaleMeasurement(scaleDialogPoints.p1, scaleDialogPoints.p2, m, loadedMap.renderScale)
            setScaleDialogPoints(null)
            measureStartRef.current = null
            setMeasureStart(null)
            useStore.getState().setActiveTool('select')
          }}
          onCancel={() => {
            setScaleDialogPoints(null)
            measureStartRef.current = null
            setMeasureStart(null)
            useStore.getState().setActiveTool('select')
          }}
        />
      )}

      {((activeTool === 'forbidden-route' && pendingAnnotationPoints.length >= 2) ||
        (activeTool === 'out-of-bounds' && pendingAnnotationPoints.length >= 3)) && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-purple-700/90 text-white text-sm px-3 py-1.5 rounded-full shadow z-10">
          <span className="text-purple-100 text-xs">{pendingAnnotationPoints.length} points</span>
          <button
            onClick={() => {
              const tool = useStore.getState().editor.activeTool
              if (tool === 'forbidden-route') useStore.getState().commitAnnotation('forbidden_route')
              else if (tool === 'out-of-bounds') useStore.getState().commitAnnotation('out_of_bounds')
            }}
            className="bg-white/20 hover:bg-white/30 transition-colors rounded-full px-2.5 py-0.5 text-xs font-semibold"
          >
            Done
          </button>
          <button
            onClick={() => useStore.getState().cancelAnnotation()}
            className="text-purple-200 hover:text-white transition-colors text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {splitPrompt && (
        <div
          data-split-prompt
          className="absolute z-20 flex flex-col gap-1.5 bg-white rounded-lg shadow-lg border border-gray-200 p-2 text-xs"
          style={{ left: `clamp(130px, ${splitPrompt.sx}px, calc(100% - 130px))`, top: `min(${splitPrompt.sy + 18}px, calc(100% - 80px))`, transform: 'translateX(-50%)', maxWidth: 260 }}
        >
          <div className="text-gray-600 px-1 leading-snug">
            This control is in {splitPrompt.courseCount === 2 ? 'two' : splitPrompt.courseCount} courses
          </div>
          <div className="flex items-center gap-1">
            <button
              className="flex-1 px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 text-left"
              onClick={() => {
                const nc = useStore.getState().splitControl(splitPrompt.controlId, splitPrompt.courseId, splitPrompt.newPos, splitPrompt.origPos)
                if (nc) useStore.getState().setSelectedControl(nc.id)
                setSplitPrompt(null)
              }}
            >
              Split in two controls
            </button>
            <button
              className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100 shrink-0"
              onClick={() => setSplitPrompt(null)}
            >
              {splitPrompt.courseCount === 2 ? 'Move for both' : 'Move for all'}
            </button>
          </div>
        </div>
      )}

      {import.meta.env.DEV && <FpsCounter />}
    </div>
  )
}
