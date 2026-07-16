import React, { memo, useState, type ReactNode } from 'react'
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
import { useT, type TFn } from '../i18n'
import { IofSymbolIcon, SymbolSvg } from './IofSymbolIcon'
import { columns, getColumnSymbols, columnFields, isDimensionText, getSymbol } from '../lib/iofSymbols'
import { defaultControlLabel, computeSubmaps, controlsById } from '../lib/courseUtils'
import { computeCourseDistances, formatDistance, resolveCourseLength, mapUnitsToMetres } from '../lib/distance'
import { polylineLength } from '../lib/geometry'
import { useRenderTracker } from '../lib/perf'
import type { IofColumn, SymbolDef } from '../lib/iofSymbols'
import type { Course, Control, CourseControl, FinishType } from '../types'

const CELL = 32
const BORDER = 'border border-gray-300'


interface GridProps {
  course: Course
  onRemove?: (courseControlId: string) => void
  onReorder?: (reordered: CourseControl[]) => void
  locked?: boolean
}

interface RowData {
  cc: CourseControl
  ctrl: Control
  seq: number
  legDist?: number
  forkEligible?: boolean
  isLoop?: boolean
  phiEligible?: boolean
  phiPartnerId?: string
  isPhiLoop?: boolean
}

export const ControlDescriptionGrid = memo(function ControlDescriptionGrid({ course, onRemove, onReorder, locked }: GridProps) {
  useRenderTracker('ControlDescriptionGrid')
  const t = useT()
  const controls = useStore(s => s.project!.controls)
  const projectName = useStore(s => s.project!.meta.name)
  const mapConfig = useStore(s => s.project!.map)
  const measuredLegs = useStore(s => s.project!.measuredLegs)
  const toggleCourseLoop = useStore(s => s.toggleCourseLoop)
  const togglePhiLoop = useStore(s => s.togglePhiLoop)
  const setExchangeMode = useStore(s => s.setExchangeMode)
  const toggleExchangeControl = useStore(s => s.toggleExchangeControl)
  const toggleMarkedRoute = useStore(s => s.toggleMarkedRoute)
  const cycleMarkedRouteMode = useStore(s => s.cycleMarkedRouteMode)
  const updateCourseFinishType = useStore(s => s.updateCourseFinishType)
  const setSelectedSubmap = useStore(s => s.setSelectedSubmap)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const isSelectedCourse = useStore(s => s.editor.selectedCourseId === course.id)
  const controlMap = controlsById(controls)
  const submaps = computeSubmaps(course)
  const hasSubmaps = submaps.length > 1

  // The submap filter (selectedSubmapIndex) applies to the selected course, so
  // picking a submap from another course's sheet must select that course first
  // — and this grid's highlight only reflects the filter when its course is
  // the selected one.
  const shownSubmapIndex = isSelectedCourse ? selectedSubmapIndex : null
  function selectSubmap(index: number | null) {
    if (!isSelectedCourse) setSelectedCourse(course.id)
    setSelectedSubmap(index)
  }

  // Map exchange courseControl IDs to the submap they END (the next submap starts with same exchange)
  const exchangeCcSubmapEnd = new Map<string, number>()
  if (hasSubmaps) {
    for (let si = 0; si < submaps.length - 1; si++) {
      const lastCc = submaps[si].controls[submaps[si].controls.length - 1]
      exchangeCcSubmapEnd.set(lastCc.id, si)
    }
  }

  const distances = computeCourseDistances(course, controls, mapConfig, measuredLegs)
  const totalLength = resolveCourseLength(course, distances)
  const [picker, setPicker] = useState<{ controlId: string; column: IofColumn } | null>(null)

  const showExtraCol = true

  // Count occurrences of each controlId to detect fork-eligible controls
  const controlIdCounts = new Map<string, number>()
  for (const cc of course.controls) {
    controlIdCounts.set(cc.controlId, (controlIdCounts.get(cc.controlId) ?? 0) + 1)
  }

  const loopForkIds = new Set((course.loops ?? []).map(l => l.forkControlId))
  const phiLoopPairs = new Map<string, string>()
  for (const l of course.loops ?? []) {
    if (l.forkControlId2) {
      phiLoopPairs.set(l.forkControlId, l.forkControlId2)
      phiLoopPairs.set(l.forkControlId2, l.forkControlId)
    }
  }

  // Detect phi-eligible pairs: two controls alternating (A...B...A...B), each 2+ times
  const phiPartners = new Map<string, string>()
  const multiIds = [...controlIdCounts.entries()].filter(([, n]) => n >= 2).map(([id]) => id)
  for (let i = 0; i < multiIds.length; i++) {
    for (let j = i + 1; j < multiIds.length; j++) {
      const a = multiIds[i], b = multiIds[j]
      const positions = course.controls
        .map((cc, idx) => ({ cid: cc.controlId, idx }))
        .filter(p => p.cid === a || p.cid === b)
        .sort((x, y) => x.idx - y.idx)
      let alternates = true
      for (let k = 1; k < positions.length; k++) {
        if (positions[k].cid === positions[k - 1].cid) { alternates = false; break }
      }
      if (alternates && positions.length >= 3) {
        phiPartners.set(a, b)
        phiPartners.set(b, a)
      }
    }
  }

  let seq = 0
  let filteredIdx = 0
  const seenControlIds = new Set<string>()
  const rows: RowData[] = []
  let finishRow: RowData | null = null
  for (const cc of course.controls) {
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
    if (ctrl.type === 'finish') {
      if (!finishRow) {
        finishRow = {
          cc,
          ctrl,
          seq: 0,
          legDist: filteredIdx > 0 ? distances.legs[filteredIdx - 1] : undefined,
        }
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
      phiEligible: isFirstOccurrence && ctrl.type === 'control' && !loopForkIds.has(cc.controlId) && (phiPartners.has(cc.controlId) || phiLoopPairs.has(cc.controlId)),
      phiPartnerId: phiLoopPairs.get(cc.controlId) ?? phiPartners.get(cc.controlId),
      isPhiLoop: phiLoopPairs.has(cc.controlId),
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
                  {totalLength > 0 ? formatDistance(totalLength) : ''}
                </td>
                <td colSpan={3} className={`${BORDER} text-center py-1 bg-gray-50 text-gray-500`}>
                  {course.climb != null && course.climb > 0 ? `${course.climb} m↑` : ''}
                </td>
                {showExtraCol && (
                  <td className="pl-1.5 align-middle whitespace-nowrap">
                    {hasSubmaps && (
                      <button
                        onClick={() => selectSubmap(null)}
                        className={`text-[10px] font-medium px-1 py-0.5 rounded transition-colors ${
                          shownSubmapIndex === null
                            ? 'bg-orange-500 text-white'
                            : 'text-orange-600 hover:bg-orange-50'
                        }`}
                      >
                        {t('controlDesc.all')}
                      </button>
                    )}
                  </td>
                )}
              </tr>

              {rows.length === 0 && !finishRow ? (
                <tr>
                  <td colSpan={8} className="text-center text-xs text-gray-400 py-3">
                    {t('controlDesc.clickToAdd')}
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
                    onSelect: selectSubmap,
                    selected: shownSubmapIndex,
                  } : undefined
                  const tapedMode = row.cc.markedRoute
                  let tapedDist: string | null = null
                  if (tapedMode && row.legDist != null) {
                    if (tapedMode === 'partial' && row.cc.markedRouteEnd) {
                      const ccIdx = course.controls.findIndex(c => c.id === row.cc.id)
                      const prevCtrl = ccIdx > 0 ? controlMap.get(course.controls[ccIdx - 1].controlId) : undefined
                      if (prevCtrl) {
                        const pts = row.cc.legBendPoints?.length
                          ? [prevCtrl.position, ...row.cc.legBendPoints, row.cc.markedRouteEnd]
                          : [prevCtrl.position, row.cc.markedRouteEnd]
                        tapedDist = formatDistance(mapUnitsToMetres(polylineLength(pts), mapConfig))
                      }
                    } else {
                      tapedDist = formatDistance(row.legDist)
                    }
                  }
                  return (
                    <React.Fragment key={row.cc.id}>
                    {tapedDist != null && tapedMode && (
                      <TapedRouteRow distText={tapedDist} mode={tapedMode}
                        onSetMode={(m) => { if (m !== tapedMode) cycleMarkedRouteMode(course.id, row.cc.id) }}
                        showExtraCol={showExtraCol} locked={locked} />
                    )}
                    <SortableDescRow
                      row={row}
                      courseId={course.id}
                      showExtraCol={showExtraCol}
                      picker={locked ? null : picker}
                      setPicker={locked ? () => {} : setPicker}
                      onRemove={onRemove}
                      onToggleLoop={locked ? undefined : toggleCourseLoop}
                      onTogglePhiLoop={locked ? undefined : togglePhiLoop}
                      onToggleExchange={locked ? undefined : (ccId) => toggleExchangeControl(course.id, ccId)}
                      onToggleMarkedRoute={locked ? undefined : (ccId) => toggleMarkedRoute(course.id, ccId)}
                      textDescriptions={course.textDescriptions}
                      submapButton={startButton}
                      locked={locked}
                      exchangeSeparator={submapEndIdx != null ? {
                        submapEndIdx,
                        nextSubmapLabel: submaps[submapEndIdx + 1]?.label ?? '',
                        exchangeMode: row.cc.exchangeMode ?? 'exchange',
                        onModeChange: locked ? () => {} : (mode) => setExchangeMode(course.id, row.cc.id, mode),
                        onSelectSubmap: selectSubmap,
                        selectedSubmapIndex: shownSubmapIndex,
                        seqLabel: String(row.seq),
                      } : undefined}
                    />
                    </React.Fragment>
                  )
                })}
                {finishRow && (
                    <FinishDescRow
                      row={finishRow}
                      finishType={course.finishType ?? 'navigate'}
                      showExtraCol={showExtraCol}
                      onRemove={onRemove}
                      onSetFinishType={(ft) => updateCourseFinishType(course.id, ft)}
                      locked={locked}
                    />
                  )}
                </>

              )}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>
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
  seqLabel: string
}

