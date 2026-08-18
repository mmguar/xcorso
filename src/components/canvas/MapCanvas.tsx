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
import { unitsPerMm, resolveVariation, defaultLabelOffset, buildSequenceMap, formatSequenceLabel, defaultControlLabel, submapLayoutView, buildAllControlsCourse, IOF_PURPLE, buildPagePlan } from '../../lib/courseUtils'
import type { AnnotationType, MapPoint, Viewport, Control, MapConfig, AppearanceSettings, EventSpec, Course } from '../../types'
import { resolveSpec, getSymbolDims, symbolScaleFactor, getAnnotationDims, controlSymbolRadiusMm } from '../../lib/symbolSpec'
import { mmToMap, pageDimsFor, ALL_CONTROLS_ID } from '../../lib/pdfExport'
import { NumericInput } from '../ui/NumericInput'
import { descriptionSheetSize, descriptionSheetPartSizes } from '../../lib/pdfDescriptionSheet'
import {
  screenToMap, pxToMap,
  findControlAt, findBendPointAt, findMarkedRouteEndAt, findMapIssueAt,
  findMeasureLegAt, findMeasurePointAt,
  findAnnotationAt, findOverlayAt, findLabelAt,
  findCrossingPointRotationHandle, findCrossingPointResizeHandle, findNorthArrowRotationHandle, findNorthArrowResizeHandle, findOobVertexHandle,
  labelBoxSize,
} from './hitTesting'

/** Resolve the active layout for a given layout target (course or all-controls). */
function resolveLayoutTarget(proj: { courses: Course[]; allControlsLayout?: import('../../types').SubmapLayout }, courseId: string, submapIndex: number): import('../../types').SubmapLayout | undefined {
  if (courseId === ALL_CONTROLS_ID) return proj.allControlsLayout
  const c = proj.courses.find(c => c.id === courseId)
  return c?.layout ? submapLayoutView(c.layout, submapIndex) : undefined
}

/** Effective print scale for overlay sizing: the active layout submap's scale
 * in layout mode, else the project-wide layout default. Undefined → map scale.
 * Must match the printScaleOverride passed to OverlaysLayer. */
