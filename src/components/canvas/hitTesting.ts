import type { Annotation, Control, MapPoint, Project, Viewport } from '../../types'
import { unitsPerMm, defaultLabelOffset, defaultControlLabel, buildSequenceMap, formatSequenceLabel, controlsById } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor, getAnnotationDims, controlSymbolRadiusMm } from '../../lib/symbolSpec'
import { northArrowHeight, northArrowGeometry, crossingPointTotalHH } from '../../lib/symbolGeometry'

export const HIT_PX = 20

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
export function mapToPx(units: number, vp: Viewport): number {
  return units * vp.scale
}

export function screenToMap(sx: number, sy: number, vp: Viewport): MapPoint {
  return { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }
}

export function mapToScreen(p: MapPoint, vp: Viewport): { x: number; y: number } {
  return { x: vp.x + p.x * vp.scale, y: vp.y + p.y * vp.scale }
}

export function controlToScreen(c: Control, vp: Viewport): { x: number; y: number } {
  return mapToScreen(c.position, vp)
}

export function controlHitRadius(control: Control, vp: Viewport, project: Project, selectedCourseId: string | null, controlScale: number): number {
  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec, project.courses.find(c => c.id === selectedCourseId)?.spec)
  const dims = getSymbolDims(spec)
  const sf = symbolScaleFactor(spec, project.map.scale)
  const symbolR = controlSymbolRadiusMm(control.type, dims) * upm * sf * controlScale
  return mapToPx(symbolR, vp)
}

export function findControlAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null, controlScale: number, extraPx = 0): Control | null {
  let best: Control | null = null
  let bestDist = Infinity
  for (const c of project.controls) {
    const s = controlToScreen(c, vp)
    const d = Math.hypot(screenX - s.x, screenY - s.y)
    const hitR = controlHitRadius(c, vp, project, selectedCourseId, controlScale) + extraPx
    if (d < hitR && d < bestDist) { best = c; bestDist = d }
  }
  return best
}

export function distToSegment(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export interface LegHit {
  courseId: string
  courseControlId: string
  t: number
  segmentIndex: number
  totalLen: number
}

export function findLegAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): LegHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course || course.type === 'score' || course.controls.length < 2) return null
  const controlMap = controlsById(project.controls)
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  for (let i = 1; i < course.controls.length; i++) {
    const fromCtrl = controlMap.get(course.controls[i - 1].controlId)
    const toCtrl = controlMap.get(course.controls[i].controlId)
    if (!fromCtrl || !toCtrl) continue

    const cc = course.controls[i]
    const bendPts = cc.legBendPoints
    const pts: MapPoint[] = bendPts?.length
      ? [fromCtrl.position, ...bendPts, toCtrl.position]
      : [fromCtrl.position, toCtrl.position]

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
        return { courseId: course.id, courseControlId: cc.id, t, segmentIndex: j, totalLen }
      }
      cumLen += segLen
    }
  }
  return null
}

export interface BendPointHit {
  courseId: string
  courseControlId: string
  bendIndex: number
}

export function findBendPointAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): BendPointHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course || course.controls.length < 2) return null
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = pxToMap(HIT_PX, vp)

  for (const cc of course.controls) {
    if (!cc.legBendPoints) continue
    for (let j = 0; j < cc.legBendPoints.length; j++) {
      const bp = cc.legBendPoints[j]
      if (Math.hypot(mapPt.x - bp.x, mapPt.y - bp.y) < hitR) {
        return { courseId: course.id, courseControlId: cc.id, bendIndex: j }
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
  const handleR = 1 * upm
  for (let i = 0; i < ann.points.length; i++) {
    if (Math.hypot(mapPt.x - ann.points[i].x, mapPt.y - ann.points[i].y) < handleR) {
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
  const handleR = 1 * upm

  const center = ann.points[0]
  const rotation = (ann.rotation ?? 0) * Math.PI / 180
  const totalHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
  const handleLocalY = -(totalHH + handleR * 2)
  const handleX = center.x - handleLocalY * Math.sin(rotation)
  const handleY = center.y + handleLocalY * Math.cos(rotation)

  const mapPt = screenToMap(screenX, screenY, vp)
  const dist = Math.hypot(mapPt.x - handleX, mapPt.y - handleY)
  if (dist < handleR) return ann
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
  const handleR = 1 * upm

  const center = ann.points[0]
  const rotation = (ann.rotation ?? 0) * Math.PI / 180
  const totalHH = crossingPointTotalHH(d, ann.elongation ?? 0, upm)
  const handleLocalY = totalHH + handleR * 2
  const handleX = center.x - handleLocalY * Math.sin(rotation)
  const handleY = center.y + handleLocalY * Math.cos(rotation)

  const mapPt = screenToMap(screenX, screenY, vp)
  const dist = Math.hypot(mapPt.x - handleX, mapPt.y - handleY)
  if (dist < handleR) return ann
  return null
}

function rotatePoint(localX: number, localY: number, cx: number, cy: number, angleDeg: number): { x: number; y: number } {
  const rad = angleDeg * Math.PI / 180
  const sin = Math.sin(rad), cos = Math.cos(rad)
  return { x: cx + localX * cos - localY * sin, y: cy + localX * sin + localY * cos }
}

export function findNorthArrowRotationHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): Annotation | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'north_arrow' || !ann.points[0]) return null

  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const h = northArrowHeight(upm, project.map.scale, spec, ann.scale ?? 1)
  const geo = northArrowGeometry(h, upm)
  const center = ann.points[0]
  const rotation = ann.rotation ?? 0

  const handle = rotatePoint(geo.rotHandleLocalX, geo.rotHandleLocalY, center.x, center.y, rotation)
  const mapPt = screenToMap(screenX, screenY, vp)
  if (Math.hypot(mapPt.x - handle.x, mapPt.y - handle.y) < geo.handleR) return ann
  return null
}

export function findNorthArrowResizeHandle(screenX: number, screenY: number, vp: Viewport, project: Project, selectedAnnotationId: string | null): Annotation | null {
  if (!selectedAnnotationId) return null
  const ann = project.annotations.find(a => a.id === selectedAnnotationId)
  if (!ann || ann.type !== 'north_arrow' || !ann.points[0]) return null

  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec)
  const h = northArrowHeight(upm, project.map.scale, spec, ann.scale ?? 1)
  const geo = northArrowGeometry(h, upm)
  const center = ann.points[0]
  const rotation = ann.rotation ?? 0

  const handle = rotatePoint(geo.resizeHandleLocalX, geo.resizeHandleLocalY, center.x, center.y, rotation)
  const mapPt = screenToMap(screenX, screenY, vp)
  if (Math.hypot(mapPt.x - handle.x, mapPt.y - handle.y) < geo.handleR) return ann
  return null
}

