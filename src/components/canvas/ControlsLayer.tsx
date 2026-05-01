import type { Control } from '../../types'
import { useStore } from '../../store'
import { defaultControlLabel, buildSequenceMap as buildSeqMap, unitsPerMm } from '../../lib/courseUtils'

// ISOM 2017-2 dimensions in mm on paper
const CIRCLE_R_MM  = 2.5   // control circle radius
const SW_MM        = 0.35  // stroke width
const TRIANGLE_MM  = 6.0   // start triangle side
const FINISH_IR_MM = 1.75  // finish inner circle radius

interface ShapeProps {
  control: Control
  color: string
  label: string
  upm: number
}

function StartTriangle({ control, color, label, upm }: ShapeProps) {
  const cr = CIRCLE_R_MM * upm
  const { x, y } = control.position
  const side = TRIANGLE_MM * upm
  const halfSide = side / 2
  const h = side * Math.sqrt(3) / 2
  const topY = y - h * 2 / 3
  const botY = y + h / 3
  const points = `${x},${topY} ${x - halfSide},${botY} ${x + halfSide},${botY}`
  return (
    <g>
      <polygon points={points} fill="none" stroke={color} strokeWidth={SW_MM * upm} />
      <text x={x + halfSide * 1.1} y={y - h * 0.4}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto">
        {label}
      </text>
    </g>
  )
}

function FinishCircles({ control, color, label, upm }: ShapeProps) {
  const cr = CIRCLE_R_MM * upm
  const innerR = FINISH_IR_MM * upm
  const { x, y } = control.position
  return (
    <g>
      <circle cx={x} cy={y} r={innerR} fill="none" stroke={color} strokeWidth={SW_MM * upm} />
      <circle cx={x} cy={y} r={cr}     fill="none" stroke={color} strokeWidth={SW_MM * upm} />
      <text x={x + cr * 1.3} y={y - cr * 1.1}
        fontSize={cr * 1.1} fill={color} fontWeight="bold" fontFamily="sans-serif"
        textAnchor="start" dominantBaseline="auto">
        {label}
      </text>
    </g>
  )
}

function ControlCircle({ control, color, label, upm }: ShapeProps) {
  const cr = CIRCLE_R_MM * upm
  const { x, y } = control.position
  return (
    <g>
      <circle cx={x} cy={y} r={cr} fill="none" stroke={color} strokeWidth={SW_MM * upm} />
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
}

export function ControlsLayer({ controls }: Props) {
  const map = useStore(s => s.project!.map)
  const upm = unitsPerMm(map)
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
            <Shape control={control} color={color} label={label} upm={upm} />
          </g>
        )
      })}
    </g>
  )
}
