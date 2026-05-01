/**
 * Draws straight-line legs between consecutive controls of the selected course.
 * Lines are clipped at the edge of each control symbol so they don't overlap.
 */

import type { Course, Control } from '../../types'

interface Props {
  course: Course | null
  controls: Control[]
  mapType: 'ocad' | 'pdf' | 'bitmap'
}

function symbolRadius(mapType: string): number {
  return mapType === 'ocad' ? 250 : 12
}

function clipRadius(control: Control, mapType: string): number {
  const r = symbolRadius(mapType)
  if (control.type === 'start') {
    const side = mapType === 'ocad' ? 600 : r * 2.4
    return side * Math.sqrt(3) / 2 * 2 / 3
  }
  return r
}

function renderLegs(course: Course, controlMap: Map<string, Control>, mapType: string, opacity = 1): React.ReactNode[] {
  if (course.controls.length < 2 || course.type === 'score') return []
  const strokeWidth = mapType === 'ocad' ? 35 : 1.7
  const legs: React.ReactNode[] = []

  for (let i = 0; i < course.controls.length - 1; i++) {
    const fromControl = controlMap.get(course.controls[i].controlId)
    const toControl = controlMap.get(course.controls[i + 1].controlId)
    if (!fromControl || !toControl) continue

    const { x: x1, y: y1 } = fromControl.position
    const { x: x2, y: y2 } = toControl.position

    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) continue

    const ux = dx / len
    const uy = dy / len

    const fromR = clipRadius(fromControl, mapType)
    const toR = clipRadius(toControl, mapType)
    const startX = x1 + ux * fromR
    const startY = y1 + uy * fromR
    const endX = x2 - ux * toR
    const endY = y2 - uy * toR

    legs.push(
      <line
        key={`${course.id}-${course.controls[i].id}-${course.controls[i + 1].id}`}
        x1={startX} y1={startY} x2={endX} y2={endY}
        stroke={course.color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={opacity}
      />
    )
  }
  return legs
}

export function LegsLayer({ course, controls, mapType }: Props) {
  if (!course) return null
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const legs = renderLegs(course, controlMap, mapType)
  if (legs.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{legs}</g>
}
