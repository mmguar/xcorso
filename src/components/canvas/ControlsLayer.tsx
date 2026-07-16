import { memo, useMemo } from 'react'
import type { Control, Course, CourseControl, CircleGap, AppearanceSettings, MapPoint } from '../../types'
import { useStore } from '../../store'
import { useRenderTracker } from '../../lib/perf'
import { defaultControlLabel, buildSequenceMap as buildSeqMap, formatSequenceLabel, unitsPerMm, computeSubmaps, IOF_PURPLE } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor, symbolLabelOffset } from '../../lib/symbolSpec'
import { startTriangleVertices, exchangeTriangleVertices, startTriangleAngle, exchangeTriangleAngle } from '../../lib/symbolGeometry'
import type { SymbolDims } from '../../lib/symbolSpec'
import { circleGapDashArray } from '../../lib/gapDash'
import { assignControlColors, MULTICOLOR_PALETTE } from '../../lib/pdfExport'

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
  rotation?: number
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

// ISOM 704: control number in Arial 4.0 mm (dims.labelH), non-bold.
function ControlLabel({ x, y, fontSize, color, label, appearance, upm }: {
  x: number; y: number; fontSize: number; color: string; label: string; appearance: AppearanceSettings; upm: number
}) {
  if (!label) return null
  return (
    <text x={x} y={y}
      fontSize={fontSize} fill={color} fontFamily="Arial, sans-serif"
      textAnchor="start" dominantBaseline="auto"
      {...labelOutlineSvgProps(appearance, upm)}>
      {label}
    </text>
  )
}

function StartTriangle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair, rotation = 0 }: ShapeProps) {
  const scale = appearance.controlScale * scaleFactor
  const labelFs = dims.labelH * upm * scale
  const { x, y } = control.position
  const side = dims.startSide * upm * scale
  const h = side * Math.sqrt(3) / 2
  const points = startTriangleVertices({ x, y }, side, rotation).map(p => `${p.x},${p.y}`).join(' ')
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
      <ControlLabel x={lx} y={ly} fontSize={labelFs} color={color} label={label} appearance={appearance} upm={upm} />
    </g>
  )
}

function FinishCircles({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const scale = appearance.controlScale
  const cr = dims.finishROuter * upm * scaleFactor * scale
  const innerR = dims.finishRInner * upm * scaleFactor * scale
  const labelFs = dims.labelH * upm * scaleFactor * scale
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
      <ControlLabel x={lx} y={ly} fontSize={labelFs} color={color} label={label} appearance={appearance} upm={upm} />
    </g>
  )
}

function ControlCircle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair }: ShapeProps) {
  const cr = dims.controlR * upm * scaleFactor * appearance.controlScale
  const labelFs = dims.labelH * upm * scaleFactor * appearance.controlScale
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
      <ControlLabel x={lx} y={ly} fontSize={labelFs} color={color} label={label} appearance={appearance} upm={upm} />
    </g>
  )
}

function ExchangeCircle({ control, color, label, upm, appearance, labelOffset, dims, scaleFactor, showCrosshair, rotation = 0 }: ShapeProps) {
  // ISOM 715: circle ø 6.0 (= finish outer), apex toward the following control.
  const cr = dims.finishROuter * upm * scaleFactor * appearance.controlScale
  const labelFs = dims.labelH * upm * scaleFactor * appearance.controlScale
  const sw = dims.strokeW * scaleFactor * upm * appearance.lineWidth
  const { x, y } = control.position
  const circumference = 2 * Math.PI * cr
  const dash = control.gaps?.length ? gapsToDashArray(control.gaps, circumference) : null
  const outlineSw = appearance.outlineEnabled ? appearance.outlineWidth * upm : 0
  const off = labelOffset ?? symbolLabelOffset(control.type, dims, upm * appearance.controlScale * scaleFactor)
  const lx = x + off.x
  const ly = y + off.y
  const triPoints = exchangeTriangleVertices({ x, y }, cr, rotation).map(p => `${p.x},${p.y}`).join(' ')
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
      <ControlLabel x={lx} y={ly} fontSize={labelFs} color={color} label={label} appearance={appearance} upm={upm} />
    </g>
  )
}

interface Props {
  controls: Control[]
  course: Course | null
  _rev?: number
}

