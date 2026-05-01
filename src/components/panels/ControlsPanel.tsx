import { useState } from 'react'
import { Trash2, MapPin, Plus, Minus } from 'lucide-react'
import { useStore } from '../../store'
import { defaultControlLabel } from '../../lib/courseUtils'

export function ControlsPanel() {
  const project = useStore(s => s.project!)
  const selectedControlId = useStore(s => s.editor.selectedControlId)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const setSelectedControl = useStore(s => s.setSelectedControl)
  const deleteControl = useStore(s => s.deleteControl)
  const updateControlCode = useStore(s => s.updateControlCode)
  const updateControlLabel = useStore(s => s.updateControlLabel)
  const updateControlPoints = useStore(s => s.updateControlPoints)
  const addControlToCourse = useStore(s => s.addControlToCourse)
  const removeControlFromCourse = useStore(s => s.removeControlFromCourse)

  const [showPoints, setShowPoints] = useState(() =>
    project.controls.some(c => c.points != null)
  )

  const controls = project.controls
  const selectedCourse = selectedCourseId
    ? project.courses.find(c => c.id === selectedCourseId) ?? null
    : null

  if (controls.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        No controls placed yet.<br />
        Use the toolbar to add start, finish, or controls.
      </div>
    )
  }

  if (selectedCourse) {
    const countInCourse = (controlId: string) =>
      selectedCourse.controls.filter(cc => cc.controlId === controlId).length

    return (
      <div className="flex flex-col gap-1 p-2">
        <div className="px-3 py-2 mb-1 text-xs text-gray-500 bg-orange-50 rounded-lg border border-orange-100">
          Click <Plus size={10} className="inline" /> to add a control to <strong>{selectedCourse.name}</strong>.
          Click <Minus size={10} className="inline" /> to remove the last instance.
        </div>
        {controls.map(control => {
          const count = countInCourse(control.id)
          return (
            <div
              key={control.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border ${
                count > 0
                  ? 'bg-orange-50 border-orange-200'
                  : 'border-transparent hover:bg-gray-50'
              }`}
            >
              <MapPin size={14} className={
                control.type === 'start' ? 'text-green-600' :
                control.type === 'finish' ? 'text-red-600' : 'text-orange-600'
              } />
              <span className="text-xs uppercase font-medium text-gray-500 w-14 shrink-0">
                {control.type}
              </span>
              <span className="text-xs font-mono font-semibold text-gray-700">
                {control.label ?? defaultControlLabel(control)}
              </span>
              {count > 0 && (
                <span className="text-xs text-orange-600 font-medium">
                  ×{count}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => addControlToCourse(selectedCourse.id, control.id)}
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-orange-600 hover:bg-orange-100 transition-colors"
                  title="Add to course"
                >
                  <Plus size={14} />
                </button>
                {count > 0 && (
                  <button
                    onClick={() => {
                      for (let i = selectedCourse.controls.length - 1; i >= 0; i--) {
                        if (selectedCourse.controls[i].controlId === control.id) {
                          removeControlFromCourse(selectedCourse.id, selectedCourse.controls[i].id)
                          return
                        }
                      }
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove last instance from course"
                  >
                    <Minus size={14} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={showPoints}
          onChange={e => setShowPoints(e.target.checked)}
          className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
        />
        Points
      </label>
      {controls.map(control => (
        <div
          key={control.id}
          onClick={() => setSelectedControl(control.id === selectedControlId ? null : control.id)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
            control.id === selectedControlId
              ? 'bg-orange-100 border border-orange-300'
              : 'hover:bg-gray-50 border border-transparent'
          }`}
        >
          <MapPin size={14} className={
            control.type === 'start' ? 'text-green-600' :
            control.type === 'finish' ? 'text-red-600' : 'text-orange-600'
          } />

          <span className="text-xs uppercase font-medium text-gray-500 w-12">
            {control.type}
          </span>

          {control.type === 'control' ? (
            <input
              type="number"
              value={control.code}
              onClick={e => e.stopPropagation()}
              onChange={e => {
                const v = parseInt(e.target.value)
                if (!isNaN(v)) updateControlCode(control.id, v)
              }}
              className="w-16 text-sm font-mono border rounded px-1 py-0.5 ml-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          ) : (
            <input
              type="text"
              value={control.label ?? defaultControlLabel(control)}
              onClick={e => e.stopPropagation()}
              onChange={e => updateControlLabel(control.id, e.target.value)}
              className="w-16 text-sm font-mono border rounded px-1 py-0.5 ml-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          )}

          {showPoints && (
            <input
              type="number"
              value={control.points ?? ''}
              placeholder="pts"
              onClick={e => e.stopPropagation()}
              onChange={e => {
                const v = e.target.value === '' ? undefined : parseInt(e.target.value)
                updateControlPoints(control.id, v != null && !isNaN(v) ? v : undefined)
              }}
              className="w-14 text-xs font-mono border rounded px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          )}

          <button
            onClick={e => { e.stopPropagation(); deleteControl(control.id) }}
            className="ml-auto text-gray-300 hover:text-red-500 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
