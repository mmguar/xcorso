import type { Control } from '../../types'
import { useStore } from '../../store'
import { defaultControlLabel, buildSequenceMap as buildSeqMap } from '../../lib/courseUtils'

const CIRCLE_R_OCAD = 250
const CIRCLE_R_PX   = 12
const SW_OCAD       = 35
const SW_PX         = 1.7

function r(mapType: string) {
  return mapType === 'ocad' ? CIRCLE_R_OCAD : CIRCLE_R_PX
}

function sw(mapType: string) {
  return mapType === 'ocad' ? SW_OCAD : SW_PX
}

interface ShapeProps {
  control: Control
  mapType: string
  color: string
  label: string
}

function StartTriangle({ control, mapType, color, label }: ShapeProps) {
  const cr = r(mapType)
  const { x, y } = control.position
  const side = mapType === 'ocad' ? 600 : cr * 2.4   // 6.0mm equilateral
  const halfSide = side / 2
  const h = side * Math.sqrt(3) / 2
  const topY = y - h * 2 / 3
  const botY = y + h / 3
  const points = `${x},${topY} ${x - halfSide},${botY} ${x + halfSide},${botY}`
  return (
    <g>
      <polygon points={points} fill="none" stroke={color} strokeWidth={sw(mapType)} />
      <text x={x + halfSide * 1.1} y={y - h * 0.4}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto">
        {label}
      </text>
    </g>
  )
}

function FinishCircles({ control, mapType, color, label }: ShapeProps) {
  const cr = r(mapType)
  const { x, y } = control.position
  const innerR = mapType === 'ocad' ? 175 : cr * 0.7   // 1.75mm
  return (
    <g>
      <circle cx={x} cy={y} r={innerR} fill="none" stroke={color} strokeWidth={sw(mapType)} />
      <circle cx={x} cy={y} r={cr}     fill="none" stroke={color} strokeWidth={sw(mapType)} />
      <text x={x + cr * 1.3} y={y - cr * 1.1}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto">
        {label}
      </text>
    </g>
  )
}

function ControlCircle({ control, mapType, color, label }: ShapeProps) {
  const cr = r(mapType)
  const { x, y } = control.position
  return (
    <g>
      <circle cx={x} cy={y} r={cr} fill="none" stroke={color} strokeWidth={sw(mapType)} />
      <text x={x + cr * 1.1} y={y - cr * 1.1}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto">
        {label}
      </text>
    </g>
  )
}


interface Props {
  controls: Control[]
  scale: number
  mapType: 'ocad' | 'pdf' | 'bitmap'
}

export function ControlsLayer({ controls, mapType }: Props) {
  const selectedId = useStore(s => s.editor.selectedControlId)
  const selectedCourse = useStore(s => {
    const cid = s.editor.selectedCourseId
    return cid ? s.project?.courses.find(c => c.id === cid) ?? null : null
  })

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
        } else if (isCourseMode && isInCourse) {
          color = selectedCourse!.color
        } else if (isCourseMode) {
          color = '#ec4899'
          opacity = 0.7
        } else {
          color = '#7B2FBE'
        }

        let label: string
        if (sequenceMap && control.type === 'control') {
          label = String(sequenceMap.get(control.id) ?? defaultControlLabel(control))
        } else {
          label = defaultControlLabel(control)
        }

        if (selectedCourse?.showPoints && control.points != null && isInCourse) {
          label += ` [${control.points}]`
        }

        const Shape = control.type === 'start' ? StartTriangle
          : control.type === 'finish' ? FinishCircles
          : ControlCircle

        return (
          <g key={control.id} opacity={opacity}>
            <Shape control={control} mapType={mapType} color={color} label={label} />
          </g>
        )
      })}
    </g>
  )
}
