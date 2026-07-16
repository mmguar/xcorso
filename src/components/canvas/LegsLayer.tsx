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
import { clipPolylineStart, clipPolylineEnd, polylineLength, clipRadius, interpolatePolyline, smoothPathD, flattenSmooth } from '../../lib/geometry'
import { legGapDashArray } from '../../lib/gapDash'

interface Props {
  course: Course | null
  controls: Control[]
  map: MapConfig
  showBendHandles?: boolean
  /** Render only the (white) bend handles, skipping the leg lines. Used to keep
   *  handles out of the overprint multiply pass. */
  handlesOnly?: boolean
  appearance: AppearanceSettings
  projectSpec?: EventSpec
  selectedSubmapIndex?: number | null
  _rev?: number
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
  handlesOnly?: boolean,
): React.ReactNode[] {
  if (course.controls.length < 2 || course.type === 'score') return []
  const dims = getSymbolDims(spec)
  const scaleFactor = specScaleFactor(spec, mapScale)
  const strokeWidth = dims.legW * upm * scaleFactor * appearance.lineWidth
  const legColor = appearance.color || course.color
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const elements: React.ReactNode[] = []

  // ponytail: IOF 707 — 2mm dash, 0.5mm gap, scaled like every other symbol
  // (must match the `2 * sf` dash in pdfExport.ts drawLeg)
  const markedRouteDash = `${2 * upm * scaleFactor} ${0.5 * upm * scaleFactor}`

  // Pre-start taped route
  const firstCc = course.controls[0]
  if (firstCc.markedRoute && !handlesOnly) {
    const startCtrl = controlMap.get(firstCc.controlId)
    const bends = firstCc.legBendPoints
    // No early return here: a marked route without bend points must not
    // swallow the rest of the course's legs.
    if (startCtrl && bends?.length) {
      const startR = clipRadius(startCtrl, mapScale, upm, appearance.controlScale, spec)
      const pts: MapPoint[] = [...bends, startCtrl.position]
      const clipped = clipPolylineEnd(pts, startR)
      if (clipped.length >= 2) {
        const d = smoothPathD(clipped)
        const legKey = `${course.id}-prestart`
        if (outlineSw > 0) {
          elements.push(
            <path key={`${legKey}-outline`} d={d} fill="none"
              stroke={appearance.outlineColor} strokeWidth={strokeWidth + outlineSw * 2}
              strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={markedRouteDash} />
          )
        }
        elements.push(
          <path key={legKey} d={d} fill="none"
            stroke={legColor} strokeWidth={strokeWidth}
            strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={markedRouteDash} />
        )
      }
    }
  }
  if (firstCc.markedRoute && showBendHandles) {
    const startCtrl = controlMap.get(firstCc.controlId)
    const bends = firstCc.legBendPoints
    if (startCtrl && bends) {
      const handleR = BEND_HANDLE_R_MM * upm
      bends.forEach((bp, j) => {
        elements.push(
          <circle key={`bend-prestart-${j}`} cx={bp.x} cy={bp.y} r={handleR}
            fill="white" stroke={legColor} strokeWidth={strokeWidth * 0.8} />
        )
      })
    }
  }

  // Green "+" to re-add map issue point when deleted
  if (firstCc.markedRoute && firstCc.mapIssueT == null && firstCc.legBendPoints?.length && !handlesOnly) {
    const addPt = firstCc.legBendPoints[0]
    const addR = 0.8 * upm
    const arm = addR * 0.5
    elements.push(
      <circle key="mapissue-add-bg" cx={addPt.x} cy={addPt.y} r={addR}
        fill="#16a34a" stroke="white" strokeWidth={strokeWidth * 0.4} />,
      <line key="mapissue-add-v" x1={addPt.x} y1={addPt.y - arm} x2={addPt.x} y2={addPt.y + arm}
        stroke="white" strokeWidth={strokeWidth * 0.6} strokeLinecap="round" />,
      <line key="mapissue-add-h" x1={addPt.x - arm} y1={addPt.y} x2={addPt.x + arm} y2={addPt.y}
        stroke="white" strokeWidth={strokeWidth * 0.6} strokeLinecap="round" />,
    )
  }

  // Map issue point (perpendicular bar on pre-start taped route)
  if (firstCc.markedRoute && firstCc.mapIssueT != null && firstCc.legBendPoints?.length) {
    const startCtrl = controlMap.get(firstCc.controlId)
    if (startCtrl) {
      const pts: MapPoint[] = [...firstCc.legBendPoints, startCtrl.position]
      const pos = interpolatePolyline(flattenSmooth(pts), firstCc.mapIssueT)
      const barHalf = 1.25 * upm * scaleFactor // matches 1.25 * sf in pdfExport.ts
      const barSw = 0.6 * upm * scaleFactor * appearance.lineWidth
      const perpX = -Math.sin(pos.angle), perpY = Math.cos(pos.angle)
      if (!handlesOnly) {
        const x1 = pos.x + perpX * barHalf, y1 = pos.y + perpY * barHalf
        const x2 = pos.x - perpX * barHalf, y2 = pos.y - perpY * barHalf
        if (outlineSw > 0) {
          elements.push(
            <line key="mapissue-outline" x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={appearance.outlineColor} strokeWidth={barSw + outlineSw * 2} strokeLinecap="butt" />
          )
        }
        elements.push(
          <line key="mapissue" x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={legColor} strokeWidth={barSw} strokeLinecap="butt" />
        )
      }
      if (!handlesOnly) {
        const delD = barHalf + 1.5 * upm
        const delX = pos.x + perpX * delD, delY = pos.y + perpY * delD
        const delR = 0.8 * upm
        const xArm = delR * 0.5
        elements.push(
          <circle key="mapissue-del-bg" cx={delX} cy={delY} r={delR}
            fill="#dc2626" stroke="white" strokeWidth={strokeWidth * 0.4} />,
          <line key="mapissue-del-x1" x1={delX - xArm} y1={delY - xArm} x2={delX + xArm} y2={delY + xArm}
            stroke="white" strokeWidth={strokeWidth * 0.6} strokeLinecap="round" />,
          <line key="mapissue-del-x2" x1={delX - xArm} y1={delY + xArm} x2={delX + xArm} y2={delY - xArm}
            stroke="white" strokeWidth={strokeWidth * 0.6} strokeLinecap="round" />,
        )
      }
    }
  }

  for (let i = 0; i < course.controls.length - 1; i++) {
    const fromControl = controlMap.get(course.controls[i].controlId)
    const toControl = controlMap.get(course.controls[i + 1].controlId)
    if (!fromControl || !toControl) continue
    if (excludeControlId && (fromControl.id === excludeControlId || toControl.id === excludeControlId)) continue

    const cc = course.controls[i + 1]
    const isLastLeg = i === course.controls.length - 2
    const effectiveMarkedRoute = cc.markedRoute
      || (isLastLeg && course.finishType === 'taped' ? 'full' as const
        : isLastLeg && course.finishType === 'funnel' ? 'partial' as const
        : undefined)
    const bendPoints = cc.legBendPoints
    const navBendPoints = cc.legNavBendPoints
    const noGap = !!effectiveMarkedRoute
    const fromR = clipRadius(fromControl, mapScale, upm, appearance.controlScale, spec, !noGap)
    const toR = clipRadius(toControl, mapScale, upm, appearance.controlScale, spec, !noGap)

    // Partial marked route: dashed to divider, solid from divider to control
    if (effectiveMarkedRoute === 'partial' && cc.markedRouteEnd) {
      const divider = cc.markedRouteEnd
      const legKey = `${course.id}-${course.controls[i].id}-${cc.id}`

      // Taped segment: from → bends → divider (dashed)
      const tapedPath: MapPoint[] = bendPoints?.length
        ? [fromControl.position, ...bendPoints, divider]
        : [fromControl.position, divider]
      const tapedClipped = clipPolylineStart(tapedPath, fromR)
      if (!handlesOnly && tapedClipped.length >= 2) {
        const tapedD = smoothPathD(tapedClipped)
        if (outlineSw > 0) {
          elements.push(
            <path key={`${legKey}-taped-outline`} d={tapedD} fill="none"
              stroke={appearance.outlineColor} strokeWidth={strokeWidth + outlineSw * 2}
              strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={markedRouteDash} />
          )
        }
        elements.push(
          <path key={`${legKey}-taped`} d={tapedD} fill="none"
            stroke={legColor} strokeWidth={strokeWidth}
            strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={markedRouteDash} />
        )
      }

      // Navigation segment: divider → nav bends → control (solid)
      const navPath: MapPoint[] = navBendPoints?.length
        ? [divider, ...navBendPoints, toControl.position]
        : [divider, toControl.position]
      const navClipped = clipPolylineEnd(navPath, toR)
      if (!handlesOnly && navClipped.length >= 2) {
        const navStr = navClipped.map(p => `${p.x},${p.y}`).join(' ')
        if (outlineSw > 0) {
          elements.push(
            <polyline key={`${legKey}-nav-outline`} points={navStr} fill="none"
              stroke={appearance.outlineColor} strokeWidth={strokeWidth + outlineSw * 2}
              strokeLinecap="round" strokeLinejoin="round" />
          )
        }
        elements.push(
          <polyline key={`${legKey}-nav`} points={navStr} fill="none"
            stroke={legColor} strokeWidth={strokeWidth}
            strokeLinecap="round" strokeLinejoin="round" />
        )
      }

      // Handles: taped bend points, nav bend points, divider
      if (showBendHandles) {
        const handleR = BEND_HANDLE_R_MM * upm
        bendPoints?.forEach((bp, j) => {
          elements.push(
            <circle key={`bend-${cc.id}-${j}`} cx={bp.x} cy={bp.y} r={handleR}
              fill="white" stroke={legColor} strokeWidth={strokeWidth * 0.8} />
          )
        })
        navBendPoints?.forEach((bp, j) => {
          elements.push(
            <circle key={`nav-bend-${cc.id}-${j}`} cx={bp.x} cy={bp.y} r={handleR}
              fill="white" stroke={legColor} strokeWidth={strokeWidth * 0.8} />
          )
        })
        elements.push(
          <circle key={`mre-${cc.id}`} cx={divider.x} cy={divider.y} r={handleR}
            fill={legColor} stroke="white" strokeWidth={strokeWidth * 0.8} />
        )
      }
      continue
    }

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
      const dashArray = effectiveMarkedRoute ? markedRouteDash
        : remappedGaps?.length ? legGapsToDashArray(remappedGaps, clippedLen) : null

      const legKey = `${course.id}-${course.controls[i].id}-${cc.id}`
      const linecap = dashArray ? 'butt' : 'round'
      const shapeProps = effectiveMarkedRoute
        ? { d: smoothPathD(clipped) } as const
        : { points: clipped.map(p => `${p.x},${p.y}`).join(' ') } as const
      const Tag = effectiveMarkedRoute ? 'path' : 'polyline'
      if (!handlesOnly && outlineSw > 0) {
        elements.push(
          <Tag key={`${legKey}-outline`} {...shapeProps} fill="none"
            stroke={appearance.outlineColor} strokeWidth={strokeWidth + outlineSw * 2}
            strokeLinecap={linecap} strokeLinejoin="round"
            {...(dashArray ? { strokeDasharray: dashArray } : {})} />
        )
      }
      if (!handlesOnly) {
        elements.push(
          <Tag key={legKey} {...shapeProps} fill="none"
            stroke={legColor} strokeWidth={strokeWidth}
            strokeLinecap={linecap} strokeLinejoin="round"
            {...(dashArray ? { strokeDasharray: dashArray } : {})} />
        )
      }

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
      const dashArray = effectiveMarkedRoute ? markedRouteDash
        : remappedGaps?.length ? legGapsToDashArray(remappedGaps, clippedLen) : null

      const legKey = `${course.id}-${course.controls[i].id}-${cc.id}`
      const linecap = dashArray ? 'butt' : 'round'
      if (!handlesOnly && outlineSw > 0) {
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
      if (!handlesOnly) {
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
  }
  return elements
}

export const LegsLayer = memo(function LegsLayer({ course, controls, map, showBendHandles = false, handlesOnly = false, appearance, projectSpec, selectedSubmapIndex, _rev: _rev }: Props) {
  void _rev
  useRenderTracker('LegsLayer')
  const draggingControlId = useStore(s => s.editor.draggingControlId)
  const controlMap = useMemo(() => controlsById(controls), [controls])

  if (!course) return null

  let effectiveCourse = course
  if (selectedSubmapIndex != null) {
    const submaps = computeSubmaps(course)
    if (selectedSubmapIndex < submaps.length) {
      effectiveCourse = { ...course, controls: submaps[selectedSubmapIndex].controls }
    }
  }

  const spec = resolveSpec(projectSpec, course.spec)
  const upm = unitsPerMm(map)
  const elements = renderLegs(effectiveCourse, controlMap, map.scale, upm, showBendHandles, appearance, spec, draggingControlId, handlesOnly)
  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
})
