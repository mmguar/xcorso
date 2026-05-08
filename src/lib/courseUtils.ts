import type { Control, Course, MapConfig, MapPoint, ControlType } from '../types'

export function defaultControlLabel(control: { type: string; code: number; label?: string }): string {
  if (control.label) return control.label
  if (control.type === 'start') return `S${control.code}`
  if (control.type === 'finish') return `F${control.code}`
  return String(control.code)
}

const DEFAULT_PX_PER_MM = 4

/**
 * Map-unit-per-mm for ISOM symbol sizing.
 * OCAD: 100 units/mm. Bitmap/PDF: derived from scaleMeasurement or ~4px/mm fallback.
 */
export function unitsPerMm(map: MapConfig): number {
  if (map.type === 'ocad') return 100
  if (map.scaleMeasurement) {
    const { p1, p2, realWorldMeters } = map.scaleMeasurement
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist > 0 && map.scale > 0) {
      const mmOnPaper = (realWorldMeters * 1000000) / map.scale
      return pixelDist / mmOnPaper
    }
  }
  return DEFAULT_PX_PER_MM
}

const CIRCLE_R_MM  = 2.5
const TRIANGLE_MM  = 6.0

export function defaultLabelOffset(type: ControlType, upm: number, controlScale: number): MapPoint {
  const cr = CIRCLE_R_MM * upm * controlScale
  if (type === 'start') {
    const side = TRIANGLE_MM * upm * controlScale
    const halfSide = side / 2
    const h = side * Math.sqrt(3) / 2
    return { x: halfSide * 1.1, y: -h * 0.4 }
  }
  if (type === 'finish') {
    return { x: cr * 1.3, y: -cr * 1.1 }
  }
  return { x: cr * 1.1, y: -cr * 1.1 }
}

export function buildSequenceMap(course: Course, controls: Control[]): Map<string, number> {
  const map = new Map<string, number>()
  let seq = 1
  for (const cc of course.controls) {
    const ctrl = controls.find(c => c.id === cc.controlId)
    if (ctrl && ctrl.type === 'control') {
      if (!map.has(cc.controlId)) map.set(cc.controlId, seq)
      seq++
    }
  }
  return map
}
