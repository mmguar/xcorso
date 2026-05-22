import { memo } from 'react'
import type { Control, Course, CircleGap, AppearanceSettings, MapPoint } from '../../types'
import { useStore } from '../../store'
import { useRenderTracker } from '../../lib/perf'
import { defaultControlLabel, buildSequenceMap as buildSeqMap, formatSequenceLabel, unitsPerMm } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor } from '../../lib/symbolSpec'
import type { SymbolDims } from '../../lib/symbolSpec'

function gapsToDashArray(gaps: CircleGap[], circumference: number): { dashArray: string; dashOffset: number } | null {
  if (gaps.length === 0) return null
  const sorted = [...gaps].sort((a, b) => a.startAngle - b.startAngle)
  const segments: { start: number; end: number }[] = []
  for (const g of sorted) {
    const s = ((g.startAngle % 360) + 360) % 360
    let e = ((g.endAngle % 360) + 360) % 360
    if (e <= s) e += 360
    segments.push({ start: s, end: e })
  }
  // Build dash pattern starting from angle 0
  const dashes: number[] = []
  let pos = 0
  for (const seg of segments) {
    const gapStart = (seg.start / 360) * circumference
    const gapEnd = (seg.end / 360) * circumference
    if (gapStart > pos) {
      dashes.push(gapStart - pos) // visible
      dashes.push(gapEnd - gapStart) // gap
    } else {
      if (dashes.length > 0) {
        dashes[dashes.length - 1] += gapEnd - pos // extend last gap
      } else {
        dashes.push(0) // no visible before first gap
        dashes.push(gapEnd - pos)
      }
    }
    pos = gapEnd
  }
  const remaining = circumference - pos
  if (remaining > 0) dashes.push(remaining)
  // SVG stroke-dasharray starts with "dash" (visible), offset rotates to start at angle 0
  // SVG circles start at 3 o'clock (0°) and go clockwise, which matches our convention
  return { dashArray: dashes.join(' '), dashOffset: 0 }
}

interface ShapeProps {
  control: Control
  color: string
  label: string
  mapScale: number
  upm: number
  appearance: AppearanceSettings
  labelOffset?: MapPoint
  dims: SymbolDims
  scaleFactor: number
  showCrosshair: boolean
}

function Crosshair({ x, y, extent, sw, color }: { x: number; y: number; extent: number; sw: number; color: string }) {
  return (
    <>
      <line x1={x - extent} y1={y} x2={x + extent} y2={y} stroke={color} strokeWidth={sw} />
      <line x1={x} y1={y - extent} x2={x} y2={y + extent} stroke={color} strokeWidth={sw} />
    </>
  )
}

function labelOutlineSvgProps(appearance: AppearanceSettings, upm: number) {
  if (!appearance.outlineEnabled) return {}
  const outlineSw = appearance.outlineWidth * upm
  return {
    stroke: appearance.outlineColor,
    strokeWidth: outlineSw * 2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    paintOrder: 'stroke fill' as const,
  }
}

function StartTriangle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const scale = appearance.controlScale * scaleFactor
  const cr = dims.controlR * upm * scale
  const { x, y } = control.position
  const side = dims.startSide * upm * scale
  const halfSide = side / 2
  const h = side * Math.sqrt(3) / 2
  const topY = y - h * 2 / 3
  const botY = y + h / 3
  const points = `${x},${topY} ${x - halfSide},${botY} ${x + halfSide},${botY}`
  const perimeter = side * 3
  const sw = dims.strokeW * upm * scaleFactor * appearance.lineWidth
  const dash = control.gaps?.length ? gapsToDashArray(control.gaps, perimeter) : null
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const lx = labelOffset ? x + labelOffset.x : x + halfSide * 1.1
  const ly = labelOffset ? y + labelOffset.y : y - h * 0.4
  const chExtent = h * 2 / 3
  return (
    <g>
      {showCrosshair && <Crosshair x={x} y={y} extent={chExtent} sw={sw * 0.5} color={color} />}
      {appearance.outlineEnabled && (
        <polygon points={points} fill="none" stroke={appearance.outlineColor} strokeWidth={sw + outlineSw * 2}
          strokeLinejoin="round"
          {...(dash ? { strokeDasharray: dash.dashArray, strokeDashoffset: dash.dashOffset } : {})}
        />
      )}
      <polygon points={points} fill="none" stroke={color} strokeWidth={sw}
        {...(dash ? { strokeDasharray: dash.dashArray, strokeDashoffset: dash.dashOffset } : {})}
      />
      <text x={lx} y={ly}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto"
        {...labelOutlineSvgProps(appearance, upm)}>
        {label}
      </text>
    </g>
  )
}

