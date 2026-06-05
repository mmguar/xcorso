import { memo, useMemo } from 'react'
import type { Control, Course, CircleGap, AppearanceSettings, MapPoint } from '../../types'
import { useStore } from '../../store'
import { useRenderTracker } from '../../lib/perf'
import { defaultControlLabel, buildSequenceMap as buildSeqMap, formatSequenceLabel, unitsPerMm, computeSubmaps } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor, symbolLabelOffset } from '../../lib/symbolSpec'
import { startTriangleVertices, exchangeTriangleVertices } from '../../lib/symbolGeometry'
import type { SymbolDims } from '../../lib/symbolSpec'
import { circleGapDashArray } from '../../lib/gapDash'

function gapsToDashArray(gaps: CircleGap[], circumference: number): { dashArray: string; dashOffset: number } | null {
  const dashes = circleGapDashArray(gaps, circumference)
  return dashes ? { dashArray: dashes.join(' '), dashOffset: 0 } : null
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

function ControlLabel({ x, y, cr, color, label, appearance, upm }: {
  x: number; y: number; cr: number; color: string; label: string; appearance: AppearanceSettings; upm: number
}) {
  if (!label) return null
  return (
    <text x={x} y={y}
      fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
      textAnchor="start" dominantBaseline="auto"
      {...labelOutlineSvgProps(appearance, upm)}>
      {label}
    </text>
  )
}

function StartTriangle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const scale = appearance.controlScale * scaleFactor
  const cr = dims.controlR * upm * scale
  const { x, y } = control.position
  const side = dims.startSide * upm * scale
  const h = side * Math.sqrt(3) / 2
  const points = startTriangleVertices({ x, y }, side).map(p => `${p.x},${p.y}`).join(' ')
  const perimeter = side * 3
  const sw = dims.strokeW * upm * scaleFactor * appearance.lineWidth
  const dash = control.gaps?.length ? gapsToDashArray(control.gaps, perimeter) : null
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const off = labelOffset ?? symbolLabelOffset(control.type, dims, upm * appearance.controlScale * scaleFactor)
  const lx = x + off.x
  const ly = y + off.y
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
      <ControlLabel x={lx} y={ly} cr={cr} color={color} label={label} appearance={appearance} upm={upm} />
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
  const off = labelOffset ?? symbolLabelOffset(control.type, dims, upm * appearance.controlScale * scaleFactor)
  const lx = x + off.x
  const ly = y + off.y
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
      <ControlLabel x={lx} y={ly} cr={cr} color={color} label={label} appearance={appearance} upm={upm} />
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
  const off = labelOffset ?? symbolLabelOffset(control.type, dims, upm * appearance.controlScale * scaleFactor)
  const lx = x + off.x
  const ly = y + off.y
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
      <ControlLabel x={lx} y={ly} cr={cr} color={color} label={label} appearance={appearance} upm={upm} />
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
  const off = labelOffset ?? symbolLabelOffset(control.type, dims, upm * appearance.controlScale * scaleFactor)
  const lx = x + off.x
  const ly = y + off.y
  // Inscribed equilateral triangle pointing down — vertices at 90°, 210°, 330°
  const triPoints = exchangeTriangleVertices({ x, y }, cr).map(p => `${p.x},${p.y}`).join(' ')
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
      <ControlLabel x={lx} y={ly} cr={cr} color={color} label={label} appearance={appearance} upm={upm} />
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
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const allCourses = useStore(s => s.project!.courses)

  const spec = resolveSpec(projectSpec, selectedCourse?.spec)
  const dims = getSymbolDims(spec)
  const scaleFactor = specScaleFactor(spec, map.scale)

  const courseControlIds = selectedCourse
    ? new Set(selectedCourse.controls.map(cc => cc.controlId))
    : null

  const sequenceMap = selectedCourse && selectedCourse.type === 'linear'
    ? buildSeqMap(selectedCourse, controls)
    : null

  const submapInfo = useMemo(() => {
    if (!selectedCourse || selectedSubmapIndex == null) return null
    const submaps = computeSubmaps(selectedCourse, controls)
    if (selectedSubmapIndex >= submaps.length) return null
    const submap = submaps[selectedSubmapIndex]
    const controlIds = new Set(submap.controls.map(cc => cc.controlId))
    const firstCcId = submap.controls[0]?.controlId
    const lastCcId = submap.controls[submap.controls.length - 1]?.controlId
    return { controlIds, firstCcId, lastCcId }
  }, [selectedCourse, selectedSubmapIndex, controls])

  const globalExchangeIds = useMemo(() => {
    if (selectedCourse) return null
    const ids = new Set<string>()
    for (const course of allCourses) {
      for (const cc of course.controls) {
        if (cc.exchangeMode) ids.add(cc.controlId)
      }
    }
    return ids
  }, [selectedCourse, allCourses])

  return (
    <g style={{ pointerEvents: 'none' }}>
      {controls.map(control => {
        const isSelected = control.id === selectedId
        const isInCourse = courseControlIds?.has(control.id) ?? false
        const isCourseMode = courseControlIds !== null
        const isInSubmap = submapInfo ? submapInfo.controlIds.has(control.id) : true
        const isActiveInCourse = isInCourse && isInSubmap

        let color: string
        let opacity = 1
        if (isSelected) {
          color = '#f59e0b'
        } else if (appearance.color && isActiveInCourse) {
          color = appearance.color
        } else if (isCourseMode && isActiveInCourse) {
          color = selectedCourse!.color
        } else if (isCourseMode) {
          color = '#ec4899'
          opacity = 0.7
        } else {
          color = '#a626ff'
        }

        let label: string
        if (sequenceMap && control.type === 'control') {
          const seqs = sequenceMap.get(control.id)
          label = seqs ? formatSequenceLabel(seqs) : defaultControlLabel(control)
        } else {
          label = defaultControlLabel(control)
        }

        const cc = selectedCourse?.controls.find(cc => cc.controlId === control.id)

        if (submapInfo && cc?.exchangeMode && control.id === submapInfo.firstCcId) {
          label = ''
        }

        if (isCourseMode && (control.type === 'start' || control.type === 'finish')) {
          label = ''
        }

        if (selectedCourse?.showPoints && control.points != null && isInCourse) {
          label += ` [${control.points}]`
        }

        const labelOffset = cc?.labelOffset ?? control.labelOffset

        let Shape: (props: ShapeProps) => React.ReactNode
        if (control.type === 'start') {
          Shape = StartTriangle
        } else if (control.type === 'finish') {
          Shape = FinishCircles
        } else if (selectedCourse) {
          const isExchange = !!cc?.exchangeMode
          if (isExchange && submapInfo && control.id === submapInfo.lastCcId) {
            Shape = ControlCircle
          } else if (isExchange) {
            Shape = ExchangeCircle
          } else {
            Shape = ControlCircle
          }
        } else {
          Shape = globalExchangeIds?.has(control.id) ? ExchangeCircle : ControlCircle
        }

        const showCrosshair = !isCourseMode || control.id === draggingControlId

        return (
          <g key={control.id} data-control-id={control.id} opacity={opacity}>
            <Shape control={control} color={color} label={label} mapScale={map.scale} upm={upm} appearance={appearance} labelOffset={labelOffset} dims={dims} scaleFactor={scaleFactor} showCrosshair={showCrosshair} />
          </g>
        )
      })}
    </g>
  )
})
