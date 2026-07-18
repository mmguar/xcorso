import type { Annotation, Control, Course, CourseControl, MapPoint, Project, Viewport } from '../../types'
import { unitsPerMm, defaultLabelOffset, defaultControlLabel, buildSequenceMap, formatSequenceLabel, controlsById, computeSubmaps } from '../../lib/courseUtils'
import { legKey, scaleBarLayoutMm } from '../../lib/distance'
import { resolveSpec, getSymbolDims, symbolScaleFactor, getAnnotationDims, controlSymbolRadiusMm } from '../../lib/symbolSpec'
import { northArrowHeight, northArrowGeometry, crossingPointTotalHH, rotateAround } from '../../lib/symbolGeometry'
import { interpolatePolyline, flattenSmooth } from '../../lib/geometry'
import { measureTextWidth } from '../../lib/textMeasure'

const HIT_PX = 20

// ── Viewport scaling ─────────────────────────────────────────────────────────
// `vp.scale` is the single source of zoom: screen_px = map_units × vp.scale.
// Use these instead of hand-writing `× vp.scale` / `÷ vp.scale`. Rule of thumb:
//   • a tolerance/handle that should stay a constant size on screen → pxToMap(px, vp)
//   • a symbol that should scale with the map → size it in map units, then mapToPx

/** Screen-pixel length → map units at the current zoom (constant on screen). */
export function pxToMap(px: number, vp: Viewport): number {
  return px / vp.scale
}

/** Map-unit length → on-screen pixels at the current zoom. */
function mapToPx(units: number, vp: Viewport): number {
  return units * vp.scale
}

/** Extra grab slop (screen px) around a draggable handle, beyond its drawn size. */
const HANDLE_GRAB_PX = 8

/** Grab radius for a handle: its drawn radius plus a constant screen-pixel slop,
 *  so handles stay comfortably grabbable at any zoom. */
function handleHitRadius(drawnR: number, vp: Viewport): number {
  return drawnR + pxToMap(HANDLE_GRAB_PX, vp)
}

export function screenToMap(sx: number, sy: number, vp: Viewport): MapPoint {
  return { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }
}

export function mapToScreen(p: MapPoint, vp: Viewport): { x: number; y: number } {
  return { x: vp.x + p.x * vp.scale, y: vp.y + p.y * vp.scale }
}

function controlToScreen(c: Control, vp: Viewport): { x: number; y: number } {
  return mapToScreen(c.position, vp)
}

interface HitMetrics {
  upm: number
  dims: ReturnType<typeof getSymbolDims>
  sf: number
  controlScale: number
}

function controlHitRadiusFromMetrics(control: Control, vp: Viewport, m: HitMetrics): number {
  const symbolR = controlSymbolRadiusMm(control.type, m.dims) * m.upm * m.sf * m.controlScale
  return mapToPx(symbolR, vp)
}

function buildHitMetrics(project: Project, selectedCourseId: string | null, controlScale: number): HitMetrics {
  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec, project.courses.find(c => c.id === selectedCourseId)?.spec)
  return { upm, dims: getSymbolDims(spec), sf: symbolScaleFactor(spec, project.map.scale), controlScale }
}

/** Control IDs that are hidden from the canvas because a submap is selected and
 *  they belong to a different submap segment. Mirrors the visibility rule in
 *  ControlsLayer — controls in the course but outside the active submap are not
 *  drawn, so they must not be hittable/draggable either. */
function hiddenSubmapControlIds(project: Project, selectedCourseId: string | null, selectedSubmapIndex: number | null): Set<string> | null {
  if (selectedCourseId == null || selectedSubmapIndex == null) return null
  const course = project.courses.find(c => c.id === selectedCourseId)
  if (!course) return null
  const submaps = computeSubmaps(course)
  if (selectedSubmapIndex >= submaps.length) return null
  const visible = new Set(submaps[selectedSubmapIndex].controls.map(cc => cc.controlId))
  const hidden = new Set<string>()
  for (const cc of course.controls) {
    if (!visible.has(cc.controlId)) hidden.add(cc.controlId)
  }
  return hidden
}

