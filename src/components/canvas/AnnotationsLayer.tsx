/**
 * Renders course overprint symbols per ISOM 2017-2:
 *   711 Out-of-bounds route — thin line with X marks at regular intervals
 *   710 Crossing point — two outward-curving arcs )(
 *   709 Out-of-bounds area — crosshatched diagonal lines with boundary
 */

import { memo, useId } from 'react'
import type { MapPoint, EventSpec } from '../../types'
import { unitsPerMm, IOF_PURPLE } from '../../lib/courseUtils'
import { symbolScaleFactor } from '../../lib/symbolSpec'
import { useRenderTracker } from '../../lib/perf'
import { northArrowGeometry, northArrowHeight } from '../../lib/symbolGeometry'
import {
  renderForbiddenRoute,
  renderCrossingPoint,
  renderOutOfBoundsArea,
  renderOobBoundary,
  renderNorthArrow,
} from '../../lib/courseRenderer'

interface Props {
  annotations: import('../../types').Annotation[]
  pendingPoints: MapPoint[]
  pendingType: 'forbidden_route' | 'crossing_point' | 'out_of_bounds' | 'oob_boundary' | 'north_arrow' | null
  cursorPoint: MapPoint | null
  map: import('../../types').MapConfig
  spec: EventSpec
  selectedAnnotationId: string | null
  render: 'ink' | 'chrome'
}

export const AnnotationsLayer = memo(function AnnotationsLayer({ annotations, pendingPoints, pendingType, cursorPoint, map, spec, selectedAnnotationId, render }: Props) {
  useRenderTracker('AnnotationsLayer')
  const color = IOF_PURPLE
  const baseId = useId()
  const upm = unitsPerMm(map)
  const scale = map.scale

  // ── Ink pass: the purple ISOM symbols (709/710/711) that overprint the map. ──
  if (render === 'ink') {
    return (
      <g style={{ pointerEvents: 'none' }}>
        {annotations.filter(a => a.type !== 'north_arrow').map(ann => {
          let svg = ''
          if (ann.type === 'crossing_point' && ann.points[0]) {
            svg = renderCrossingPoint(ann.points[0], ann.rotation ?? 0, (ann.elongation ?? 0) * upm, scale, spec, color, upm)
          } else if (ann.type === 'forbidden_route') {
            svg = renderForbiddenRoute(ann.points, scale, spec, color, upm)
          } else if (ann.type === 'out_of_bounds') {
            svg = renderOutOfBoundsArea(ann.points, scale, spec, color, `${baseId}-oob-${ann.id}`, upm, ann.boundaryMarking ?? 'none')
          } else if (ann.type === 'oob_boundary') {
            svg = renderOobBoundary(ann.points, scale, spec, color, upm)
          }
          if (!svg) return null
          return <g key={ann.id} dangerouslySetInnerHTML={{ __html: svg }} />
        })}
      </g>
    )
  }

  // ── Chrome pass: north arrows, selection outline, pending previews. ──────────
  const selectedOob = selectedAnnotationId
    ? annotations.find(a => a.id === selectedAnnotationId && a.type === 'out_of_bounds')
    : undefined

  const sf = symbolScaleFactor(spec, scale)

  return (
    <g style={{ pointerEvents: 'none' }}>
      {selectedOob && selectedOob.points.length >= 3 && (
        <path
          d={selectedOob.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'}
          fill="none" stroke={color} strokeWidth={0.3 * upm}
          strokeDasharray={`${1.5 * upm} ${1.5 * upm}`}
        />
      )}

      {annotations.filter(a => a.type === 'north_arrow').map(ann => {
        if (!ann.points[0]) return null
        const center = ann.points[0]
        const annScale = ann.scale ?? 1
        const rotation = ann.rotation ?? 0
        const arrowColor = ann.color ?? '#38bdf8'
        const textColor = ann.textColor ?? '#ffffff'
        const selected = ann.id === selectedAnnotationId

        const arrowSvg = renderNorthArrow(center, rotation, annScale, scale, spec, arrowColor, textColor, upm)

        if (!selected) {
          return <g key={ann.id} dangerouslySetInnerHTML={{ __html: arrowSvg }} />
        }

        // Selected: arrow + handles as JSX
        const h = northArrowHeight(upm, scale, spec, annScale)
        const geo = northArrowGeometry(h, upm, sf)
        const strokeW = 0.2 * upm * sf

        return (
          <g key={ann.id}>
            <g dangerouslySetInnerHTML={{ __html: arrowSvg }} />
            <g transform={`rotate(${rotation}, ${center.x}, ${center.y})`}>
              {/* Rotation handle — bottom center */}
              <circle
                cx={center.x + geo.rotHandleLocalX} cy={center.y + geo.rotHandleLocalY}
                r={geo.handleR}
                fill={arrowColor} stroke="white" strokeWidth={strokeW}
              />
              {/* Resize handle — bottom-right corner */}
              <rect
                x={center.x + geo.halfBase - geo.handleR} y={center.y + geo.baseLocalY - geo.handleR}
                width={geo.handleR * 2} height={geo.handleR * 2}
                rx={strokeW * 2}
                fill={arrowColor} stroke="white" strokeWidth={strokeW}
              />
            </g>
          </g>
        )
      })}

      {pendingPoints.length > 0 && pendingType === 'forbidden_route' && (() => {
        const svg = renderForbiddenRoute(pendingPoints, scale, spec, color, upm)
        return svg ? <g opacity={0.5} dangerouslySetInnerHTML={{ __html: svg }} /> : null
      })()}
      {pendingPoints.length >= 2 && pendingType === 'oob_boundary' && (() => {
        const svg = renderOobBoundary(pendingPoints, scale, spec, color, upm)
        return svg ? <g opacity={0.5} dangerouslySetInnerHTML={{ __html: svg }} /> : null
      })()}
      {pendingPoints.length > 0 && pendingType === 'crossing_point' && (() => {
        const svg = renderCrossingPoint(pendingPoints[0], 0, 0, scale, spec, color, upm)
        return svg ? <g opacity={0.5} dangerouslySetInnerHTML={{ __html: svg }} /> : null
      })()}
      {pendingPoints.length >= 1 && pendingType === 'out_of_bounds' && (() => {
        const pts = cursorPoint ? [...pendingPoints, cursorPoint] : pendingPoints
        if (pts.length < 3) return null
        const svg = renderOutOfBoundsArea(pts, scale, spec, color, `${baseId}-oob-pending`, upm, 'none')
        return svg ? <g opacity={0.5} dangerouslySetInnerHTML={{ __html: svg }} /> : null
      })()}
      {pendingPoints.length > 0 && pendingType === 'north_arrow' && (() => {
        const svg = renderNorthArrow(pendingPoints[0], 0, 1, scale, spec, '#38bdf8', '#ffffff', upm)
        return svg ? <g opacity={0.5} dangerouslySetInnerHTML={{ __html: svg }} /> : null
      })()}
    </g>
  )
})
