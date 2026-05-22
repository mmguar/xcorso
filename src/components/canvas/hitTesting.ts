import type { Annotation, Control, MapPoint, Project, Viewport } from '../../types'
import type { EditorState } from '../../store/types'
import { unitsPerMm, defaultLabelOffset, defaultControlLabel, buildSequenceMap, formatSequenceLabel, computeSubmaps } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims } from '../../lib/symbolSpec'

const HIT_PX = 20
const HIT_TOLERANCE_PX = 8

export function screenToMap(sx: number, sy: number, vp: Viewport): MapPoint {
  return { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }
}

export function controlToScreen(c: Control, vp: Viewport): { x: number; y: number } {
  return { x: vp.x + c.position.x * vp.scale, y: vp.y + c.position.y * vp.scale }
}

export function controlHitRadius(control: Control, vp: Viewport, project: Project, selectedCourseId: string | null): number {
  const upm = unitsPerMm(project.map)
  const spec = resolveSpec(project.spec, project.courses.find(c => c.id === selectedCourseId)?.spec)
  const dims = getSymbolDims(spec)
  let symbolR: number
  if (control.type === 'start') {
    symbolR = dims.startSide * upm * Math.sqrt(3) / 2 * 2 / 3
  } else {
    symbolR = dims.controlR * upm
  }
  const symbolScreenR = symbolR * vp.scale
  return Math.max(HIT_PX, symbolScreenR + HIT_TOLERANCE_PX)
}

export function getVisibleControlIds(project: Project, editor: EditorState): Set<string> | null {
  if (editor.selectedSubmapIndex == null || !editor.selectedCourseId) return null
  const course = project.courses.find(c => c.id === editor.selectedCourseId)
  if (!course) return null
  const submaps = computeSubmaps(course, project.controls)
  if (editor.selectedSubmapIndex >= submaps.length) return null
  return new Set(submaps[editor.selectedSubmapIndex].controls.map(cc => cc.controlId))
}

export function findControlAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null, visibleControlIds?: Set<string> | null): Control | null {
  let best: Control | null = null
  let bestDist = Infinity
  for (const c of project.controls) {
    if (visibleControlIds && !visibleControlIds.has(c.id)) continue
    const s = controlToScreen(c, vp)
    const d = Math.hypot(screenX - s.x, screenY - s.y)
    const hitR = controlHitRadius(c, vp, project, selectedCourseId)
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
}

export function findLegAt(screenX: number, screenY: number, vp: Viewport, project: Project, selectedCourseId: string | null): LegHit | null {
  const course = selectedCourseId ? project.courses.find(c => c.id === selectedCourseId) : null
  if (!course || course.type === 'score' || course.controls.length < 2) return null
  const controlMap = new Map(project.controls.map(c => [c.id, c]))
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = HIT_PX / vp.scale

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
        return { courseId: course.id, courseControlId: cc.id, t, segmentIndex: j }
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
  const hitR = HIT_PX / vp.scale

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

export function findAnnotationAt(screenX: number, screenY: number, vp: Viewport, project: Project): Annotation | null {
  const mapPt = screenToMap(screenX, screenY, vp)
  const hitR = HIT_PX / vp.scale
  for (const ann of project.annotations) {
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

export function findOverlayAt(screenX: number, screenY: number, vp: Viewport, project: Project, posOverrides?: Record<string, MapPoint>): { id: string; kind: 'scalebar' | 'text' } | null {
  const mapPt = screenToMap(screenX, screenY, vp)
  const upm = unitsPerMm(project.map)
  const hitSlop = HIT_PX / vp.scale

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
    const w = tl.text.length * fontSize * 0.65
    const h = fontSize * 1.3
    if (mapPt.x >= pos.x - hitSlop && mapPt.x <= pos.x + w + hitSlop &&
        mapPt.y >= pos.y - fontSize - hitSlop && mapPt.y <= pos.y - fontSize + h + hitSlop) {
      return { id: tl.id, kind: 'text' }
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
  const controlMap = new Map(project.controls.map(c => [c.id, c]))
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
    const offset = cc.labelOffset ?? defaultLabelOffset(ctrl.type, upm, controlScale, labelSpec)
    const labelMapX = ctrl.position.x + offset.x
    const labelMapY = ctrl.position.y + offset.y
    const labelScreenX = vp.x + labelMapX * vp.scale
    const labelScreenY = vp.y + labelMapY * vp.scale

    const cr = labelDims.controlR * upm * controlScale
    const fontSize = cr * 1.1 * vp.scale
    let labelText: string
    if (seqMap && (ctrl.type === 'control' || ctrl.type === 'exchange')) {
      const seqs = seqMap.get(ctrl.id)
      labelText = seqs ? formatSequenceLabel(seqs) : defaultControlLabel(ctrl)
    } else {
      labelText = defaultControlLabel(ctrl)
    }
    const textW = labelText.length * fontSize * 0.7
    const textH = fontSize
    const pad = Math.max(HIT_PX * 0.5, 4)

    if (screenX >= labelScreenX - pad && screenX <= labelScreenX + textW + pad &&
        screenY >= labelScreenY - textH - pad && screenY <= labelScreenY + pad) {
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