export function findControlAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null, controlScale: number, extraPx = 0, selectedSubmapIndex: number | null = null): Control | null {
  const hidden = hiddenSubmapControlIds(project, selectedCourseId, selectedSubmapIndex)
  const m = buildHitMetrics(project, selectedCourseId, controlScale)
  let best: Control | null = null
  let bestDist = Infinity
  for (const c of project.controls) {
    if (hidden?.has(c.id)) continue
    const s = controlToScreen(c, vp)
    const d = Math.hypot(screenX - s.x, screenY - s.y)
    const hitR = controlHitRadiusFromMetrics(c, vp, m) + extraPx
    if (d < hitR && d < bestDist) { best = c; bestDist = d }
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

interface LegHit {
  courseId: string
  courseControlId: string
  t: number
  segmentIndex: number
  totalLen: number
}

/** True when segmentIndex is the solid nav portion of a partial/funnel leg.
 *  Polyline is [from, ...tapedBends, divider, ...navBends, to] — taped segments are 0..numTapedBends. */
export function isPartialLegNavSegment(course: Course, cc: CourseControl, segmentIndex: number): boolean {
  const ccIdx = course.controls.indexOf(cc)
  if (ccIdx <= 0) return false
  const isLastLeg = ccIdx === course.controls.length - 1
  const effectivePartial = cc.markedRoute === 'partial' || (isLastLeg && course.finishType === 'funnel')
  if (!effectivePartial || !cc.markedRouteEnd) return false
  const numTapedBends = cc.legBendPoints?.length ?? 0
  return segmentIndex > numTapedBends
}

export function legBendInsertIndex(
  course: Course,
  cc: CourseControl,
  segmentIndex: number,
): { segment: 'taped' | 'nav'; index: number } {
  if (isPartialLegNavSegment(course, cc, segmentIndex)) {
    const numTapedBends = cc.legBendPoints?.length ?? 0
    return { segment: 'nav', index: segmentIndex - numTapedBends - 1 }
  }
  return { segment: 'taped', index: segmentIndex }
}

function partialLegHitPoints(
  from: MapPoint,
  to: MapPoint,
  bendPts: MapPoint[] | undefined,
  navBendPts: MapPoint[] | undefined,
  divider: MapPoint,
): MapPoint[] {
  const pts: MapPoint[] = [from]
  if (bendPts?.length) pts.push(...bendPts)
  pts.push(divider)
  if (navBendPts?.length) pts.push(...navBendPts)
  pts.push(to)
  return pts
}

export function findLegAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): LegHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course || course.type === 'score' || course.controls.length < 2) return null
  const controlMap = controlsById(project.controls)
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  // Pre-start taped route
  const firstCc = course.controls[0]
  if (firstCc.markedRoute) {
    const startCtrl = controlMap.get(firstCc.controlId)
    const bends = firstCc.legBendPoints
    if (startCtrl && bends?.length) {
      const rawPts: MapPoint[] = [...bends, startCtrl.position]
      const numOrigSegs = rawPts.length - 1
      const pts: MapPoint[] = flattenSmooth(rawPts)
      const stepsPerSeg = numOrigSegs > 1 ? Math.round((pts.length - 1) / numOrigSegs) : 1
      let totalLen = 0
      for (let j = 1; j < pts.length; j++) totalLen += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y)
      let cumLen = 0
      for (let j = 0; j < pts.length - 1; j++) {
        const a = pts[j], b = pts[j + 1]
        const d = distToSegment(mapPt, a, b)
        const segLen = Math.hypot(b.x - a.x, b.y - a.y)
        if (d < hitR) {
          const dx = b.x - a.x, dy = b.y - a.y
          const lenSq = dx * dx + dy * dy
          const segT = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((mapPt.x - a.x) * dx + (mapPt.y - a.y) * dy) / lenSq))
          const t = totalLen === 0 ? 0 : (cumLen + segT * segLen) / totalLen
          const origSeg = Math.min(Math.floor(j / stepsPerSeg), numOrigSegs - 1)
          return { courseId: course.id, courseControlId: firstCc.id, t, segmentIndex: origSeg, totalLen }
        }
        cumLen += segLen
      }
    }
  }

  for (let i = 1; i < course.controls.length; i++) {
    const fromCtrl = controlMap.get(course.controls[i - 1].controlId)
    const toCtrl = controlMap.get(course.controls[i].controlId)
    if (!fromCtrl || !toCtrl) continue

    const cc = course.controls[i]
    const isLastLeg = i === course.controls.length - 1
    const effectiveMarked = cc.markedRoute
      || (isLastLeg && course.finishType === 'taped' ? 'full' as const
        : isLastLeg && course.finishType === 'funnel' ? 'partial' as const
        : undefined)
    const effectivePartial = cc.markedRoute === 'partial' || (isLastLeg && course.finishType === 'funnel')
    const bendPts = cc.legBendPoints
    const divider = effectivePartial ? cc.markedRouteEnd : undefined
    const navBendPts = effectivePartial ? cc.legNavBendPoints : undefined
    const rawPts: MapPoint[] = divider
      ? partialLegHitPoints(fromCtrl.position, toCtrl.position, bendPts, navBendPts, divider)
      : bendPts?.length
        ? [fromCtrl.position, ...bendPts, toCtrl.position]
        : [fromCtrl.position, toCtrl.position]
    const numOrigSegs = rawPts.length - 1
    const pts = effectiveMarked ? flattenSmooth(rawPts) : rawPts
    const stepsPerSeg = pts.length > rawPts.length ? Math.round((pts.length - 1) / numOrigSegs) : 1

    let totalLen = 0
    for (let j = 1; j < pts.length; j++) totalLen += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y)

    let cumLen = 0
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j], b = pts[j + 1]
      const d = distToSegment(mapPt, a, b)
      const segLen = Math.hypot(b.x - a.x, b.y - a.y)
      if (d < hitR) {
        const dx = b.x - a.x, dy = b.y - a.y
        const lenSq = dx * dx + dy * dy
        const segT = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((mapPt.x - a.x) * dx + (mapPt.y - a.y) * dy) / lenSq))
        const t = totalLen === 0 ? 0 : (cumLen + segT * segLen) / totalLen
        const origSeg = Math.min(Math.floor(j / stepsPerSeg), numOrigSegs - 1)
        return { courseId: course.id, courseControlId: cc.id, t, segmentIndex: origSeg, totalLen }
      }
      cumLen += segLen
    }
  }
  return null
}

