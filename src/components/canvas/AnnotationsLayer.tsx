/**
 * Renders course overprint symbols per ISOM 2017-2:
 *   711 Out-of-bounds route — thin line with X marks at regular intervals
 *   710 Crossing point — two outward-curving arcs )(
 *   709 Out-of-bounds area — crosshatched diagonal lines with boundary
 */

import { memo, useId } from 'react'
import type { Annotation, MapConfig, MapPoint, EventSpec } from '../../types'
import { unitsPerMm } from '../../lib/courseUtils'
import { useRenderTracker } from '../../lib/perf'
import { symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'

interface Props {
  annotations: Annotation[]
  pendingPoints: MapPoint[]
  pendingType: 'forbidden_route' | 'crossing_point' | 'out_of_bounds' | null
  map: MapConfig
  spec: EventSpec
}

function dims(upm: number, scale: number, spec: EventSpec) {
  const sf = specScaleFactor(spec, scale)
  return {
    routeLineW:  0.35 * upm * sf,
    routeXArm:   1.5  * upm * sf,
    routeXW:     0.35 * upm * sf,
    routeXSpace: 5.0  * upm * sf,
    crossW:      0.6  * upm * sf,
    crossHalf:   1.5  * upm * sf,
    crossH:      1.5  * upm * sf,
    hatchSpace:  1.2  * upm * sf,
    hatchW:      0.2  * upm * sf,
    boundaryW:   0.7  * upm * sf,
  }
}


// ── 711 Out-of-bounds route ──────────────────────────────────────────────────
// Thin connecting line with X marks placed at regular intervals along the path.

function walkPath(points: MapPoint[], spacing: number): { x: number; y: number; angle: number }[] {
  if (points.length < 2) return []

  const segs: { len: number; angle: number }[] = []
  let totalLen = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const len = Math.sqrt(dx * dx + dy * dy)
    segs.push({ len, angle: Math.atan2(dy, dx) })
    totalLen += len
  }

  const marks: { x: number; y: number; angle: number }[] = []
  const count = Math.max(2, Math.round(totalLen / spacing))
  const actualSpacing = totalLen / count

  let dist = actualSpacing / 2
  while (dist < totalLen) {
    let cumLen = 0
    for (let i = 0; i < segs.length; i++) {
      if (cumLen + segs[i].len >= dist) {
        const t = (dist - cumLen) / segs[i].len
        marks.push({
          x: points[i].x + t * (points[i + 1].x - points[i].x),
          y: points[i].y + t * (points[i + 1].y - points[i].y),
          angle: segs[i].angle,
        })
        break
      }
      cumLen += segs[i].len
    }
    dist += actualSpacing
  }
  return marks
}

function ForbiddenRoute({ points, upm, scale, color, spec }: {
  points: MapPoint[]; upm: number; scale: number; color: string; spec: EventSpec
}) {
  if (points.length < 2) return null
  const d = dims(upm, scale, spec)
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const marks = walkPath(points, d.routeXSpace)

  return (
    <g>
      <path d={pathD} fill="none" stroke={color} strokeWidth={d.routeLineW}
        strokeLinecap="round" strokeLinejoin="round" />
      {marks.map((m, i) => {
        const a1 = m.angle + Math.PI / 4
        const a2 = m.angle - Math.PI / 4
        const arm = d.routeXArm
        return (
          <g key={i}>
            <line
              x1={m.x - Math.cos(a1) * arm} y1={m.y - Math.sin(a1) * arm}
              x2={m.x + Math.cos(a1) * arm} y2={m.y + Math.sin(a1) * arm}
              stroke={color} strokeWidth={d.routeXW} strokeLinecap="round"
            />
            <line
              x1={m.x - Math.cos(a2) * arm} y1={m.y - Math.sin(a2) * arm}
              x2={m.x + Math.cos(a2) * arm} y2={m.y + Math.sin(a2) * arm}
              stroke={color} strokeWidth={d.routeXW} strokeLinecap="round"
            />
          </g>
        )
      })}
    </g>
  )
}

// ── 710 Crossing point ───────────────────────────────────────────────────────
// Two outward-curving arcs like )( marking a mandatory crossing.