function FinishCircles({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const scale = appearance.controlScale
  const cr = dims.finishROuter * upm * scaleFactor * scale
  const innerR = dims.finishRInner * upm * scaleFactor * scale
  const { x, y } = control.position
  const sw = dims.strokeW * upm * scaleFactor * appearance.lineWidth
  const outerCirc = 2 * Math.PI * cr
  const innerCirc = 2 * Math.PI * innerR
  const outerDash = control.gaps?.length ? gapsToDashArray(control.gaps, outerCirc) : null
  const innerDash = control.gaps?.length ? gapsToDashArray(control.gaps, innerCirc) : null
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const lx = labelOffset ? x + labelOffset.x : x + cr * 1.3
  const ly = labelOffset ? y + labelOffset.y : y - cr * 1.1
  return (
    <g>
      {showCrosshair && <Crosshair x={x} y={y} extent={cr} sw={sw * 0.5} color={color} />}
      {appearance.outlineEnabled && (
        <>
          <circle cx={x} cy={y} r={innerR} fill="none" stroke={appearance.outlineColor} strokeWidth={sw + outlineSw * 2}
            {...(innerDash ? { strokeDasharray: innerDash.dashArray, strokeDashoffset: innerDash.dashOffset } : {})}
          />
          <circle cx={x} cy={y} r={cr} fill="none" stroke={appearance.outlineColor} strokeWidth={sw + outlineSw * 2}
            {...(outerDash ? { strokeDasharray: outerDash.dashArray, strokeDashoffset: outerDash.dashOffset } : {})}
          />
        </>
      )}
      <circle cx={x} cy={y} r={innerR} fill="none" stroke={color} strokeWidth={sw}
        {...(innerDash ? { strokeDasharray: innerDash.dashArray, strokeDashoffset: innerDash.dashOffset } : {})}
      />
      <circle cx={x} cy={y} r={cr} fill="none" stroke={color} strokeWidth={sw}
        {...(outerDash ? { strokeDasharray: outerDash.dashArray, strokeDashoffset: outerDash.dashOffset } : {})}
      />
      <text x={lx} y={ly}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto"
        {...labelOutlineSvgProps(appearance, upm)}>
        {label}
      </text>
    </g>
  )
}

function ControlCircle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const cr = dims.controlR * upm * scaleFactor * appearance.controlScale
  const sw = dims.strokeW * scaleFactor * upm * appearance.lineWidth
  const { x, y } = control.position
  const circumference = 2 * Math.PI * cr
  const dash = control.gaps?.length ? gapsToDashArray(control.gaps, circumference) : null
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const lx = labelOffset ? x + labelOffset.x : x + cr * 1.1
  const ly = labelOffset ? y + labelOffset.y : y - cr * 1.1
  return (
    <g>
      {showCrosshair && <Crosshair x={x} y={y} extent={cr} sw={sw * 0.5} color={color} />}
      {appearance.outlineEnabled && (
        <circle
          cx={x} cy={y} r={cr}
          fill="none" stroke={appearance.outlineColor} strokeWidth={sw + outlineSw * 2}
          {...(dash ? { strokeDasharray: dash.dashArray, strokeDashoffset: dash.dashOffset } : {})}
        />
      )}
      <circle
        cx={x} cy={y} r={cr}
        fill="none" stroke={color} strokeWidth={sw}
        {...(dash ? { strokeDasharray: dash.dashArray, strokeDashoffset: dash.dashOffset } : {})}
      />
      <text x={lx} y={ly}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto"
        {...labelOutlineSvgProps(appearance, upm)}>
        {label}
      </text>
    </g>
  )
}