interface BendPointHit {
  courseId: string
  courseControlId: string
  bendIndex: number
  nav?: boolean
}

export function findBendPointAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): BendPointHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course || course.controls.length < 2) return null
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  for (const cc of course.controls) {
    if (cc.legBendPoints) {
      for (let j = 0; j < cc.legBendPoints.length; j++) {
        const bp = cc.legBendPoints[j]
        if (Math.hypot(mapPt.x - bp.x, mapPt.y - bp.y) < hitR) {
          return { courseId: course.id, courseControlId: cc.id, bendIndex: j }
        }
      }
    }
    if (cc.legNavBendPoints) {
      for (let j = 0; j < cc.legNavBendPoints.length; j++) {
        const bp = cc.legNavBendPoints[j]
        if (Math.hypot(mapPt.x - bp.x, mapPt.y - bp.y) < hitR) {
          return { courseId: course.id, courseControlId: cc.id, bendIndex: j, nav: true }
        }
      }
    }
  }
  return null
}

export interface MarkedRouteEndHit {
  courseId: string
  courseControlId: string
}

export function findMarkedRouteEndAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): MarkedRouteEndHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course) return null
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  for (let i = 0; i < course.controls.length; i++) {
    const cc = course.controls[i]
    if (!cc.markedRouteEnd) continue
    const isLastCc = i === course.controls.length - 1
    const isPartial = cc.markedRoute === 'partial' || (isLastCc && course.finishType === 'funnel')
    if (!isPartial) continue
    if (Math.hypot(mapPt.x - cc.markedRouteEnd.x, mapPt.y - cc.markedRouteEnd.y) < hitR) {
      return { courseId: course.id, courseControlId: cc.id }
    }
  }
  return null
}

