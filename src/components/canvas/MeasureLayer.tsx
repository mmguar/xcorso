/**
 * Measure mode overlay: draws each leg of the measured course as an editable
 * route polyline (control centre → waypoints → control centre) with draggable
 * handles, plus a per-leg measured-distance label. Purely for measuring actual
 * route length — it never affects how course legs are drawn elsewhere.
 *
 * pointerEvents are off; MapCanvas owns the add/drag/remove gestures (mirrors
 * the bend-point handling).
 */

import { memo } from 'react'
import type { Course, Control, MapConfig, MapPoint } from '../../types'
import { unitsPerMm, controlsById } from '../../lib/courseUtils'
import { legKey, mapUnitsToMetres, formatDistance } from '../../lib/distance'
import { polylineLength } from '../../lib/geometry'

interface Props {
  course: Course | null
  controls: Control[]
  map: MapConfig
  measuredLegs?: Record<string, MapPoint[]>
  hiddenLegs?: Set<string>
}

const COLOR = '#0d9488' // teal-600
const HANDLE_R_MM = 0.55

export const MeasureLayer = memo(function MeasureLayer({ course, controls, map, measuredLegs, hiddenLegs }: Props) {
  if (!course || course.type === 'score' || course.controls.length < 2) return null

  const controlMap = controlsById(controls)
  const upm = unitsPerMm(map)
  const strokeW = 0.4 * upm
  const handleR = HANDLE_R_MM * upm
  const fontSize = 1.9 * upm

  const elements: React.ReactNode[] = []

  for (let i = 1; i < course.controls.length; i++) {
    const fromId = course.controls[i - 1].controlId
    const toId = course.controls[i].controlId
    const key = legKey(fromId, toId)
    if (hiddenLegs?.has(key)) continue
    const a = controlMap.get(fromId)?.position
    const b = controlMap.get(toId)?.position
    if (!a || !b) continue

    const waypoints = measuredLegs?.[key] ?? []
    const path: MapPoint[] = [a, ...waypoints, b]
    const pointsStr = path.map(p => `${p.x},${p.y}`).join(' ')
    const metres = mapUnitsToMetres(polylineLength(path), map)

    elements.push(
      <polyline
        key={`mleg-${i}`}
        points={pointsStr}
        fill="none"
        stroke={COLOR}
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${strokeW * 2} ${strokeW * 2}`}
      />
    )

    // Per-leg distance label at the midpoint of the central segment.
    if (metres > 0) {
      const segIdx = Math.floor((path.length - 1) / 2)
      const mid = { x: (path[segIdx].x + path[segIdx + 1].x) / 2, y: (path[segIdx].y + path[segIdx + 1].y) / 2 }
      elements.push(
        <text
          key={`mlabel-${i}`}
          x={mid.x}
          y={mid.y - handleR * 1.5}
          fontSize={fontSize}
          fill={COLOR}
          textAnchor="middle"
          style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: fontSize * 0.18 }}
        >
          {formatDistance(metres)}
        </text>
      )
    }

    waypoints.forEach((wp, j) => {
      elements.push(
        <circle
          key={`mh-${i}-${j}`}
          cx={wp.x}
          cy={wp.y}
          r={handleR}
          fill="white"
          stroke={COLOR}
          strokeWidth={strokeW * 0.6}
        />
      )
    })
  }

  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
})
