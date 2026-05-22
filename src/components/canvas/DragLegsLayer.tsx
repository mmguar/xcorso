import { memo, useMemo } from 'react'
import type { Course, Control, MapConfig, MapPoint, AppearanceSettings, EventSpec } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'
import { clipPolylineStart, clipPolylineEnd, polylineLength, clipRadius } from '../../lib/geometry'

interface Props {
  draggingControlId: string | null
  courses: Course[]
  selectedCourse: Course | null
  controls: Control[]
  map: MapConfig
  appearance: AppearanceSettings
  projectSpec?: EventSpec
  viewportScale: number
}

const LIGHT_PURPLE = '#c4a0e0'
const ARROW_LEN_MM = 2
const ARROW_WIDTH_MM = 1.4

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

const LABEL_PX = 25

interface CollectedLeg {
  clippedPts: MapPoint[]
  strokeWidth: number
  arrowLen: number
  arrowWidth: number
  fromControlId: string
  selectedCourseUsesThis: boolean
  selectedCourseColor: string
  courseNames: string[]
}

export const DragLegsLayer = memo(function DragLegsLayer({
  draggingControlId,
  courses,
  selectedCourse,
  controls,
  map,
  appearance,
  projectSpec,
  viewportScale,
}: Props) {
  const controlMap = useMemo(() => new Map(controls.map(c => [c.id, c])), [controls])

  if (!draggingControlId) return null

  const upm = unitsPerMm(map)

  // ── Pass 1: collect unique legs and their course names ─────────────────
  const legs = new Map<string, CollectedLeg>()

  for (const rawCourse of courses) {
    if (rawCourse.type !== 'linear') continue
    const isSelectedCourse = rawCourse.id === selectedCourse?.id
    const course = isSelectedCourse && selectedCourse ? selectedCourse : rawCourse
    if (course.controls.length < 2) continue

    const spec = resolveSpec(projectSpec, course.spec)
    const scaleFactor = specScaleFactor(spec, map.scale)
    const dims = getSymbolDims(spec)

    for (let i = 0; i < course.controls.length - 1; i++) {
      const fromCc = course.controls[i]
      const toCc = course.controls[i + 1]
      const fromControl = controlMap.get(fromCc.controlId)
      const toControl = controlMap.get(toCc.controlId)
      if (!fromControl || !toControl) continue
      if (fromCc.controlId !== draggingControlId && toCc.controlId !== draggingControlId) continue

      const legKey = `${fromCc.controlId}->${toCc.controlId}`
      let leg = legs.get(legKey)

      if (!leg) {
        const fromR = clipRadius(fromControl, map.scale, upm, appearance.controlScale, spec)
        const toR = clipRadius(toControl, map.scale, upm, appearance.controlScale, spec)
        const bendPoints = toCc.legBendPoints
        let clippedPts: MapPoint[]

        if (bendPoints && bendPoints.length > 0) {
          const fullPath: MapPoint[] = [fromControl.position, ...bendPoints, toControl.position]
          if (polylineLength(fullPath) === 0) continue
          clippedPts = clipPolylineEnd(clipPolylineStart(fullPath, fromR), toR)
          if (clippedPts.length < 2) continue
        } else {
          const { x: x1, y: y1 } = fromControl.position
          const { x: x2, y: y2 } = toControl.position
          const dx = x2 - x1, dy = y2 - y1
          const len = Math.sqrt(dx * dx + dy * dy)
          if (len === 0) continue
          const ux = dx / len, uy = dy / len
          clippedPts = [
            { x: x1 + ux * fromR, y: y1 + uy * fromR },
            { x: x2 - ux * toR, y: y2 - uy * toR },
          ]
        }

        leg = {
          clippedPts,
          strokeWidth: dims.legW * upm * scaleFactor * appearance.lineWidth,
          arrowLen: ARROW_LEN_MM * upm * scaleFactor,
          arrowWidth: ARROW_WIDTH_MM * upm * scaleFactor,
          fromControlId: fromCc.controlId,
          selectedCourseUsesThis: false,
          selectedCourseColor: '',
          courseNames: [],
        }
        legs.set(legKey, leg)
      }

      if (isSelectedCourse) {
        leg.selectedCourseUsesThis = true
        leg.selectedCourseColor = appearance.color || course.color
      } else {
        leg.courseNames.push(course.name)
      }
    }
  }

  // ── Pass 2: render lines + arrows, collect label positions ──────────
  const elements: React.ReactNode[] = []

  const fontSize = LABEL_PX / viewportScale
  const labelPerpDist = fontSize * 1.2

  interface LabelInfo {
    key: string
    text: string
    x: number
    y: number
    perpX: number
    perpY: number
  }
  const labels: LabelInfo[] = []

  for (const [key, leg] of legs) {
    const { clippedPts, strokeWidth, arrowLen, arrowWidth } = leg
    const showLine = !leg.selectedCourseUsesThis
    const arrowColor = leg.selectedCourseUsesThis ? leg.selectedCourseColor : LIGHT_PURPLE

    if (showLine) {
      if (clippedPts.length === 2) {
        elements.push(
          <line
            key={key}
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
            key={key}
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

    const arrowFraction = leg.fromControlId === draggingControlId ? 0.15 : 0.85
    const arrowPt = pointAlongPolyline(clippedPts, arrowFraction)
    if (arrowPt) {
      elements.push(renderArrow(arrowPt.x, arrowPt.y, arrowPt.angle, arrowLen, arrowWidth, arrowColor, `${key}-arrow`))
    }

    if (leg.courseNames.length > 0) {
      const fraction = leg.fromControlId === draggingControlId ? 0.7 : 0.3
      const pt = pointAlongPolyline(clippedPts, fraction)
      if (pt) {
        const perpX = -Math.sin(pt.angle) * labelPerpDist
        const perpY = Math.cos(pt.angle) * labelPerpDist
        labels.push({
          key: `${key}-label`,
          text: leg.courseNames.join(', '),
          x: pt.x + perpX,
          y: pt.y + perpY,
          perpX, perpY,
        })
      }
    }
  }

  // ── Pass 3: resolve label overlaps then render ────────────────────────
  for (let i = 0; i < labels.length; i++) {
    const li = labels[i]
    for (let j = 0; j < i; j++) {
      if (Math.hypot(li.x - labels[j].x, li.y - labels[j].y) < fontSize * 3) {
        li.x -= 2 * li.perpX
        li.y -= 2 * li.perpY
        break
      }
    }
  }

  for (const l of labels) {
    elements.push(
      <text
        key={l.key}
        x={l.x}
        y={l.y}
        fontSize={fontSize}
        fill={LIGHT_PURPLE}
        textAnchor="middle"
        dominantBaseline="middle"
        stroke="white"
        strokeWidth={fontSize * 0.25}
        paintOrder="stroke"
        fontWeight="bold"
        fontFamily="sans-serif"
      >
        {l.text}
      </text>
    )
  }

  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
})
