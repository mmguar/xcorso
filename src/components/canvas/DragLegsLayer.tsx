import { memo, useMemo } from 'react'
import type { Course, Control, MapConfig, MapPoint, AppearanceSettings, EventSpec } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'
import { clipPolylineStart, clipPolylineEnd } from '../../lib/geometry'

interface Props {
  draggingControlId: string | null
  courses: Course[]
  selectedCourse: Course | null
  controls: Control[]
  map: MapConfig
  appearance: AppearanceSettings
  projectSpec?: EventSpec
}

const LIGHT_PURPLE = 'rgba(123, 47, 190, 0.4)'
const ARROW_LEN_MM = 2
const ARROW_WIDTH_MM = 1.4

function clipRadius(control: Control, mapScale: number, upm: number, controlScale: number, spec: EventSpec): number {
  const dims = getSymbolDims(spec)
  const sf = specScaleFactor(spec, mapScale)
  const r = dims.controlR * upm * controlScale * sf * 1.3
  if (control.type === 'start') {
    const side = dims.startSide * upm * controlScale * sf
    return side * Math.sqrt(3) / 2 * 2 / 3
  }
  return r
}

function polylineLength(pts: MapPoint[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return len
}

function pointAlongPolyline(pts: MapPoint[], fraction: number): { x: number; y: number; angle: number } | null {
  if (pts.length < 2) return null
  const totalLen = polylineLength(pts)
  if (totalLen === 0) return null
  let remaining = fraction * totalLen
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    const segLen = Math.hypot(dx, dy)
    if (remaining <= segLen || i === pts.length - 1) {
      const t = segLen > 0 ? Math.min(remaining / segLen, 1) : 0
      return {
        x: pts[i - 1].x + t * dx,
        y: pts[i - 1].y + t * dy,
        angle: Math.atan2(dy, dx),
      }
    }
    remaining -= segLen
  }
  return null
}

function renderArrow(
  cx: number, cy: number, angle: number,
  arrowLen: number, arrowWidth: number,
  color: string, key: string,
): React.ReactNode {
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const halfLen = arrowLen / 2
  const halfW = arrowWidth / 2

  const tipX = cx + halfLen * cosA
  const tipY = cy + halfLen * sinA
  const leftX = cx - halfLen * cosA - halfW * sinA
  const leftY = cy - halfLen * sinA + halfW * cosA
  const rightX = cx - halfLen * cosA + halfW * sinA
  const rightY = cy - halfLen * sinA - halfW * cosA

  return (
    <polygon
      key={key}
      points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`}
      fill={color}
    />
  )
}

export const DragLegsLayer = memo(function DragLegsLayer({
  draggingControlId,
  courses,
  selectedCourse,
  controls,
  map,
  appearance,
  projectSpec,
}: Props) {
  const controlMap = useMemo(() => new Map(controls.map(c => [c.id, c])), [controls])

  if (!draggingControlId) return null

  const upm = unitsPerMm(map)
  const elements: React.ReactNode[] = []

  for (const rawCourse of courses) {
    if (rawCourse.type !== 'linear') continue
    const isSelectedCourse = rawCourse.id === selectedCourse?.id
    const course = isSelectedCourse && selectedCourse ? selectedCourse : rawCourse
    if (course.controls.length < 2) continue

    const showLine = !selectedCourse || !isSelectedCourse
    const spec = resolveSpec(projectSpec, course.spec)
    const scaleFactor = specScaleFactor(spec, map.scale)
    const dims = getSymbolDims(spec)
    const strokeWidth = dims.legW * upm * scaleFactor * appearance.lineWidth
    const arrowLen = ARROW_LEN_MM * upm * scaleFactor
    const arrowWidth = ARROW_WIDTH_MM * upm * scaleFactor
    const legColor = isSelectedCourse ? (appearance.color || course.color) : LIGHT_PURPLE

    for (let i = 0; i < course.controls.length - 1; i++) {
      const fromCc = course.controls[i]
      const toCc = course.controls[i + 1]
      const fromControl = controlMap.get(fromCc.controlId)
      const toControl = controlMap.get(toCc.controlId)
      if (!fromControl || !toControl) continue

      if (fromCc.controlId !== draggingControlId && toCc.controlId !== draggingControlId) continue

      const fromR = clipRadius(fromControl, map.scale, upm, appearance.controlScale, spec)
      const toR = clipRadius(toControl, map.scale, upm, appearance.controlScale, spec)
      const bendPoints = toCc.legBendPoints
      let clippedPts: MapPoint[]

      if (bendPoints && bendPoints.length > 0) {
        const fullPath: MapPoint[] = [fromControl.position, ...bendPoints, toControl.position]
        const totalLen = polylineLength(fullPath)
        if (totalLen === 0) continue
        clippedPts = clipPolylineEnd(clipPolylineStart(fullPath, fromR), toR)
        if (clippedPts.length < 2) continue
      } else {
        const { x: x1, y: y1 } = fromControl.position
        const { x: x2, y: y2 } = toControl.position
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        if (len === 0) continue
        const ux = dx / len
        const uy = dy / len
        clippedPts = [
          { x: x1 + ux * fromR, y: y1 + uy * fromR },
          { x: x2 - ux * toR, y: y2 - uy * toR },
        ]
      }

      const legKey = `drag-${course.id}-${fromCc.id}-${toCc.id}`

      if (showLine) {
        if (clippedPts.length === 2) {
          elements.push(
            <line
              key={legKey}
              x1={clippedPts[0].x} y1={clippedPts[0].y}
              x2={clippedPts[1].x} y2={clippedPts[1].y}
              stroke={LIGHT_PURPLE}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )
        } else {
          elements.push(
            <polyline
              key={legKey}
              points={clippedPts.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={LIGHT_PURPLE}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        }
      }

      const mid = pointAlongPolyline(clippedPts, 0.5)
      if (mid) {
        elements.push(renderArrow(mid.x, mid.y, mid.angle, arrowLen, arrowWidth, legColor, `${legKey}-arrow`))
      }
    }
  }

  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
})