// ── Map issue point hit testing ─────────────────────────────────────────────

export interface MapIssueHit {
  courseId: string
  courseControlId: string
  kind: 'bar' | 'delete' | 'add'
}

export function findMapIssueAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): MapIssueHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course || course.controls.length < 1) return null
  const firstCc = course.controls[0]
  if (!firstCc.markedRoute || !firstCc.legBendPoints?.length) return null

  const mapPt = screenToMap(screenX, screenY, vp)
  const upm = unitsPerMm(project.map)
  // Sizes match the sf-scaled drawing in LegsLayer.
  const sf = symbolScaleFactor(resolveSpec(project.spec, course.spec), project.map.scale)

  // No map issue point — test the green "+" add button at route start
  if (firstCc.mapIssueT == null) {
    const addPt = firstCc.legBendPoints[0]
    const addR = handleHitRadius(0.8 * upm * sf, vp)
    if (Math.hypot(mapPt.x - addPt.x, mapPt.y - addPt.y) < addR) {
      return { courseId: course.id, courseControlId: firstCc.id, kind: 'add' }
    }
    return null
  }

  const controlMap = controlsById(project.controls)
  const startCtrl = controlMap.get(firstCc.controlId)
  if (!startCtrl) return null
  const pts: MapPoint[] = flattenSmooth([...firstCc.legBendPoints, startCtrl.position])
  const pos = interpolatePolyline(pts, firstCc.mapIssueT)
  const barHalf = 1.25 * upm * sf

  // Delete button
  const perpX = -Math.sin(pos.angle), perpY = Math.cos(pos.angle)
  const delX = pos.x + perpX * (barHalf + 1.5 * upm * sf)
  const delY = pos.y + perpY * (barHalf + 1.5 * upm * sf)
  const delR = handleHitRadius(0.8 * upm * sf, vp)
  if (Math.hypot(mapPt.x - delX, mapPt.y - delY) < delR) {
    return { courseId: course.id, courseControlId: firstCc.id, kind: 'delete' }
  }

  // Bar drag
  const endA = { x: pos.x + perpX * barHalf, y: pos.y + perpY * barHalf }
  const endB = { x: pos.x - perpX * barHalf, y: pos.y - perpY * barHalf }
  const hitR = pxToMap(HIT_PX, vp)
  if (distToSegment(mapPt, endA, endB) < hitR) {
    return { courseId: course.id, courseControlId: firstCc.id, kind: 'bar' }
  }
  return null
}

// ── Measure mode (route polylines, keyed per leg in project.measuredLegs) ─────

interface MeasureLegHit {
  fromControlId: string
  toControlId: string
  segmentIndex: number
}

export interface MeasurePointHit {
  fromControlId: string
  toControlId: string
  index: number
}

/** Full point path of a measure leg: from-centre, waypoints, to-centre. */
function measureLegPath(project: Project, fromControlId: string, toControlId: string): MapPoint[] | null {
  const cm = controlsById(project.controls)
  const a = cm.get(fromControlId)?.position
  const b = cm.get(toControlId)?.position
  if (!a || !b) return null
  const waypoints = project.measuredLegs?.[legKey(fromControlId, toControlId)] ?? []
  return [a, ...waypoints, b]
}

export function findMeasureLegAt(screenX: number, screenY: number, vp: Viewport, project: Project, measureCourseId: string | null, hiddenLegs?: Set<string>): MeasureLegHit | null {
  const course = measureCourseId ? project.courses.find(c => c.id === measureCourseId) : null
  if (!course || course.type === 'score' || course.controls.length < 2) return null
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  for (let i = 1; i < course.controls.length; i++) {
    const fromId = course.controls[i - 1].controlId
    const toId = course.controls[i].controlId
    if (hiddenLegs?.has(legKey(fromId, toId))) continue
    const pts = measureLegPath(project, fromId, toId)
    if (!pts) continue
    for (let j = 0; j < pts.length - 1; j++) {
      if (distToSegment(mapPt, pts[j], pts[j + 1]) < hitR) {
        return { fromControlId: fromId, toControlId: toId, segmentIndex: j }
      }
    }
  }
  return null
}

