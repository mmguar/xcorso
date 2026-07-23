/**
 * Draws legs between consecutive controls of the selected course.
 * Supports bend points (intermediate waypoints) for non-straight legs.
 * Lines are clipped at the edge of each control symbol so they don't overlap.
 */

import { memo, useMemo } from 'react'
import type { Course, Control, MapConfig, MapPoint, AppearanceSettings, EventSpec } from '../../types'
import { unitsPerMm, computeSubmaps, controlsById } from '../../lib/courseUtils'
import { useStore } from '../../store'
import { useRenderTracker } from '../../lib/perf'
import { resolveSpec, dimsFor, symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'
import { interpolatePolyline, flattenSmooth } from '../../lib/geometry'
import { renderLeg, renderPartialLeg, renderPreStartRoute } from '../../lib/courseRenderer'

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
  const dims = dimsFor(spec, appearance)
  const scaleFactor = specScaleFactor(spec, mapScale)
  const sf = upm * scaleFactor
  const strokeWidth = dims.legW * sf
  const legColor = appearance.color || course.color
  const elements: React.ReactNode[] = []
  // outlineWidth scaled to map units
  const canvasApp = { ...appearance, outlineWidth: appearance.outlineWidth * upm }

  // Pre-start taped route
  const firstCc = course.controls[0]
  if (firstCc.markedRoute && !handlesOnly) {
    const startCtrl = controlMap.get(firstCc.controlId)
    const bends = firstCc.legBendPoints
    if (startCtrl && bends?.length) {
      const svg = renderPreStartRoute({
        startPosition: startCtrl.position,
        startType: startCtrl.type,
        dims, scale: sf, color: legColor, appearance: canvasApp,
        bendPoints: bends, mapIssueT: firstCc.mapIssueT,
      })
      if (svg) elements.push(<g key={`${course.id}-prestart`} dangerouslySetInnerHTML={{ __html: svg }} />)
    }
  }
  if (firstCc.markedRoute && showBendHandles) {
    const bends = firstCc.legBendPoints
    if (bends) {
      const handleR = BEND_HANDLE_R_MM * sf
      bends.forEach((bp, j) => {
        if (j > 0) {
          elements.push(
            <circle key={`bend-prestart-${j}`} cx={bp.x} cy={bp.y} r={handleR}
              fill="white" stroke={legColor} strokeWidth={strokeWidth * 0.8} />
          )
        }
      })
    }
  }
  // First pre-start handle rendered in handlesOnly pass (outside overprint multiply)
  if (firstCc.markedRoute && handlesOnly && firstCc.legBendPoints?.length) {
    const handleR = BEND_HANDLE_R_MM * sf
    const bp = firstCc.legBendPoints[0]
    elements.push(
      <circle key="bend-prestart-0" cx={bp.x} cy={bp.y} r={handleR}
        fill={legColor} stroke="white" strokeWidth={strokeWidth * 0.8} />
    )
  }

  // Green "+" / red "x" for map issue point — rendered in handlesOnly pass (outside overprint)
  if (firstCc.markedRoute && handlesOnly && firstCc.legBendPoints?.length) {
    if (firstCc.mapIssueT == null) {
      const addPt = firstCc.legBendPoints[0]
      const addR = 0.8 * sf
      const arm = addR * 0.5
      elements.push(
        <circle key="mapissue-add-bg" cx={addPt.x} cy={addPt.y} r={addR}
          fill="#16a34a" stroke="white" strokeWidth={strokeWidth * 0.4} />,
        <line key="mapissue-add-v" x1={addPt.x} y1={addPt.y - arm} x2={addPt.x} y2={addPt.y + arm}
          stroke="white" strokeWidth={strokeWidth * 0.6} strokeLinecap="round" />,
        <line key="mapissue-add-h" x1={addPt.x - arm} y1={addPt.y} x2={addPt.x + arm} y2={addPt.y}
          stroke="white" strokeWidth={strokeWidth * 0.6} strokeLinecap="round" />,
      )
    } else {
      const startCtrl = controlMap.get(firstCc.controlId)
      if (startCtrl) {
        const pts: MapPoint[] = [...firstCc.legBendPoints, startCtrl.position]
        const pos = interpolatePolyline(flattenSmooth(pts), firstCc.mapIssueT)
        const barHalf = 1.25 * sf
        const perpX = -Math.sin(pos.angle), perpY = Math.cos(pos.angle)
        const delD = barHalf + 1.5 * sf
        const delX = pos.x + perpX * delD, delY = pos.y + perpY * delD
        const delR = 0.8 * sf
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
    const isFunnelFinish = isLastLeg && course.finishType === 'funnel' && !cc.markedRoute
    const bendPoints = cc.legBendPoints
    const navBendPoints = cc.legNavBendPoints

    // Partial marked route: dashed to divider, solid from divider to control
    if (effectiveMarkedRoute === 'partial' && cc.markedRouteEnd) {
      if (!handlesOnly) {
        const svg = renderPartialLeg({
          from: fromControl.position, to: toControl.position,
          divider: cc.markedRouteEnd,
          fromType: fromControl.type, toType: toControl.type,
          dims, scale: sf, color: legColor, appearance: canvasApp,
          bendPoints, navBendPoints, isFunnelFinish,
        })
        if (svg) {
          elements.push(<g key={`${course.id}-${course.controls[i].id}-${cc.id}`} dangerouslySetInnerHTML={{ __html: svg }} />)
        }
      }

      // Divider handle rendered in handlesOnly pass
      if (handlesOnly) {
        const handleR = BEND_HANDLE_R_MM * sf
        elements.push(
          <circle key={`mre-${cc.id}`} cx={cc.markedRouteEnd.x} cy={cc.markedRouteEnd.y} r={handleR}
            fill={legColor} stroke="white" strokeWidth={strokeWidth * 0.8} />
        )
      }
      if (showBendHandles) {
        const handleR = BEND_HANDLE_R_MM * sf
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
      }
      continue
    }

    if (!handlesOnly) {
      const svg = renderLeg({
        from: fromControl.position, to: toControl.position,
        fromType: fromControl.type, toType: toControl.type,
        dims, scale: sf, color: legColor, appearance: canvasApp,
        bendPoints, gaps: cc.legGaps, markedRoute: effectiveMarkedRoute,
      })
      if (svg) {
        elements.push(<g key={`${course.id}-${course.controls[i].id}-${cc.id}`} dangerouslySetInnerHTML={{ __html: svg }} />)
      }
    }

    if (showBendHandles && bendPoints?.length) {
      const handleR = BEND_HANDLE_R_MM * sf
      bendPoints.forEach((bp, j) => {
        elements.push(
          <circle key={`bend-${cc.id}-${j}`} cx={bp.x} cy={bp.y} r={handleR}
            fill="white" stroke={legColor} strokeWidth={strokeWidth * 0.8} />
        )
      })
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
