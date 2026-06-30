// Pure geometry for course-overprint symbols (ISOM 2017-2 / ISSprOM 2019-2).
// Single source of truth shared by the SVG canvas layers, the jsPDF export, and
// hit-testing — so the shapes drawn in each backend stay identical. No React or
// jsPDF deps live here; callers translate the returned points into their own
// primitives.

import { getAnnotationDims, symbolScaleFactor } from './symbolSpec'
import type { AnnotationDims, EventSpec } from './symbolSpec'

interface Pt { x: number; y: number }

/** Rotate `p` around `center` by `deg` degrees (clockwise in screen coordinates). */
export function rotateAround(p: Pt, center: Pt, deg: number): Pt {
  const rad = deg * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = p.x - center.x, dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** Start symbol: equilateral triangle, centroid at `center`, edge `side`.
 *  `angleDeg` rotates clockwise from the default apex-up orientation. */
export function startTriangleVertices(center: Pt, side: number, angleDeg = 0): [Pt, Pt, Pt] {
  const h = side * Math.sqrt(3) / 2
  const half = side / 2
  const pts: [Pt, Pt, Pt] = [
    { x: center.x, y: center.y - h * 2 / 3 },
    { x: center.x - half, y: center.y + h / 3 },
    { x: center.x + half, y: center.y + h / 3 },
  ]
  if (angleDeg === 0) return pts
  return pts.map(p => rotateAround(p, center, angleDeg)) as [Pt, Pt, Pt]
}

/** Angle (degrees) to rotate the start triangle so its apex points from `from` toward `to`. */
export function startTriangleAngle(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90
}

/** Exchange marker: equilateral triangle pointing down, inscribed in radius `r`. */
export function exchangeTriangleVertices(center: Pt, r: number): [Pt, Pt, Pt] {
  return [90, 210, 330].map(deg => {
    const rad = (deg * Math.PI) / 180
    return { x: center.x + r * Math.cos(rad), y: center.y + r * Math.sin(rad) }
  }) as [Pt, Pt, Pt]
}

/** Forbidden-route 'X' mark: two segments crossing at `mark`, ±45° to path direction. */
export function routeXMarkSegments(
  mark: { x: number; y: number; angle: number },
  arm: number,
): [[Pt, Pt], [Pt, Pt]] {
  const seg = (a: number): [Pt, Pt] => [
    { x: mark.x - Math.cos(a) * arm, y: mark.y - Math.sin(a) * arm },
    { x: mark.x + Math.cos(a) * arm, y: mark.y + Math.sin(a) * arm },
  ]
  return [seg(mark.angle + Math.PI / 4), seg(mark.angle - Math.PI / 4)]
}

// ── 710 Crossing point ───────────────────────────────────────────────────────

function crossingPointControlX(d: AnnotationDims): number {
  const halfGapCenter = (d.crossGap + d.crossW) / 2
  return 2 * halfGapCenter - d.crossHalf
}

export function crossingPointTotalHH(d: AnnotationDims, elongation: number, upm: number): number {
  return d.crossH + elongation * upm
}

/**
 * Control values for the two outward pinch curves of a crossing point. `ext` is
 * the already unit-scaled half-gap the elongation pulls the curve halves apart by.
 * Each half is a quadratic with control point (±midX, ±ctrlY) ending tangent-vertical
 * at the inner pinch (±midX, ±ext), joined across the gap by a vertical line.
 */
export function crossingPointCurve(
  d: AnnotationDims,
  ext: number,
): { spread: number; midX: number; ctrlY: number; totalHH: number } {
  const spread = d.crossHalf
  const midX = (spread + crossingPointControlX(d)) / 2
  return { spread, midX, ctrlY: d.crossH / 2, totalHH: d.crossH + ext }
}

// ── North arrow ──────────────────────────────────────────────────────────────

const TAN_22_5 = Math.tan(Math.PI / 8)

export function northArrowGeometry(h: number, upm: number) {
  const halfBase = h * TAN_22_5
  const handleR = 1 * upm
  return {
    halfBase,
    apexLocalY: -(2 / 3) * h,
    baseLocalY: (1 / 3) * h,
    handleR,
    rotHandleLocalX: 0,
    rotHandleLocalY: (1 / 3) * h + handleR * 2,
    resizeHandleLocalX: halfBase,
    resizeHandleLocalY: (1 / 3) * h,
  }
}

/** Annotation dimensions in canvas units (spec mm × scale factor × units-per-mm). */
export function annotationDims(upm: number, scale: number, spec: EventSpec): AnnotationDims {
  return getAnnotationDims(symbolScaleFactor(spec, scale) * upm)
}

export function northArrowHeight(upm: number, scale: number, spec: EventSpec, annScale: number): number {
  return annotationDims(upm, scale, spec).northArrowH * annScale
}