function overlayPrintScaleOf(st: ReturnType<typeof useStore.getState>): number | undefined {
  const proj = st.project!
  if (st.editor.layoutMode && st.editor.layoutCourseId) {
    const layout = resolveLayoutTarget(proj, st.editor.layoutCourseId, st.editor.layoutSubmapIndex)
    if (layout) return layout.printScale
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

import { handleGapTap, handleGapRebuildTap, handleGapRightClick, handleBendTap, handleBendRightClick } from './toolHandlers'
import { computeCourseDistances, resolveCourseLength, formatDistance, legKey } from '../../lib/distance'
import { projectOnPolyline, flattenSmooth } from '../../lib/geometry'

const TAP_PX    = 8
const MIN_SCALE = 0.05
const MAX_SCALE = 50
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Height of the mobile panel strip overlapping the canvas top (0 on desktop). */
function mobilePanelOverlap(rectTop: number): number {
  const mp = document.querySelector<HTMLElement>('[data-mobile-panel]')
  return mp ? Math.max(0, mp.getBoundingClientRect().bottom - rectTop) : 0
}

function MapScaleInput({ scale }: { scale: number }) {
  return (
    <>
      <div className="w-px h-4 bg-gray-300" />
      <span className="text-[10px] text-gray-400 select-none">1:</span>
      <NumericInput
        value={scale}
        onCommit={v => useStore.getState().setMapScale(v, 'manual')}
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
        const { w: textW, h: textH } = labelBoxSize(labelText, fontSize)
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

interface ActiveDrag {
  started: boolean
  onStart(): void
  onMove(e: PointerEvent): void
  onCommit(e: PointerEvent): void
  onCancel(): void
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
    if (!s.editor.layoutCourseId || s.editor.layoutCourseId === ALL_CONTROLS_ID) return null
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
  const layoutTargetLayout = useStore(s => {
    if (!s.editor.layoutMode || !s.editor.layoutCourseId || !s.project) return null
    return resolveLayoutTarget(s.project, s.editor.layoutCourseId, s.editor.layoutSubmapIndex) ?? null
  })
  useLayoutEffect(() => {
    if (!layoutMode || !layoutTargetLayout) {
      prevLayoutRef.current = null
      return
    }
    const layout = layoutTargetLayout
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
    const overlap = mobilePanelOverlap(rect.top)

    const { w: pageW, h: pageH } = pageDimsFor(layout.pageSize, layout.orientation)
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
  }, [layoutMode, layoutCourseId, layoutSubmapIndex, layoutTargetLayout, map, layoutSnapRequest])

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
    // On mobile, the panel overlaps the canvas top — shift center into visible area
    const cy = (mobilePanelOverlap(rect.top) + rect.height) / 2
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

    let activeDrag: ActiveDrag | null = null

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
      if (!rect || !st.editor.layoutCourseId || !st.project) return
      const smIdx = st.editor.layoutSubmapIndex
      const layout = resolveLayoutTarget(st.project, st.editor.layoutCourseId, smIdx)
      if (!layout?.mapBorder) return
      st.moveCourseLayout(st.editor.layoutCourseId, { mapBorder: { ...layout.mapBorder, ...rect } }, smIdx)
    }

    // Adopt the map point under the canvas center as the layout's mapCenter —
    // shared by pointerup (pan/pinch end) and wheel-zoom idle in layout mode.
    // Must match the snap effect's page position, including the mobile-panel
    // overlap compensation, or each pan would nudge the page.
    function commitLayoutMapCenter() {
      const st = useStore.getState()
      if (!st.editor.layoutMode || !st.editor.layoutCourseId || !st.project) return
      const rect = getRect()
      const overlap = mobilePanelOverlap(rect.top)
      const v = vpRef.current
      const centerX = (rect.width / 2 - v.x) / v.scale
      const centerY = ((overlap + rect.height) / 2 - v.y) / v.scale
      const layout = resolveLayoutTarget(st.project, st.editor.layoutCourseId, st.editor.layoutSubmapIndex)
      const oldCenter = layout?.mapCenter ?? null
      if (!oldCenter || Math.abs(centerX - oldCenter.x) > 1 || Math.abs(centerY - oldCenter.y) > 1) {
        st.beginLayoutDrag()
        st.setLayoutMapCenter(st.editor.layoutCourseId, { x: centerX, y: centerY }, st.editor.layoutSubmapIndex)
      }
    }

    function makeLayoutElDrag(startX: number, startY: number, element: string, ox: number, oy: number, wMm: number, hMm: number): ActiveDrag {
      let nx = ox, ny = oy
      return {
        started: false,
        onStart() { useStore.getState().beginLayoutDrag() },
        onMove(ev) {
          const st = useStore.getState()
          const lo = st.project ? resolveLayoutTarget(st.project, st.editor.layoutCourseId!, st.editor.layoutSubmapIndex) : undefined
          if (!lo) return
          const { w: pw, h: ph } = pageDimsFor(lo.pageSize, lo.orientation)
          const hwm = mmToMap({ x: pw / 2, y: 0 }, st.project!.map, lo.printScale).x
          const mmToPx = (hwm * 2 * vpRef.current.scale) / pw
          const dx = (ev.clientX - startX) / mmToPx
          const dy = (ev.clientY - startY) / mmToPx
          if (element.startsWith('overlay:')) {
            const newX = ox + dx, newY = oy + dy
            scheduleDragMutation(() => st.updateLayoutElement(st.editor.layoutCourseId!, element, { x: newX, y: newY }, st.editor.layoutSubmapIndex))
          } else {
            nx = Math.max(0, Math.min(pw - wMm, ox + dx))
            ny = Math.max(0, Math.min(ph - hMm, oy + dy))
            scheduleDragMutation(() => st.setLayoutDragPreview({ type: 'element', key: element, x: nx, y: ny }))
          }
        },
        onCommit() {
          if (!element.startsWith('overlay:')) {
            const st = useStore.getState()
            if (st.editor.layoutCourseId) {
              st.updateLayoutElement(st.editor.layoutCourseId, element, { x: nx, y: ny }, st.editor.layoutSubmapIndex)
            }
            st.setLayoutDragPreview(null)
          }
        },
        onCancel() {
          if (!element.startsWith('overlay:')) useStore.getState().setLayoutDragPreview(null)
        },
      }
    }

    function makeRotationDrag(annId: string, center: MapPoint): ActiveDrag {
      return {
        started: false,
        onStart() { useStore.getState().beginRotateAnnotation() },
        onMove(ev) {
          const rect = getRect()
          const mp = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
          const angle = Math.atan2(mp.x - center.x, -(mp.y - center.y)) * 180 / Math.PI
          scheduleDragMutation(() => useStore.getState().rotateAnnotation(annId, angle))
        },
        onCommit() {},
        onCancel() {},
      }
    }

    function makeControlDrag(hit: { id: string; position: { x: number; y: number } }, mapPt: { x: number; y: number }): ActiveDrag {
      const id = hit.id
      const offset = { dx: mapPt.x - hit.position.x, dy: mapPt.y - hit.position.y }
      let origPos: { x: number; y: number } | null = null
      let controlEls: SVGGElement[] = []
      let pendingPos: { x: number; y: number } | null = null
      let raf = 0
      return {
        started: false,
        onStart() {
          const ctrl = useStore.getState().project?.controls.find(c => c.id === id)
          useStore.getState().beginMoveControl(ctrl ? `Move ${defaultControlLabel(ctrl)}` : undefined)
          useStore.getState().setDraggingControl(id)
          origPos = ctrl ? { ...ctrl.position } : null
          const sel = `[data-control-id="${id}"]`
          controlEls = [courseGRef.current, courseMultGRef.current]
            .map(g => g?.querySelector(sel) as SVGGElement | null)
            .filter((el): el is SVGGElement => el != null)
          dragLegsRef.current?.begin(id)
        },
        onMove(ev) {
          const rect = getRect()
          const mp = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
          pendingPos = { x: mp.x - offset.dx, y: mp.y - offset.dy }
          if (!raf) {
            raf = requestAnimationFrame(() => {
              raf = 0
              if (pendingPos && origPos && controlEls.length) {
                const dx = pendingPos.x - origPos.x
                const dy = pendingPos.y - origPos.y
                for (const el of controlEls) el.style.transform = `translate(${dx}px,${dy}px)`
              }
              if (pendingPos) dragLegsRef.current?.update(pendingPos)
            })
          }
        },
        onCommit(ev) {
          if (raf) { cancelAnimationFrame(raf); raf = 0 }
          const splitNewPos = pendingPos
          const splitOrigPos = origPos
          if (pendingPos) { useStore.getState().moveControl(id, pendingPos); pendingPos = null }
          if (controlEls.length) { for (const el of controlEls) el.style.transform = ''; controlEls = [] }
          dragLegsRef.current?.end()
          origPos = null
          useStore.getState().setDraggingControl(null)
          if (splitNewPos && splitOrigPos) {
            const st = useStore.getState()
            const cid = st.editor.selectedCourseId
            const proj = st.project
            if (cid && proj) {
              const containing = proj.courses.filter(c => c.controls.some(cc => cc.controlId === id))
              const selCourse = containing.find(c => c.id === cid)
              if (selCourse && containing.length >= 2) {
                const rect = getRect()
                setSplitPrompt({
                  controlId: id, courseId: cid, courseName: selCourse.name, courseCount: containing.length,
                  newPos: splitNewPos, origPos: splitOrigPos, sx: ev.clientX - rect.left, sy: ev.clientY - rect.top,
                })
              }
            }
          }
        },
        onCancel() {
          if (raf) { cancelAnimationFrame(raf); raf = 0 }
          if (pendingPos) { useStore.getState().moveControl(id, pendingPos); pendingPos = null }
          if (controlEls.length) { for (const el of controlEls) el.style.transform = ''; controlEls = [] }
          dragLegsRef.current?.end()
          origPos = null
          useStore.getState().setDraggingControl(null)
        },
      }
    }

    function makeMREDrag(hit: { courseId: string; courseControlId: string }): ActiveDrag {
      const { courseId, courseControlId } = hit
      return {
        started: false,
        onStart() { useStore.getState().beginMoveMarkedRouteEnd() },
        onMove(ev) {
          const rect = getRect()
          const mp = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
          scheduleDragMutation(() => useStore.getState().moveMarkedRouteEnd(courseId, courseControlId, mp))
        },
        onCommit() {},
        onCancel() {},
      }
    }

    function makeBendDrag(hit: { courseId: string; courseControlId: string; bendIndex: number; nav?: boolean }): ActiveDrag {
      const { courseId, courseControlId, bendIndex, nav } = hit
      return {
        started: false,
        onStart() {
          const st = useStore.getState()
          const course = st.project?.courses.find(c => c.id === courseId)
          let label = 'Move bend'
          if (course && st.project) {
            const ci = course.controls.findIndex(cc => cc.id === courseControlId)
            const from = ci >= 0 ? st.project.controls.find(c => c.id === course.controls[ci].controlId) : undefined
            const to = ci >= 0 && ci + 1 < course.controls.length ? st.project.controls.find(c => c.id === course.controls[ci + 1].controlId) : undefined
            if (from && to) label = `Move bend ${defaultControlLabel(from)}-${defaultControlLabel(to)} ${course.name}`
          }
          st.beginMoveLegBendPoint(label)
        },
        onMove(ev) {
          const rect = getRect()
          const mp = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
          scheduleDragMutation(() => useStore.getState().moveLegBendPoint(courseId, courseControlId, bendIndex, mp, nav ? 'nav' : 'taped'))
        },
        onCommit() {},
        onCancel() {},
      }
    }

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
        cx = rect.width / 2
        cy = (mobilePanelOverlap(rect.top) + rect.height) / 2
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
      if (!pendingRaf) pendingRaf = requestAnimationFrame(() => { pendingRaf = 0; syncTransform(); syncGapRingRadius() })
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

        const smIdx = state.editor.layoutSubmapIndex
        const isAC = state.editor.layoutCourseId === ALL_CONTROLS_ID
        const course = isAC ? null : proj.courses.find(c => c.id === state.editor.layoutCourseId)
        const layout = isAC ? proj.allControlsLayout : (course?.layout ? submapLayoutView(course.layout, smIdx) : undefined)
        const plan = course ? buildPagePlan(course, smIdx, proj.controls, !!proj.clueSheetHideSubmapRestart, layout?.clueSheetBreaks) : null
        const submapCourse = plan?.pageCourse
        if (layout && (isAC || (course && submapCourse))) {
          const { w: pageW, h: pageH } = pageDimsFor(layout.pageSize, layout.orientation)
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
              const brSx = e.clientX, brSy = e.clientY, brOx = layout.mapBorder.x, brOy = layout.mapBorder.y, brOw = layout.mapBorder.width, brOh = layout.mapBorder.height
              let brLast: { x: number; y: number; width: number; height: number } | null = null
              activeDrag = {
                started: false,
                onStart() { useStore.getState().beginLayoutDrag() },
                onMove(ev) {
                  const st = useStore.getState()
                  const lo = st.project ? resolveLayoutTarget(st.project, st.editor.layoutCourseId!, st.editor.layoutSubmapIndex) : undefined
                  if (!lo?.mapBorder) return
                  const { w: pw, h: ph } = pageDimsFor(lo.pageSize, lo.orientation)
                  const hwm = mmToMap({ x: pw / 2, y: 0 }, st.project!.map, lo.printScale).x
                  const pxToMm = pw / (hwm * 2 * vpRef.current.scale)
                  const dw = (ev.clientX - brSx) * pxToMm
                  const dh = (ev.clientY - brSy) * pxToMm
                  const minSize = 20
                  const nw = Math.max(minSize, Math.min(pw, brOw + dw * 2))
                  const nh = Math.max(minSize, Math.min(ph, brOh + dh * 2))
                  const nx = Math.max(0, brOx - (nw - brOw) / 2)
                  const ny = Math.max(0, brOy - (nh - brOh) / 2)
                  const rect = { x: nx, y: ny, width: Math.min(nw, pw - nx), height: Math.min(nh, ph - ny) }
                  brLast = rect
                  scheduleDragMutation(() => st.setLayoutDragPreview({ type: 'border', ...rect }))
                },
                onCommit() { commitBorderDrag(brLast) },
                onCancel() { useStore.getState().setLayoutDragPreview(null) },
              }
              return
            }
          }

          // Hit test layout elements (clue sheet, title) — before border translate so elements on top of border margin are draggable
          const elements: Array<{ key: string; el: { x: number; y: number; visible: boolean }; wMm: number; hMm: number }> = []
          {
            const sheetCourse = isAC
              ? buildAllControlsCourse(proj.controls)
              : plan ? plan.clueSheetCourse : null
            const sheetBreaks = isAC
              ? layout.clueSheetBreaks
              : plan?.sheetBreaks
            const trailingFlip = plan ? (plan.trailingFlip || plan.trailingExchange) : false
            if (sheetCourse) {
              if (sheetBreaks && sheetBreaks.length > 0) {
                const sizes = descriptionSheetPartSizes(sheetCourse, proj.controls, sheetBreaks, trailingFlip, proj.clueSheetFontSize)
                const positions = [layout.clueSheet, ...(layout.clueSheetParts ?? [])]
                for (let i = 0; i < sizes.length; i++) {
                  const el = positions[i] ?? layout.clueSheet
                  elements.push({ key: i === 0 ? 'clueSheet' : `clueSheetPart:${i - 1}`, el, wMm: sizes[i].width, hMm: sizes[i].height })
                }
              } else {
                const sheet = descriptionSheetSize(sheetCourse, proj.controls, trailingFlip, proj.clueSheetFontSize)
                elements.push({ key: 'clueSheet', el: layout.clueSheet, wMm: sheet.width, hMm: sheet.height })
              }
            }
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
              activeDrag = makeLayoutElDrag(e.clientX, e.clientY, key, el.x, el.y, wMm, hMm)
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
                activeDrag = makeLayoutElDrag(e.clientX, e.clientY, `overlay:${overlayHit.id}`, mmX, mmY, 0, 0)
                return
              }
            }
          }

          // Hit test north arrow annotations — same drag path as overlays
          {
            const mapPt = screenToMap(sx, sy, vpRef.current)
            const upm = unitsPerMm(proj.map)
            const annSpec = resolveSpec(proj.spec)
            for (const ann of proj.annotations) {
              if (ann.type !== 'north_arrow' || !ann.points[0]) continue
              const pos = layout.overlayPositions?.[ann.id] ?? ann.points[0]
              const h = northArrowHeight(upm, proj.map.scale, annSpec, ann.scale ?? 1)
              if (Math.hypot(mapPt.x - pos.x, mapPt.y - pos.y) < h * 0.7) {
                const mmPerMapU = pageW / pageWMap
                const mmX = (pos.x - pageTLx) * mmPerMapU
                const mmY = (pos.y - pageTLy) * mmPerMapU
                activeDrag = makeLayoutElDrag(e.clientX, e.clientY, `overlay:${ann.id}`, mmX, mmY, 0, 0)
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
              const btSx = e.clientX, btSy = e.clientY, btOx = layout.mapBorder.x, btOy = layout.mapBorder.y
              let btLast: { x: number; y: number; width: number; height: number } | null = null
              activeDrag = {
                started: false,
                onStart() { useStore.getState().beginLayoutDrag() },
                onMove(ev) {
                  const st = useStore.getState()
                  const lo = st.project ? resolveLayoutTarget(st.project, st.editor.layoutCourseId!, st.editor.layoutSubmapIndex) : undefined
                  if (!lo?.mapBorder) return
                  const { w: pw, h: ph } = pageDimsFor(lo.pageSize, lo.orientation)
                  const hwm = mmToMap({ x: pw / 2, y: 0 }, st.project!.map, lo.printScale).x
                  const pxToMm = pw / (hwm * 2 * vpRef.current.scale)
                  const dx = (ev.clientX - btSx) * pxToMm
                  const dy = (ev.clientY - btSy) * pxToMm
                  const bw = lo.mapBorder.width, bh = lo.mapBorder.height
                  const nx = Math.max(0, Math.min(pw - bw, btOx + dx))
                  const ny = Math.max(0, Math.min(ph - bh, btOy + dy))
                  const rect = { x: nx, y: ny, width: bw, height: bh }
                  btLast = rect
                  scheduleDragMutation(() => st.setLayoutDragPreview({ type: 'border', ...rect }))
                },
                onCommit() { commitBorderDrag(btLast) },
                onCancel() { useStore.getState().setLayoutDragPreview(null) },
              }
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
            const { fromControlId, toControlId, index } = ptHit
            activeDrag = {
              started: false,
              onStart() { useStore.getState().beginMoveMeasurePoint() },
              onMove(ev) {
                const rect = getRect()
                const mapPt = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
                scheduleDragMutation(() => useStore.getState().moveMeasurePoint(fromControlId, toControlId, index, mapPt))
              },
              onCommit() {},
              onCancel() {},
            }
            if (e.pointerType === 'touch') {
              longPressTimer = setTimeout(() => {
                longPressTimer = null
                longPressFired = true
                useStore.getState().removeMeasurePoint(fromControlId, toControlId, index)
                activeDrag = null
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
            const vi = i
            activeDrag = {
              started: false,
              onStart() {},
              onMove(ev) {
                const rect = getRect()
                const mp = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
                scheduleDragMutation(() => useStore.getState().movePendingAnnotationPoint(vi, mp))
              },
              onCommit() {},
              onCancel() {},
            }
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
          const miCourseId = miHit.courseId, miCcId = miHit.courseControlId
          activeDrag = {
            started: false,
            onStart() { useStore.getState().beginMoveMapIssue() },
            onMove(ev) {
              const rect = getRect()
              const mp = screenToMap(ev.clientX - rect.left, ev.clientY - rect.top, vpRef.current)
              const st = useStore.getState()
              const course = st.project?.courses.find(c => c.id === miCourseId)
              const cc = course?.controls.find(c => c.id === miCcId)
              if (cc?.legBendPoints?.length && st.project) {
                const startCtrl = st.project.controls.find(c => c.id === cc.controlId)
                if (startCtrl) {
                  const pts = flattenSmooth([...cc.legBendPoints, startCtrl.position])
                  const t = projectOnPolyline(mp, pts)
                  scheduleDragMutation(() => useStore.getState().moveMapIssue(miCourseId, miCcId, t))
                }
              }
            },
            onCommit() {},
            onCancel() {},
          }
          return
        }
      }
      if (activeTool === 'bend' && pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const mreHit = findMarkedRouteEndAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
        if (mreHit) {
          activeDrag = makeMREDrag(mreHit)
        } else {
          const bpHit = findBendPointAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
          if (bpHit) activeDrag = makeBendDrag(bpHit)
        }
      }
      if (activeTool === 'select' && pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        let handleHit = false
        const mreHitSel = findMarkedRouteEndAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
        if (mreHitSel) {
          activeDrag = makeMREDrag(mreHitSel)
          handleHit = true
        }
        if (!handleHit) {
          const bpHitSel = findBendPointAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
          const selCrs = state.editor.selectedCourseId ? proj.courses.find(c => c.id === state.editor.selectedCourseId) : null
          if (bpHitSel && selCrs && bpHitSel.courseControlId === selCrs.controls[0]?.id && bpHitSel.bendIndex === 0) {
            activeDrag = makeBendDrag(bpHitSel)
            handleHit = true
          }
        }
        const labelHit = !handleHit && findLabelAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId, state.editor.appearance.controlScale, state.editor.selectedSubmapIndex)
        if (labelHit) {
          const mapPt = screenToMap(sx, sy, vpRef.current)
          const lCourseId = labelHit.courseId, lCcId = labelHit.courseControlId, lCtrlId = labelHit.controlId
          const lDx = mapPt.x - labelHit.labelX, lDy = mapPt.y - labelHit.labelY
          activeDrag = {
            started: false,
            onStart() {
              const ctrl = useStore.getState().project?.controls.find(c => c.id === lCtrlId)
              const name = ctrl ? defaultControlLabel(ctrl) : '?'
              const courseName = lCourseId ? useStore.getState().project?.courses.find(c => c.id === lCourseId)?.name : undefined
              const label = courseName ? `Move label ${name} ${courseName}` : `Move label ${name}`
              if (lCourseId && lCcId) useStore.getState().beginMoveCourseLabel(label)
              else useStore.getState().beginMoveControlLabel(label)
              useStore.getState().setDraggingLabel(lCtrlId)
            },
            onMove(ev) {
              const rect2 = getRect()
              const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
              const ctrl = useStore.getState().project?.controls.find(c => c.id === lCtrlId)
              if (ctrl) {
                const offset = { x: mp.x - lDx - ctrl.position.x, y: mp.y - lDy - ctrl.position.y }
                scheduleDragMutation(() => {
                  if (lCourseId && lCcId) useStore.getState().moveCourseLabel(lCourseId, lCcId, offset)
                  else useStore.getState().moveControlLabel(lCtrlId, offset)
                })
              }
            },
            onCommit() { useStore.getState().setDraggingLabel(null) },
            onCancel() { useStore.getState().setDraggingLabel(null) },
          }
        } else {
          const rotHit = findCrossingPointRotationHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (rotHit && rotHit.points[0]) {
            activeDrag = makeRotationDrag(rotHit.id, rotHit.points[0])
            return
          }

          const crossResizeHit = findCrossingPointResizeHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (crossResizeHit && crossResizeHit.points[0]) {
            const crUpm = unitsPerMm(proj.map)
            const crSf = symbolScaleFactor(resolveSpec(proj.spec), proj.map.scale)
            const crD = getAnnotationDims(crSf * crUpm)
            const ceId = crossResizeHit.id, ceCx = crossResizeHit.points[0].x, ceCy = crossResizeHit.points[0].y, ceBaseHH = crD.crossH + 2 * crUpm
            activeDrag = {
              started: false,
              onStart() { useStore.getState().beginElongateAnnotation() },
              onMove(ev) {
                const rect2 = getRect()
                const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
                const proj2 = useStore.getState().project!
                const rotation = (proj2.annotations.find(a => a.id === ceId)?.rotation ?? 0) * Math.PI / 180
                const ddx = mp.x - ceCx, ddy = mp.y - ceCy
                const projectedDist = ddx * (-Math.sin(rotation)) + ddy * Math.cos(rotation)
                const upm = unitsPerMm(proj2.map)
                const newElongation = Math.max(0, (projectedDist - ceBaseHH) / upm)
                scheduleDragMutation(() => useStore.getState().elongateAnnotation(ceId, newElongation))
              },
              onCommit() {},
              onCancel() {},
            }
            return
          }

          const naRotHit = findNorthArrowRotationHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (naRotHit && naRotHit.points[0]) {
            activeDrag = makeRotationDrag(naRotHit.id, naRotHit.points[0])
            return
          }

          const naResizeHit = findNorthArrowResizeHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (naResizeHit && naResizeHit.points[0]) {
            const naUpm = unitsPerMm(proj.map)
            const naH = northArrowHeight(naUpm, proj.map.scale, resolveSpec(proj.spec), naResizeHit.scale ?? 1)
            const geo = northArrowGeometry(naH, naUpm)
            const arId = naResizeHit.id, arCx = naResizeHit.points[0].x, arCy = naResizeHit.points[0].y
            const arOrigScale = naResizeHit.scale ?? 1, arOrigDist = Math.hypot(geo.resizeHandleLocalX, geo.resizeHandleLocalY)
            activeDrag = {
              started: false,
              onStart() { useStore.getState().beginResizeAnnotation() },
              onMove(ev) {
                const rect2 = getRect()
                const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
                const dist = Math.hypot(mp.x - arCx, mp.y - arCy)
                const newScale = Math.max(0.3, arOrigScale * dist / arOrigDist)
                scheduleDragMutation(() => useStore.getState().resizeAnnotation(arId, newScale))
              },
              onCommit() {},
              onCancel() {},
            }
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
              const irId = selectedImg.id, irPosX = selectedImg.position.x, irPosY = selectedImg.position.y
              const irOrigW = selectedImg.widthMm * upmVal, irOrigH = selectedImg.heightMm * upmVal
              activeDrag = {
                started: false,
                onStart() { useStore.getState().beginMoveOverlay() },
                onMove(ev) {
                  const rect2 = getRect()
                  const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
                  const relX = mp.x - irPosX, relY = mp.y - irPosY
                  const diagLen = Math.hypot(irOrigW, irOrigH)
                  const proj2 = (relX * irOrigW + relY * irOrigH) / diagLen
                  const st = useStore.getState()
                  const upm2 = overlayUpmOf(st)
                  const minMap = 5 * upm2
                  const minProj = Math.hypot(minMap, minMap * (irOrigH / irOrigW))
                  const scale = Math.max(minProj, proj2) / diagLen
                  scheduleDragMutation(() => st.resizeImageOverlay(irId, irOrigW * scale / upm2, irOrigH * scale / upm2))
                },
                onCommit() {},
                onCancel() {},
              }
              return
            }
          }

          const oobVtx = findOobVertexHandle(sx, sy, vpRef.current, proj, state.editor.selectedAnnotationId)
          if (oobVtx) {
            const ovAnnId = oobVtx.ann.id, ovIdx = oobVtx.vertexIndex
            activeDrag = {
              started: false,
              onStart() { useStore.getState().beginMoveAnnotationVertex() },
              onMove(ev) {
                const rect2 = getRect()
                const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
                scheduleDragMutation(() => useStore.getState().moveAnnotationVertex(ovAnnId, ovIdx, mp))
              },
              onCommit() {},
              onCancel() {},
            }
            return
          }

          const annHit = findAnnotationAt(sx, sy, vpRef.current, proj)
          if (annHit && annHit.points[0]) {
            const draggable = annHit.type === 'crossing_point' || annHit.type === 'north_arrow'
              || annHit.type === 'forbidden_route' || annHit.type === 'oob_boundary'
              || (annHit.type === 'out_of_bounds' && annHit.id === state.editor.selectedAnnotationId)
            if (draggable) {
              const mapPt2 = screenToMap(sx, sy, vpRef.current)
              const daId = annHit.id, daDx = mapPt2.x - annHit.points[0].x, daDy = mapPt2.y - annHit.points[0].y
              activeDrag = {
                started: false,
                onStart() {
                  const st = useStore.getState()
                  const ann = st.project?.annotations.find(a => a.id === daId)
                  st.beginMoveAnnotation(ann ? `Move ${ann.type.replace(/_/g, ' ')}` : undefined)
                  st.setSelectedAnnotation(daId)
                  st.setSelectedControl(null)
                  st.setSelectedOverlay(null)
                },
                onMove(ev) {
                  const rect2 = getRect()
                  const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
                  scheduleDragMutation(() => useStore.getState().moveAnnotation(daId, { x: mp.x - daDx, y: mp.y - daDy }))
                },
                onCommit() {},
                onCancel() {},
              }
              return
            }
          }

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
              const olId = overlayHit.id, olKind = overlayHit.kind, olDx = mapPt.x - oPos.x, olDy = mapPt.y - oPos.y
              activeDrag = {
                started: false,
                onStart() { useStore.getState().beginMoveOverlay() },
                onMove(ev) {
                  const rect2 = getRect()
                  const mp = screenToMap(ev.clientX - rect2.left, ev.clientY - rect2.top, vpRef.current)
                  const newPos = { x: mp.x - olDx, y: mp.y - olDy }
                  scheduleDragMutation(() => {
                    if (olKind === 'scalebar') useStore.getState().moveScaleBar(olId, newPos)
                    else if (olKind === 'text') useStore.getState().moveTextLabel(olId, newPos)
                    else useStore.getState().moveImageOverlay(olId, newPos)
                  })
                },
                onCommit() {},
                onCancel() {},
              }
              return
            }
          }

          const hit = findControlAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId, state.editor.appearance.controlScale, 0, state.editor.selectedSubmapIndex)
          const selCourse = state.editor.selectedCourseId ? proj.courses.find(c => c.id === state.editor.selectedCourseId) : null
          const hitInCourse = hit && (!selCourse || selCourse.controls.some(cc => cc.controlId === hit.id))
          if (hit && hitInCourse) {
            activeDrag = makeControlDrag(hit, screenToMap(sx, sy, vpRef.current))
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

      if (activeDrag && pos.size === 1) {
        if (!activeDrag.started) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          activeDrag.onStart()
          activeDrag.started = true
        }
        activeDrag.onMove(e)
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

      flushDragMutation()
      if (activeDrag) {
        if (activeDrag.started) { activeDrag.onCommit(e); activeDrag = null; return }
        activeDrag = null
      }

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
      if (activeDrag) {
        if (activeDrag.started) activeDrag.onCancel()
        activeDrag = null
      }
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

    function syncGapRingRadius() {
      const g = gapRingRef.current
      const circle = g?.firstElementChild as SVGCircleElement | null
      if (!circle) return
      const st = useStore.getState()
      const proj = st.project
      if (!proj) return
      const course = st.editor.selectedCourseId ? proj.courses.find(c => c.id === st.editor.selectedCourseId) : null
      const spec = resolveSpec(proj.spec, course?.spec)
      const sf = symbolScaleFactor(spec, proj.map.scale)
      const controlR = getSymbolDims(spec).controlR * unitsPerMm(proj.map) * sf * st.editor.appearance.controlScale * vpRef.current.scale
      circle.setAttribute('r', String(controlR * st.editor.gapSize * Math.PI / 180 / 2))
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
      syncGapRingRadius()
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
  const layoutOverlayPositions = layoutTargetLayout?.overlayPositions

  const annBase = {
    annotations,
    pendingPoints: pendingAnnotationPoints,
    pendingType: getAnnotationType(),
    cursorPoint: oobCursorPoint,
    map,
    spec: resolveSpec(projectSpec, selectedCourse?.spec),
    selectedAnnotationId,
    posOverrides: layoutOverlayPositions,
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
      {layoutMode && layoutTargetLayout && (() => {
        const isAC = layoutCourseId === ALL_CONTROLS_ID
        const submapLayout = layoutTargetLayout
        const plan = !isAC && layoutCourse ? buildPagePlan(layoutCourse, layoutSubmapIndex, controls, clueSheetHideSubmapRestart, submapLayout.clueSheetBreaks) : null
        const submapCourse: Course = isAC
          ? { id: ALL_CONTROLS_ID, name: '', type: 'linear' as const, color: '#ea580c', controls: controls.map(c => ({ id: c.id, controlId: c.id })) }
          : plan!.pageCourse
        const sheetView = isAC
          ? { course: buildAllControlsCourse(controls), breaks: submapLayout.clueSheetBreaks }
          : plan
            ? { course: plan.clueSheetCourse, breaks: plan.sheetBreaks }
            : { course: submapCourse, breaks: undefined as number[] | undefined }
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
              trailingFlip={plan ? (plan.trailingFlip || plan.trailingExchange) : false}
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
            const layoutView = layoutTargetLayout
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
