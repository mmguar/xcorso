/**
 * Renders course overprint symbols per ISOM 2017-2:
 *   711 Out-of-bounds route — thin line with X marks at regular intervals
 *   710 Crossing point — two outward-curving arcs )(
 *   709 Out-of-bounds area — crosshatched diagonal lines with boundary
 */

import { memo, useId } from 'react'
import type { Annotation, MapConfig, MapPoint, EventSpec } from '../../types'
import { unitsPerMm, IOF_PURPLE } from '../../lib/courseUtils'
import { useRenderTracker } from '../../lib/perf'
import { walkPath } from '../../lib/geometry'
import { darkenHex } from '../../lib/color'
import {
  annotationDims as dims,
  crossingPointCurve,
  northArrowGeometry,
  northArrowHeight,
  routeXMarkSegments,
} from '../../lib/symbolGeometry'

interface Props {
  annotations: Annotation[]
  pendingPoints: MapPoint[]
  pendingType: 'forbidden_route' | 'crossing_point' | 'out_of_bounds' | 'north_arrow' | null
  cursorPoint: MapPoint | null
  map: MapConfig
  spec: EventSpec
  selectedAnnotationId: string | null
  /**
   * 'ink'   — the purple ISOM symbols (709/710/711) that participate in overprint.
   * 'chrome' — north arrows, selection outlines and pending previews (never overprinted).
   * The caller renders 'ink' twice (a solid pass + a multiply pass) to crossfade overprint.
   */
  render: 'ink' | 'chrome'
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
        const [s1, s2] = routeXMarkSegments(m, d.routeXArm)
        return (
          <g key={i}>
            <line x1={s1[0].x} y1={s1[0].y} x2={s1[1].x} y2={s1[1].y}
              stroke={color} strokeWidth={d.routeXW} strokeLinecap="round" />
            <line x1={s2[0].x} y1={s2[0].y} x2={s2[1].x} y2={s2[1].y}
              stroke={color} strokeWidth={d.routeXW} strokeLinecap="round" />
          </g>
        )
      })}
    </g>
  )
}

// ── 710 Crossing point ───────────────────────────────────────────────────────
// Two outward-curving arcs like )( marking a mandatory crossing.