export function findMeasurePointAt(screenX: number, screenY: number, vp: Viewport, project: Project, measureCourseId: string | null, hiddenLegs?: Set<string>): MeasurePointHit | null {
  const course = measureCourseId ? project.courses.find(c => c.id === measureCourseId) : null
  if (!course || course.controls.length < 2) return null
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  for (let i = 1; i < course.controls.length; i++) {
    const fromId = course.controls[i - 1].controlId
    const toId = course.controls[i].controlId
    if (hiddenLegs?.has(legKey(fromId, toId))) continue
    const waypoints = project.measuredLegs?.[legKey(fromId, toId)]
    if (!waypoints) continue
    for (let j = 0; j < waypoints.length; j++) {
      if (Math.hypot(mapPt.x - waypoints[j].x, mapPt.y - waypoints[j].y) < hitR) {
        return { fromControlId: fromId, toControlId: toId, index: j }
      }
    }
  }
  return null
}

function pointInPolygon(pt: MapPoint, poly: MapPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y, yj = poly[j].y
    if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < (poly[j].x - poly[i].x) * (pt.y - yi) / (yj - yi) + poly[i].x) {
      inside = !inside
    }
  }
  return inside
}

export function findAnnotationAt(screenX: number, screenY: number, vp: Viewport, project: Project): Annotation | null {
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)
  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const sf = symbolScaleFactor(spec, project.map.scale)
  const d = getAnnotationDims(sf * upm)
  for (const ann of project.annotations) {
    if (ann.type === 'north_arrow') {
      const p = ann.points[0]
      if (p) {
        const h = northArrowHeight(upm, project.map.scale, spec, ann.scale ?? 1)
        if (Math.hypot(mapPt.x - p.x, mapPt.y - p.y) < h * 0.7) return ann
      }
    } else if (ann.type === 'crossing_point') {
      const p = ann.points[0]
      const cpHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
      if (p && Math.hypot(mapPt.x - p.x, mapPt.y - p.y) < cpHH) return ann
    } else {
      for (let i = 1; i < ann.points.length; i++) {
        if (distToSegment(mapPt, ann.points[i - 1], ann.points[i]) < hitR) return ann
      }
      if (ann.type === 'out_of_bounds' && ann.points.length >= 3) {
        if (distToSegment(mapPt, ann.points[ann.points.length - 1], ann.points[0]) < hitR) return ann
        if (pointInPolygon(mapPt, ann.points)) return ann
      }
    }
  }
  return null
}

export function findOobVertexHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): { ann: Annotation; vertexIndex: number } | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'out_of_bounds' || ann.points.length < 3) return null
  const mapPt = screenToMap(screenX, screenY, vp)
  const upm = unitsPerMm(project.map)
  const sf = symbolScaleFactor(resolveSpec(project.spec), project.map.scale)
  const grabR = handleHitRadius(1 * upm * sf, vp)
  for (let i = 0; i < ann.points.length; i++) {
    if (Math.hypot(mapPt.x - ann.points[i].x, mapPt.y - ann.points[i].y) < grabR) {
      return { ann, vertexIndex: i }
    }
  }
  return null
}

export function findCrossingPointRotationHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): Annotation | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'crossing_point' || !ann.points[0]) return null

  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const sf = symbolScaleFactor(spec, project.map.scale)
  const d = getAnnotationDims(sf * upm)
  const handleR = 1 * upm * sf

  const center = ann.points[0]
  const rotation = (ann.rotation ?? 0) * Math.PI / 180
  const totalHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
  const handleLocalY = -(totalHH + handleR * 2)
  const handleX = center.x - handleLocalY * Math.sin(rotation)
  const handleY = center.y + handleLocalY * Math.cos(rotation)

  const mapPt = screenToMap(screenX, screenY, vp)
  const dist = Math.hypot(mapPt.x - handleX, mapPt.y - handleY)
  if (dist < handleHitRadius(handleR, vp)) return ann
  return null
}

