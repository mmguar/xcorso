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
import { symbolScaleFactor as specScaleFactor, getAnnotationDims } from '../../lib/symbolSpec'
import type { AnnotationDims } from '../../lib/symbolSpec'
import { walkPath } from '../../lib/geometry'

interface Props {
  annotations: Annotation[]
  pendingPoints: MapPoint[]
  pendingType: 'forbidden_route' | 'crossing_point' | 'out_of_bounds' | null
  map: MapConfig
  spec: EventSpec
  selectedAnnotationId: string | null
}

function dims(upm: number, scale: number, spec: EventSpec): AnnotationDims {
  const sf = specScaleFactor(spec, scale) * upm
  return getAnnotationDims(sf)
}


// ── 711 Out-of-bounds route ──────────────────────────────────────────────────
// Thin connecting line with X marks placed at regular intervals along the path.

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

export function crossingPointControlX(d: AnnotationDims): number {
  const halfGapCenter = (d.crossGap + d.crossW) / 2
  return 2 * halfGapCenter - d.crossHalf
}

function CrossingPoint({ center, upm, scale, rotation, color, spec, selected }: {
  center: MapPoint; upm: number; scale: number; rotation: number; color: string; spec: EventSpec; selected: boolean
}) {
  const { x, y } = center
  const d = dims(upm, scale, spec)
  const spread = d.crossHalf
  const hh = d.crossH
  const cx = crossingPointControlX(d)

  const rightD = `M ${x + spread} ${y - hh} Q ${x + cx} ${y} ${x + spread} ${y + hh}`
  const leftD = `M ${x - spread} ${y - hh} Q ${x - cx} ${y} ${x - spread} ${y + hh}`

  const strokeW = 0.2 * upm
  const handleR = 1 * upm

  return (
    <g transform={`rotate(${rotation}, ${x}, ${y})`}>
      <path d={rightD} fill="none" stroke={color} strokeWidth={d.crossW} strokeLinecap="round" />
      <path d={leftD} fill="none" stroke={color} strokeWidth={d.crossW} strokeLinecap="round" />
      {selected && (
        <circle
          cx={x} cy={y - hh - handleR * 2}
          r={handleR}
          fill="#a626ff" stroke="white" strokeWidth={strokeW}
        />
      )}
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

export const AnnotationsLayer = memo(function AnnotationsLayer({ annotations, pendingPoints, pendingType, map, spec, selectedAnnotationId }: Props) {
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
                rotation={ann.rotation ?? 0} color={color} spec={spec}
                selected={ann.id === selectedAnnotationId} />
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
            rotation={0} color={color} spec={spec} selected={false} />
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
