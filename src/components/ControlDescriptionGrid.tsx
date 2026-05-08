import { useState } from 'react'
import { useStore } from '../store'
import { IofSymbolIcon, SymbolSvg } from './IofSymbolIcon'
import { columns, getColumnSymbols, columnFields } from '../lib/iofSymbols'
import { defaultControlLabel } from '../lib/courseUtils'
import type { IofColumn, SymbolDef } from '../lib/iofSymbols'
import type { Course, Control } from '../types'

const CELL = 32
const BORDER = 'border border-gray-300'

interface GridProps {
  course: Course
}

export function ControlDescriptionGrid({ course }: GridProps) {
  const project = useStore(s => s.project!)
  const updateControlDescription = useStore(s => s.updateControlDescription)
  const controlMap = new Map(project.controls.map(c => [c.id, c]))

  const [picker, setPicker] = useState<{ controlId: string; column: IofColumn } | null>(null)

  const resolvedControls = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c !== undefined)

  let seq = 0

  return (
    <div className="overflow-x-auto">
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
          </tr>
        </thead>
        <tbody>
          {/* Course header row */}
          <tr>
            <td colSpan={8} className={`${BORDER} text-center font-bold py-1 bg-gray-50`}>
              {course.name}
              {project.map.scale > 0 && (
                <span className="font-normal text-gray-500 ml-2">1:{project.map.scale}</span>
              )}
              {course.climb != null && course.climb > 0 && (
                <span className="font-normal text-gray-500 ml-2">{course.climb} m↑</span>
              )}
            </td>
          </tr>

          {resolvedControls.map((ctrl) => {
            if (ctrl.type === 'control') seq++
            const seqLabel = ctrl.type === 'start' ? '△'
              : ctrl.type === 'finish' ? '◎'
              : String(seq)
            const desc = ctrl.description ?? {}

            return (
              <tr key={ctrl.id}>
                {/* Column A: sequence */}
                <td className={`${BORDER} text-center font-bold`} style={{ width: CELL, height: CELL }}>
                  {seqLabel}
                </td>
                {/* Column B: code */}
                <td className={`${BORDER} text-center font-mono`} style={{ height: CELL }}>
                  {defaultControlLabel(ctrl)}
                </td>
                {/* Columns C-H */}
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
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Symbol picker */}
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

  // Group column G symbols by base type
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
