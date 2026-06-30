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
import type { Course, Control, MapConfig, MapPoint, EventSpec } from '../../types'
import { unitsPerMm, controlsById, defaultControlLabel } from '../../lib/courseUtils'
import { legKey, mapUnitsToMetres, formatDistance } from '../../lib/distance'
import { polylineLength } from '../../lib/geometry'
import { getSymbolDims, symbolScaleFactor, symbolLabelOffset } from '../../lib/symbolSpec'
import { startTriangleVertices, startTriangleAngle } from '../../lib/symbolGeometry'

interface Props {
  course: Course | null
  controls: Control[]
  map: MapConfig
  measuredLegs?: Record<string, MapPoint[]>
  hiddenLegs?: Set<string>
  spec: EventSpec
  controlScale: number
}

const COLOR = '#0d9488' // teal-600
const HANDLE_R_MM = 0.55

export const MeasureLayer = memo(function MeasureLayer({ course, controls, map, measuredLegs, hiddenLegs, spec, controlScale }: Props) {
  if (!course || course.type === 'score' || course.controls.length < 2) return null

  const controlMap = controlsById(controls)
  const upm = unitsPerMm(map)
  const strokeW = 0.4 * upm
  const handleR = HANDLE_R_MM * upm
  const fontSize = 1.9 * upm

  // Symbol sizing matches ControlsLayer so the teal symbols sit exactly on the
  // dimmed course symbols beneath them.
  const dims = getSymbolDims(spec)
  const symScale = upm * controlScale * symbolScaleFactor(spec, map.scale)
  const symStrokeW = dims.strokeW * symScale

  const elements: React.ReactNode[] = []

  // Controls belonging to legs being measured, drawn at full strength.
  const measuredControls = new Map<string, Control>()

  for (let i = 1; i < course.controls.length; i++) {
    const fromId = course.controls[i - 1].controlId
    const toId = course.controls[i].controlId
    const key = legKey(fromId, toId)
    if (hiddenLegs?.has(key)) continue
    const from = controlMap.get(fromId)
    const to = controlMap.get(toId)
    const a = from?.position
    const b = to?.position
    if (!from || !to || !a || !b) continue
    measuredControls.set(from.id, from)
    measuredControls.set(to.id, to)

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

  // Endpoint control symbols + codes for the measured legs, at full strength
  // (the regular course layer is dimmed in measure mode).
  for (const ctrl of measuredControls.values()) {
    const { x, y } = ctrl.position
    const common = { fill: 'none', stroke: COLOR, strokeWidth: symStrokeW }
    if (ctrl.type === 'start') {
      let angle = 0
      const ccIdx = course.controls.findIndex(cc => cc.controlId === ctrl.id)
      const nextCtrl = ccIdx >= 0 ? controlMap.get(course.controls[ccIdx + 1]?.controlId) : undefined
      if (nextCtrl) angle = startTriangleAngle(ctrl.position, nextCtrl.position)
      const pts = startTriangleVertices(ctrl.position, dims.startSide * symScale, angle)
      elements.push(
        <polygon key={`mc-${ctrl.id}`} points={pts.map(p => `${p.x},${p.y}`).join(' ')} {...common} strokeLinejoin="round" />
      )
    } else if (ctrl.type === 'finish') {
      elements.push(
        <g key={`mc-${ctrl.id}`}>
          <circle cx={x} cy={y} r={dims.finishROuter * symScale} {...common} />
          <circle cx={x} cy={y} r={dims.finishRInner * symScale} {...common} />
        </g>
      )
    } else {
      elements.push(
        <circle key={`mc-${ctrl.id}`} cx={x} cy={y} r={dims.controlR * symScale} {...common} />
      )
    }
    const off = symbolLabelOffset(ctrl.type, dims, symScale)
    elements.push(
      <text
        key={`mcl-${ctrl.id}`}
        x={x + off.x}
        y={y + off.y}
        fontSize={fontSize}
        fill={COLOR}
        style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: fontSize * 0.18 }}
      >
        {defaultControlLabel(ctrl)}
      </text>
    )
  }

  if (elements.length === 0) return null
  return <g style={{ pointerEvents: 'none' }}>{elements}</g>
})