function ExchangeCircle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const cr = dims.controlR * upm * scaleFactor * appearance.controlScale
  const sw = dims.strokeW * scaleFactor * upm * appearance.lineWidth
  const { x, y } = control.position
  const circumference = 2 * Math.PI * cr
  const dash = control.gaps?.length ? gapsToDashArray(control.gaps, circumference) : null
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const lx = labelOffset ? x + labelOffset.x : x + cr * 1.1
  const ly = labelOffset ? y + labelOffset.y : y - cr * 1.1
  // Inscribed equilateral triangle pointing down — vertices at 90°, 210°, 330° (from center, measured CW from 3 o'clock)
  const triPoints = [90, 210, 330].map(deg => {
    const rad = (deg * Math.PI) / 180
    return `${x + cr * Math.cos(rad)},${y + cr * Math.sin(rad)}`
  }).join(' ')
  return (
    <g>
      {showCrosshair && <Crosshair x={x} y={y} extent={cr} sw={sw * 0.5} color={color} />}
      {appearance.outlineEnabled && (
        <>
          <circle cx={x} cy={y} r={cr} fill="none" stroke={appearance.outlineColor} strokeWidth={sw + outlineSw * 2}
            {...(dash ? { strokeDasharray: dash.dashArray, strokeDashoffset: dash.dashOffset } : {})}
          />
          <polygon points={triPoints} fill="none" stroke={appearance.outlineColor} strokeWidth={sw + outlineSw * 2} strokeLinejoin="round" />
        </>
      )}
      <circle cx={x} cy={y} r={cr} fill="none" stroke={color} strokeWidth={sw}
        {...(dash ? { strokeDasharray: dash.dashArray, strokeDashoffset: dash.dashOffset } : {})}
      />
      <polygon points={triPoints} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <text x={lx} y={ly}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto"
        {...labelOutlineSvgProps(appearance, upm)}>
        {label}
      </text>
    </g>
  )
}

interface Props {
  controls: Control[]
  course: Course | null
}

export const ControlsLayer = memo(function ControlsLayer({ controls, course: selectedCourse }: Props) {
  useRenderTracker('ControlsLayer')
  const map = useStore(s => s.project!.map)
  const upm = unitsPerMm(map)
  const selectedId = useStore(s => s.editor.selectedControlId)
  const draggingControlId = useStore(s => s.editor.draggingControlId)
  const appearance = useStore(s => s.editor.appearance)
  const projectSpec = useStore(s => s.project!.spec)

  const spec = resolveSpec(projectSpec, selectedCourse?.spec)
  const dims = getSymbolDims(spec)
  const scaleFactor = specScaleFactor(spec, map.scale)

  const courseControlIds = selectedCourse
    ? new Set(selectedCourse.controls.map(cc => cc.controlId))
    : null

  const sequenceMap = selectedCourse && selectedCourse.type === 'linear'
    ? buildSeqMap(selectedCourse, controls)
    : null

  return (
    <g style={{ pointerEvents: 'none' }}>
      {controls.map(control => {
        const isSelected = control.id === selectedId
        const isInCourse = courseControlIds?.has(control.id) ?? false
        const isCourseMode = courseControlIds !== null

        let color: string
        let opacity = 1
        if (isSelected) {
          color = '#f59e0b'
        } else if (appearance.color) {
          color = appearance.color
        } else if (isCourseMode && isInCourse) {
          color = selectedCourse!.color
        } else if (isCourseMode) {
          color = '#ec4899'
          opacity = 0.7
        } else {
          color = '#7B2FBE'
        }

        let label: string
        if (sequenceMap && (control.type === 'control' || control.type === 'exchange')) {
          const seqs = sequenceMap.get(control.id)
          label = seqs ? formatSequenceLabel(seqs) : defaultControlLabel(control)
        } else {
          label = defaultControlLabel(control)
        }

        if (selectedCourse?.showPoints && control.points != null && isInCourse) {
          label += ` [${control.points}]`
        }

        const cc = selectedCourse?.controls.find(cc => cc.controlId === control.id)
        const labelOffset = cc?.labelOffset

        const Shape = control.type === 'start' ? StartTriangle
          : control.type === 'finish' ? FinishCircles
          : control.type === 'exchange' ? ExchangeCircle
          : ControlCircle

        const showCrosshair = !isCourseMode || control.id === draggingControlId

        return (
          <g key={control.id} opacity={opacity}>
            <Shape control={control} color={color} label={label} mapScale={map.scale} upm={upm} appearance={appearance} labelOffset={labelOffset} dims={dims} scaleFactor={scaleFactor} showCrosshair={showCrosshair} />
          </g>
        )
      })}
    </g>
  )
})
