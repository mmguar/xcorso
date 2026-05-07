/**
 * Draws legs between consecutive controls of the selected course.
 * Supports bend points (intermediate waypoints) for non-straight legs.
 * Lines are clipped at the edge of each control symbol so they don't overlap.
 */

import type { Course, Control, MapConfig, MapPoint, LegGap, AppearanceSettings } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'

interface Props {
  course: Course | null
  controls: Control[]
  map: MapConfig
  showBendHandles?: boolean
  appearance: AppearanceSettings
}

const CIRCLE_R_MM  = 2.5
const TRIANGLE_MM  = 6.0
const SW_MM        = 0.35
const BEND_HANDLE_R_MM = 0.8

function clipRadius(control: Control, upm: number, controlScale: number): number {
  const r = CIRCLE_R_MM * upm * controlScale
  if (control.type === 'start') {
    const side = TRIANGLE_MM * upm * controlScale
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

function clipPolylineStart(pts: MapPoint[], clipDist: number): MapPoint[] {
  let remaining = clipDist
  let startIdx = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    if (remaining < segLen) {
      const t = remaining / segLen
      const clipped: MapPoint = {
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

function clipPolylineEnd(pts: MapPoint[], clipDist: number): MapPoint[] {
  let remaining = clipDist
  for (let i = pts.length - 1; i > 0; i--) {
    const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (remaining < segLen) {
      const t = remaining / segLen
      const clipped: MapPoint = {
        x: pts[i].x + t * (pts[i - 1].x - pts[i].x),
        y: pts[i].y + t * (pts[i - 1].y - pts[i].y),
      }
      return [...pts.slice(0, i), clipped]
    }
    remaining -= segLen
  }
  return pts.slice(0, 1)
}

function legGapsToDashArray(gaps: LegGap[], lineLen: number): string | null {
  if (gaps.length === 0) return null
  const sorted = [...gaps].sort((a, b) => a.start - b.start)
  const dashes: number[] = []
  let pos = 0
  for (const g of sorted) {
    const gapStart = g.start * lineLen
    const gapEnd = g.end * lineLen
    if (gapStart > pos) {
      dashes.push(gapStart - pos)
      dashes.push(gapEnd - gapStart)
    } else {
      if (dashes.length > 0) {
        dashes[dashes.length - 1] += gapEnd - pos
      } else {
        dashes.push(0)
        dashes.push(gapEnd - pos)
      }
    }
    pos = gapEnd
  }
  const remaining = lineLen - pos
  if (remaining > 0) dashes.push(remaining)
  return dashes.join(' ')
}

function renderLegs(
  course: Course,
  controlMap: Map<string, Control>,
  upm: number,
  showBendHandles: boolean,
  appearance: AppearanceSettings,
): React.ReactNode[] {
  if (course.controls.length < 2 || course.type === 'score') return []
  const strokeWidth = SW_MM * upm * appearance.lineWidth
  const legColor = appearance.color || course.color
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const elements: React.ReactNode[] = []

  for (let i = 0; i < course.controls.length - 1; i++) {
    const fromControl = controlMap.get(course.controls[i].controlId)
    const toControl = controlMap.get(course.controls[i + 1].controlId)
    if (!fromControl || !toControl) continue

    const cc = course.controls[i + 1]
    const bendPoints = cc.legBendPoints
    const fromR = clipRadius(fromControl, upm, appearance.controlScale)
    const toR = clipRadius(toControl, upm, appearance.controlScale)

    if (bendPoints && bendPoints.length > 0) {
      const fullPath: MapPoint[] = [fromControl.position, ...bendPoints, toControl.position]
      const totalLen = polylineLength(fullPath)
      if (totalLen === 0) continue

      const clipped = clipPolylineEnd(clipPolylineStart(fullPath, fromR), toR)
      if (clipped.length < 2) continue

      const clippedLen = polylineLength(clipped)
      const remappedGaps = cc.legGaps?.map(g => {
        const clipStart = fromR / totalLen
        const clipEnd = 1 - toR / totalLen
        const clipRange = clipEnd - clipStart
        if (clipRange <= 0) return { start: 0, end: 0 }
        return {
          start: Math.max(0, (g.start - clipStart) / clipRange),
          end: Math.min(1, (g.end - clipStart) / clipRange),
        }
      }).filter(g => g.end > 0 && g.start < 1)
      const dashArray = remappedGaps?.length ? legGapsToDashArray(remappedGaps, clippedLen) : null

      const pointsStr = clipped.map(p => `${p.x},${p.y}`).join(' ')
      const legKey = `${course.id}-${course.controls[i].id}-${cc.id}`
      if (outlineSw > 0) {
        elements.push(
          <polyline
            key={`${legKey}-outline`}
            points={pointsStr}
            fill="none"
            stroke={appearance.outlineColor}
            strokeWidth={strokeWidth + outlineSw * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...(dashArray ? { strokeDasharray: dashArray } : {})}
          />
        )
      }
      elements.push(
        <polyline
          key={legKey}
          points={pointsStr}
          fill="none"
          stroke={legColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...(dashArray ? { strokeDasharray: dashArray } : {})}
        />
      )

      if (showBendHandles) {
        const handleR = BEND_HANDLE_R_MM * upm
        bendPoints.forEach((bp, j) => {
          elements.push(
            <circle
              key={`bend-${cc.id}-${j}`}
              cx={bp.x}
              cy={bp.y}
              r={handleR}
              fill="white"
              stroke={legColor}
              strokeWidth={strokeWidth * 0.8}
            />
          )
        })
      }
    } else {
      const { x: x1, y: y1 } = fromControl.position
      const { x: x2, y: y2 } = toControl.position

      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len === 0) continue

      const ux = dx / len
      const uy = dy / len

      const startX = x1 + ux * fromR
      const startY = y1 + uy * fromR
      const endX = x2 - ux * toR
      const endY = y2 - uy * toR

      const clippedLen = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2)
      const remappedGaps = cc.legGaps?.map(g => {
        const clipStart = fromR / len
        const clipEnd = 1 - toR / len
        const clipRange = clipEnd - clipStart
        return {
          start: Math.max(0, (g.start - clipStart) / clipRange),
          end: Math.min(1, (g.end - clipStart) / clipRange),
        }
      }).filter(g => g.end > 0 && g.start < 1)
      const dashArray = remappedGaps?.length ? legGapsToDashArray(remappedGaps, clippedLen) : null

      const legKey = `${course.id}-${course.controls[i].id}-${cc.id}`
      if (outlineSw > 0) {
        elements.push(
          <line
            key={`${legKey}-outline`}
            x1={startX} y1={startY} x2={endX} y2={endY}
            stroke={appearance.outlineColor}
            strokeWidth={strokeWidth + outlineSw * 2}
            strokeLinecap="round"
            {...(dashArray ? { strokeDasharray: dashArray } : {})}
          />
        )
      }
      elements.push(
        <line
          key={legKey}
          x1={startX} y1={startY} x2={endX} y2={endY}
          stroke={legColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          {...(dashArray ? { strokeDasharray: dashArray } : {})}
        />
      )
    }
  }
  return elements
}

export function LegsLayer({ course, controls, map, showBendHandles = false, appearance }: Props) {
  if (!course) return null
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const upm = unitsPerMm(map)
  const elements = renderLegs(course, controlMap, upm, showBendHandles, appearance)
  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
}
