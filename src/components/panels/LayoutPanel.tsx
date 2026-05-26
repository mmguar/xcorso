import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store'
import { PAGE_SIZES } from '../../lib/pdfExport'
import { defaultControlLabel } from '../../lib/courseUtils'
import type { PageSizeKey, Control } from '../../types'

const PAGE_SIZE_KEYS: PageSizeKey[] = ['a4', 'a3', 'letter', 'legal']

function ScaleInput({ courseId, printScale }: { courseId: string; printScale: number }) {
  const [value, setValue] = useState(String(printScale))
  const prevScale = useRef(printScale)
  if (printScale !== prevScale.current) {
    prevScale.current = printScale
    setValue(String(printScale))
  }
  const updateCourseLayout = useStore(s => s.updateCourseLayout)
  function commit() {
    const v = parseInt(value)
    if (v > 0 && isFinite(v) && v !== printScale) {
      updateCourseLayout(courseId, { printScale: v })
    } else {
      setValue(String(printScale))
    }
  }
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className="text-xs text-gray-500">1:</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-20 px-2 py-1 text-xs border border-gray-200 rounded focus:border-orange-400 focus:outline-none"
      />
    </div>
  )
}

export function LayoutPanel() {
  const courses = useStore(s => s.project?.courses ?? [])
  const controls = useStore(s => s.project?.controls ?? [])
  const layoutCourseId = useStore(s => s.editor.layoutCourseId)
  const enterLayoutMode = useStore(s => s.enterLayoutMode)
  const exitLayoutMode = useStore(s => s.exitLayoutMode)
  const updateCourseLayout = useStore(s => s.updateCourseLayout)
  const updateLayoutElement = useStore(s => s.updateLayoutElement)
  const addClueSheetBreak = useStore(s => s.addClueSheetBreak)
  const removeClueSheetBreak = useStore(s => s.removeClueSheetBreak)

  if (courses.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        Create a course first to configure its print layout.
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1">
      {courses.map(course => {
        const isActive = course.id === layoutCourseId
        const layout = course.layout

        return (
          <div key={course.id} className="rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => isActive ? exitLayoutMode() : enterLayoutMode(course.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                isActive ? 'bg-orange-50' : 'hover:bg-gray-50'
              }`}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: course.color }}
              />
              <span className="text-sm font-medium text-gray-800 flex-1 truncate">
                {course.name}
              </span>
              {layout ? (
                <span className="text-[10px] text-gray-400 tabular-nums">
                  {PAGE_SIZES[layout.pageSize]?.label ?? 'A4'} · 1:{layout.printScale.toLocaleString()}
                </span>
              ) : (
                <span className="text-[10px] text-gray-300">No layout</span>
              )}
            </button>

            {isActive && layout && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100 bg-orange-50/50">
                {/* Page size */}
                <div>
                  <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Page size</label>
                  <div className="flex gap-1 mt-1">
                    {PAGE_SIZE_KEYS.map(key => (
                      <button
                        key={key}
                        onClick={() => updateCourseLayout(course.id, { pageSize: key })}
                        className={`px-2 py-1 text-[11px] rounded transition-colors ${
                          layout.pageSize === key
                            ? 'bg-orange-600 text-white'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                        }`}
                      >
                        {PAGE_SIZES[key].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation */}
                <div>
                  <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Orientation</label>
                  <div className="flex gap-1 mt-1">
                    {(['portrait', 'landscape'] as const).map(o => (
                      <button
                        key={o}
                        onClick={() => updateCourseLayout(course.id, { orientation: o })}
                        className={`px-2 py-1 text-[11px] rounded capitalize transition-colors ${
                          layout.orientation === o
                            ? 'bg-orange-600 text-white'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-orange-300'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Print scale */}
                <div>
                  <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Print scale</label>
                  <ScaleInput courseId={course.id} printScale={layout.printScale} />
                </div>

                {/* Element visibility */}
                <div>
                  <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Elements</label>
                  <div className="space-y-1.5 mt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={layout.clueSheet.visible}
                        onChange={e => updateLayoutElement(course.id, 'clueSheet', { visible: e.target.checked })}
                        className="accent-orange-600"
                      />
                      <span className="text-xs text-gray-600">Clue sheet</span>
                    </label>
                  </div>
                  {layout.clueSheet.visible && (() => {
                    const controlMap = new Map(controls.map((c: Control) => [c.id, c]))
                    const resolved = course.controls
                      .map(cc => controlMap.get(cc.controlId))
                      .filter((c): c is Control => c != null)
                    if (resolved.length < 3) return null

                    const breaks = layout.clueSheetBreaks ?? []
                    const breakSet = new Set(breaks)

                    const eligible = resolved
                      .map((ctrl, i) => ({ ctrl, i }))
                      .filter(({ i }) => i > 0 && i < resolved.length - 1 && !breakSet.has(i))

                    const partCount = breaks.length + 1
                    const boundaries = [0, ...breaks, resolved.length]

                    return (
                      <div className="mt-2 ml-5 space-y-1.5">
                        {breaks.length > 0 && (
                          <div className="space-y-1">
                            {Array.from({ length: partCount }, (_, p) => {
                              const start = boundaries[p]
                              const end = boundaries[p + 1] - 1
                              const startLabel = defaultControlLabel(resolved[start])
                              const endLabel = defaultControlLabel(resolved[end])
                              return (
                                <div key={p} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                                  <span className="tabular-nums">Part {p + 1}:</span>
                                  <span className="text-gray-400">{startLabel} &rarr; {endLabel}</span>
                                  {p > 0 && (
                                    <button
                                      onClick={() => removeClueSheetBreak(course.id, p - 1)}
                                      className="ml-auto w-4 h-4 rounded-full bg-gray-200 hover:bg-red-400 text-gray-500 hover:text-white flex items-center justify-center"
                                    >
                                      <X size={8} />
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {eligible.length > 0 && (
                          <select
                            value=""
                            onChange={e => {
                              const idx = parseInt(e.target.value)
                              if (!isNaN(idx)) addClueSheetBreak(course.id, idx)
                            }}
                            className="text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-500 focus:outline-none focus:border-orange-400 w-full"
                          >
                            <option value="">Split after...</option>
                            {eligible.map(({ ctrl, i }) => (
                              <option key={i} value={i}>
                                {defaultControlLabel(ctrl)} ({ctrl.type === 'start' ? 'start' : `#${resolved.slice(0, i + 1).filter(c => c.type === 'control').length}`})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* Reset */}
                <button
                  onClick={() => {
                    const project = useStore.getState().project
                    if (!project) return
                    const controlMap = new Map(project.controls.map(c => [c.id, c]))
                    const positions = course.controls
                      .map(cc => controlMap.get(cc.controlId))
                      .filter(Boolean)
                      .map(c => c!.position)
                    if (positions.length > 0) {
                      const xs = positions.map(p => p.x)
                      const ys = positions.map(p => p.y)
                      updateCourseLayout(course.id, {
                        mapCenter: {
                          x: (Math.min(...xs) + Math.max(...xs)) / 2,
                          y: (Math.min(...ys) + Math.max(...ys)) / 2,
                        },
                      })
                    }
                  }}
                  className="text-[11px] text-gray-400 hover:text-orange-600 transition-colors"
                >
                  Reset to course center
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