export function findCrossingPointResizeHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): Annotation | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'crossing_point' || !ann.points[0]) return null

  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const sf = symbolScaleFactor(spec, project.map.scale)
  const d = getAnnotationDims(sf * upm)
  const handleR = 1 * upm * sf

  const center = ann.points[0]
  const rotation = (ann.rotation ?? 0) * Math.PI / 180
  const totalHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
  const handleLocalY = totalHH + handleR * 2
  const handleX = center.x - handleLocalY * Math.sin(rotation)
  const handleY = center.y + handleLocalY * Math.cos(rotation)

  const mapPt = screenToMap(screenX, screenY, vp)
  const dist = Math.hypot(mapPt.x - handleX, mapPt.y - handleY)
  if (dist < handleHitRadius(handleR, vp)) return ann
  return null
}

export function findNorthArrowRotationHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): Annotation | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'north_arrow' || !ann.points[0]) return null

  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const h = northArrowHeight(upm, project.map.scale, spec, ann.scale ?? 1)
  const geo = northArrowGeometry(h, upm, symbolScaleFactor(spec, project.map.scale))
  const center = ann.points[0]
  const rotation = ann.rotation ?? 0

  const handle = rotateAround({ x: center.x + geo.rotHandleLocalX, y: center.y + geo.rotHandleLocalY }, center, rotation)
  const mapPt = screenToMap(screenX, screenY, vp)
  if (Math.hypot(mapPt.x - handle.x, mapPt.y - handle.y) < handleHitRadius(geo.handleR, vp)) return ann
  return null
}

export function findNorthArrowResizeHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): Annotation | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'north_arrow' || !ann.points[0]) return null

  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const h = northArrowHeight(upm, project.map.scale, spec, ann.scale ?? 1)
  const geo = northArrowGeometry(h, upm, symbolScaleFactor(spec, project.map.scale))
  const center = ann.points[0]
  const rotation = ann.rotation ?? 0

  const handle = rotateAround({ x: center.x + geo.resizeHandleLocalX, y: center.y + geo.resizeHandleLocalY }, center, rotation)
  const mapPt = screenToMap(screenX, screenY, vp)
  if (Math.hypot(mapPt.x - handle.x, mapPt.y - handle.y) < handleHitRadius(geo.handleR, vp)) return ann
  return null
}

export function findOverlayAt(screenX: number, screenY: number, vp: Viewport, project: Project, posOverrides?: Record<string, MapPoint>, printScale?: number): { id: string; kind: 'scalebar' | 'text' | 'image' } | null {
  const mapPt = screenToMap(screenX, screenY, vp)
  const baseUpm = unitsPerMm(project.map)
  // Overlays render at the effective print scale (see OverlaysLayer) — the hit
  // boxes must use the same sizing or clicks miss when it differs from map scale.
  const upm = printScale ? baseUpm * printScale / project.map.scale : baseUpm
  const hitSlop = pxToMap(HIT_PX, vp)

  for (const sb of project.scaleBars) {
    const pos = posOverrides?.[sb.id] ?? sb.position
    const lay = scaleBarLayoutMm(sb, printScale ?? project.map.scale)
    const boxW = lay.boxW * upm
    const boxH = lay.boxH * upm
    if (mapPt.x >= pos.x - hitSlop && mapPt.x <= pos.x + boxW + hitSlop &&
        mapPt.y >= pos.y - hitSlop && mapPt.y <= pos.y + boxH + hitSlop) {
      return { id: sb.id, kind: 'scalebar' }
    }
  }

  for (const tl of project.textLabels) {
    const pos = posOverrides?.[tl.id] ?? tl.position
    const fontSize = tl.fontSizeMm * upm
    const lines = tl.text.split('\n')
    const w = Math.max(...lines.map(l => measureTextWidth(l, fontSize)))
    const h = fontSize * 1.25 * lines.length
    if (mapPt.x >= pos.x - hitSlop && mapPt.x <= pos.x + w + hitSlop &&
        mapPt.y >= pos.y - fontSize - hitSlop && mapPt.y <= pos.y - fontSize + h + hitSlop) {
      return { id: tl.id, kind: 'text' }
    }
  }

  for (const img of project.imageOverlays) {
    const pos = posOverrides?.[img.id] ?? img.position
    const w = img.widthMm * upm
    const h = img.heightMm * upm
    if (mapPt.x >= pos.x - hitSlop && mapPt.x <= pos.x + w + hitSlop &&
        mapPt.y >= pos.y - hitSlop && mapPt.y <= pos.y + h + hitSlop) {
      return { id: img.id, kind: 'image' }
    }
  }

  return null
}

