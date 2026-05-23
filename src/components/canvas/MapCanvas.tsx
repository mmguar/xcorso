import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useRenderTracker } from '../../lib/perf'
import { MapCanvasLayer } from './MapCanvasLayer'
import { MapLayer } from './MapLayer'
import { FpsCounter } from './FpsCounter'
import { ControlsLayer } from './ControlsLayer'
import { LegsLayer } from './LegsLayer'
import { DragLegsLayer } from './DragLegsLayer'
import type { DragLegsHandle } from './DragLegsLayer'
import { AnnotationsLayer } from './AnnotationsLayer'
import { OverlaysLayer } from './OverlaysLayer'
import { PageOverlay } from './PageOverlay'
import type { LoadedMap } from '../../lib/mapLoader'
import { ScaleInputDialog } from '../ScaleInputDialog'
import { unitsPerMm, resolveVariation, defaultLabelOffset, buildSequenceMap, formatSequenceLabel, defaultControlLabel } from '../../lib/courseUtils'
import type { AnnotationType, MapPoint, Viewport, Control, MapConfig, AppearanceSettings, EventSpec } from '../../types'
import { resolveSpec, getSymbolDims, symbolScaleFactor } from '../../lib/symbolSpec'
import { PAGE_SIZES, mmToMap } from '../../lib/pdfExport'
import {
  screenToMap,
  findControlAt, findBendPointAt,
  findAnnotationAt, findOverlayAt, findLabelAt,
} from './hitTesting'
import { handleGapTap, handleGapRightClick, handleBendTap, handleBendRightClick } from './toolHandlers'