function SortableDescRow({
  row,
  courseId,
  showExtraCol,
  picker,
  setPicker,
  onRemove,
  onToggleLoop,
  onTogglePhiLoop,
  onToggleExchange,
  onToggleMarkedRoute,
  textDescriptions,
  submapButton,
  exchangeSeparator,
  locked,
}: {
  row: RowData
  courseId: string
  showExtraCol: boolean
  picker: { controlId: string; column: IofColumn } | null
  setPicker: (p: { controlId: string; column: IofColumn } | null) => void
  onRemove?: (ccId: string) => void
  onToggleLoop?: (courseId: string, controlId: string) => void
  onTogglePhiLoop?: (courseId: string, controlId: string, controlId2: string) => void
  onToggleExchange?: (ccId: string) => void
  onToggleMarkedRoute?: (ccId: string) => void
  textDescriptions?: boolean
  submapButton?: SubmapButtonProps
  exchangeSeparator?: ExchangeSeparatorProps
  locked?: boolean
}) {
  const t = useT()
  const { cc, ctrl, seq, legDist, forkEligible, isLoop, phiEligible, phiPartnerId, isPhiLoop } = row
  const updateControlDescription = useStore(s => s.updateControlDescription)
  const requestCenterOnControl = useStore(s => s.requestCenterOnControl)
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
          className={`${BORDER} text-center font-bold relative ${locked ? '' : 'cursor-grab active:cursor-grabbing'}`}
          style={{ width: CELL, height: CELL, touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
          {...(locked ? {} : { ...attributes, ...listeners })}
        >
          {!locked && <GripVertical size={14} strokeWidth={2.5} className="absolute -left-1 top-1/2 -translate-y-1/2 text-gray-300 group-hover:text-gray-400" />}
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
        <td
          className={`${BORDER} text-center font-mono cursor-pointer hover:bg-orange-50`}
          style={{ height: CELL }}
          onClick={() => requestCenterOnControl(ctrl.id)}
          title={t('controlDesc.showOnMap')}
        >
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
              className={`${BORDER} text-center ${locked ? '' : 'cursor-pointer hover:bg-orange-50'} ${isActive ? 'bg-orange-100' : ''}`}
              style={{ width: CELL, height: CELL, padding: 0 }}
              onClick={locked ? undefined : () => setPicker(isActive ? null : { controlId: ctrl.id, column: col.id })}
            >
              {value && (textDescriptions && sym
                ? <span className="text-[8px] leading-tight px-0.5">{t('iof.' + sym.code)}</span>
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
            {!locked && ctrl.type !== 'finish' && onToggleMarkedRoute && (
              <button
                onClick={() => onToggleMarkedRoute(cc.id)}
                title={cc.markedRoute ? t('controlDesc.removeMarkedRoute') : t('controlDesc.setMarkedRoute')}
                className={`absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-opacity z-10 ${
                  cc.markedRoute
                    ? 'bg-purple-500 text-white opacity-100'
                    : 'bg-gray-300 hover:bg-purple-400 text-white opacity-60 group-hover:opacity-100'
                }`}
              >
                <svg width={10} height={6} viewBox="0 0 10 6">
                  <line x1="0" y1="3" x2="3" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="7" y1="3" x2="10" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {!locked && ctrl.type === 'control' && onToggleExchange && (
              <button
                onClick={() => onToggleExchange(cc.id)}
                title={cc.exchangeMode ? t('controlDesc.removeExchange') : t('controlDesc.setExchange')}
                className={`absolute -top-1 right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-opacity z-10 ${
                  cc.exchangeMode
                    ? 'bg-orange-500 text-white opacity-100'
                    : 'bg-gray-300 hover:bg-orange-400 text-white opacity-60 group-hover:opacity-100'
                }`}
              >
                <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9,3 A9,9 0 1,1 9,21" />
                  <polyline points="13,18 9,22 5,18" />
                </svg>
              </button>
            )}
          </td>
        )}
      </tr>
      {picker?.controlId === ctrl.id && (
        <tr>
          <td colSpan={colCount} className="p-0 border-0 relative">
            {/* ponytail: absolute so picker doesn't widen the table */}
            <div className="absolute left-0 w-full z-20">
            <SymbolPicker
              column={picker.column}
              current={ctrl.description?.[columnFields[picker.column]]}
              onSelect={(code) => {
                updateControlDescription(ctrl.id, columnFields[picker.column], code)
                setPicker(null)
              }}
              onClear={() => {
                updateControlDescription(ctrl.id, columnFields[picker.column], undefined)
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
            </div>
          </td>
        </tr>
      )}
      {!locked && forkEligible && (
        <tr>
          <td colSpan={colCount} className="py-0.5 px-1">
            <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isLoop ?? false}
                onChange={() => onToggleLoop?.(courseId, ctrl.id)}
                className="accent-orange-600"
              />
              {t('controlDesc.butterflyLoop')}
            </label>
          </td>
        </tr>
      )}
      {!locked && phiEligible && phiPartnerId && (
        <tr>
          <td colSpan={colCount} className="py-0.5 px-1">
            <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isPhiLoop ?? false}
                onChange={() => onTogglePhiLoop?.(courseId, ctrl.id, phiPartnerId)}
                className="accent-orange-600"
              />
              {t('controlDesc.phiLoop')}
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
            locked={locked}
          />
          <RestartRow
            ctrl={ctrl}
            seqLabel={exchangeSeparator.seqLabel}
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
  locked,
}: {
  exchangeMode: 'exchange' | 'flip'
  onModeChange: (mode: 'exchange' | 'flip') => void
  showExtraCol: boolean
  locked?: boolean
}) {
  const t = useT()
  return (
    <tr className="group">
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
            <ExchangeRowSvg />
          )}
          {!locked && <select
            value={exchangeMode}
            onChange={e => onModeChange(e.target.value as 'exchange' | 'flip')}
            className="text-[10px] border border-gray-300 rounded px-1 py-0.5 bg-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <option value="exchange">{t('controlDesc.exchange')}</option>
            <option value="flip">{t('controlDesc.flip')}</option>
          </select>}
        </div>
      </td>
      {showExtraCol && <td />}
    </tr>
  )
}

function ExchangeRowSvg() {
  const W = 256
  const CY = 18
  const sw = 1.5
  const circleR = 9
  const circleX = 18
  const triX = W - 18
  const triR = 10

  const contentLeft = circleX + circleR + 3
  const contentRight = triX - triR - 3
  const midX = (contentLeft + contentRight) / 2

  const chevronW = 5
  const chevronH = 8
  const rightChevronStart = contentRight - chevronW

  const dashes = 3
  const dashGapRatio = 1.8
  const textWidth = 38
  const textLeft = midX - textWidth / 2
  const textRight = midX + textWidth / 2

  const leftTotal = textLeft - 2 - contentLeft
  const leftDashLen = leftTotal / (dashes + (dashes - 1) / dashGapRatio)
  const leftGapLen = leftDashLen / dashGapRatio

  const rightTotal = rightChevronStart - 2 - (textRight + 2)
  const rightDashLen = rightTotal / (dashes + (dashes - 1) / dashGapRatio)
  const rightGapLen = rightDashLen / dashGapRatio

  return (
    <svg viewBox={`0 0 ${W} 32`} width="100%" height={CELL} preserveAspectRatio="xMidYMid meet">
      <circle cx={circleX} cy={CY} r={circleR} fill="none" stroke="black" strokeWidth={sw} />
      {Array.from({ length: dashes }, (_, i) => {
        const x1 = contentLeft + i * (leftDashLen + leftGapLen)
        return <line key={`ld${i}`} x1={x1} y1={CY} x2={x1 + leftDashLen} y2={CY} stroke="black" strokeWidth={sw} strokeLinecap="round" />
      })}
      <text x={midX} y={CY + 1} textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="sans-serif">0 m</text>
      {Array.from({ length: dashes }, (_, i) => {
        const x1 = textRight + 2 + i * (rightDashLen + rightGapLen)
        return <line key={`rd${i}`} x1={x1} y1={CY} x2={x1 + rightDashLen} y2={CY} stroke="black" strokeWidth={sw} strokeLinecap="round" />
      })}
      <Chevron x={rightChevronStart} cy={CY} w={chevronW} h={chevronH} direction=">" sw={sw} />
      <polygon
        points={`${triX},${CY - triR} ${triX + triR * 0.866},${CY + triR * 0.5} ${triX - triR * 0.866},${CY + triR * 0.5}`}
        fill="none" stroke="black" strokeWidth={sw} strokeLinejoin="round"
      />
    </svg>
  )
}

function RestartRow({
  ctrl,
  seqLabel,
  submapLabel,
  submapIndex,
  onSelectSubmap,
  selectedSubmapIndex,
  showExtraCol,
}: {
  ctrl: Control
  seqLabel: string
  submapLabel: string
  submapIndex: number
  onSelectSubmap: (index: number | null) => void
  selectedSubmapIndex: number | null
  showExtraCol: boolean
}) {
  const labelSubmapStart = useStore(s => s.project!.labelSubmapStart ?? false)
  return (
    <tr>
      <td className={`${BORDER} text-center font-bold`} style={{ width: CELL, height: CELL }}>
        {labelSubmapStart ? seqLabel : '△'}
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

function FinishTypeSvg({ finishType, w }: { finishType: FinishType; w: number }) {
  const CY = 18
  const sw = 1.5
  const circleR = 9
  const circleX = 18
  const finishX = w - 18
  const finishR = 9
  const finishRInner = 6
  const contentLeft = circleX + circleR + 3
  const contentRight = finishX - finishR - 3
  return (
    <svg viewBox={`0 0 ${w} 32`} width="100%" height={CELL} preserveAspectRatio="xMidYMid meet">
      <circle cx={circleX} cy={CY} r={circleR} fill="none" stroke="currentColor" strokeWidth={sw} />
      {finishRowElements(finishType, '', contentLeft, contentRight, CY, sw)}
      <circle cx={finishX} cy={CY} r={finishR} fill="none" stroke="currentColor" strokeWidth={sw} />
      <circle cx={finishX} cy={CY} r={finishRInner} fill="none" stroke="currentColor" strokeWidth={sw} />
    </svg>
  )
}

const FINISH_TYPES: FinishType[] = ['navigate', 'funnel', 'taped']

function FinishDescRow({
  row,
  finishType,
  showExtraCol,
  onRemove,
  onSetFinishType,
  locked,
}: {
  row: RowData
  finishType: FinishType
  showExtraCol: boolean
  onRemove?: (ccId: string) => void
  onSetFinishType: (ft: FinishType) => void
  locked?: boolean
}) {
  const [open, setOpen] = useState(false)
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

  const otherTypes = FINISH_TYPES.filter(ft => ft !== finishType)

  return (
    <tr className="group">
      <td
        colSpan={8}
        className={`${BORDER} relative ${locked ? '' : 'cursor-pointer hover:bg-orange-50'}`}
        style={{ height: CELL, padding: 0 }}
        tabIndex={locked ? undefined : 0}
        onClick={locked ? undefined : () => setOpen(v => !v)}
        onBlur={locked ? undefined : () => setTimeout(() => setOpen(false), 150)}
      >
        <svg viewBox={`0 0 ${W} 32`} width="100%" height={CELL} preserveAspectRatio="xMidYMid meet">
          <circle cx={circleX} cy={CY} r={circleR} fill="none" stroke="black" strokeWidth={sw} />
          {finishRowElements(finishType, distText, contentLeft, contentRight, CY, sw)}
          <circle cx={finishX} cy={CY} r={finishR} fill="none" stroke="black" strokeWidth={sw} />
          <circle cx={finishX} cy={CY} r={finishRInner} fill="none" stroke="black" strokeWidth={sw} />
        </svg>
        {onRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(cc.id) }}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-gray-300 hover:bg-red-400 text-white flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity z-10"
          >
            <X size={8} />
          </button>
        )}
        {open && (
          <div className="absolute left-0 bottom-full z-30 bg-white border border-gray-300 rounded shadow-md"
            style={{ width: '100%' }}>
            {otherTypes.map(ft => (
              <div key={ft} className="px-1 py-0.5 hover:bg-orange-100 text-gray-600 cursor-pointer"
                onClick={e => { e.stopPropagation(); onSetFinishType(ft); setOpen(false) }}>
                <FinishTypeSvg finishType={ft} w={W} />
              </div>
            ))}
          </div>
        )}
      </td>
      {showExtraCol && <td />}
    </tr>
  )
}

function TapedRouteSvg({ mode, w }: { mode: 'full' | 'partial'; w: number }) {
  const CY = 18
  const sw = 1.5
  const circleR = 9
  const circleX = 18
  const chevronW = 5
  const chevronH = 8
  const showRightCircle = mode === 'full'
  const rightCircleX = w - 18
  const contentLeft = circleX + circleR + 3
  const contentRight = showRightCircle ? rightCircleX - circleR - 3 : w - 6
  const rightChevronStart = contentRight - chevronW
  const dashes = 6
  const dashGapRatio = 1.8
  const total = rightChevronStart - contentLeft
  const dashLen = total / (dashes + (dashes - 1) / dashGapRatio)
  const gapLen = dashLen / dashGapRatio
  return (
    <svg viewBox={`0 0 ${w} 32`} width="100%" height={CELL} preserveAspectRatio="xMidYMid meet">
      <circle cx={circleX} cy={CY} r={circleR} fill="none" stroke="currentColor" strokeWidth={sw} />
      {Array.from({ length: dashes }, (_, i) => {
        const x1 = contentLeft + i * (dashLen + gapLen)
        return <line key={`d${i}`} x1={x1} y1={CY} x2={x1 + dashLen} y2={CY} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      })}
      <Chevron x={rightChevronStart} cy={CY} w={chevronW} h={chevronH} direction=">" sw={sw} />
      {showRightCircle && (
        <circle cx={rightCircleX} cy={CY} r={circleR} fill="none" stroke="currentColor" strokeWidth={sw} />
      )}
    </svg>
  )
}

function TapedRouteRow({ distText, mode, onSetMode, showExtraCol, locked }: {
  distText: string; mode: 'full' | 'partial'; onSetMode: (mode: 'full' | 'partial') => void; showExtraCol: boolean; locked?: boolean
}) {
  const [open, setOpen] = useState(false)
  const W = 256
  const CY = 18
  const sw = 1.5
  const circleR = 9
  const circleX = 18
  const chevronW = 5
  const chevronH = 8

  const showRightCircle = mode === 'full'
  const rightCircleX = W - 18
  const contentLeft = circleX + circleR + 3
  const contentRight = showRightCircle ? rightCircleX - circleR - 3 : W - 6
  const rightChevronStart = contentRight - chevronW

  const textWidth = distText ? 38 : 0
  const midX = (contentLeft + contentRight) / 2
  const textLeft = midX - textWidth / 2
  const textRight = midX + textWidth / 2

  const leftDashes = 3
  const rightDashes = 3
  const dashGapRatio = 1.8

  const leftRegionEnd = textLeft - 2
  const leftTotal = leftRegionEnd - contentLeft
  const leftDashLen = leftTotal / (leftDashes + (leftDashes - 1) / dashGapRatio)
  const leftGapLen = leftDashLen / dashGapRatio

  const rightRegionStart = textRight + 2
  const rightRegionEnd = rightChevronStart - 2
  const rightTotal = rightRegionEnd - rightRegionStart
  const rightDashLen = rightTotal / (rightDashes + (rightDashes - 1) / dashGapRatio)
  const rightGapLen = rightDashLen / dashGapRatio

  const otherMode: 'full' | 'partial' = mode === 'full' ? 'partial' : 'full'

  return (
    <tr>
      <td colSpan={8} className={`${BORDER} ${locked ? '' : 'cursor-pointer hover:bg-orange-50'} relative`} style={{ height: CELL, padding: 0 }}
        tabIndex={locked ? undefined : 0} onClick={locked ? undefined : () => setOpen(v => !v)} onBlur={locked ? undefined : () => setTimeout(() => setOpen(false), 150)}>
        <svg viewBox={`0 0 ${W} 32`} width="100%" height={CELL} preserveAspectRatio="xMidYMid meet">
          <circle cx={circleX} cy={CY} r={circleR} fill="none" stroke="black" strokeWidth={sw} />
          {Array.from({ length: leftDashes }, (_, i) => {
            const x1 = contentLeft + i * (leftDashLen + leftGapLen)
            return <line key={`ld${i}`} x1={x1} y1={CY} x2={x1 + leftDashLen} y2={CY} stroke="black" strokeWidth={sw} strokeLinecap="round" />
          })}
          {distText && (
            <text x={midX} y={CY + 1} textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="sans-serif">{distText}</text>
          )}
          {Array.from({ length: rightDashes }, (_, i) => {
            const x1 = rightRegionStart + i * (rightDashLen + rightGapLen)
            return <line key={`rd${i}`} x1={x1} y1={CY} x2={x1 + rightDashLen} y2={CY} stroke="black" strokeWidth={sw} strokeLinecap="round" />
          })}
          <Chevron x={rightChevronStart} cy={CY} w={chevronW} h={chevronH} direction=">" sw={sw} />
          {showRightCircle && (
            <circle cx={rightCircleX} cy={CY} r={circleR} fill="none" stroke="black" strokeWidth={sw} />
          )}
        </svg>
        {open && (
          <div className="absolute left-0 top-full z-30 bg-white border border-gray-300 rounded shadow-md"
            style={{ width: '100%' }}>
            <div className="px-1 py-0.5 hover:bg-orange-100 text-gray-600"
              onClick={e => { e.stopPropagation(); onSetMode(otherMode); setOpen(false) }}>
              <TapedRouteSvg mode={otherMode} w={W} />
            </div>
          </div>
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
  const t = useT()
  const symbols = getColumnSymbols(column)
  const [search, setSearch] = useState('')
  const currentIsDimension = column === 'F' && current != null && isDimensionText(current)
  const [dimValue, setDimValue] = useState(currentIsDimension ? current : '')

  // Match ignoring spaces/hyphens so "northeast", "north east" and
  // "north-east" all find "North-east side".
  const normalize = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '')
  const searchNorm = normalize(search)
  const filtered = search
    ? symbols.filter(s => normalize(s.name).includes(searchNorm) || normalize(t('iof.' + s.code)).includes(searchNorm) || s.code.includes(search))
    : symbols

  const grouped = column === 'G' ? groupLocationSymbols(filtered, t)
    : column === 'E' ? groupBySourceColumn(filtered, t)
    : column === 'C' ? groupDirectionSymbols(filtered, t)
    : null

  return (
    <div className="mt-1 border border-gray-300 rounded-lg bg-white shadow-lg p-2 max-h-64 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        {column !== 'F' && (
          <input
            type="text"
            placeholder={t('controlDesc.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
            autoFocus
          />
        )}
        {current && (
          <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700 shrink-0">
            {t('controlDesc.clear')}
          </button>
        )}
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
          {t('controlDesc.close')}
        </button>
      </div>

      {column === 'F' && (
        <div className="mb-2">
          <div className="text-[10px] text-gray-400 font-semibold uppercase px-1 mb-0.5">{t('controlDesc.dimensions')}</div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder={t('controlDesc.dimensionPlaceholder')}
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
              {t('controlDesc.set')}
            </button>
          </div>
          <div className="text-[9px] text-gray-400 mt-0.5 px-1">{t('controlDesc.dimensionHint')}</div>
        </div>
      )}

      {column === 'F' && (
        <div className="text-[10px] text-gray-400 font-semibold uppercase px-1 mb-0.5">{t('controlDesc.combinations')}</div>
      )}

      {grouped ? (
        Object.entries(grouped).map(([group, syms]) => (
          <div key={group} className="mb-1">
            <div className="text-[10px] text-gray-400 font-semibold uppercase px-1 mb-0.5">{group}</div>
            {isCompassGroup(syms)
              ? <CompassGrid symbols={syms} current={current} onSelect={onSelect} />
              : <SymbolGrid symbols={syms} current={current} onSelect={onSelect} />
            }
          </div>
        ))
      ) : (
        <SymbolGrid symbols={filtered} current={current} onSelect={onSelect} />
      )}
    </div>
  )
}

const COMPASS_DIRS = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE']

function isCompassGroup(syms: SymbolDef[]): boolean {
  return syms.length === 8 && syms.every(s => /[NESW]+$/.test(s.code))
}

function CompassGrid({ symbols, current, onSelect }: {
  symbols: SymbolDef[]
  current?: string
  onSelect: (code: string) => void
}) {
  const t = useT()
  const byDir = new Map<string, SymbolDef>()
  for (const s of symbols) {
    const dir = s.code.match(/([NESW]+)$/)?.[1]
    if (dir) byDir.set(dir, s)
  }
  return (
    <div className="inline-grid grid-cols-3 gap-0.5">
      {COMPASS_DIRS.map((dir, i) => {
        if (!dir) return <div key={i} style={{ width: 36, height: 36 }} />
        const sym = byDir.get(dir)
        if (!sym) return <div key={i} style={{ width: 36, height: 36 }} />
        return (
          <button
            key={sym.code}
            onClick={() => onSelect(sym.code)}
            title={`${t('iof.' + sym.code)} (${sym.code})`}
            className={`flex items-center justify-center rounded border transition-colors ${
              sym.code === current
                ? 'border-orange-500 bg-orange-100'
                : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50'
            }`}
            style={{ width: 36, height: 36 }}
          >
            <SymbolSvg sym={sym} size={28} />
          </button>
        )
      })}
    </div>
  )
}

function SymbolGrid({ symbols, current, onSelect }: {
  symbols: SymbolDef[]
  current?: string
  onSelect: (code: string) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-0.5">
      {symbols.map(sym => (
        <button
          key={sym.code}
          onClick={() => onSelect(sym.code)}
          title={`${t('iof.' + sym.code)} (${sym.code})`}
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

function groupBySourceColumn(syms: SymbolDef[], t: TFn): Record<string, SymbolDef[]> {
  const groups: Record<string, SymbolDef[]> = {}
  for (const s of syms) {
    const group = s.column === 'D' ? t('iofGroup.feature') : t('iofGroup.appearance')
    if (!groups[group]) groups[group] = []
    groups[group].push(s)
  }
  return groups
}

function groupDirectionSymbols(syms: SymbolDef[], t: TFn): Record<string, SymbolDef[]> {
  const dir: SymbolDef[] = []
  const other: SymbolDef[] = []
  for (const s of syms) {
    if (/[NESW]+$/.test(s.code)) dir.push(s)
    else other.push(s)
  }
  const groups: Record<string, SymbolDef[]> = {}
  if (dir.length) groups[t('iofGroup.direction')] = dir
  if (other.length) groups[t('iofGroup.position')] = other
  return groups
}

function groupLocationSymbols(syms: SymbolDef[], t: TFn): Record<string, SymbolDef[]> {
  const groups: Record<string, SymbolDef[]> = {}
  for (const s of syms) {
    const base = s.code.replace(/[NESW]+$/, '').replace(/\.$/, '')
    const group = t('iofGroup.' + base) !== 'iofGroup.' + base
      ? t('iofGroup.' + base)
      : t('iof.' + base)
    if (!groups[group]) groups[group] = []
    groups[group].push(s)
  }
  return groups
}
