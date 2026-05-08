import type { MapPoint, MapConfig, CourseDistances, Control, Course } from '../types'

/**
 * Euclidean distance between two map points in map-native units.
 */
function mapUnitDistance(a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
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
    const dx = p2.x - p1.x; const dy = p2.y - p1.y
    const measuredUnits = Math.sqrt(dx * dx + dy * dy)
    if (measuredUnits === 0) return 0
    return units * (realWorldMeters / measuredUnits)
  }

  // No measurement available — pixel distances can't be converted to metres
  return 0
}

/**
 * Compute per-leg and total distances for a course.
 * Resolves CourseControl → Control → MapPoint.
 */
export function computeCourseDistances(
  course: Course,
  controls: Control[],
  map: MapConfig,
): CourseDistances {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const positions = course.controls
    .map(cc => controlMap.get(cc.controlId)?.position)
    .filter((p): p is MapPoint => p !== undefined)

  if (positions.length < 2) return { legs: [], total: 0 }

  const legs: number[] = []
  for (let i = 0; i < positions.length - 1; i++) {
    const units = mapUnitDistance(positions[i], positions[i + 1])
    legs.push(mapUnitsToMetres(units, map))
  }

  return { legs, total: legs.reduce((s, d) => s + d, 0) }
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}