function CrossingPoint({ center, upm, scale, rotation, elongation, color, spec }: {
  center: MapPoint; upm: number; scale: number; rotation: number; elongation: number; color: string; spec: EventSpec
}) {
  const { x, y } = center
  const d = dims(upm, scale, spec)
  const ext = Math.max(0, elongation * upm)
  // Each half is a quadratic with control point (midX, ±ctrlY) ending tangent-vertical
  // at the inner pinch (midX, ±ext), joined across the gap by a straight vertical line.
  const { spread, midX, ctrlY, totalHH } = crossingPointCurve(d, ext)

  const rightD =
    `M ${x + spread} ${y - totalHH} Q ${x + midX} ${y - ctrlY - ext} ${x + midX} ${y - ext}` +
    ` L ${x + midX} ${y + ext}` +
    ` Q ${x + midX} ${y + ctrlY + ext} ${x + spread} ${y + totalHH}`
  const leftD =
    `M ${x - spread} ${y - totalHH} Q ${x - midX} ${y - ctrlY - ext} ${x - midX} ${y - ext}` +
    ` L ${x - midX} ${y + ext}` +
    ` Q ${x - midX} ${y + ctrlY + ext} ${x - spread} ${y + totalHH}`

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

// ── North Arrow ─────────────────────────────────────────────────────────────
// Blue isosceles triangle (30° apex) pointing up with a white "N" inside.

function NorthArrow({ center, upm, scale, annScale, rotation, color, textColor, spec, selected }: {
  center: MapPoint; upm: number; scale: number; annScale: number; rotation: number; color: string; textColor: string; spec: EventSpec; selected: boolean
}) {
  const h = northArrowHeight(upm, scale, spec, annScale)
  const geo = northArrowGeometry(h, upm)

  const apexY  = center.y + geo.apexLocalY
  const baseY  = center.y + geo.baseLocalY
  const leftX  = center.x - geo.halfBase
  const rightX = center.x + geo.halfBase

  const points = `${center.x},${apexY} ${rightX},${baseY} ${leftX},${baseY}`

  const fontSize = h * 0.45
  const strokeW = 0.2 * upm
  const strokeColor = darkenHex(color)

  return (
    <g transform={`rotate(${rotation}, ${center.x}, ${center.y})`}>
      <polygon points={points} fill={color} stroke={strokeColor} strokeWidth={upm * 0.15} strokeLinejoin="round" />
      <text
        x={center.x} y={center.y + h * 0.12}
        textAnchor="middle" dominantBaseline="central"
        fill={textColor} fontSize={fontSize} fontWeight="bold" fontFamily="sans-serif"
        style={{ pointerEvents: 'none' }}
      >
        N
      </text>
      {selected && (
        <>
          {/* Rotation handle — bottom center */}
          <circle
            cx={center.x + geo.rotHandleLocalX} cy={center.y + geo.rotHandleLocalY}
            r={geo.handleR}
            fill={color} stroke="white" strokeWidth={strokeW}
          />
          {/* Resize handle — bottom-right corner */}
          <rect
            x={rightX - geo.handleR} y={baseY - geo.handleR}
            width={geo.handleR * 2} height={geo.handleR * 2}
            rx={strokeW * 2}
            fill={color} stroke="white" strokeWidth={strokeW}
          />
        </>
      )}
    </g>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export const AnnotationsLayer = memo(function AnnotationsLayer({ annotations, pendingPoints, pendingType, cursorPoint, map, spec, selectedAnnotationId, render }: Props) {
  useRenderTracker('AnnotationsLayer')
  const color = IOF_PURPLE
  const baseId = useId()
  const upm = unitsPerMm(map)
  const scale = map.scale

  // ── Ink pass: the purple ISOM symbols (709/710/711) that overprint the map. ──
  if (render === 'ink') {
    const inkSymbol = (ann: Annotation) => {
      if (ann.type === 'crossing_point' && ann.points[0]) {
        return (
          <CrossingPoint key={ann.id} center={ann.points[0]} upm={upm} scale={scale}
            rotation={ann.rotation ?? 0} elongation={ann.elongation ?? 0}
            color={color} spec={spec} />
        )
      }
      if (ann.type === 'forbidden_route') {
        return <ForbiddenRoute key={ann.id} points={ann.points} upm={upm} scale={scale} color={color} spec={spec} />
      }
      if (ann.type === 'out_of_bounds') {
        return (
          <OutOfBoundsArea key={ann.id} points={ann.points} upm={upm} scale={scale} color={color}
            patternId={`${baseId}-oob-${ann.id}`} spec={spec} />
        )
      }
      return null
    }
    return (
      <g style={{ pointerEvents: 'none' }}>
        {annotations.filter(a => a.type !== 'north_arrow').map(inkSymbol)}
      </g>
    )
  }

  // ── Chrome pass: north arrows, selection outline, pending previews. ──────────
  // North arrows are excluded from overprint (their white "N" would vanish under
  // a multiply blend), so they live here at full opacity.
  const selectedOob = selectedAnnotationId
    ? annotations.find(a => a.id === selectedAnnotationId && a.type === 'out_of_bounds')
    : undefined

  return (
    <g style={{ pointerEvents: 'none' }}>
      {selectedOob && selectedOob.points.length >= 3 && (
        <path
          d={selectedOob.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'}
          fill="none" stroke={color} strokeWidth={0.3 * upm}
          strokeDasharray={`${1.5 * upm} ${1.5 * upm}`}
        />
      )}

      {annotations.filter(a => a.type === 'north_arrow').map(ann => ann.points[0] ? (
        <NorthArrow key={ann.id} center={ann.points[0]} upm={upm} scale={scale}
          annScale={ann.scale ?? 1} rotation={ann.rotation ?? 0}
          color={ann.color ?? '#38bdf8'} textColor={ann.textColor ?? '#ffffff'}
          spec={spec} selected={ann.id === selectedAnnotationId} />
      ) : null)}

      {pendingPoints.length > 0 && pendingType === 'forbidden_route' && (
        <g opacity={0.5}>
          <ForbiddenRoute points={pendingPoints} upm={upm} scale={scale} color={color} spec={spec} />
        </g>
      )}
      {pendingPoints.length > 0 && pendingType === 'crossing_point' && (
        <g opacity={0.5}>
          <CrossingPoint center={pendingPoints[0]} upm={upm} scale={scale}
            rotation={0} elongation={0} color={color} spec={spec} />
        </g>
      )}
      {pendingPoints.length >= 1 && pendingType === 'out_of_bounds' && (() => {
        const pts = cursorPoint ? [...pendingPoints, cursorPoint] : pendingPoints
        return pts.length >= 3 ? (
          <g opacity={0.5}>
            <OutOfBoundsArea points={pts} upm={upm} scale={scale} color={color}
              patternId={`${baseId}-oob-pending`} spec={spec} />
          </g>
        ) : null
      })()}
      {pendingPoints.length > 0 && pendingType === 'north_arrow' && (
        <g opacity={0.5}>
          <NorthArrow center={pendingPoints[0]} upm={upm} scale={scale}
            annScale={1} rotation={0} color="#38bdf8" textColor="#ffffff"
            spec={spec} selected={false} />
        </g>
      )}
    </g>
  )
})
