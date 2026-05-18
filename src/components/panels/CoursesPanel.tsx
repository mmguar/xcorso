import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useStore } from '../../store'
import { computeCourseDistances } from '../../lib/distance'
import { ControlDescriptionGrid } from '../ControlDescriptionGrid'
import { useRenderTracker } from '../../lib/perf'
import { SPEC_LABELS } from '../../lib/symbolSpec'
import type { Course, EventSpec } from '../../types'

function CourseEditor({ course }: { course: Course }) {
  useRenderTracker('CourseEditor')
  const project = useStore(s => s.project!)
  const reorderCourseControls = useStore(s => s.reorderCourseControls)
  const removeControlFromCourse = useStore(s => s.removeControlFromCourse)
  const updateCourseName = useStore(s => s.updateCourseName)
  const updateCourseColor = useStore(s => s.updateCourseColor)
  const updateCourseClimb = useStore(s => s.updateCourseClimb)
  const updateCourseShowPoints = useStore(s => s.updateCourseShowPoints)
  const updateCourseTextDescriptions = useStore(s => s.updateCourseTextDescriptions)
  const updateCourseSpec = useStore(s => s.updateCourseSpec)
  const deleteCourse = useStore(s => s.deleteCourse)
  const addAllControlsToCourse = useStore(s => s.addAllControlsToCourse)
  const addControlsToCourseByCode = useStore(s => s.addControlsToCourseByCode)

  const distances = computeCourseDistances(course, project.controls, project.map)

  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(course.name)
  const [codesInput, setCodesInput] = useState('')

  return (
    <div className="border border-orange-200 rounded-xl overflow-hidden mb-2">
      {/* Course header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-orange-50">
        <input
          type="color"
          value={course.color}
          onChange={e => updateCourseColor(course.id, e.target.value)}
          className="w-5 h-5 rounded cursor-pointer border-0 p-0"
          title="Course color"
        />
        {editingName ? (
          <input
            autoFocus
            className="flex-1 text-sm font-semibold bg-white border rounded px-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={() => { updateCourseName(course.id, nameVal); setEditingName(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { updateCourseName(course.id, nameVal); setEditingName(false) } }}
          />
        ) : (
          <span className="flex-1 text-sm font-semibold cursor-pointer" onDoubleClick={() => setEditingName(true)}>
            {course.name}
          </span>
        )}
        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border">
          {course.type === 'score' ? 'Score-O' : 'Linear'}
        </span>
        <select
          value={course.spec ?? ''}
          onChange={e => updateCourseSpec(course.id, (e.target.value || undefined) as EventSpec | undefined)}
          className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-[5.5rem]"
          title="Course specification (inherits from project if blank)"
        >
          <option value="">Project default</option>
          {(Object.entries(SPEC_LABELS) as [EventSpec, string][]).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <button
          onClick={() => deleteCourse(course.id)}
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Course toggles */}
      <div className="flex flex-col border-b border-gray-100">
        {project.controls.some(c => c.points != null) && (
          <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={course.showPoints ?? false}
              onChange={e => updateCourseShowPoints(course.id, e.target.checked)}
              className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
            />
            Show points on map
          </label>
        )}
        <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={course.textDescriptions ?? false}
            onChange={e => updateCourseTextDescriptions(course.id, e.target.checked)}
            className="rounded border-gray-300 text-orange-600 focus:ring-orange-400"
          />
          Text descriptions
        </label>
      </div>

      {/* Add controls toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100">
        <input
          type="text"
          value={codesInput}
          onChange={e => setCodesInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && codesInput.trim()) {
              const codes = codesInput.split(/[\s,;-]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n))
              if (codes.length > 0) addControlsToCourseByCode(course.id, codes)
              setCodesInput('')
            }
          }}
          placeholder="Type codes: 31,32,33"
          className="flex-1 min-w-0 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
        <button
          onClick={() => addAllControlsToCourse(course.id)}
          className="text-xs text-orange-600 hover:text-orange-800 font-medium whitespace-nowrap transition-colors"
          title="Add all controls sorted by code"
        >
          + All
        </button>
      </div>

      {/* Control description grid */}
      <div className="px-2 py-1.5">
        <ControlDescriptionGrid
          course={course}
          onRemove={(ccId) => removeControlFromCourse(course.id, ccId)}
          onReorder={(reordered) => reorderCourseControls(course.id, reordered)}
        />
      </div>

      {/* Climb input */}
      {distances.total > 0 && (
        <div className="flex items-center px-3 py-1.5 bg-gray-50 border-t border-gray-100">
          <label className="flex items-center gap-1 text-xs text-gray-500">
            <span>Climb</span>
            <input
              type="number"
              min={0}
              value={course.climb ?? ''}
              placeholder="m"
              onChange={e => {
                const v = e.target.value === '' ? undefined : parseInt(e.target.value)
                updateCourseClimb(course.id, v != null && !isNaN(v) && v >= 0 ? v : undefined)
              }}
              className="w-14 text-xs border rounded px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            <span className="text-gray-400">m</span>
          </label>
        </div>
      )}
    </div>
  )
}