export function findOverlayAt(screenX: number, screenY: number, vp: Viewport, project: Project, posOverrides?: Record<string, MapPoint>): { id: string; kind: 'scalebar' | 'text' | 'image' } | null {
  const mapPt = screenToMap(screenX, screenY, vp)
  const upm = unitsPerMm(project.map)
  const hitSlop = pxToMap(HIT_PX, vp)

  for (const sb of project.scaleBars) {
    const pos = posOverrides?.[sb.id] ?? sb.position
    const segMmOnPaper = (sb.segmentLengthM * 1000) / (sb.scale ?? project.map.scale)
    const segU = segMmOnPaper * upm
    const totalU = segU * sb.segments
    const pad = 3 * upm
    const textH = 2.5 * upm
    const barH = 2.0 * upm
    const tickH = 0.5 * upm
    const boxW = totalU + pad * 2
    const boxH = barH + textH + tickH + pad * 0.5 + pad * 2 + textH
    if (mapPt.x >= pos.x - hitSlop && mapPt.x <= pos.x + boxW + hitSlop &&
        mapPt.y >= pos.y - hitSlop && mapPt.y <= pos.y + boxH + hitSlop) {
      return { id: sb.id, kind: 'scalebar' }
    }
  }

  for (const tl of project.textLabels) {
    const pos = posOverrides?.[tl.id] ?? tl.position
    const fontSize = tl.fontSizeMm * upm
    const lines = tl.text.split('\n')
    const w = Math.max(...lines.map(l => l.length)) * fontSize * 0.48
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

export interface LabelHit {
  courseId: string
  courseControlId: string
  controlId: string
  labelX: number
  labelY: number
}

export function findLabelAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null, controlScale: number): LabelHit | null {
  if (!selectedCourseId) return null
  const course = project.courses.find(c => c.id === selectedCourseId)
  if (!course) return null
  const map = project.map
  const upm = unitsPerMm(map)
  const controlMap = controlsById(project.controls)
  const seqMap = course.type === 'linear' ? buildSequenceMap(course, project.controls) : null

  let best: LabelHit | null = null
  let bestDist = Infinity

  const labelSpec = resolveSpec(project.spec, course.spec)
  const labelDims = getSymbolDims(labelSpec)

  const seenControlIds = new Set<string>()
  for (const cc of course.controls) {
    if (seenControlIds.has(cc.controlId)) continue
    seenControlIds.add(cc.controlId)
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
    const offset = cc.labelOffset ?? defaultLabelOffset(ctrl.type, upm, controlScale, labelSpec, project.map.scale)
    const labelMapX = ctrl.position.x + offset.x
    const labelMapY = ctrl.position.y + offset.y
    const { x: labelScreenX, y: labelScreenY } = mapToScreen({ x: labelMapX, y: labelMapY }, vp)

    const sf = symbolScaleFactor(labelSpec, project.map.scale)
    const cr = labelDims.controlR * upm * controlScale * sf
    const fontSize = mapToPx(cr * 1.1, vp)
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
        best = { courseId: selectedCourseId, courseControlId: cc.id, controlId: cc.controlId, labelX: labelMapX, labelY: labelMapY }
        bestDist = d
      }
    }
  }
  return best
}
