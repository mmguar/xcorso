import { memo, useState, type ReactNode } from 'react'
import { GripVertical, X } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'
import { IofSymbolIcon, SymbolSvg } from './IofSymbolIcon'
import { columns, getColumnSymbols, columnFields, isDimensionText, getSymbol } from '../lib/iofSymbols'
import { defaultControlLabel, computeSubmaps, controlsById } from '../lib/courseUtils'
import { computeCourseDistances, formatDistance } from '../lib/distance'
import { useRenderTracker } from '../lib/perf'
import type { IofColumn, SymbolDef } from '../lib/iofSymbols'
import type { Course, Control, CourseControl, FinishType } from '../types'

const CELL = 32
const BORDER = 'border border-gray-300'


interface GridProps {
  course: Course
  onRemove?: (courseControlId: string) => void
  onReorder?: (reordered: CourseControl[]) => void
}

interface RowData {
  cc: CourseControl
  ctrl: Control
  seq: number
  legDist?: number
  forkEligible?: boolean
  isLoop?: boolean
}

export const ControlDescriptionGrid = memo(function ControlDescriptionGrid({ course, onRemove, onReorder }: GridProps) {
  useRenderTracker('ControlDescriptionGrid')
  const controls = useStore(s => s.project!.controls)
  const projectName = useStore(s => s.project!.meta.name)
  const mapConfig = useStore(s => s.project!.map)
  const updateControlDescription = useStore(s => s.updateControlDescription)
  const toggleCourseLoop = useStore(s => s.toggleCourseLoop)
  const setExchangeMode = useStore(s => s.setExchangeMode)
  const toggleExchangeControl = useStore(s => s.toggleExchangeControl)
  const setSelectedSubmap = useStore(s => s.setSelectedSubmap)
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const controlMap = controlsById(controls)
  const submaps = computeSubmaps(course)
  const hasSubmaps = submaps.length > 1

  // Map exchange courseControl IDs to the submap they END (the next submap starts with same exchange)
  const exchangeCcSubmapEnd = new Map<string, number>()
  if (hasSubmaps) {
    for (let si = 0; si < submaps.length - 1; si++) {
      const lastCc = submaps[si].controls[submaps[si].controls.length - 1]
      exchangeCcSubmapEnd.set(lastCc.id, si)
    }
  }

  const distances = computeCourseDistances(course, controls, mapConfig)
  const [picker, setPicker] = useState<{ controlId: string; column: IofColumn } | null>(null)

  const showExtraCol = true

  // Count occurrences of each controlId to detect fork-eligible controls
  const controlIdCounts = new Map<string, number>()
  for (const cc of course.controls) {
    controlIdCounts.set(cc.controlId, (controlIdCounts.get(cc.controlId) ?? 0) + 1)
  }

  const loopForkIds = new Set((course.loops ?? []).map(l => l.forkControlId))

  let seq = 0
  let filteredIdx = 0
  const seenControlIds = new Set<string>()
  const rows: RowData[] = []
  let finishRow: RowData | null = null
  for (const cc of course.controls) {
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
    if (ctrl.type === 'finish') {
      finishRow = {
        cc,
        ctrl,
        seq: 0,
        legDist: filteredIdx > 0 ? distances.legs[filteredIdx - 1] : undefined,
      }
      filteredIdx++
      continue
    }
    if (ctrl.type === 'control') seq++
    const isFirstOccurrence = !seenControlIds.has(cc.controlId)
    seenControlIds.add(cc.controlId)
    rows.push({
      cc,
      ctrl,
      seq: ctrl.type === 'control' ? seq : 0,
      legDist: filteredIdx > 0 ? distances.legs[filteredIdx - 1] : undefined,
      forkEligible: isFirstOccurrence && ctrl.type === 'control' && (controlIdCounts.get(cc.controlId) ?? 0) >= 3,
      isLoop: loopForkIds.has(cc.controlId),
    })
    filteredIdx++
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    if (!onReorder) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = course.controls.findIndex(cc => cc.id === active.id)
    const newIdx = course.controls.findIndex(cc => cc.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = [...course.controls]
    const [item] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, item)
    onReorder(reordered)
  }

  return (
    <div className="overflow-x-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={course.controls.map(cc => cc.id)} strategy={verticalListSortingStrategy}>
          <table className="border-collapse" style={{ fontSize: 11 }}>
            <tbody>
              <tr>
                <td colSpan={8} className={`${BORDER} text-center font-bold py-1 bg-gray-50`}>
                  {projectName}
                </td>
                {showExtraCol && <td />}
              </tr>
              <tr>
                <td colSpan={3} className={`${BORDER} text-center font-bold py-1 bg-gray-50`}>
                  {course.name}
                </td>
                <td colSpan={2} className={`${BORDER} text-center py-1 bg-gray-50 text-gray-500`}>
                  {distances.total > 0 ? formatDistance(distances.total) : ''}
                </td>
                <td colSpan={3} className={`${BORDER} text-center py-1 bg-gray-50 text-gray-500`}>
                  {course.climb != null && course.climb > 0 ? `${course.climb} m↑` : ''}
                </td>
                {showExtraCol && (
                  <td className="pl-1.5 align-middle whitespace-nowrap">
                    {hasSubmaps && (
                      <button
                        onClick={() => setSelectedSubmap(null)}
                        className={`text-[10px] font-medium px-1 py-0.5 rounded transition-colors ${
                          selectedSubmapIndex === null
                            ? 'bg-orange-500 text-white'
                            : 'text-orange-600 hover:bg-orange-50'
                        }`}
                      >
                        All
                      </button>
                    )}
                  </td>
                )}
              </tr>

              {rows.length === 0 && !finishRow ? (
                <tr>
                  <td colSpan={8} className="text-center text-xs text-gray-400 py-3">
                    Click controls on the map to add them.
                  </td>
                  {showExtraCol && <td />}
                </tr>
              ) : (
                <>
                {rows.map((row, i) => {
                  const submapEndIdx = exchangeCcSubmapEnd.get(row.cc.id)
                  const startButton = i === 0 && hasSubmaps ? {
                    label: submaps[0].label,
                    index: 0,
                    onSelect: setSelectedSubmap,
                    selected: selectedSubmapIndex,
                  } : undefined
                  return (
                    <SortableDescRow
                      key={row.cc.id}
                      row={row}
                      courseId={course.id}
                      showExtraCol={showExtraCol}
                      picker={picker}
                      setPicker={setPicker}
                      onRemove={onRemove}
                      onToggleLoop={toggleCourseLoop}
                      onToggleExchange={(ccId) => toggleExchangeControl(course.id, ccId)}
                      textDescriptions={course.textDescriptions}
                      submapButton={startButton}
                      exchangeSeparator={submapEndIdx != null ? {
                        submapEndIdx,
                        nextSubmapLabel: submaps[submapEndIdx + 1]?.label ?? '',
                        exchangeMode: row.cc.exchangeMode ?? 'exchange',
                        onModeChange: (mode) => setExchangeMode(course.id, row.cc.id, mode),
                        onSelectSubmap: setSelectedSubmap,
                        selectedSubmapIndex,
                      } : undefined}
                    />
                  )
                })}
                {finishRow && (
                    <FinishDescRow
                      row={finishRow}
                      finishType={course.finishType ?? 'navigate'}
                      showExtraCol={showExtraCol}
                      onRemove={onRemove}
                    />
                  )}
                </>

              )}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>

      {picker && (
        <SymbolPicker
          column={picker.column}
          current={(controlMap.get(picker.controlId)?.description as any)?.[columnFields[picker.column]]}
          onSelect={(code) => {
            updateControlDescription(picker.controlId, columnFields[picker.column], code)
            setPicker(null)
          }}
          onClear={() => {
            updateControlDescription(picker.controlId, columnFields[picker.column], undefined)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
})

interface SubmapButtonProps {
  label: string
  index: number
  onSelect: (index: number | null) => void
  selected: number | null
}

interface ExchangeSeparatorProps {
  submapEndIdx: number
  nextSubmapLabel: string
  exchangeMode: 'exchange' | 'flip'
  onModeChange: (mode: 'exchange' | 'flip') => void
  onSelectSubmap: (index: number | null) => void
  selectedSubmapIndex: number | null
}

function SortableDescRow({
  row,
  courseId,
  showExtraCol,
  picker,
  setPicker,
  onRemove,
  onToggleLoop,
  onToggleExchange,
  textDescriptions,
  submapButton,
  exchangeSeparator,
}: {
  row: RowData
  courseId: string
  showExtraCol: boolean
  picker: { controlId: string; column: IofColumn } | null
  setPicker: (p: { controlId: string; column: IofColumn } | null) => void
  onRemove?: (ccId: string) => void
  onToggleLoop?: (courseId: string, controlId: string) => void
  onToggleExchange?: (ccId: string) => void
  textDescriptions?: boolean
  submapButton?: SubmapButtonProps
  exchangeSeparator?: ExchangeSeparatorProps
}) {
  const { cc, ctrl, seq, legDist, forkEligible, isLoop } = row
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cc.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const seqLabel = ctrl.type === 'start' ? '△'
    : ctrl.type === 'finish' ? '◎'
    : String(seq)
  const desc = ctrl.description ?? {}

  const colCount = 2 + columns.length + (showExtraCol ? 1 : 0)

  return (
    <>
      <tr ref={setNodeRef} style={style} className="group">
        <td
          className={`${BORDER} text-center font-bold relative cursor-grab active:cursor-grabbing`}
          style={{ width: CELL, height: CELL }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} strokeWidth={2.5} className="absolute -left-1 top-1/2 -translate-y-1/2 text-gray-300 group-hover:text-gray-400" />
          {seqLabel}
          {onRemove && (
            <button
              onClick={() => onRemove(cc.id)}
              onPointerDown={e => e.stopPropagation()}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-gray-300 hover:bg-red-400 text-white flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity z-10"
            >
              <X size={8} />
            </button>
          )}
        </td>
        <td className={`${BORDER} text-center font-mono`} style={{ height: CELL }}>
          {defaultControlLabel(ctrl)}
        </td>
        {columns.map(col => {
          const field = columnFields[col.id]
          const value = desc[field]
          const isActive = picker?.controlId === ctrl.id && picker?.column === col.id
          const isDimText = col.id === 'F' && value && isDimensionText(value)
          const sym = value ? getSymbol(value) : undefined

          return (
            <td
              key={col.id}
              className={`${BORDER} text-center cursor-pointer hover:bg-orange-50 ${isActive ? 'bg-orange-100' : ''}`}
              style={{ width: CELL, height: CELL, padding: 0 }}
              onClick={() => setPicker(isActive ? null : { controlId: ctrl.id, column: col.id })}
            >
              {value && (textDescriptions && sym
                ? <span className="text-[8px] leading-tight px-0.5">{sym.name}</span>
                : isDimText
                  ? <span className="text-[9px] font-bold leading-none">{value}</span>
                  : <IofSymbolIcon code={value} size={CELL - 4} />
              )}
            </td>
          )
        })}
        {showExtraCol && (
          <td className="text-[10px] text-gray-400 pl-1.5 whitespace-nowrap relative">
            {submapButton ? (
              <button
                onClick={() => submapButton.onSelect(submapButton.index)}
                className={`text-[10px] font-medium px-1 py-0.5 rounded transition-colors ${
                  submapButton.selected === submapButton.index
                    ? 'bg-orange-500 text-white'
                    : 'text-orange-600 hover:bg-orange-50'
                }`}
              >
                {submapButton.label}
              </button>
            ) : legDist != null ? formatDistance(legDist) : ''}
            {ctrl.type === 'control' && onToggleExchange && (
              <button
                onClick={() => onToggleExchange(cc.id)}
                title={cc.exchangeMode ? 'Remove exchange' : 'Set as exchange'}
                className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-opacity z-10 ${
                  cc.exchangeMode
                    ? 'bg-orange-500 text-white opacity-100'
                    : 'bg-gray-300 hover:bg-orange-400 text-white opacity-60 group-hover:opacity-100'
                }`}
              >
                <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="7,3 17,12 7,21" />
                  <polyline points="17,3 7,12 17,21" />
                </svg>
              </button>
            )}
          </td>
        )}
      </tr>
      {forkEligible && (
        <tr>
          <td colSpan={colCount} className="py-0.5 px-1">
            <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isLoop ?? false}
                onChange={() => onToggleLoop?.(courseId, ctrl.id)}
                className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
              />
              Butterfly loop
            </label>
          </td>
        </tr>
      )}
      {exchangeSeparator && (
        <>
          <ExchangeRow
            exchangeMode={exchangeSeparator.exchangeMode}
            onModeChange={exchangeSeparator.onModeChange}
            showExtraCol={showExtraCol}
          />
          <RestartRow
            ctrl={ctrl}
            submapLabel={exchangeSeparator.nextSubmapLabel}
            submapIndex={exchangeSeparator.submapEndIdx + 1}
            onSelectSubmap={exchangeSeparator.onSelectSubmap}
            selectedSubmapIndex={exchangeSeparator.selectedSubmapIndex}
            showExtraCol={showExtraCol}
          />
        </>
      )}
    </>
  )
}

function ExchangeRow({
  exchangeMode,
  onModeChange,
  showExtraCol,
}: {
  exchangeMode: 'exchange' | 'flip'
  onModeChange: (mode: 'exchange' | 'flip') => void
  showExtraCol: boolean
}) {
  return (
    <tr>
      <td colSpan={8} className={`${BORDER} relative`} style={{ height: CELL, padding: 0 }}>
        <div className="flex items-center justify-center h-full gap-2 ml-3">
          {exchangeMode === 'flip' ? (
            <svg width="56" height="22" viewBox="-82 -18 238 70" className="inline-block shrink-0">
              <path
                d="M -80.360565,49.756998 V -17.208278 H 54.554767 v 66.965274 z"
                fill="none"
                stroke="black"
                strokeWidth={3.22857}
              />
              <path
                d="m 49.30259,11.022181 v 6.893485 L 8.2699446,2.8156518 49.959111,-14.91045 v 8.5347896 c 15.43476,-2.485079 33.252421,1.8872434 43.986994,20.3521914 5.028306,12.413486 -4.5942,21.038774 -16.325094,26.752301 -8.097252,3.943763 -16.901703,8.282472 -23.066244,9.028164 C 64.528975,43.023482 82.356897,37.724495 77.533048,24.480888 73.266429,16.666484 68.17025,9.3888529 49.30259,11.022181 Z"
                fill="black"
                stroke="black"
                strokeWidth={0}
              />
            </svg>
          ) : (
            <span className="text-[10px] font-bold tracking-wider text-gray-600">EXCHANGE</span>
          )}
          <select
            value={exchangeMode}
            onChange={e => onModeChange(e.target.value as 'exchange' | 'flip')}
            className="text-[10px] border border-gray-300 rounded px-1 py-0.5 bg-white"
          >
            <option value="exchange">Exchange</option>
            <option value="flip">Flip</option>
          </select>
        </div>
      </td>
      {showExtraCol && <td />}
    </tr>
  )
}

function RestartRow({
  ctrl,
  submapLabel,
  submapIndex,
  onSelectSubmap,
  selectedSubmapIndex,
  showExtraCol,
}: {
  ctrl: Control
  submapLabel: string
  submapIndex: number
  onSelectSubmap: (index: number | null) => void
  selectedSubmapIndex: number | null
  showExtraCol: boolean
}) {
  return (
    <tr>
      <td className={`${BORDER} text-center font-bold`} style={{ width: CELL, height: CELL }}>
        △
      </td>
      <td className={`${BORDER} text-center font-mono`} style={{ height: CELL }} />
      {columns.map(col => {
        const field = columnFields[col.id]
        const value = ctrl.description?.[field]
        return (
          <td key={col.id} className={`${BORDER} text-center`} style={{ width: CELL, height: CELL, padding: 0 }}>
            {value && (
              col.id === 'F' && isDimensionText(value)
                ? <span className="text-[9px] font-bold leading-none">{value}</span>
                : <IofSymbolIcon code={value} size={CELL - 4} />
            )}
          </td>
        )
      })}
      {showExtraCol && (
        <td className="pl-1.5 whitespace-nowrap">
          <button
            onClick={() => onSelectSubmap(submapIndex)}
            className={`text-[10px] font-medium px-1 py-0.5 rounded transition-colors ${
              selectedSubmapIndex === submapIndex
                ? 'bg-orange-500 text-white'
                : 'text-orange-600 hover:bg-orange-50'
            }`}
          >
            {submapLabel}
          </button>
        </td>
      )}
    </tr>
  )
}

function Chevron({ x, cy, w, h, direction, sw }: {
  x: number; cy: number; w: number; h: number; direction: '<' | '>'; sw: number
}) {
  const tip = direction === '<' ? x : x + w
  const back = direction === '<' ? x + w : x
  return (
    <>
      <line x1={back} y1={cy - h} x2={tip} y2={cy} stroke="black" strokeWidth={sw} strokeLinecap="round" />
      <line x1={tip} y1={cy} x2={back} y2={cy + h} stroke="black" strokeWidth={sw} strokeLinecap="round" />
    </>
  )
}

function finishRowElements(
  finishType: FinishType,
  distText: string,
  contentLeft: number,
  contentRight: number,
  cy: number,
  sw: number,
) {
  const chevronW = 5
  const chevronH = 8
  const textWidth = distText ? 38 : 0
  const midX = (contentLeft + contentRight) / 2
  const textLeft = midX - textWidth / 2
  const textRight = midX + textWidth / 2

  const elements: ReactNode[] = []

  if (finishType === 'navigate') {
    elements.push(
      <Chevron key="lc" x={contentLeft} cy={cy} w={chevronW} h={chevronH} direction="<" sw={sw} />,
    )
    if (distText) {
      elements.push(
        <text key="dt" x={midX} y={cy + 1} textAnchor="middle" dominantBaseline="central"
          fontSize="11" fontFamily="sans-serif">{distText}</text>,
      )
    }
    elements.push(
      <Chevron key="rc" x={contentRight - chevronW} cy={cy} w={chevronW} h={chevronH} direction=">" sw={sw} />,
    )
    return elements
  }

  const leftDashes = 3
  const rightDashes = 3

  const rightChevronStart = contentRight - chevronW

  const leftRegionEnd = textLeft - 2
  const dashGapRatio = 1.8
  const leftTotal = leftRegionEnd - contentLeft
  const leftDashLen = leftTotal / (leftDashes + (leftDashes - 1) / dashGapRatio)
  const leftGapLen = leftDashLen / dashGapRatio

  if (finishType === 'funnel') {
    const dash1Start = contentLeft + leftDashLen + leftGapLen
    elements.push(
      <Chevron key="lc" x={dash1Start - chevronW} cy={cy} w={chevronW} h={chevronH} direction=">" sw={sw} />,
    )
  }

  const leftStart = finishType === 'funnel' ? 1 : 0
  for (let i = leftStart; i < leftDashes; i++) {
    const x1 = contentLeft + i * (leftDashLen + leftGapLen)
    const x2 = x1 + leftDashLen
    elements.push(
      <line key={`ld${i}`} x1={x1} y1={cy} x2={x2} y2={cy}
        stroke="black" strokeWidth={sw} strokeLinecap="round" />,
    )
  }

  if (distText) {
    elements.push(
      <text key="dt" x={midX} y={cy + 1} textAnchor="middle" dominantBaseline="central"
        fontSize="11" fontFamily="sans-serif">{distText}</text>,
    )
  }

  const rightRegionStart = textRight + 2
  const rightRegionEnd = rightChevronStart - 2
  const rightTotal = rightRegionEnd - rightRegionStart
  const rightDashLen = rightTotal / (rightDashes + (rightDashes - 1) / dashGapRatio)
  const rightGapLen = rightDashLen / dashGapRatio

  for (let i = 0; i < rightDashes; i++) {
    const x1 = rightRegionStart + i * (rightDashLen + rightGapLen)
    const x2 = x1 + rightDashLen
    elements.push(
      <line key={`rd${i}`} x1={x1} y1={cy} x2={x2} y2={cy}
        stroke="black" strokeWidth={sw} strokeLinecap="round" />,
    )
  }

  elements.push(
    <Chevron key="rc" x={rightChevronStart} cy={cy} w={chevronW} h={chevronH} direction=">" sw={sw} />,
  )

  return elements
}

function FinishDescRow({
  row,
  finishType,
  showExtraCol,
  onRemove,
}: {
  row: RowData
  finishType: FinishType
  showExtraCol: boolean
  onRemove?: (ccId: string) => void
}) {
  const { cc, legDist } = row
  const distText = legDist != null ? formatDistance(legDist) : ''

  const W = 256
  const CY = 18
  const sw = 1.5
  const circleR = 9
  const circleX = 18
  const finishX = W - 18
  const finishR = 9
  const finishRInner = 6

  const contentLeft = circleX + circleR + 3
  const contentRight = finishX - finishR - 3

  return (
    <tr className="group">
      <td
        colSpan={8}
        className={`${BORDER} relative`}
        style={{ height: CELL, padding: 0 }}
      >
        <svg viewBox={`0 0 ${W} 32`} width="100%" height={CELL} preserveAspectRatio="xMidYMid meet">
          <circle cx={circleX} cy={CY} r={circleR} fill="none" stroke="black" strokeWidth={sw} />
          {finishRowElements(finishType, distText, contentLeft, contentRight, CY, sw)}
          <circle cx={finishX} cy={CY} r={finishR} fill="none" stroke="black" strokeWidth={sw} />
          <circle cx={finishX} cy={CY} r={finishRInner} fill="none" stroke="black" strokeWidth={sw} />
        </svg>
        {onRemove && (
          <button
            onClick={() => onRemove(cc.id)}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-gray-300 hover:bg-red-400 text-white flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity z-10"
          >
            <X size={8} />
          </button>
        )}
      </td>
      {showExtraCol && <td />}
    </tr>
  )
}

function SymbolPicker({
  column, current, onSelect, onClear, onClose,
}: {
  column: IofColumn
  current?: string
  onSelect: (code: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const symbols = getColumnSymbols(column)
  const [search, setSearch] = useState('')
  const currentIsDimension = column === 'F' && current != null && isDimensionText(current)
  const [dimValue, setDimValue] = useState(currentIsDimension ? current : '')

  const filtered = search
    ? symbols.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.code.includes(search))
    : symbols

  const grouped = column === 'G' ? groupLocationSymbols(filtered)
    : column === 'E' ? groupBySourceColumn(filtered)
    : null

  return (
    <div className="mt-1 border border-gray-300 rounded-lg bg-white shadow-lg p-2 max-h-64 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        {column !== 'F' && (
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
            autoFocus
          />
        )}
        {current && (
          <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700 shrink-0">
            Clear
          </button>
        )}
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
          Close
        </button>
      </div>

      {column === 'F' && (
        <div className="mb-2">
          <div className="text-[10px] text-gray-400 font-semibold uppercase px-1 mb-0.5">Dimensions</div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="e.g. 2.5 or 8 x 4"
              value={dimValue}
              onChange={e => setDimValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && dimValue.trim()) onSelect(dimValue.trim()) }}
              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
              autoFocus
            />
            <button
              onClick={() => { if (dimValue.trim()) onSelect(dimValue.trim()) }}
              className="text-xs bg-orange-500 text-white rounded px-2 py-1 hover:bg-orange-600 shrink-0"
            >
              Set
            </button>
          </div>
          <div className="text-[9px] text-gray-400 mt-0.5 px-1">Height/depth, size (W×H), or slope (e.g. 0.5 / 3)</div>
        </div>
      )}

      {column === 'F' && (
        <div className="text-[10px] text-gray-400 font-semibold uppercase px-1 mb-0.5">Combinations</div>
      )}

      {grouped ? (
        Object.entries(grouped).map(([group, syms]) => (
          <div key={group} className="mb-1">
            <div className="text-[10px] text-gray-400 font-semibold uppercase px-1 mb-0.5">{group}</div>
            <SymbolGrid symbols={syms} current={current} onSelect={onSelect} />
          </div>
        ))
      ) : (
        <SymbolGrid symbols={filtered} current={current} onSelect={onSelect} />
      )}
    </div>
  )
}

function SymbolGrid({ symbols, current, onSelect }: {
  symbols: SymbolDef[]
  current?: string
  onSelect: (code: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {symbols.map(sym => (
        <button
          key={sym.code}
          onClick={() => onSelect(sym.code)}
          title={`${sym.name} (${sym.code})`}
          className={`flex items-center justify-center rounded border transition-colors ${
            sym.code === current
              ? 'border-orange-500 bg-orange-100'
              : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50'
          }`}
          style={{ width: 36, height: 36 }}
        >
          <SymbolSvg sym={sym} size={28} />
        </button>
      ))}
    </div>
  )
}

function groupBySourceColumn(syms: SymbolDef[]): Record<string, SymbolDef[]> {
  const groups: Record<string, SymbolDef[]> = {}
  for (const s of syms) {
    const group = s.column === 'D' ? 'Feature' : 'Appearance'
    if (!groups[group]) groups[group] = []
    groups[group].push(s)
  }
  return groups
}

function groupLocationSymbols(syms: SymbolDef[]): Record<string, SymbolDef[]> {
  const groups: Record<string, SymbolDef[]> = {}
  for (const s of syms) {
    const base = s.code.replace(/[NESW]+$/, '').replace(/\.$/, '')
    const label = s.name.replace(/(North-east|North-west|South-east|South-west|North|South|East|West)\s*/i, '').trim()
    const group = label || base
    if (!groups[group]) groups[group] = []
    groups[group].push(s)
  }
  return groups
}