function ClassesSection() {
  const project = useStore(s => s.project!)
  const addClass = useStore(s => s.addClass)
  const deleteClass = useStore(s => s.deleteClass)
  const updateClassName = useStore(s => s.updateClassName)
  const updateClassCourse = useStore(s => s.updateClassCourse)
  const [showClasses, setShowClasses] = useState(project.classes.length > 0)

  if (project.courses.length === 0) return null

  if (!showClasses) {
    return (
      <button
        onClick={() => setShowClasses(true)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600 px-3 py-2 transition-colors"
      >
        <Plus size={12} /> Add race classes
      </button>
    )
  }

  return (
    <div className="border-t border-gray-200 pt-2">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Classes</span>
        <button
          onClick={() => addClass(`Class ${project.classes.length + 1}`, project.courses[0].id)}
          className="text-xs text-orange-600 hover:text-orange-800 font-medium transition-colors"
        >
          + Add
        </button>
      </div>
      <div className="flex flex-col gap-1 px-2 pb-2">
        {project.classes.length === 0 ? (
          <div className="text-xs text-gray-400 px-1 py-1">
            No classes yet. Click "+ Add" above.
          </div>
        ) : (
          project.classes.map(rc => (
            <div key={rc.id} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1.5">
              <input
                type="text"
                value={rc.name}
                onChange={e => updateClassName(rc.id, e.target.value)}
                className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                placeholder="Class name"
              />
              <select
                value={rc.courseId}
                onChange={e => updateClassCourse(rc.id, e.target.value)}
                className="text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-[7rem]"
              >
                {project.courses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={() => deleteClass(rc.id)}
                className="text-gray-300 hover:text-red-500 transition-colors shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function CoursesPanel() {
  useRenderTracker('CoursesPanel')
  const project = useStore(s => s.project!)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const addCourse = useStore(s => s.addCourse)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const isAllControls = selectedCourseId === null

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-2 border-b border-gray-100">
        <button
          onClick={() => { const c = addCourse(`Course ${project.courses.length + 1}`); setExpanded(p => new Set([...p, c.id])) }}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-orange-600 text-white rounded-lg px-3 py-1.5 hover:bg-orange-700 transition-colors"
        >
          <Plus size={13} /> Linear course
        </button>
        <button
          onClick={() => { const c = addCourse(`Score ${project.courses.length + 1}`, 'score'); setExpanded(p => new Set([...p, c.id])) }}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-orange-500 text-white rounded-lg px-3 py-1.5 hover:bg-orange-600 transition-colors"
        >
          <Plus size={13} /> Score-O
        </button>
      </div>

      <div className="flex-1 overflow-y-auto panel-scroll p-2">
        {/* All controls view */}
        {project.controls.length > 0 && (
          <div
            onClick={() => setSelectedCourse(null)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer mb-1 transition-colors ${
              isAllControls
                ? 'bg-orange-100'
                : 'hover:bg-gray-50'
            }`}
          >
            <div className="w-3 h-3 rounded-full bg-orange-600" />
            <span className="text-sm font-medium flex-1">All controls</span>
            <span className="text-xs text-gray-400">{project.controls.length} controls</span>
          </div>
        )}

        {project.courses.length === 0 && project.controls.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-6">
            No courses yet. Create one above.
          </div>
        ) : (
          project.courses.map(course => (
            <div key={course.id}>
              {/* Collapsed header */}
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors ${
                  course.id === selectedCourseId
                    ? 'bg-orange-100'
                    : 'hover:bg-gray-50'
                }`}
              >
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setExpanded(prev => {
                      const next = new Set(prev)
                      if (next.has(course.id)) next.delete(course.id); else next.add(course.id)
                      return next
                    })
                  }}
                  className="text-gray-400 hover:text-orange-600 transition-colors shrink-0"
                >
                  {expanded.has(course.id)
                    ? <ChevronDown size={14} />
                    : <ChevronRight size={14} />}
                </button>
                <div
                  onClick={() => {
                    setSelectedCourse(course.id === selectedCourseId ? null : course.id)
                  }}
                  className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: course.color }} />
                  <span className="text-sm font-medium flex-1 truncate">{course.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{course.controls.length} controls</span>
                </div>
              </div>
              {expanded.has(course.id) && <CourseEditor course={course} />}
            </div>
          ))
        )}

        <ClassesSection />
      </div>
    </div>
  )
}
