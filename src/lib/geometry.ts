interface Point { x: number; y: number }

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
  while (dist < totalLen) {
    let cumLen = 0
    for (let i = 0; i < segs.length; i++) {
      if (cumLen + segs[i].len >= dist) {
        const t = (dist - cumLen) / segs[i].len
        marks.push({
          x: points[i].x + t * (points[i + 1].x - points[i].x),
          y: points[i].y + t * (points[i + 1].y - points[i].y),
          angle: segs[i].angle,
        })
        break
      }
      cumLen += segs[i].len
    }
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
