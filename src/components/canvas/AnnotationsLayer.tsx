/**
 * Renders course overprint symbols per ISOM 2017-2:
 *   711 Out-of-bounds route — thin line with X marks at regular intervals
 *   710 Crossing point — two outward-curving arcs )(
 *   709 Out-of-bounds area — crosshatched diagonal lines with boundary
 */

import { useId } from 'react'
import type { Annotation, MapPoint } from '../../types'

interface Props {
  annotations: Annotation[]
  pendingPoints: MapPoint[]
  pendingType: 'forbidden_route' | 'crossing_point' | 'out_of_bounds' | null
  mapType: 'ocad' | 'pdf' | 'bitmap'
}

// ISOM 2017-2 dimensions (mm on paper at print scale)
// Bitmap/PDF: ~4px per mm based on our control circle radius (12px ≈ 3mm)
// OCAD: 100 units per mm

function dims(mapType: string) {
  const ocad = mapType === 'ocad'
  return {
    // 711 Out-of-bounds route
    routeLineW:  ocad ? 35  : 1.5,   // 0.35mm connecting line
    routeXArm:   ocad ? 150 : 6,     // 1.5mm half-arm of each X (3mm total)
    routeXW:     ocad ? 35  : 1.5,   // 0.35mm X stroke
    routeXSpace: ocad ? 500 : 20,    // 5mm center-to-center spacing

    // 710 Crossing point
    crossW:      ocad ? 60  : 2.5,   // 0.6mm line width
    crossHalf:   ocad ? 150 : 6,     // 1.5mm half-width (3mm total)
    crossH:      ocad ? 150 : 6,     // 1.5mm half-height

    // 709 Out-of-bounds area
    hatchSpace:  ocad ? 80  : 3.2,   // ~0.8mm line spacing
    hatchW:      ocad ? 25  : 1,     // 0.25mm hatch line width
    boundaryW:   ocad ? 70  : 2.8,   // 0.7mm boundary line (same as 708)
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

function ForbiddenRoute({ points, mapType, color }: {
  points: MapPoint[]; mapType: string; color: string
}) {
  if (points.length < 2) return null
  const d = dims(mapType)
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

function CrossingPoint({ center, mapType, rotation, color }: {
  center: MapPoint; mapType: string; rotation: number; color: string
}) {
  const { x, y } = center
  const d = dims(mapType)
  const hw = d.crossHalf
  const hh = d.crossH

  // Left arc ) — curves outward to the left
  const leftD = `M ${x - hw * 0.15} ${y - hh} Q ${x - hw} ${y} ${x - hw * 0.15} ${y + hh}`
  // Right arc ( — curves outward to the right
  const rightD = `M ${x + hw * 0.15} ${y - hh} Q ${x + hw} ${y} ${x + hw * 0.15} ${y + hh}`

  return (
    <g transform={`rotate(${rotation}, ${x}, ${y})`}>
      <path d={leftD} fill="none" stroke={color} strokeWidth={d.crossW} strokeLinecap="round" />
      <path d={rightD} fill="none" stroke={color} strokeWidth={d.crossW} strokeLinecap="round" />
    </g>
  )
}

// ── 709 Out-of-bounds area ───────────────────────────────────────────────────
// Crosshatched with 45° diagonal purple lines, with a boundary line.

function OutOfBoundsArea({ points, mapType, color, patternId }: {
  points: MapPoint[]; mapType: string; color: string; patternId: string
}) {
  if (points.length < 3) return null
  const d = dims(mapType)
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  const sp = d.hatchSpace

  return (
    <g>
      <defs>
        <pattern id={patternId} width={sp} height={sp}
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={sp}
            stroke={color} strokeWidth={d.hatchW} />
        </pattern>
      </defs>
      <path d={pathD} fill={`url(#${patternId})`}
        stroke={color} strokeWidth={d.boundaryW} strokeLinejoin="round" />
    </g>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function AnnotationsLayer({ annotations, pendingPoints, pendingType, mapType }: Props) {
  const color = '#cc0000'
  const baseId = useId()

  return (
    <g style={{ pointerEvents: 'none' }}>
      {annotations.map((ann, idx) => {
        if (ann.type === 'crossing_point' && ann.points[0]) {
          return (
            <g key={ann.id}>
              <CrossingPoint center={ann.points[0]} mapType={mapType}
                rotation={ann.rotation ?? 0} color={color} />
            </g>
          )
        }
        if (ann.type === 'forbidden_route') {
          return (
            <g key={ann.id}>
              <ForbiddenRoute points={ann.points} mapType={mapType} color={color} />
            </g>
          )
        }
        if (ann.type === 'out_of_bounds') {
          return (
            <g key={ann.id}>
              <OutOfBoundsArea points={ann.points} mapType={mapType} color={color}
                patternId={`${baseId}-oob-${idx}`} />
            </g>
          )
        }
        return null
      })}

      {/* In-progress annotation preview */}
      {pendingPoints.length > 0 && pendingType === 'forbidden_route' && (
        <g opacity={0.5}>
          <ForbiddenRoute points={pendingPoints} mapType={mapType} color={color} />
        </g>
      )}
      {pendingPoints.length > 0 && pendingType === 'crossing_point' && (
        <g opacity={0.5}>
          <CrossingPoint center={pendingPoints[0]} mapType={mapType}
            rotation={0} color={color} />
        </g>
      )}
      {pendingPoints.length >= 2 && pendingType === 'out_of_bounds' && (
        <g opacity={0.5}>
          <OutOfBoundsArea points={pendingPoints} mapType={mapType} color={color}
            patternId={`${baseId}-oob-pending`} />
        </g>
      )}
    </g>
  )
}
