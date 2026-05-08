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
import { columns, getColumnSymbols, columnFields } from '../lib/iofSymbols'
import { defaultControlLabel } from '../lib/courseUtils'
import { formatDistance } from '../lib/distance'
import type { IofColumn, SymbolDef } from '../lib/iofSymbols'
import type { Course, Control, CourseControl } from '../types'

const CELL = 32
const BORDER = 'border border-gray-300'

interface GridProps {
  course: Course
  onRemove?: (courseControlId: string) => void
  onReorder?: (reordered: CourseControl[]) => void
  legDistances?: number[]
  totalDistance?: number
}

interface RowData {
  cc: CourseControl
  ctrl: Control
  seq: number
  legDist?: number
}

export function ControlDescriptionGrid({ course, onRemove, onReorder, legDistances, totalDistance }: GridProps) {
  const project = useStore(s => s.project!)
  const updateControlDescription = useStore(s => s.updateControlDescription)
  const controlMap = new Map(project.controls.map(c => [c.id, c]))

  const [picker, setPicker] = useState<{ controlId: string; column: IofColumn } | null>(null)

  const showDist = legDistances != null && legDistances.length > 0

  let seq = 0
  let filteredIdx = 0
  const rows: RowData[] = []
  for (const cc of course.controls) {
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
    if (ctrl.type === 'control') seq++
    rows.push({
      cc,
      ctrl,
      seq: ctrl.type === 'control' ? seq : 0,
      legDist: filteredIdx > 0 ? legDistances?.[filteredIdx - 1] : undefined,
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
                {showDist && <th className="px-1 text-gray-400 font-normal text-[10px]" />}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={8} className={`${BORDER} text-center font-bold py-1 bg-gray-50`}>
                  {course.name}
                  {totalDistance != null && totalDistance > 0 && (
                    <span className="font-normal text-gray-500 ml-2">{formatDistance(totalDistance)}</span>
                  )}
                  {course.climb != null && course.climb > 0 && (
                    <span className="font-normal text-gray-500 ml-2">{course.climb} m</span>
                  )}
                </td>
                {showDist && <td />}
              </tr>

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8 + (showDist ? 1 : 0)} className="text-center text-xs text-gray-400 py-3">
                    Click controls on the map to add them.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <SortableDescRow
                    key={row.cc.id}
                    row={row}
                    showDist={showDist}
                    picker={picker}
                    setPicker={setPicker}
                    onRemove={onRemove}
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
  showDist,
  picker,
  setPicker,
  onRemove,
}: {
  row: RowData
  showDist: boolean
  picker: { controlId: string; column: IofColumn } | null
  setPicker: (p: { controlId: string; column: IofColumn } | null) => void
  onRemove?: (ccId: string) => void
}) {
  const { cc, ctrl, seq, legDist } = row
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

  return (
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

        return (
          <td
            key={col.id}
            className={`${BORDER} text-center cursor-pointer hover:bg-orange-50 ${isActive ? 'bg-orange-100' : ''}`}
            style={{ width: CELL, height: CELL, padding: 0 }}
            onClick={() => setPicker(isActive ? null : { controlId: ctrl.id, column: col.id })}
          >
            {value && <IofSymbolIcon code={value} size={CELL - 4} />}
          </td>
        )
      })}
      {showDist && (
        <td className="text-[10px] text-gray-400 pl-1.5 whitespace-nowrap">
          {legDist != null ? formatDistance(legDist) : ''}
        </td>
      )}
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

  const filtered = search
    ? symbols.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.code.includes(search))
    : symbols

  const grouped = column === 'G' ? groupLocationSymbols(filtered) : null

  return (
    <div className="mt-1 border border-gray-300 rounded-lg bg-white shadow-lg p-2 max-h-64 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
          autoFocus
        />
        {current && (
          <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700 shrink-0">
            Clear
          </button>
        )}
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
          Close
        </button>
      </div>

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