export const ControlsLayer = memo(function ControlsLayer({ controls, course: selectedCourse, _rev: _rev }: Props) {
  void _rev
  useRenderTracker('ControlsLayer')
  const map = useStore(s => s.project!.map)
  const upm = unitsPerMm(map)
  const selectedId = useStore(s => s.editor.selectedControlId)
  const draggingControlId = useStore(s => s.editor.draggingControlId)
  const draggingLabelControlId = useStore(s => s.editor.draggingLabelControlId)
  const appearance = useStore(s => s.editor.appearance)
  const projectSpec = useStore(s => s.project!.spec)
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const labelSubmapStart = useStore(s => s.project!.labelSubmapStart ?? false)
  const allCourses = useStore(s => s.project!.courses)
  const courseViewMode = useStore(s => s.editor.courseViewMode)
  const multicolor = useStore(s => s.project!.allControlsMulticolor) && courseViewMode === 'all-controls'
  const linkId = useStore(s => s.project!.allControlsLinkId) && courseViewMode === 'all-controls'

  const spec = resolveSpec(projectSpec, selectedCourse?.spec)
  const dims = getSymbolDims(spec)
  const scaleFactor = specScaleFactor(spec, map.scale)

  const courseControlIds = selectedCourse
    ? new Set(selectedCourse.controls.map(cc => cc.controlId))
    : null

  // First CourseControl per control id (mirrors .find semantics for controls
  // that repeat in loop courses) — avoids an O(courseControls) scan per control.
  const ccByControlId = useMemo(() => {
    if (!selectedCourse) return null
    const m = new Map<string, CourseControl>()
    for (const cc of selectedCourse.controls) {
      if (!m.has(cc.controlId)) m.set(cc.controlId, cc)
    }
    return m
  }, [selectedCourse])

  const sequenceMap = selectedCourse && selectedCourse.type === 'linear'
    ? buildSeqMap(selectedCourse, controls)
    : null

  const submapInfo = useMemo(() => {
    if (!selectedCourse || selectedSubmapIndex == null) return null
    const submaps = computeSubmaps(selectedCourse)
    if (selectedSubmapIndex >= submaps.length) return null
    const submap = submaps[selectedSubmapIndex]
    const controlIds = new Set(submap.controls.map(cc => cc.controlId))
    const firstCcId = submap.controls[0]?.controlId
    const lastCcId = submap.controls[submap.controls.length - 1]?.controlId
    return { controlIds, firstCcId, lastCcId }
  }, [selectedCourse, selectedSubmapIndex])

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

  const colorMap = useMemo(() => {
    if (selectedCourse || !multicolor) return null
    return assignControlColors(controls)
  }, [selectedCourse, multicolor, controls])

  // Start triangles and exchange triangles (ISOM 715) both point toward the
  // following control. First occurrence wins, matching the PDF export.
  const symbolAngles = useMemo(() => {
    if (!selectedCourse || selectedCourse.controls.length < 2) return null
    const m = new Map<string, number>()
    const ccs = selectedCourse.controls
    const ctrlMap = new Map(controls.map(c => [c.id, c]))
    for (let i = 0; i < ccs.length - 1; i++) {
      const ctrl = ctrlMap.get(ccs[i].controlId)
      if (!ctrl || m.has(ctrl.id)) continue
      const isStart = ctrl.type === 'start'
      if (!isStart && !ccs[i].exchangeMode) continue
      const next = ctrlMap.get(ccs[i + 1].controlId)
      if (next) {
        m.set(ctrl.id, isStart
          ? startTriangleAngle(ctrl.position, next.position)
          : exchangeTriangleAngle(ctrl.position, next.position))
      }
    }
    return m
  }, [selectedCourse, controls])

  return (
    <g style={{ pointerEvents: 'none' }}>
      {controls.map(control => {
        const isSelected = control.id === selectedId
        const isInCourse = courseControlIds?.has(control.id) ?? false
        const isCourseMode = courseControlIds !== null
        const isInSubmap = submapInfo ? submapInfo.controlIds.has(control.id) : true
        const isActiveInCourse = isInCourse && isInSubmap

        // When viewing a submap, course controls belonging to other submap
        // segments are not drawn as faint background — only controls outside the
        // course remain as context.
        if (submapInfo && isInCourse && !isInSubmap) return null

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
        } else if (colorMap) {
          color = MULTICOLOR_PALETTE[colorMap.get(control.id) ?? 0]
        } else {
          color = IOF_PURPLE
        }

        let label: string
        if (sequenceMap && control.type === 'control') {
          const seqs = sequenceMap.get(control.id)
          label = seqs ? formatSequenceLabel(seqs) : defaultControlLabel(control)
        } else {
          label = defaultControlLabel(control)
        }

        const cc = ccByControlId?.get(control.id)

        if (submapInfo && cc?.exchangeMode && control.id === submapInfo.firstCcId && !labelSubmapStart) {
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

        const showLinkLine = (linkId && !isCourseMode) || control.id === draggingLabelControlId
        const leaderLine = showLinkLine ? (() => {
          const off = labelOffset ?? symbolLabelOffset(control.type, dims, upm * appearance.controlScale * scaleFactor)
          return (
            <line
              x1={control.position.x} y1={control.position.y}
              x2={control.position.x + off.x} y2={control.position.y + off.y}
              stroke={color}
              strokeWidth={dims.strokeW * upm * scaleFactor * 0.4}
              opacity={control.id === draggingLabelControlId ? 0.7 : 1}
            />
          )
        })() : null

        return (
          <g key={control.id} data-control-id={control.id} opacity={opacity}>
            {leaderLine}
            <Shape control={control} color={color} label={label} mapScale={map.scale} upm={upm} appearance={appearance} labelOffset={labelOffset} dims={dims} scaleFactor={scaleFactor} showCrosshair={showCrosshair} rotation={symbolAngles?.get(control.id)} />
          </g>
        )
      })}
    </g>
  )
})