function CrossingPoint({ center, upm, scale, rotation, color, spec }: {
  center: MapPoint; upm: number; scale: number; rotation: number; color: string; spec: EventSpec
}) {
  const { x, y } = center
  const d = dims(upm, scale, spec)
  const hw = d.crossHalf
  const hh = d.crossH

  // Left arc ) — curves outward to the left
  const leftD = `M ${x  - 0.8*hw } ${y - hh} Q ${x + 0.01*hw} ${y} ${x - 0.8*hw } ${y + hh}`
  // Right arc ( — curves outward to the right
  const rightD = `M ${x + 0.8*hw } ${y - hh} Q ${x - 0.01*hw} ${y} ${x + 0.8*hw } ${y + hh}`

  return (
    <g transform={`rotate(${rotation}, ${x}, ${y})`}>
      <path d={rightD} fill="none" stroke={color} strokeWidth={d.crossW} strokeLinecap="round" />
      <path d={leftD} fill="none" stroke={color} strokeWidth={d.crossW} strokeLinecap="round" />
    </g>
  )
}

// ── 709 Out-of-bounds area ───────────────────────────────────────────────────
// Crosshatched with 45° diagonal lines, with a boundary line.

function OutOfBoundsArea({ points, upm, scale, color, patternId, spec }: {
  points: MapPoint[]; upm: number; scale: number; color: string; patternId: string; spec: EventSpec
}) {
  if (points.length < 3) return null
  const d = dims(upm, scale, spec)
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  const sp = d.hatchSpace

  return (
    <g>
      <defs>
        <pattern id={patternId} width={sp/0.707} height={sp/0.707} // 0.707 is sqrt(2)/2 to account for 45° rotation
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={sp/0.707}
            stroke={color} strokeWidth={d.hatchW/0.707} />
          <line x1={0} y1={0} x2={sp/0.707} y2={0}
            stroke={color} strokeWidth={d.hatchW/0.707} />
        </pattern>
      </defs>
      <path d={pathD} fill={`url(#${patternId})`}
        stroke={color} strokeWidth={0} strokeLinejoin="round" />
    </g>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export const AnnotationsLayer = memo(function AnnotationsLayer({ annotations, pendingPoints, pendingType, map, spec }: Props) {
  useRenderTracker('AnnotationsLayer')
  const color = '#a626ff'
  const baseId = useId()
  const upm = unitsPerMm(map)
  const scale = map.scale

  return (
    <g style={{ pointerEvents: 'none' }}>
      {annotations.map((ann, idx) => {
        if (ann.type === 'crossing_point' && ann.points[0]) {
          return (
            <g key={ann.id}>
              <CrossingPoint center={ann.points[0]} upm={upm} scale={scale}
                rotation={ann.rotation ?? 0} color={color} spec={spec} />
            </g>
          )
        }
        if (ann.type === 'forbidden_route') {
          return (
            <g key={ann.id}>
              <ForbiddenRoute points={ann.points} upm={upm} scale={scale} color={color} spec={spec} />
            </g>
          )
        }
        if (ann.type === 'out_of_bounds') {
          return (
            <g key={ann.id}>
              <OutOfBoundsArea points={ann.points} upm={upm} scale={scale} color={color}
                patternId={`${baseId}-oob-${idx}`} spec={spec} />
            </g>
          )
        }
        return null
      })}

      {pendingPoints.length > 0 && pendingType === 'forbidden_route' && (
        <g opacity={0.5}>
          <ForbiddenRoute points={pendingPoints} upm={upm} scale={scale} color={color} spec={spec} />
        </g>
      )}
      {pendingPoints.length > 0 && pendingType === 'crossing_point' && (
        <g opacity={0.5}>
          <CrossingPoint center={pendingPoints[0]} upm={upm} scale={scale}
            rotation={0} color={color} spec={spec} />
        </g>
      )}
      {pendingPoints.length >= 2 && pendingType === 'out_of_bounds' && (
        <g opacity={0.5}>
          <OutOfBoundsArea points={pendingPoints} upm={upm} scale={scale} color={color}
            patternId={`${baseId}-oob-pending`} spec={spec} />
        </g>
      )}
    </g>
  )
})
