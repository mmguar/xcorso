import type { Control, EventSpec } from '../types'
import { getSymbolDims, symbolScaleFactor as specScaleFactor, controlSymbolRadiusMm } from './symbolSpec'

interface Point { x: number; y: number }

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export function walkPath<T extends Point>(points: T[], spacing: number): { x: number; y: number; angle: number }[] {
  if (points.length < 2) return []

  const segs: { len: number; angle: number }[] = []
  let totalLen = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const len = Math.sqrt(dx * dx + dy * dy)
    segs.push({ len, angle: Math.atan2(dy, dx) })
    totalLen += len
  }

  const marks: { x: number; y: number; angle: number }[] = []
  const count = Math.max(2, Math.round(totalLen / spacing))
  const step = totalLen / count

  let dist = step / 2
  let segIdx = 0
  let cumLen = 0
  while (dist < totalLen) {
    while (segIdx < segs.length && cumLen + segs[segIdx].len < dist) {
      cumLen += segs[segIdx].len
      segIdx++
    }
    if (segIdx >= segs.length) break
    const t = (dist - cumLen) / segs[segIdx].len
    marks.push({
      x: points[segIdx].x + t * (points[segIdx + 1].x - points[segIdx].x),
      y: points[segIdx].y + t * (points[segIdx + 1].y - points[segIdx].y),
      angle: segs[segIdx].angle,
    })
    dist += step
  }
  return marks
}

export function clipPolylineStart<T extends Point>(pts: T[], clipDist: number): Point[] {
  let remaining = clipDist
  let startIdx = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    if (remaining < segLen) {
      const t = remaining / segLen
      const clipped: Point = {
        x: pts[i].x + t * (pts[i + 1].x - pts[i].x),
        y: pts[i].y + t * (pts[i + 1].y - pts[i].y),
      }
      return [clipped, ...pts.slice(i + 1)]
    }
    remaining -= segLen
    startIdx = i + 1
  }
  return pts.slice(startIdx)
}

export function clipPolylineEnd<T extends Point>(pts: T[], clipDist: number): Point[] {
  let remaining = clipDist
  for (let i = pts.length - 1; i > 0; i--) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (remaining < segLen) {
      const t = remaining / segLen
      const clipped: Point = {
        x: pts[i].x + t * (pts[i - 1].x - pts[i].x),
        y: pts[i].y + t * (pts[i - 1].y - pts[i].y),
      }
      return [...pts.slice(0, i), clipped]
    }
    remaining -= segLen
  }
  return pts.slice(0, 1)
}

export function clipPolyline<T extends Point>(pts: T[], startClip: number, endClip: number): Point[] {
  if (pts.length < 2) return pts
  const clipped = clipPolylineStart(pts, startClip)
  if (clipped.length < 2) return []
  return clipPolylineEnd(clipped, endClip)
}

export function polylineLength<T extends Point>(pts: T[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return len
}

/** Interpolate position + angle on a polyline at parametric t (0–1). */
export function interpolatePolyline(pts: Point[], t: number): { x: number; y: number; angle: number } {
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, angle: 0 }
  let totalLen = 0
  for (let i = 1; i < pts.length; i++) totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const target = Math.max(0, Math.min(1, t)) * totalLen
  let cum = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y
    const segLen = Math.hypot(dx, dy)
    if (cum + segLen >= target || i === pts.length - 2) {
      const st = segLen > 0 ? (target - cum) / segLen : 0
      return { x: pts[i].x + st * dx, y: pts[i].y + st * dy, angle: Math.atan2(dy, dx) }
    }
    cum += segLen
  }
  return { x: pts[0].x, y: pts[0].y, angle: 0 }
}

/** Project a point onto a polyline, returning the nearest parametric t (0–1). */
export function projectOnPolyline(pt: Point, polyline: Point[]): number {
  if (polyline.length < 2) return 0
  let totalLen = 0
  for (let i = 1; i < polyline.length; i++) totalLen += Math.hypot(polyline[i].x - polyline[i - 1].x, polyline[i].y - polyline[i - 1].y)
  if (totalLen === 0) return 0
  let bestDistSq = Infinity, bestCum = 0, cum = 0
  for (let i = 0; i < polyline.length - 1; i++) {
    const ax = polyline[i].x, ay = polyline[i].y
    const dx = polyline[i + 1].x - ax, dy = polyline[i + 1].y - ay
    const segLenSq = dx * dx + dy * dy
    const segLen = Math.sqrt(segLenSq)
    const st = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - ax) * dx + (pt.y - ay) * dy) / segLenSq))
    const px = ax + st * dx, py = ay + st * dy
    const dSq = (pt.x - px) ** 2 + (pt.y - py) ** 2
    if (dSq < bestDistSq) { bestDistSq = dSq; bestCum = cum + st * segLen }
    cum += segLen
  }
  return bestCum / totalLen
}

// ── Catmull-Rom → cubic bezier ──────────────────────────────────────────────

export interface CubicSeg { cp1: Point; cp2: Point; end: Point }

export function catmullRomToCubics(pts: Point[]): CubicSeg[] {
  if (pts.length < 2) return []
  const segs: CubicSeg[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y }
    const p1 = pts[i], p2 = pts[i + 1]
    const p3 = i + 2 < pts.length ? pts[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y }
    segs.push({
      cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      end: p2,
    })
  }
  return segs
}

/** SVG path `d` attribute for a Catmull-Rom spline through `pts`. */
export function smoothPathD(pts: Point[]): string {
  if (pts.length < 2) return ''
  const segs = catmullRomToCubics(pts)
  let d = `M${pts[0].x},${pts[0].y}`
  for (const s of segs) d += ` C${s.cp1.x},${s.cp1.y} ${s.cp2.x},${s.cp2.y} ${s.end.x},${s.end.y}`
  return d
}

/** Flatten a Catmull-Rom spline to a dense polyline for hit testing / length / interpolation. */
export function flattenSmooth(pts: Point[], stepsPerSeg = 16): Point[] {
  if (pts.length < 3) return pts.slice()
  const segs = catmullRomToCubics(pts)
  const out: Point[] = [pts[0]]
  let p0 = pts[0]
  for (const s of segs) {
    for (let j = 1; j <= stepsPerSeg; j++) {
      const t = j / stepsPerSeg, mt = 1 - t
      out.push({
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * s.cp1.x + 3 * mt * t * t * s.cp2.x + t * t * t * s.end.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * s.cp1.y + 3 * mt * t * t * s.cp2.y + t * t * t * s.end.y,
      })
    }
    p0 = s.end
  }
  return out
}

export function clipRadius(control: Control, mapScale: number, upm: number, controlScale: number, spec: EventSpec, gap = true): number {
  const dims = getSymbolDims(spec)
  const sf = specScaleFactor(spec, mapScale)
  const r = control.type === 'start' || control.type === 'finish'
    ? controlSymbolRadiusMm(control.type, dims) : dims.controlR
  return r * upm * controlScale * sf * (gap ? 1.4 : 1)
}
