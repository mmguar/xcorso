/**
 * Draws legs between consecutive controls of the selected course.
 * Supports bend points (intermediate waypoints) for non-straight legs.
 * Lines are clipped at the edge of each control symbol so they don't overlap.
 */

import { memo, useMemo } from 'react'
import type { Course, Control, MapConfig, MapPoint, LegGap, AppearanceSettings, EventSpec } from '../../types'
import { unitsPerMm, computeSubmaps, controlsById } from '../../lib/courseUtils'
import { useStore } from '../../store'
import { useRenderTracker } from '../../lib/perf'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'
import { clipPolylineStart, clipPolylineEnd, polylineLength, clipRadius } from '../../lib/geometry'
import { legGapDashArray } from '../../lib/gapDash'

interface Props {
  course: Course | null
  controls: Control[]
  map: MapConfig
  showBendHandles?: boolean
  appearance: AppearanceSettings
  projectSpec?: EventSpec
  selectedSubmapIndex?: number | null
}

const BEND_HANDLE_R_MM = 0.8

function legGapsToDashArray(gaps: LegGap[], lineLen: number): string | null {
  const dashes = legGapDashArray(gaps, lineLen)
  return dashes ? dashes.join(' ') : null
}

function renderLegs(
  course: Course,
  controlMap: Map<string, Control>,
  mapScale: number,
  upm: number,
  showBendHandles: boolean,
  appearance: AppearanceSettings,
  spec: EventSpec,
  excludeControlId?: string | null,
): React.ReactNode[] {
  if (course.controls.length < 2 || course.type === 'score') return []
  const dims = getSymbolDims(spec)
  const scaleFactor = specScaleFactor(spec, mapScale)
  const strokeWidth = dims.legW * upm * scaleFactor * appearance.lineWidth
  const legColor = appearance.color || course.color
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const elements: React.ReactNode[] = []

  for (let i = 0; i < course.controls.length - 1; i++) {
    const fromControl = controlMap.get(course.controls[i].controlId)
    const toControl = controlMap.get(course.controls[i + 1].controlId)
    if (!fromControl || !toControl) continue
    if (excludeControlId && (fromControl.id === excludeControlId || toControl.id === excludeControlId)) continue

    const cc = course.controls[i + 1]
    const bendPoints = cc.legBendPoints
    const fromR = clipRadius(fromControl, mapScale, upm, appearance.controlScale, spec)
    const toR = clipRadius(toControl, mapScale, upm, appearance.controlScale, spec)

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
      const linecap = dashArray ? 'butt' : 'round'
      if (outlineSw > 0) {
        elements.push(
          <polyline
            key={`${legKey}-outline`}
            points={pointsStr}
            fill="none"
            stroke={appearance.outlineColor}
            strokeWidth={strokeWidth + outlineSw * 2}
            strokeLinecap={linecap}
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
          strokeLinecap={linecap}
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
      if (len === 0 || fromR + toR >= len) continue

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
      const linecap = dashArray ? 'butt' : 'round'
      if (outlineSw > 0) {
        elements.push(
          <line
            key={`${legKey}-outline`}
            x1={startX} y1={startY} x2={endX} y2={endY}
            stroke={appearance.outlineColor}
            strokeWidth={strokeWidth + outlineSw * 2}
            strokeLinecap={linecap}
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
          strokeLinecap={linecap}
          {...(dashArray ? { strokeDasharray: dashArray } : {})}
        />
      )
    }
  }
  return elements
}

export const LegsLayer = memo(function LegsLayer({ course, controls, map, showBendHandles = false, appearance, projectSpec, selectedSubmapIndex }: Props) {
  useRenderTracker('LegsLayer')
  const draggingControlId = useStore(s => s.editor.draggingControlId)
  const controlMap = useMemo(() => controlsById(controls), [controls])

  if (!course) return null

  let effectiveCourse = course
  if (selectedSubmapIndex != null) {
    const submaps = computeSubmaps(course, controls)
    if (selectedSubmapIndex < submaps.length) {
      effectiveCourse = { ...course, controls: submaps[selectedSubmapIndex].controls }
    }
  }

  const spec = resolveSpec(projectSpec, course.spec)
  const upm = unitsPerMm(map)
  const elements = renderLegs(effectiveCourse, controlMap, map.scale, upm, showBendHandles, appearance, spec, draggingControlId)
  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
})
