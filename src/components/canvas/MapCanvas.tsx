import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { MapLayer } from './MapLayer'
import { ControlsLayer } from './ControlsLayer'
import { LegsLayer } from './LegsLayer'
import { AnnotationsLayer } from './AnnotationsLayer'
import type { LoadedMap } from '../../lib/mapLoader'
import { ScaleInputDialog } from '../ScaleInputDialog'
import type { Annotation, AnnotationType, Control, MapPoint, Viewport } from '../../types'

const TAP_PX    = 8
const HIT_PX    = 20
const MIN_SCALE = 0.05
const MAX_SCALE = 50
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Props { loadedMap: LoadedMap }

export function MapCanvas({ loadedMap }: Props) {
  const divRef = useRef<HTMLDivElement>(null)

  const [vp, setVpState] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const vpRef = useRef<Viewport>(vp)
  const fitScaleRef = useRef<number>(MIN_SCALE)
  function setVp(next: Viewport) {
    vpRef.current = next
    setVpState(next)
    useStore.getState().setViewport(next)
  }

  // ── Store ──────────────────────────────────────────────────────────────────
  const project  = useStore(s => s.project!)
  const editor   = useStore(s => s.editor)
  const addControl               = useStore(s => s.addControl)
  const setSelectedControl       = useStore(s => s.setSelectedControl)
  const addAnnotationPoint       = useStore(s => s.addAnnotationPoint)
  const commitAnnotation         = useStore(s => s.commitAnnotation)
  const addControlToCourse       = useStore(s => s.addControlToCourse)
  const removeControlFromCourse  = useStore(s => s.removeControlFromCourse)
  const setMapScaleMeasurement   = useStore(s => s.setMapScaleMeasurement)
  const setActiveTool            = useStore(s => s.setActiveTool)

  const [useRaster, setUseRaster] = useState(true)
  const [measureStart, setMeasureStart] = useState<MapPoint | null>(null)
  const measureStartRef = useRef<MapPoint | null>(null)
  const [scaleDialogPoints, setScaleDialogPoints] = useState<{ p1: MapPoint; p2: MapPoint } | null>(null)

  // ── Fit to screen on map load ──────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
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

  // ── All native event listeners in one place ────────────────────────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    const div = el

    const pos  = new Map<number, { x: number; y: number }>()
    const down = new Map<number, { x: number; y: number }>()
    let pinchDist = 0

    function screenToMap(sx: number, sy: number): MapPoint {
      const v = vpRef.current
      return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale }
    }

    function controlToScreen(c: Control): { x: number; y: number } {
      const v = vpRef.current
      return { x: v.x + c.position.x * v.scale, y: v.y + c.position.y * v.scale }
    }

    function findControlAt(screenX: number, screenY: number): Control | null {
      const controls = useStore.getState().project?.controls ?? []
      const courseMode = !!useStore.getState().editor.selectedCourseId
      const hitRadius = courseMode ? HIT_PX * 2 : HIT_PX
      let best: Control | null = null
      let bestDist = hitRadius
      for (const c of controls) {
        const s = controlToScreen(c)
        const d = Math.hypot(screenX - s.x, screenY - s.y)
        if (d < bestDist) { best = c; bestDist = d }
      }
      return best
    }

    function distToSegment(p: MapPoint, a: MapPoint, b: MapPoint): number {
      const dx = b.x - a.x, dy = b.y - a.y
      const lenSq = dx * dx + dy * dy
      if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    function findAnnotationAt(screenX: number, screenY: number): Annotation | null {
      const annotations = useStore.getState().project?.annotations ?? []
      const mapPt = screenToMap(screenX, screenY)
      const hitR = HIT_PX / vpRef.current.scale
      for (const ann of annotations) {
        if (ann.type === 'crossing_point') {
          const p = ann.points[0]
          if (p && Math.hypot(mapPt.x - p.x, mapPt.y - p.y) < hitR) return ann
        } else {
          for (let i = 1; i < ann.points.length; i++) {
            if (distToSegment(mapPt, ann.points[i - 1], ann.points[i]) < hitR) return ann
          }
          if (ann.type === 'out_of_bounds' && ann.points.length >= 3) {
            if (distToSegment(mapPt, ann.points[ann.points.length - 1], ann.points[0]) < hitR) return ann
          }
        }
      }
      return null
    }

    let dragControlId: string | null = null
    let dragOffset: { dx: number; dy: number } | null = null
    let dragStarted = false

    // ── Wheel ────────────────────────────────────────────────────────────────
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = div.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const v = vpRef.current
      const raw = e.deltaMode === 0 ? e.deltaY : e.deltaY * 30
      const factor = raw > 0 ? 0.85 : 1 / 0.85
      const minScale = Math.min(fitScaleRef.current, MIN_SCALE)
      const ns = clamp(v.scale * factor, minScale, MAX_SCALE)
      const ratio = ns / v.scale
      setVp({ scale: ns, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) })
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

      const { activeTool } = useStore.getState().editor
      if (activeTool === 'select' && pos.size === 1) {
        const rect = div.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const hit = findControlAt(sx, sy)
        if (hit) {
          const mapPt = screenToMap(sx, sy)
          dragControlId = hit.id
          dragOffset = { dx: mapPt.x - hit.position.x, dy: mapPt.y - hit.position.y }
          dragStarted = false
        }
      }
    }

    // ── Pointer move ─────────────────────────────────────────────────────────
    function onMove(e: PointerEvent) {
      if (!pos.has(e.pointerId)) return
      const prev = pos.get(e.pointerId)!
      pos.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (dragControlId && pos.size === 1) {
        if (!dragStarted) {
          const start = down.get(e.pointerId)
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TAP_PX) return
          useStore.getState().beginMoveControl()
          dragStarted = true
        }
        const rect = div.getBoundingClientRect()
        const mapPt = screenToMap(e.clientX - rect.left, e.clientY - rect.top)
        useStore.getState().moveControl(dragControlId, {
          x: mapPt.x - dragOffset!.dx, y: mapPt.y - dragOffset!.dy,
        })
        return
      }

      if (pos.size === 1) {
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        const v = vpRef.current
        setVp({ ...v, x: v.x + dx, y: v.y + dy })
      } else if (pos.size === 2) {
        const [a, b] = [...pos.values()]
        const dist = Math.hypot(b.x - a.x, b.y - a.y)
        const rect = div.getBoundingClientRect()
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const cx = mid.x - rect.left
        const cy = mid.y - rect.top
        const v = vpRef.current
        const minScale = Math.min(fitScaleRef.current, MIN_SCALE)
        const ns = clamp(v.scale * (dist / pinchDist), minScale, MAX_SCALE)
        const ratio = ns / v.scale
        setVp({ scale: ns, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) })
        pinchDist = dist
      }
    }

    // ── Pointer up / tap ──────────────────────────────────────────────────────
    function onUp(e: PointerEvent) {
      const start = down.get(e.pointerId)
      pos.delete(e.pointerId)
      down.delete(e.pointerId)

      // End control drag
      if (dragControlId && dragStarted) {
        dragControlId = null
        dragOffset = null
        dragStarted = false
        return
      }
      dragControlId = null
      dragOffset = null
      dragStarted = false

      if (!start) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_PX) return

      // ── It's a tap ──────────────────────────────────────────────────────────
      const rect = div.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const mapPt = screenToMap(sx, sy)
      const { activeTool, selectedCourseId } = useStore.getState().editor
      const ms = measureStartRef.current
      const hitControl = findControlAt(sx, sy)

      // Delete tool
      if (activeTool === 'delete') {
        if (hitControl) {
          useStore.getState().deleteControl(hitControl.id)
        } else {
          const hitAnn = findAnnotationAt(sx, sy)
          if (hitAnn) useStore.getState().deleteAnnotation(hitAnn.id)
        }
        return
      }

      // Control hit always takes priority
      if (hitControl) {
        if (selectedCourseId) {
          addControlToCourse(selectedCourseId, hitControl.id)
        } else {
          setSelectedControl(hitControl.id)
        }
        return
      }

      // In course-building mode, background taps deselect
      if (selectedCourseId) {
        setSelectedControl(null)
        return
      }

      switch (activeTool) {
        case 'place-start':   addControl('start',   mapPt); break
        case 'place-finish':  addControl('finish',  mapPt); break
        case 'place-control': addControl('control', mapPt); break
        case 'forbidden-route': addAnnotationPoint(mapPt); break
        case 'out-of-bounds': addAnnotationPoint(mapPt); break
        case 'crossing-point':
          addAnnotationPoint(mapPt)
          commitAnnotation('crossing_point')
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
          setSelectedControl(null)
          break
      }
    }

    function onCancel(e: PointerEvent) {
      pos.delete(e.pointerId)
      down.delete(e.pointerId)
    }

    function onDblClick() {
      const { activeTool, pendingAnnotationPoints } = useStore.getState().editor
      if (activeTool === 'forbidden-route' && pendingAnnotationPoints.length >= 2) {
        commitAnnotation('forbidden_route')
      } else if (activeTool === 'out-of-bounds' && pendingAnnotationPoints.length >= 3) {
        commitAnnotation('out_of_bounds')
      }
    }

    // ── Right-click on control → remove last instance from course ────────────
    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const { selectedCourseId } = useStore.getState().editor
      if (!selectedCourseId) return

      const rect = div.getBoundingClientRect()
      const hit = findControlAt(e.clientX - rect.left, e.clientY - rect.top)
      if (!hit) return

      const course = useStore.getState().project?.courses.find(c => c.id === selectedCourseId)
      if (!course) return
      for (let i = course.controls.length - 1; i >= 0; i--) {
        if (course.controls[i].controlId === hit.id) {
          removeControlFromCourse(selectedCourseId, course.controls[i].id)
          return
        }
      }
    }

    div.addEventListener('wheel',        onWheel,   { passive: false })
    div.addEventListener('pointerdown',  onDown)
    div.addEventListener('pointermove',  onMove)
    div.addEventListener('pointerup',    onUp)
    div.addEventListener('pointercancel', onCancel)
    div.addEventListener('dblclick',     onDblClick)
    div.addEventListener('contextmenu',  onContextMenu)

    return () => {
      div.removeEventListener('wheel',        onWheel)
      div.removeEventListener('pointerdown',  onDown)
      div.removeEventListener('pointermove',  onMove)
      div.removeEventListener('pointerup',    onUp)
      div.removeEventListener('pointercancel', onCancel)
      div.removeEventListener('dblclick',     onDblClick)
      div.removeEventListener('contextmenu',  onContextMenu)
    }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function getAnnotationType(): AnnotationType | null {
    if (editor.activeTool === 'forbidden-route') return 'forbidden_route'
    if (editor.activeTool === 'crossing-point')  return 'crossing_point'
    if (editor.activeTool === 'out-of-bounds')   return 'out_of_bounds'
    return null
  }

  const mapSaturation = useStore(s => s.editor.mapSaturation)
  const selectedCourse = project.courses.find(c => c.id === editor.selectedCourseId) ?? null
  const isCourseMode = !!editor.selectedCourseId
  const cursor = isCourseMode ? 'default'
    : editor.activeTool === 'select' ? 'grab'
    : editor.activeTool === 'delete' ? 'crosshair'
    : 'crosshair'

  return (
    <div
      ref={divRef}
      className="w-full h-full overflow-hidden bg-gray-100 relative"
      style={{ cursor, touchAction: 'none', userSelect: 'none' }}
    >
      {/* Map layer — separate SVG so CSS filter doesn't force huge raster buffer */}
      <svg
        width="100%" height="100%"
        style={{
          display: 'block',
          position: 'absolute',
          inset: 0,
          filter: mapSaturation < 1 ? `saturate(${mapSaturation})` : undefined,
        }}
      >
        <g transform={`translate(${vp.x},${vp.y}) scale(${vp.scale})`}>
          <MapLayer loadedMap={loadedMap} useRaster={useRaster} />
        </g>
      </svg>
      {/* Overlay layers — controls, legs, annotations (no filter) */}
      <svg width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0 }}>
        <g transform={`translate(${vp.x},${vp.y}) scale(${vp.scale})`}>
          <LegsLayer
            course={selectedCourse}
            controls={project.controls}
            map={project.map}
          />
          <AnnotationsLayer
            annotations={project.annotations}
            pendingPoints={editor.pendingAnnotationPoints}
            pendingType={getAnnotationType()}
            map={project.map}
          />
          <ControlsLayer
            controls={project.controls}
          />
        </g>
      </svg>

      {/* Saturation slider + HD toggle */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm border border-gray-200">
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
      </div>

      {measureStart && !scaleDialogPoints && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1 rounded-full pointer-events-none">
          Click second point, then enter real distance
        </div>
      )}

      {scaleDialogPoints && (
        <ScaleInputDialog
          onConfirm={m => {
            setMapScaleMeasurement(scaleDialogPoints.p1, scaleDialogPoints.p2, m, loadedMap.renderScale)
            setScaleDialogPoints(null)
            measureStartRef.current = null
            setMeasureStart(null)
            setActiveTool('select')
          }}
          onCancel={() => {
            setScaleDialogPoints(null)
            measureStartRef.current = null
            setMeasureStart(null)
            setActiveTool('select')
          }}
        />
      )}
    </div>
  )
}