interface LabelHit {
  // courseId/courseControlId are null for the all-controls layout (no course
  // selected) — the label offset lives on the Control itself, not a CourseControl.
  courseId: string | null
  courseControlId: string | null
  controlId: string
  labelX: number
  labelY: number
}

export function findLabelAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null, controlScale: number, selectedSubmapIndex: number | null = null): LabelHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (selectedCourseId && !course) return null
  const hidden = hiddenSubmapControlIds(project, selectedCourseId, selectedSubmapIndex)
  const map = project.map
  const upm = unitsPerMm(map)
  const controlMap = controlsById(project.controls)
  const seqMap = course?.type === 'linear' ? buildSequenceMap(course, project.controls) : null

  let best: LabelHit | null = null
  let bestDist = Infinity

  const labelSpec = resolveSpec(project.spec, course?.spec)
  const labelDims = getSymbolDims(labelSpec)
  const sf = symbolScaleFactor(labelSpec, project.map.scale)
  const fontSize = mapToPx(labelDims.labelH * upm * controlScale * sf, vp)

  // In a course, one label per distinct control (the first course-control).
  // In the all-controls layout (no course), every control gets a label whose
  // offset lives on the Control itself.
  type Candidate = { ctrl: typeof project.controls[number]; ccId: string | null; offset: { x: number; y: number } }
  const candidates: Candidate[] = []
  if (course) {
    const seen = new Set<string>()
    for (const cc of course.controls) {
      if (seen.has(cc.controlId)) continue
      seen.add(cc.controlId)
      if (hidden?.has(cc.controlId)) continue
      const ctrl = controlMap.get(cc.controlId)
      if (!ctrl) continue
      const offset = cc.labelOffset ?? ctrl.labelOffset ?? defaultLabelOffset(ctrl.type, upm, controlScale, labelSpec, project.map.scale)
      candidates.push({ ctrl, ccId: cc.id, offset })
    }
  } else {
    for (const ctrl of project.controls) {
      const offset = ctrl.labelOffset ?? defaultLabelOffset(ctrl.type, upm, controlScale, labelSpec, project.map.scale)
      candidates.push({ ctrl, ccId: null, offset })
    }
  }

  for (const { ctrl, ccId, offset } of candidates) {
    const labelMapX = ctrl.position.x + offset.x
    const labelMapY = ctrl.position.y + offset.y
    const { x: labelScreenX, y: labelScreenY } = mapToScreen({ x: labelMapX, y: labelMapY }, vp)

    let labelText: string
    if (seqMap && ctrl.type === 'control') {
      const seqs = seqMap.get(ctrl.id)
      labelText = seqs ? formatSequenceLabel(seqs) : defaultControlLabel(ctrl)
    } else {
      labelText = defaultControlLabel(ctrl)
    }
    const textW = labelText.length * fontSize * 0.6
    const textH = fontSize * 0.75

    if (screenX >= labelScreenX && screenX <= labelScreenX + textW &&
        screenY >= labelScreenY - textH && screenY <= labelScreenY) {
      const cx = labelScreenX + textW / 2
      const cy = labelScreenY - textH / 2
      const d = Math.hypot(screenX - cx, screenY - cy)
      if (d < bestDist) {
        best = { courseId: course ? course.id : null, courseControlId: ccId, controlId: ctrl.id, labelX: labelMapX, labelY: labelMapY }
        bestDist = d
      }
    }
  }
  return best
}