const TAP_PX    = 8
const MIN_SCALE = 0.05
const MAX_SCALE = 50
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function LayoutScaleInput({ courseId, printScale }: { courseId: string; printScale: number }) {
  const [value, setValue] = useState(String(printScale))
  const prevScale = useRef(printScale)
  if (printScale !== prevScale.current) {
    prevScale.current = printScale
    setValue(String(printScale))
  }
  function commit() {
    const v = parseInt(value)
    if (v > 0 && isFinite(v) && v !== printScale) {
      useStore.getState().updateCourseLayout(courseId, { printScale: v })
    } else {
      setValue(String(printScale))
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
        const scale = controlScale * sf
        let symbolR: number
        if (c.type === 'start') {
          symbolR = dims.startSide * upm * scale * Math.sqrt(3) / 2 * 2 / 3
        } else if (c.type === 'finish') {
          symbolR = dims.finishROuter * upm * sf * controlScale
        } else {
          symbolR = dims.controlR * upm * sf * controlScale
        }
        return (
          <circle key={`hit-${c.id}`} cx={c.position.x} cy={c.position.y} r={symbolR}
            fill="rgba(255,255,0,0.15)" stroke="rgba(255,255,0,0.5)" strokeWidth={1 / vp.scale} />
        )
      })}
      {controls.map(c => {
        const cc = course?.controls.find(cc => cc.controlId === c.id)
        const offset = cc?.labelOffset ?? defaultLabelOffset(c.type, upm, controlScale, spec, map.scale)
        const lx = c.position.x + offset.x
        const ly = c.position.y + offset.y
        const cr = dims.controlR * upm * controlScale * sf
        const fontSize = cr * 1.1
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
            fill="rgba(255,255,0,0.15)" stroke="rgba(255,255,0,0.5)" strokeWidth={1 / vp.scale} />
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
  const dragLegsRef = useRef<DragLegsHandle>(null)
  const rectCacheRef = useRef<DOMRect | null>(null)
  const canvasPixelRef = useRef<[number, number]>([1, 1])

  function syncTransform() {
    const v = vpRef.current
    const t = `translate(${v.x}px,${v.y}px) scale(${v.scale})`
    if (mapDivRef.current) {
      const [cpw, cph] = canvasPixelRef.current
      const b = loadedMap.bounds
      mapDivRef.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.scale}) translate(${b.minX}px,${b.minY}px) scale(${b.width / cpw},${b.height / cph})`
    }
    if (hdMapGRef.current) hdMapGRef.current.style.transform = t
    if (overlayGRef.current) overlayGRef.current.style.transform = t
  }
  function setVp(next: Viewport) {
    vpRef.current = next
    setVpState(next)
  }

  // ── Store ──────────────────────────────────────────────────────────────────
  const controls = useStore(s => s.project!.controls)
  const courses = useStore(s => s.project!.courses)
  const annotations = useStore(s => s.project!.annotations)
  const map = useStore(s => s.project!.map)
  const scaleBars = useStore(s => s.project!.scaleBars)
  const textLabels = useStore(s => s.project!.textLabels)
  const projectSpec = useStore(s => s.project!.spec)
  const activeTool = useStore(s => s.editor.activeTool)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const selectedOverlayId = useStore(s => s.editor.selectedOverlayId)
  const appearance = useStore(s => s.editor.appearance)
  const pendingAnnotationPoints = useStore(s => s.editor.pendingAnnotationPoints)
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const layoutMode = useStore(s => s.editor.layoutMode)
  const layoutCourseId = useStore(s => s.editor.layoutCourseId)
  const layoutCourse = useStore(s => {
    if (!s.editor.layoutCourseId) return null
    return s.project?.courses.find(c => c.id === s.editor.layoutCourseId) ?? null
  })

  const [useRaster, setUseRaster] = useState(true)
  const [measureStart, setMeasureStart] = useState<MapPoint | null>(null)
  const measureStartRef = useRef<MapPoint | null>(null)
  const [scaleDialogPoints, setScaleDialogPoints] = useState<{ p1: MapPoint; p2: MapPoint } | null>(null)
  const gapRingRef = useRef<SVGGElement>(null)

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
  const prevLayoutRef = useRef<{ courseId: string | null; printScale: number; pageSize: string; orientation: string } | null>(null)
  useEffect(() => {
    if (!layoutMode || !layoutCourse?.layout) {
      prevLayoutRef.current = null
      return
    }
    const layout = layoutCourse.layout
    const key = { courseId: layoutCourseId, printScale: layout.printScale, pageSize: layout.pageSize, orientation: layout.orientation }
    const prev = prevLayoutRef.current
    if (prev && prev.courseId === key.courseId && prev.printScale === key.printScale && prev.pageSize === key.pageSize && prev.orientation === key.orientation) return
    prevLayoutRef.current = key

    const el = divRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()

    const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
    const pageW = layout.orientation === 'landscape' ? base.h : base.w
    const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, map, layout.printScale).x
    const pageWidthMapUnits = halfWMap * 2

    const desiredScale = (width * 0.85) / pageWidthMapUnits
    setVp({
      x: width / 2 - layout.mapCenter.x * desiredScale,
      y: height / 2 - layout.mapCenter.y * desiredScale,
      scale: desiredScale,
    })
  }, [layoutMode, layoutCourseId, layoutCourse, map])

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
    let dragControlEl: SVGGElement | null = null
    let pendingControlPos: { x: number; y: number } | null = null
    let pendingControlRaf = 0

    let dragBend: { courseId: string; courseControlId: string; bendIndex: number } | null = null
    let dragBendStarted = false

    let dragOverlay: { id: string; kind: 'scalebar' | 'text'; dx: number; dy: number } | null = null
    let dragOverlayStarted = false

    let dragLabel: { courseId: string; courseControlId: string; controlId: string; dx: number; dy: number } | null = null
    let dragLabelStarted = false

    let dragLayoutEl: { element: 'clueSheet'; sx: number; sy: number; ox: number; oy: number } | null = null
    let dragLayoutElStarted = false

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
      if (useStore.getState().editor.layoutMode) return
      const rect = getRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const v = vpRef.current
      const raw = e.deltaMode === 0 ? e.deltaY : e.deltaY * 30
      const factor = raw > 0 ? 0.85 : 1 / 0.85
      const minScale = Math.min(fitScaleRef.current, MIN_SCALE)
      const ns = clamp(v.scale * factor, minScale, MAX_SCALE)
      const ratio = ns / v.scale
      vpRef.current = { scale: ns, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) }
      startPanning()
      syncTransform()
      if (wheelTimer) clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => { wheelTimer = null; setVpState(vpRef.current); stopPanning() }, 150)
    }

    // ── Pointer down ─────────────────────────────────────────────────────────
    function onDown(e: PointerEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return
      div.setPointerCapture(e.pointerId)
      pos.set(e.pointerId, { x: e.clientX, y: e.clientY })
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pos.size === 2) {
        const [a, b] = [...pos.values()]
        pinchDist = Math.hypot(b.x - a.x, b.y - a.y)
      }

      longPressFired = false
      if (e.pointerType === 'touch' && pos.size === 1 && !useStore.getState().editor.layoutMode) {
        const state = useStore.getState()
        const cid = state.editor.selectedCourseId
        if (cid) {
          const rect = getRect()
          const proj = state.project
          if (proj) {
            const hit = findControlAt(e.clientX - rect.left, e.clientY - rect.top, vpRef.current, proj, cid, state.editor.appearance.controlScale)
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
      }

      const state = useStore.getState()
      if (state.editor.layoutMode) {
        if (pos.size !== 1) return
        const proj = state.project
        if (!proj) return
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top

        // Hit test layout elements (clue sheet, title) first
        const course = proj.courses.find(c => c.id === state.editor.layoutCourseId)
        const layout = course?.layout
        if (layout) {
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pageW = layout.orientation === 'landscape' ? base.h : base.w
          const pageH = layout.orientation === 'landscape' ? base.w : base.h
          const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, proj.map, layout.printScale).x
          const halfHMap = mmToMap({ x: 0, y: pageH / 2 }, proj.map, layout.printScale).y
          const pageTL = {
            x: layout.mapCenter.x - halfWMap,
            y: layout.mapCenter.y - halfHMap,
          }
          const pageWMap = halfWMap * 2
          const mmToMapU = pageWMap / pageW

          const elements: Array<{ key: 'clueSheet'; el: { x: number; y: number; visible: boolean }; wMm: number; hMm: number }> = [
            { key: 'clueSheet', el: layout.clueSheet, wMm: 50, hMm: 30 },
          ]
          for (const { key, el, wMm, hMm } of elements) {
            if (!el.visible) continue
            const elMapX = pageTL.x + el.x * mmToMapU
            const elMapY = pageTL.y + el.y * mmToMapU
            const elScreenX = elMapX * vpRef.current.scale + vpRef.current.x
            const elScreenY = elMapY * vpRef.current.scale + vpRef.current.y
            const elW = wMm * mmToMapU * vpRef.current.scale
            const elH = hMm * mmToMapU * vpRef.current.scale
            if (sx >= elScreenX && sx <= elScreenX + elW && sy >= elScreenY && sy <= elScreenY + elH) {
              dragLayoutEl = { element: key, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y }
              dragLayoutElStarted = false
              return
            }
          }
        }

        // Hit test overlays (scale bars, text labels) — drag stores per-course override
        const overlayHit = findOverlayAt(sx, sy, vpRef.current, proj, layout?.overlayPositions)
        if (overlayHit) {
          const mapPt = screenToMap(sx, sy, vpRef.current)
          let oPos: { x: number; y: number } | undefined
          const overridePos = layout?.overlayPositions?.[overlayHit.id]
          if (overridePos) {
            oPos = overridePos
          } else if (overlayHit.kind === 'scalebar') {
            oPos = proj.scaleBars.find(s => s.id === overlayHit.id)?.position
          } else {
            oPos = proj.textLabels.find(t => t.id === overlayHit.id)?.position
          }
          if (oPos) {
            dragOverlay = { id: overlayHit.id, kind: overlayHit.kind, dx: mapPt.x - oPos.x, dy: mapPt.y - oPos.y }
            dragOverlayStarted = false
          }
        }
        return
      }
      const { activeTool } = state.editor
      const proj = state.project
      if (!proj) return

      if (activeTool === 'bend' && pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const bpHit = findBendPointAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId)
        if (bpHit) {
          dragBend = bpHit
          dragBendStarted = false
        }
      }
      if (activeTool === 'select' && pos.size === 1) {
        const rect = getRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const labelHit = findLabelAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId, state.editor.appearance.controlScale)
        if (labelHit) {
          const mapPt = screenToMap(sx, sy, vpRef.current)
          dragLabel = { courseId: labelHit.courseId, courseControlId: labelHit.courseControlId, controlId: labelHit.controlId, dx: mapPt.x - labelHit.labelX, dy: mapPt.y - labelHit.labelY }
          dragLabelStarted = false
        } else {
          const hit = findControlAt(sx, sy, vpRef.current, proj, state.editor.selectedCourseId, state.editor.appearance.controlScale)
          if (hit) {
            const mapPt = screenToMap(sx, sy, vpRef.current)
            dragControlId = hit.id
            dragOffset = { dx: mapPt.x - hit.position.x, dy: mapPt.y - hit.position.y }
            dragStarted = false
          } else {
            const overlayHit = findOverlayAt(sx, sy, vpRef.current, proj)
            if (overlayHit) {
              const mapPt = screenToMap(sx, sy, vpRef.current)
              let oPos: { x: number; y: number } | undefined
              if (overlayHit.kind === 'scalebar') {
                oPos = proj.scaleBars.find(s => s.id === overlayHit.id)?.position
              } else {
                oPos = proj.textLabels.find(t => t.id === overlayHit.id)?.position
              }
              if (oPos) {
                dragOverlay = { id: overlayHit.id, kind: overlayHit.kind, dx: mapPt.x - oPos.x, dy: mapPt.y - oPos.y }
                dragOverlayStarted = false
              }
            }
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

      if (dragLayoutEl && pos.size === 1) {
        if (!dragLayoutElStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginLayoutDrag()
          dragLayoutElStarted = true
        }
        const st = useStore.getState()
        const course = st.project?.courses.find(c => c.id === st.editor.layoutCourseId)
        const layout = course?.layout
        if (layout) {
          const base = PAGE_SIZES[layout.pageSize] ?? PAGE_SIZES.a4
          const pageW = layout.orientation === 'landscape' ? base.h : base.w
          const pageH = layout.orientation === 'landscape' ? base.w : base.h
          const halfWMap = mmToMap({ x: pageW / 2, y: 0 }, st.project!.map, layout.printScale).x
          const pageWMap = halfWMap * 2
          const mmToPx = (pageWMap * vpRef.current.scale) / pageW

          const dx = (e.clientX - dragLayoutEl.sx) / mmToPx
          const dy = (e.clientY - dragLayoutEl.sy) / mmToPx
          const newX = Math.max(0, Math.min(pageW - 10, dragLayoutEl.ox + dx))
          const newY = Math.max(0, Math.min(pageH - 5, dragLayoutEl.oy + dy))
          st.updateLayoutElement(st.editor.layoutCourseId!, dragLayoutEl.element, { x: newX, y: newY })
        }
        return
      }

      if (dragBend && pos.size === 1) {
        if (!dragBendStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveLegBendPoint()
          dragBendStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        useStore.getState().moveLegBendPoint(dragBend.courseId, dragBend.courseControlId, dragBend.bendIndex, mapPt)
        return
      }

      if (dragLabel && pos.size === 1) {
        if (!dragLabelStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveCourseLabel()
          dragLabelStarted = true
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        const ctrl = useStore.getState().project?.controls.find(c => c.id === dragLabel!.controlId)
        if (ctrl) {
          const offset = { x: mapPt.x - dragLabel.dx - ctrl.position.x, y: mapPt.y - dragLabel.dy - ctrl.position.y }
          useStore.getState().moveCourseLabel(dragLabel.courseId, dragLabel.courseControlId, offset)
        }
        return
      }

      if (dragControlId && pos.size === 1) {
        if (!dragStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveControl()
          useStore.getState().setDraggingControl(dragControlId)
          dragStarted = true
          const ctrl = useStore.getState().project?.controls.find(c => c.id === dragControlId)
          dragOrigPos = ctrl ? { ...ctrl.position } : null
          const og = overlayGRef.current
          dragControlEl = og?.querySelector(`[data-control-id="${dragControlId}"]`) as SVGGElement | null
          dragLegsRef.current?.begin(dragControlId)
        }
        const rect = getRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top, vpRef.current)
        pendingControlPos = { x: mapPt.x - dragOffset!.dx, y: mapPt.y - dragOffset!.dy }
        if (!pendingControlRaf) {
          pendingControlRaf = requestAnimationFrame(() => {
            pendingControlRaf = 0
            if (pendingControlPos && dragOrigPos && dragControlEl) {
              const dx = pendingControlPos.x - dragOrigPos.x
              const dy = pendingControlPos.y - dragOrigPos.y
              dragControlEl.style.transform = `translate(${dx}px,${dy}px)`
            }
            if (pendingControlPos) {
              dragLegsRef.current?.update(pendingControlPos)
            }
          })
        }
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
        const st = useStore.getState()
        if (st.editor.layoutMode && st.editor.layoutCourseId) {
          st.setLayoutOverlayPosition(st.editor.layoutCourseId, dragOverlay.id, newPos)
        } else if (dragOverlay.kind === 'scalebar') {
          st.moveScaleBar(dragOverlay.id, newPos)
        } else {
          st.moveTextLabel(dragOverlay.id, newPos)
        }
        return
      }

      if (pos.size === 1) {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        const v = vpRef.current
        vpRef.current = { ...v, x: v.x + dx, y: v.y + dy }
        if (!vpDirty) startPanning()
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
        const ns = clamp(v.scale * (dist / pinchDist), minScale, MAX_SCALE)
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
        if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0 }
        syncTransform()
        setVpState(vpRef.current)
        stopPanning()

        const st = useStore.getState()
        if (st.editor.layoutMode && st.editor.layoutCourseId) {
          const rect = getRect()
          const v = vpRef.current
          const centerX = (rect.width / 2 - v.x) / v.scale
          const centerY = (rect.height / 2 - v.y) / v.scale
          st.setLayoutMapCenter(st.editor.layoutCourseId, { x: centerX, y: centerY })
        }
      }

      if (longPressFired) { longPressFired = false; return }

      if (dragLayoutEl && dragLayoutElStarted) { dragLayoutEl = null; dragLayoutElStarted = false; return }
      dragLayoutEl = null; dragLayoutElStarted = false

      if (dragLabel && dragLabelStarted) { dragLabel = null; dragLabelStarted = false; return }
      dragLabel = null; dragLabelStarted = false

      if (dragBend && dragBendStarted) { dragBend = null; dragBendStarted = false; return }
      dragBend = null; dragBendStarted = false

      if (dragControlId && dragStarted) {
        if (pendingControlRaf) { cancelAnimationFrame(pendingControlRaf); pendingControlRaf = 0 }
        if (pendingControlPos) { useStore.getState().moveControl(dragControlId, pendingControlPos); pendingControlPos = null }
        if (dragControlEl) { dragControlEl.style.transform = ''; dragControlEl = null }
        dragLegsRef.current?.end()
        dragOrigPos = null
        useStore.getState().setDraggingControl(null)
        dragControlId = null; dragOffset = null; dragStarted = false; return
      }
      dragControlId = null; dragOffset = null; dragStarted = false

      if (dragOverlay && dragOverlayStarted) { dragOverlay = null; dragOverlayStarted = false; return }
      dragOverlay = null; dragOverlayStarted = false

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
      const ms = measureStartRef.current
      const hitControl = findControlAt(sx, sy, vpRef.current, proj, selectedCourseId, state.editor.appearance.controlScale)

      if (activeTool === 'gap') {
        handleGapTap(sx, sy, vpRef.current, proj, selectedCourseId)
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
          const hitOverlay = findOverlayAt(sx, sy, vpRef.current, proj)
          if (hitOverlay) {
            if (hitOverlay.kind === 'scalebar') state.deleteScaleBar(hitOverlay.id)
            else state.deleteTextLabel(hitOverlay.id)
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
        }
        return
      }

      if (!selectedCourseId && activeTool === 'select') {
        const overlayHit = findOverlayAt(sx, sy, vpRef.current, proj)
        if (overlayHit) {
          state.setSelectedOverlay(overlayHit.id)
          state.setSelectedControl(null)
          return
        }
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
        case 'crossing-point':
          state.addAnnotationPoint(mapPt)
          state.commitAnnotation('crossing_point')
          break
        case 'place-scalebar':
          state.addScaleBar(mapPt, proj.map.scale)
          break
        case 'place-text':
          state.addTextLabel(mapPt)
          break
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
      dragLayoutEl = null; dragLayoutElStarted = false
      dragLabel = null; dragLabelStarted = false
      if (dragStarted) {
        if (pendingControlRaf) { cancelAnimationFrame(pendingControlRaf); pendingControlRaf = 0 }
        if (pendingControlPos && dragControlId) { useStore.getState().moveControl(dragControlId, pendingControlPos); pendingControlPos = null }
        if (dragControlEl) { dragControlEl.style.transform = ''; dragControlEl = null }
        dragLegsRef.current?.end()
        dragOrigPos = null
        useStore.getState().setDraggingControl(null)
      }
      dragControlId = null; dragOffset = null; dragStarted = false
      pos.delete(e.pointerId)
      down.delete(e.pointerId)
      if (vpDirty && pos.size === 0) {
        vpDirty = false
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
      } else if (activeTool === 'out-of-bounds' && pendingAnnotationPoints.length >= 3) {
        useStore.getState().commitAnnotation('out_of_bounds')
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

      if (activeTool === 'gap') {
        handleGapRightClick(sx, sy, vpRef.current, proj, selectedCourseId)
        return
      }

      if (activeTool === 'bend') {
        handleBendRightClick(sx, sy, vpRef.current, proj, selectedCourseId)
        return
      }

      if (!selectedCourseId) return
      const hit = findControlAt(sx, sy, vpRef.current, proj, selectedCourseId, state.editor.appearance.controlScale)
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
    }

    div.addEventListener('wheel',        onWheel,   { passive: false })
    div.addEventListener('pointerdown',  onDown)
    div.addEventListener('pointermove',  onMove)
    div.addEventListener('pointermove',  updateGapRing)
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
      div.removeEventListener('pointerup',    onUp)
      div.removeEventListener('pointercancel', onCancel)
      div.removeEventListener('dblclick',     onDblClick)
      div.removeEventListener('contextmenu',  onContextMenu)
      div.removeEventListener('pointerleave', onLeave)
    }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function getAnnotationType(): AnnotationType | null {
    if (activeTool === 'forbidden-route') return 'forbidden_route'
    if (activeTool === 'crossing-point')  return 'crossing_point'
    if (activeTool === 'out-of-bounds')   return 'out_of_bounds'
    return null
  }

  const mapSaturation = useStore(s => s.editor.mapSaturation)
  const gapSize = useStore(s => s.editor.gapSize)
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

  const cursor = layoutMode ? 'grab'
    : activeTool === 'bend' ? 'crosshair'
    : activeTool === 'gap' ? 'none'
    : isCourseMode ? 'default'
    : activeTool === 'select' ? 'grab'
    : 'crosshair'

  return (
    <div
      ref={divRef}
      className="w-full h-full overflow-hidden bg-gray-100 relative"
      style={{ cursor, touchAction: 'none', userSelect: 'none' }}
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
        <MapCanvasLayer loadedMap={loadedMap} onPixelSize={(w, h) => { canvasPixelRef.current = [w, h]; syncTransform() }} />
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
      {/* Overlay layers — controls, legs, annotations (no filter) */}
      <svg key="overlay" width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0 }}>
        <g ref={overlayGRef} style={{ willChange: 'transform', transformOrigin: '0 0' }}>
          <LegsLayer
            course={selectedCourse}
            controls={controls}
            map={map}
            showBendHandles={activeTool === 'bend'}
            appearance={appearance}
            projectSpec={projectSpec}
            selectedSubmapIndex={selectedSubmapIndex}
          />
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
          <AnnotationsLayer
            annotations={annotations}
            pendingPoints={pendingAnnotationPoints}
            pendingType={getAnnotationType()}
            map={map}
            spec={resolveSpec(projectSpec, selectedCourse?.spec)}
          />
          <OverlaysLayer
            scaleBars={scaleBars}
            textLabels={textLabels}
            map={map}
            selectedOverlayId={selectedOverlayId}
            positionOverrides={layoutCourse?.layout?.overlayPositions}
          />
          <ControlsLayer
            controls={controls}
            course={selectedCourse}
          />
          {import.meta.env.DEV && (
            <DebugHitboxes controls={controls} map={map} vp={vp} selectedCourseId={selectedCourseId} appearance={appearance} projectSpec={projectSpec} />
          )}
        </g>
        {activeTool === 'gap' && (() => {
          const upm = unitsPerMm(map)
          const gapSpec = resolveSpec(projectSpec, selectedCourse?.spec)
          const r = getSymbolDims(gapSpec).controlR * upm * appearance.controlScale * vp.scale
          const circumference = 2 * Math.PI * r
          const gapFraction = gapSize / 360
          const gapLen = circumference * gapFraction
          const arcLen = circumference - gapLen
          const sw = Math.max(1, 0.35 * upm * appearance.lineWidth * vp.scale)
          return (
            <g ref={gapRingRef} style={{ pointerEvents: 'none', display: 'none' }}>
              <circle
                r={r}
                fill="none"
                stroke="#ea580c"
                strokeWidth={sw}
                strokeDasharray={`${arcLen} ${gapLen}`}
                strokeDashoffset={arcLen / 2 + circumference / 4}
              />
              <line x1={-4} y1={0} x2={4} y2={0} stroke="#ea580c" strokeWidth={1} />
              <line x1={0} y1={-4} x2={0} y2={4} stroke="#ea580c" strokeWidth={1} />
            </g>
          )
        })()}
      </svg>

      {/* Layout mode page overlay */}
      {layoutMode && layoutCourse?.layout && (
        <PageOverlay
          layout={layoutCourse.layout}
          map={map}
          viewport={vp}
          canvasW={rectCacheRef.current?.width ?? 800}
          canvasH={rectCacheRef.current?.height ?? 600}
        />
      )}

      {/* Saturation slider + HD toggle */}
      <div className="absolute top-14 left-2 md:top-2 flex items-center gap-1.5 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm border border-gray-200 z-10">
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
        {layoutMode && layoutCourse?.layout && (
          <LayoutScaleInput courseId={layoutCourse.id} printScale={layoutCourse.layout.printScale} />
        )}
      </div>

      {measureStart && !scaleDialogPoints && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1 rounded-full pointer-events-none">
          Click second point, then enter real distance
        </div>
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

      {import.meta.env.DEV && <FpsCounter />}
    </div>
  )
}
