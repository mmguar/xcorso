import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { Course, Control, MapConfig, MapPoint, AppearanceSettings, EventSpec } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'
import { clipPolylineStart, clipPolylineEnd, polylineLength, clipRadius } from '../../lib/geometry'

const LIGHT_PURPLE = '#c4a0e0'
const ARROW_LEN_MM = 2
const ARROW_WIDTH_MM = 1.4
const LABEL_PX = 25

interface LegTopology {
  fromControlId: string
  toControlId: string
  fromR: number
  toR: number
  bendPoints?: MapPoint[]
  strokeWidth: number
  arrowLen: number
  arrowWidth: number
  selectedCourseUsesThis: boolean
  selectedCourseColor: string
  courseNames: string[]
}

export interface DragLegsHandle {
  begin: (controlId: string) => void
  update: (pos: MapPoint) => void
  end: () => void
}

interface Props {
  courses: Course[]
  selectedCourse: Course | null
  controls: Control[]
  map: MapConfig
  appearance: AppearanceSettings
  projectSpec?: EventSpec
  viewportScale: number
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

export const DragLegsLayer = forwardRef<DragLegsHandle, Props>(function DragLegsLayer(
  { courses, selectedCourse, controls, map, appearance, projectSpec, viewportScale },
  ref,
) {
  const gRef = useRef<SVGGElement>(null)
  const topoRef = useRef<LegTopology[]>([])
  const controlMapRef = useRef<Map<string, Control>>(new Map())
  const draggingIdRef = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    begin(controlId: string) {
      draggingIdRef.current = controlId
      const cMap = new Map(controls.map(c => [c.id, c]))
      controlMapRef.current = cMap
      const upm = unitsPerMm(map)
      const topo: LegTopology[] = []
      const seen = new Set<string>()

      for (const rawCourse of courses) {
        if (rawCourse.type !== 'linear') continue
        const isSelected = rawCourse.id === selectedCourse?.id
        const course = isSelected && selectedCourse ? selectedCourse : rawCourse
        if (course.controls.length < 2) continue

        const spec = resolveSpec(projectSpec, course.spec)
        const scaleFactor = specScaleFactor(spec, map.scale)
        const dims = getSymbolDims(spec)

        for (let i = 0; i < course.controls.length - 1; i++) {
          const fromCc = course.controls[i]
          const toCc = course.controls[i + 1]
          if (fromCc.controlId !== controlId && toCc.controlId !== controlId) continue

          const legKey = `${fromCc.controlId}->${toCc.controlId}`
          const fromCtrl = cMap.get(fromCc.controlId)
          const toCtrl = cMap.get(toCc.controlId)
          if (!fromCtrl || !toCtrl) continue

          let entry = topo.find(t => t.fromControlId === fromCc.controlId && t.toControlId === toCc.controlId)
          if (!entry) {
            entry = {
              fromControlId: fromCc.controlId,
              toControlId: toCc.controlId,
              fromR: clipRadius(fromCtrl, map.scale, upm, appearance.controlScale, spec),
              toR: clipRadius(toCtrl, map.scale, upm, appearance.controlScale, spec),
              bendPoints: toCc.legBendPoints,
              strokeWidth: dims.legW * upm * scaleFactor * appearance.lineWidth,
              arrowLen: ARROW_LEN_MM * upm * scaleFactor,
              arrowWidth: ARROW_WIDTH_MM * upm * scaleFactor,
              selectedCourseUsesThis: false,
              selectedCourseColor: '',
              courseNames: [],
            }
            topo.push(entry)
          }

          if (isSelected) {
            entry.selectedCourseUsesThis = true
            entry.selectedCourseColor = appearance.color || course.color
          } else if (!seen.has(legKey + course.id)) {
            seen.add(legKey + course.id)
            entry.courseNames.push(course.name)
          }
        }
      }
      topoRef.current = topo
    },

    update(dragPos: MapPoint) {
      const g = gRef.current
      if (!g) return
      const controlId = draggingIdRef.current
      if (!controlId) return

      while (g.firstChild) g.removeChild(g.firstChild)

      const cMap = controlMapRef.current
      const fontSize = LABEL_PX / viewportScale
      const labelPerpDist = fontSize * 1.2

      interface LabelInfo { text: string; x: number; y: number; perpX: number; perpY: number }
      const labels: LabelInfo[] = []

      for (const leg of topoRef.current) {
        const fromPos = leg.fromControlId === controlId ? dragPos : cMap.get(leg.fromControlId)!.position
        const toPos = leg.toControlId === controlId ? dragPos : cMap.get(leg.toControlId)!.position

        let clippedPts: MapPoint[]
        if (leg.bendPoints && leg.bendPoints.length > 0) {
          const fullPath: MapPoint[] = [fromPos, ...leg.bendPoints, toPos]
          if (polylineLength(fullPath) === 0) continue
          clippedPts = clipPolylineEnd(clipPolylineStart(fullPath, leg.fromR), leg.toR)
          if (clippedPts.length < 2) continue
        } else {
          const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y
          const len = Math.hypot(dx, dy)
          if (len === 0) continue
          const ux = dx / len, uy = dy / len
          clippedPts = [
            { x: fromPos.x + ux * leg.fromR, y: fromPos.y + uy * leg.fromR },
            { x: toPos.x - ux * leg.toR, y: toPos.y - uy * leg.toR },
          ]
        }

        const lineColor = leg.selectedCourseUsesThis ? leg.selectedCourseColor : LIGHT_PURPLE
        const arrowColor = lineColor

        if (clippedPts.length === 2) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          line.setAttribute('x1', String(clippedPts[0].x))
          line.setAttribute('y1', String(clippedPts[0].y))
          line.setAttribute('x2', String(clippedPts[1].x))
          line.setAttribute('y2', String(clippedPts[1].y))
          line.setAttribute('stroke', lineColor)
          line.setAttribute('stroke-width', String(leg.strokeWidth))
          line.setAttribute('stroke-linecap', 'round')
          g.appendChild(line)
        } else {
          const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
          pl.setAttribute('points', clippedPts.map(p => `${p.x},${p.y}`).join(' '))
          pl.setAttribute('fill', 'none')
          pl.setAttribute('stroke', lineColor)
          pl.setAttribute('stroke-width', String(leg.strokeWidth))
          pl.setAttribute('stroke-linecap', 'round')
          pl.setAttribute('stroke-linejoin', 'round')
          g.appendChild(pl)
        }

        const arrowFraction = leg.fromControlId === controlId ? 0.15 : 0.85
        const arrowPt = pointAlongPolyline(clippedPts, arrowFraction)
        if (arrowPt) {
          const cosA = Math.cos(arrowPt.angle), sinA = Math.sin(arrowPt.angle)
          const halfLen = leg.arrowLen / 2, halfW = leg.arrowWidth / 2
          const tipX = arrowPt.x + halfLen * cosA, tipY = arrowPt.y + halfLen * sinA
          const leftX = arrowPt.x - halfLen * cosA - halfW * sinA
          const leftY = arrowPt.y - halfLen * sinA + halfW * cosA
          const rightX = arrowPt.x - halfLen * cosA + halfW * sinA
          const rightY = arrowPt.y - halfLen * sinA - halfW * cosA
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
          poly.setAttribute('points', `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`)
          poly.setAttribute('fill', arrowColor)
          g.appendChild(poly)
        }

        if (leg.courseNames.length > 0) {
          const fraction = leg.fromControlId === controlId ? 0.7 : 0.3
          const pt = pointAlongPolyline(clippedPts, fraction)
          if (pt) {
            const perpX = -Math.sin(pt.angle) * labelPerpDist
            const perpY = Math.cos(pt.angle) * labelPerpDist
            labels.push({ text: leg.courseNames.join(', '), x: pt.x + perpX, y: pt.y + perpY, perpX, perpY })
          }
        }
      }

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
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        text.setAttribute('x', String(l.x))
        text.setAttribute('y', String(l.y))
        text.setAttribute('font-size', String(fontSize))
        text.setAttribute('fill', LIGHT_PURPLE)
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('dominant-baseline', 'middle')
        text.setAttribute('stroke', 'white')
        text.setAttribute('stroke-width', String(fontSize * 0.25))
        text.setAttribute('paint-order', 'stroke')
        text.setAttribute('font-weight', 'bold')
        text.setAttribute('font-family', 'sans-serif')
        text.textContent = l.text
        g.appendChild(text)
      }
    },

    end() {
      draggingIdRef.current = null
      topoRef.current = []
      const g = gRef.current
      if (g) while (g.firstChild) g.removeChild(g.firstChild)
    },
  }), [courses, selectedCourse, controls, map, appearance, projectSpec, viewportScale])

  return <g ref={gRef} style={{ pointerEvents: 'none' }} />
})
