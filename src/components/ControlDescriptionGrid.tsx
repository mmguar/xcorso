import { useState } from 'react'
import { X } from 'lucide-react'
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
import { columns, getColumnSymbols, columnFields, isDimensionText } from '../lib/iofSymbols'
import { defaultControlLabel } from '../lib/courseUtils'
import { computeCourseDistances, formatDistance } from '../lib/distance'
import { useRenderTracker } from '../lib/perf'
import type { IofColumn, SymbolDef } from '../lib/iofSymbols'
import type { Course, Control, CourseControl } from '../types'

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

export function ControlDescriptionGrid({ course, onRemove, onReorder }: GridProps) {
  useRenderTracker('ControlDescriptionGrid')
  const project = useStore(s => s.project!)
  const updateControlDescription = useStore(s => s.updateControlDescription)
  const toggleCourseLoop = useStore(s => s.toggleCourseLoop)
  const controlMap = new Map(project.controls.map(c => [c.id, c]))

  const distances = computeCourseDistances(course, project.controls, project.map)
  const [picker, setPicker] = useState<{ controlId: string; column: IofColumn } | null>(null)

  const showDist = distances.legs.length > 0

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
  for (const cc of course.controls) {
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
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
            <thead>
              <tr>
                <th className={`${BORDER} bg-gray-50 px-1`} style={{ width: CELL, minWidth: CELL }}>#</th>
                <th className={`${BORDER} bg-gray-50 px-1`} style={{ width: CELL + 8, minWidth: CELL + 8 }}>Code</th>
                {columns.map(col => (
                  <th key={col.id} className={`${BORDER} bg-gray-50 px-0.5 text-center`}
                    style={{ width: CELL, minWidth: CELL }} title={col.label}>
                    {col.id}
                  </th>
                ))}
                {showDist && <th className="px-1" />}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={8} className={`${BORDER} text-center font-bold py-1 bg-gray-50`}>
                  {course.name}
                  {distances.total > 0 && (
                    <span className="font-normal text-gray-500 ml-2">{formatDistance(distances.total)}</span>
                  )}
                  {course.climb != null && course.climb > 0 && (
                    <span className="font-normal text-gray-500 ml-2">{course.climb} m↑</span>
                  )}
                </td>
                {showDist && <td />}
              </tr>

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-xs text-gray-400 py-3">
                    Click controls on the map to add them.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <SortableDescRow
                    key={row.cc.id}
                    row={row}
                    courseId={course.id}
                    showDist={showDist}
                    picker={picker}
                    setPicker={setPicker}
                    onRemove={onRemove}
                    onToggleLoop={toggleCourseLoop}
                  />
                ))
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
}

function SortableDescRow({
  row,
  courseId,
  showDist,
  picker,
  setPicker,
  onRemove,
  onToggleLoop,
}: {
  row: RowData
  courseId: string
  showDist: boolean
  picker: { controlId: string; column: IofColumn } | null
  setPicker: (p: { controlId: string; column: IofColumn } | null) => void
  onRemove?: (ccId: string) => void
  onToggleLoop?: (courseId: string, controlId: string) => void
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

  const colCount = 2 + columns.length + (showDist ? 1 : 0)

  return (
    <>
      <tr ref={setNodeRef} style={style} className="group">
        <td
          className={`${BORDER} text-center font-bold relative cursor-grab active:cursor-grabbing`}
          style={{ width: CELL, height: CELL }}
          {...attributes}
          {...listeners}
        >
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

          return (
            <td
              key={col.id}
              className={`${BORDER} text-center cursor-pointer hover:bg-orange-50 ${isActive ? 'bg-orange-100' : ''}`}
              style={{ width: CELL, height: CELL, padding: 0 }}
              onClick={() => setPicker(isActive ? null : { controlId: ctrl.id, column: col.id })}
            >
              {value && (isDimText
                ? <span className="text-[9px] font-bold leading-none">{value}</span>
                : <IofSymbolIcon code={value} size={CELL - 4} />
              )}
            </td>
          )
        })}
        {showDist && (
          <td className="text-[10px] text-gray-400 pl-1.5 whitespace-nowrap">
            {legDist != null ? formatDistance(legDist) : ''}
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
    </>
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

  const grouped = column === 'G' ? groupLocationSymbols(filtered) : null

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

function groupLocationSymbols(syms: SymbolDef[]): Record<string, SymbolDef[]> {
  const groups: Record<string, SymbolDef[]> = {}
  for (const s of syms) {
    const base = s.code.replace(/[NESW]+$/, '').replace(/\.$/, '')
    const label = s.name.replace(/(North|South|East|West|North-east|North-west|South-east|South-west)\s*/i, '').trim()
    const group = label || base
    if (!groups[group]) groups[group] = []
    groups[group].push(s)
  }
  return groups
}
