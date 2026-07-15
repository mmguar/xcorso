import type { MapPoint, MapConfig, CourseDistances, Control, Course } from '../types'
import { controlsById } from './courseUtils'
import { distance, polylineLength, flattenSmooth } from './geometry'

/** Key for a measured leg polyline (direction-specific). */
export function legKey(fromControlId: string, toControlId: string): string {
  return `${fromControlId}__${toControlId}`
}

/**
 * Convert a distance in map-native units to metres, given the map config.
 *
 * OCAD world units: 1 unit = 1/100 mm on paper = (scale / 100000) metres in real world
 *   → metres = units × scale / 100000
 *
 * Bitmap (pixels): scale denominator is derived from measurement.
 *   scaleMeasurement stores the pixel distance and real-world metres.
 *   → metres = pixels × (realWorldMeters / pixelDist)
 *
 * PDF (points, 1 pt = 1/72 inch): similar to bitmap.
 *
 * For bitmap/PDF without measurement, scale denominator is approximate.
 * We store it as (realWorldMeters * 1000 / pixelDist) so:
 *   → metres = pixels / (scale / 1000)    [inverse]
 *
 * For simplicity we unify: metres = units × scaleFactor(map)
 */
export function mapUnitsToMetres(units: number, map: MapConfig): number {
  if (map.type === 'ocad') {
    // OCAD: 1 unit = 0.01 mm on paper; real world = 0.01mm × scale
    return units * map.scale / 100000
  }

  // Bitmap / PDF: use manual measurement if available
  if (map.scaleMeasurement) {
    const { p1, p2, realWorldMeters } = map.scaleMeasurement
    const measuredUnits = distance(p1, p2)
    if (measuredUnits === 0) return 0
    return units * (realWorldMeters / measuredUnits)
  }

  // No measurement available — pixel distances can't be converted to metres
  return 0
}

/**
 * Compute per-leg and total distances for a course.
 * Resolves CourseControl → Control → MapPoint.
 *
 * When `measuredLegs` has a polyline for a leg (keyed by `from__to`), that leg's
 * length follows the measured route (centre → waypoints → centre); otherwise it
 * is the straight-line distance.
 */
export function computeCourseDistances(
  course: Course,
  controls: Control[],
  map: MapConfig,
  measuredLegs?: Record<string, MapPoint[]>,
): CourseDistances {
  const controlMap = controlsById(controls)
  const resolved = course.controls.map(cc => ({
    controlId: cc.controlId,
    position: controlMap.get(cc.controlId)?.position,
    markedRoute: cc.markedRoute,
    legBendPoints: cc.legBendPoints,
    legNavBendPoints: cc.legNavBendPoints,
    markedRouteEnd: cc.markedRouteEnd,
  }))
  const positions = resolved
    .map(r => r.position)
    .filter((p): p is MapPoint => p !== undefined)

  if (positions.length < 2) return { legs: [], total: 0 }

  // legs[i] is the distance from course control i to i+1. Consumers index this
  // positionally (legs[idx - 1]), so a leg with an unresolvable control must
  // still occupy its slot — push 0 ("unknown") instead of skipping it.
  const legs: number[] = []
  for (let i = 0; i < resolved.length - 1; i++) {
    const from = resolved[i]
    const to = resolved[i + 1]
    if (!from.position || !to.position) { legs.push(0); continue }
    const isLastLeg = i === resolved.length - 2
    const effectiveMarkedRoute = to.markedRoute
      || (isLastLeg && course.finishType === 'taped' ? 'full' as const
        : isLastLeg && course.finishType === 'funnel' ? 'partial' as const
        : undefined)
    const bendPts = effectiveMarkedRoute ? to.legBendPoints : undefined
    const waypoints = bendPts ? undefined : measuredLegs?.[legKey(from.controlId, to.controlId)]
    let units: number
    if (effectiveMarkedRoute === 'partial' && to.markedRouteEnd) {
      const tapedPts: MapPoint[] = bendPts?.length
        ? [from.position, ...bendPts, to.markedRouteEnd]
        : [from.position, to.markedRouteEnd]
      const navPts: MapPoint[] = to.legNavBendPoints?.length
        ? [to.markedRouteEnd, ...to.legNavBendPoints, to.position]
        : [to.markedRouteEnd, to.position]
      units = polylineLength(flattenSmooth(tapedPts)) + polylineLength(navPts)
    } else if (bendPts && bendPts.length > 0) {
      units = polylineLength(flattenSmooth([from.position, ...bendPts, to.position]))
    } else if (waypoints && waypoints.length > 0) {
      units = polylineLength([from.position, ...waypoints, to.position])
    } else {
      units = distance(from.position, to.position)
    }
    legs.push(mapUnitsToMetres(units, map))
  }

  // Pre-start taped route distance
  let preStart = 0
  const first = resolved[0]
  if (first.markedRoute && first.legBendPoints?.length && first.position) {
    preStart = mapUnitsToMetres(polylineLength(flattenSmooth([...first.legBendPoints, first.position])), map)
  }

  return { legs, total: preStart + legs.reduce((s, d) => s + d, 0) }
}

/**
 * The length to display/export for a course: a manually-typed total overrides
 * everything; otherwise the computed (measured-or-straight) total.
 */
export function resolveCourseLength(course: Course, distances: CourseDistances): number {
  return course.manualLength != null ? course.manualLength : distances.total
}

export function formatDistance(metres: number): string {
  const rounded = Math.round(metres / 10) * 10
  if (rounded < 1000) return `${rounded} m`
  return `${(rounded / 1000).toFixed(1)} km`
}

/** Scale-bar tick label: exact metres (no rounding to 10 m), km past 1000 m.
 *  Shared by the canvas scale bar and the PDF export so they always agree. */
export function formatScaleBarDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`
}

/** Scale bar layout dimensions in mm. Multiply by upm for map units. */
export function scaleBarLayoutMm(sb: { segmentLengthM: number; segments: number; fixedCmSegments?: boolean; scale?: number }, scaleDen: number) {
  const segMm = sb.fixedCmSegments ? 10 : (sb.segmentLengthM * 1000) / scaleDen
  const totalMm = segMm * sb.segments
  const barH = 2.0, textH = 2.5, pad = 3, strokeW = 0.2, tickH = 0.5
  const boxW = totalMm + pad * 2
  const boxH = barH + textH + tickH + pad * 0.5 + pad * 2 + textH
  return { segMm, totalMm, barH, textH, pad, strokeW, tickH, boxW, boxH }
}
