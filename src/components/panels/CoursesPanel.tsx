import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil, Copy, FileText } from 'lucide-react'
import { useStore } from '../../store'
import { computeCourseDistances, formatDistance, resolveCourseLength } from '../../lib/distance'
import { ControlDescriptionGrid } from '../ControlDescriptionGrid'
import { useRenderTracker } from '../../lib/perf'
import { SPEC_LABELS } from '../../lib/symbolSpec'
import type { Course, CourseControl, EventSpec, FinishType } from '../../types'

const IOF_PURPLE = '#a626ff'

function ClueSheetColorPicker({ label, value, onChange }: {
  label: string
  value: string | undefined
  onChange: (color: string | undefined) => void
}) {
  const current = value || '#000000'
  const isBlack = !value || value === '#000000'
  const isPurple = value === IOF_PURPLE
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600">
      <span className="w-16 shrink-0">{label}</span>
      <button
        onClick={() => onChange(undefined)}
        className={`w-5 h-5 rounded border transition-all shrink-0 ${isBlack ? 'ring-2 ring-orange-500 ring-offset-1' : 'border-gray-300'}`}
        style={{ background: '#000000' }}
        title="Black"
      />
      <button
        onClick={() => onChange(IOF_PURPLE)}
        className={`w-5 h-5 rounded border transition-all shrink-0 ${isPurple ? 'ring-2 ring-orange-500 ring-offset-1' : 'border-gray-300'}`}
        style={{ background: IOF_PURPLE }}
        title="IOF purple"
      />
      <input
        type="color"
        value={current}
        onChange={e => onChange(e.target.value === '#000000' ? undefined : e.target.value)}
        className="w-5 h-5 rounded cursor-pointer border-0 p-0 shrink-0"
        title="Custom color"
      />
      {!isBlack && (
        <span className="text-[10px] text-gray-400 truncate">{current}</span>
      )}
    </div>
  )
}

function ClueSheetOptionsPanel() {
  const clueSheetFontSize = useStore(s => s.project!.clueSheetFontSize)
  const clueSheetHideSubmapRestart = useStore(s => s.project!.clueSheetHideSubmapRestart)
  const clueSheetSplitSubmaps = useStore(s => s.project!.clueSheetSplitSubmaps)
  const overlayColor = useStore(s => s.project!.clueSheetOverlayColor)
  const separateColor = useStore(s => s.project!.clueSheetSeparateColor)
  const updateClueSheetFontSize = useStore(s => s.updateClueSheetFontSize)
  const updateClueSheetHideSubmapRestart = useStore(s => s.updateClueSheetHideSubmapRestart)
  const updateClueSheetSplitSubmaps = useStore(s => s.updateClueSheetSplitSubmaps)
  const updateOverlayColor = useStore(s => s.updateClueSheetOverlayColor)
  const updateSeparateColor = useStore(s => s.updateClueSheetSeparateColor)

  return (
    <div className="px-3 py-2 flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="w-16 shrink-0">Font size</span>
        <select
          value={clueSheetFontSize ?? 7}
          onChange={e => updateClueSheetFontSize(Number(e.target.value))}
          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
        >
          <option value={5}>Small</option>
          <option value={7}>Medium</option>
          <option value={10}>Large</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-600 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={clueSheetHideSubmapRestart ?? false}
          onChange={e => updateClueSheetHideSubmapRestart(e.target.checked)}
          className="accent-orange-600"
        />
        Hide first control on submaps
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-600 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={clueSheetSplitSubmaps ?? false}
          onChange={e => updateClueSheetSplitSubmaps(e.target.checked)}
          className="accent-orange-600"
        />
        Split clue sheets for submaps
      </label>
      <ClueSheetColorPicker label="On-map" value={overlayColor} onChange={updateOverlayColor} />
      <ClueSheetColorPicker label="Separate" value={separateColor} onChange={updateSeparateColor} />
    </div>
  )
}

function ClueSheetPopover({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLButtonElement | null> }) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', onClick)
    return () => document.removeEventListener('pointerdown', onClick)
  }, [open, onClose, anchorRef])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full mb-2 right-0 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50"
    >
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-xs font-semibold text-gray-700">Clue sheet options</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>
      <ClueSheetOptionsPanel />
    </div>
  )
}

function CourseEditor({ course }: { course: Course }) {
  useRenderTracker('CourseEditor')
  // Narrow selectors: subscribing to the whole project would re-render this
  // editor (and the heavy ControlDescriptionGrid) on every store mutation,
  // including per-pointermove drag updates elsewhere on the canvas.
  const controls = useStore(s => s.project!.controls)
  const map = useStore(s => s.project!.map)
  const measuredLegs = useStore(s => s.project!.measuredLegs)
  const reorderCourseControls = useStore(s => s.reorderCourseControls)
  const removeControlFromCourse = useStore(s => s.removeControlFromCourse)
  const updateCourseClimb = useStore(s => s.updateCourseClimb)
  const setManualCourseLength = useStore(s => s.setManualCourseLength)
  const enterMeasureMode = useStore(s => s.enterMeasureMode)
  const updateCourseFinishType = useStore(s => s.updateCourseFinishType)
  const updateCourseShowPoints = useStore(s => s.updateCourseShowPoints)
  const updateCourseTextDescriptions = useStore(s => s.updateCourseTextDescriptions)
  const updateCourseSpec = useStore(s => s.updateCourseSpec)
  const deleteCourse = useStore(s => s.deleteCourse)
  const duplicateCourse = useStore(s => s.duplicateCourse)
  const addAllControlsToCourse = useStore(s => s.addAllControlsToCourse)
  const addControlsToCourseByCode = useStore(s => s.addControlsToCourseByCode)

  const distances = useMemo(
    () => computeCourseDistances(course, controls, map, measuredLegs),
    [course, controls, map, measuredLegs],
  )
  const computedTotal = distances.total
  const resolvedTotal = resolveCourseLength(course, distances)

  const handleRemove = useCallback((ccId: string) => removeControlFromCourse(course.id, ccId), [removeControlFromCourse, course.id])
  const handleReorder = useCallback((reordered: CourseControl[]) => reorderCourseControls(course.id, reordered), [reorderCourseControls, course.id])

  const [codesInput, setCodesInput] = useState('')

  return (
    <div className="border border-orange-200 rounded-xl rounded-t-none border-t-0 overflow-hidden mb-2">
      {/* Course metadata toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
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
        <div className="flex-1" />
        <button
          onClick={() => duplicateCourse(course.id)}
          className="text-gray-300 hover:text-orange-600 transition-colors"
          title="Duplicate course"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={() => deleteCourse(course.id)}
          className="text-gray-300 hover:text-red-500 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Course toggles */}
      <div className="flex flex-col border-b border-gray-100">
        {controls.some(c => c.points != null) && (
          <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={course.showPoints ?? false}
              onChange={e => updateCourseShowPoints(course.id, e.target.checked)}
              className="accent-orange-600"
            />
            Show points on map
          </label>
        )}
        <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={course.textDescriptions ?? false}
            onChange={e => updateCourseTextDescriptions(course.id, e.target.checked)}
            className="accent-orange-600"
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
              const codes = codesInput.split(/[\s,;-]+/).map(s => s.trim()).filter(Boolean)
              if (codes.length > 0) addControlsToCourseByCode(course.id, codes)
              setCodesInput('')
            }
          }}
          placeholder="Type codes: 31,32,S1"
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
          onRemove={handleRemove}
          onReorder={handleReorder}
        />
      </div>

      {/* Variations */}
      <VariationsSection course={course} />

      {/* Length: computed/measured total + manual override + measure mode */}
      {computedTotal > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-t border-gray-100">
          <span className="text-xs text-gray-500">Length</span>
          <input
            type="text"
            inputMode="numeric"
            value={course.manualLength ?? ''}
            placeholder={String(Math.round(computedTotal))}
            title={course.manualLength != null ? 'Manual override — clear to use measured/computed length' : 'Computed length (type to override)'}
            onChange={e => {
              const v = e.target.value === '' ? undefined : parseInt(e.target.value)
              setManualCourseLength(course.id, v != null && !isNaN(v) && v >= 0 ? v : undefined)
            }}
            className={`w-16 text-xs border rounded px-1 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-orange-400 ${course.manualLength != null ? 'border-orange-400 text-orange-700 font-medium' : ''}`}
          />
          <span className="text-gray-400 text-xs">m</span>
          <span className="text-[10px] text-gray-400">({formatDistance(resolvedTotal)})</span>
          <div className="flex-1" />
          <button
            onClick={() => enterMeasureMode(course.id)}
            className="text-[11px] font-medium text-orange-600 hover:text-orange-800 transition-colors"
            title="Trace the real route per leg to measure actual distance"
          >
            Measure…
          </button>
        </div>
      )}

      {/* Climb & finish type */}
      {(distances.total > 0 || course.controls.some(cc => controls.find(c => c.id === cc.controlId)?.type === 'finish')) && (
        <div className="flex items-center gap-4 px-3 py-1.5 bg-gray-50 border-t border-gray-100">
          {distances.total > 0 && (
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <span>Climb</span>
              <input
                type="text"
                inputMode="numeric"
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
          )}
          {course.controls.some(cc => controls.find(c => c.id === cc.controlId)?.type === 'finish') && (
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <span>Finish</span>
              <select
                value={course.finishType ?? 'navigate'}
                onChange={e => updateCourseFinishType(course.id, e.target.value as FinishType)}
                className="text-xs border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
              >
                <option value="navigate">Navigate</option>
                <option value="funnel">Funnel</option>
                <option value="taped">Taped</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  )
}

function VariationsSection({ course }: { course: Course }) {
  const variations = course.variations
  const selectedVariationId = useStore(s => s.editor.selectedVariationId)
  const setSelectedVariation = useStore(s => s.setSelectedVariation)

  if (!variations || variations.length === 0) return null

  return (
    <div className="px-3 py-1.5 border-t border-gray-100">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Variations</div>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedVariation(null)}
          className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
            selectedVariationId === null
              ? 'bg-orange-100 border-orange-400 text-orange-700'
              : 'border-gray-200 text-gray-500 hover:border-orange-300'
          }`}
        >
          Master
        </button>
        {variations.map(v => (
          <button
            key={v.id}
            onClick={() => setSelectedVariation(v.id === selectedVariationId ? null : v.id)}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
              v.id === selectedVariationId
                ? 'bg-orange-100 border-orange-400 text-orange-700'
                : 'border-gray-200 text-gray-500 hover:border-orange-300'
            }`}
          >
            {v.name}
          </button>
        ))}
      </div>
    </div>
  )
}

function ClassesSection() {
  const classes = useStore(s => s.project!.classes)
  const courses = useStore(s => s.project!.courses)
  const addClass = useStore(s => s.addClass)
  const deleteClass = useStore(s => s.deleteClass)
  const updateClassName = useStore(s => s.updateClassName)
  const updateClassCourse = useStore(s => s.updateClassCourse)
  const [showClasses, setShowClasses] = useState(classes.length > 0)

  if (courses.length === 0) return null

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
          onClick={() => addClass(`Class ${classes.length + 1}`, courses[0].id)}
          className="text-xs text-orange-600 hover:text-orange-800 font-medium transition-colors"
        >
          + Add
        </button>
      </div>
      <div className="flex flex-col gap-1 px-2 pb-2">
        {classes.length === 0 ? (
          <div className="text-xs text-gray-400 px-1 py-1">
            No classes yet. Click "+ Add" above.
          </div>
        ) : (
          classes.map(rc => (
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
                {courses.map(c => (
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

function CourseRow({ course, isSelected, isExpanded, onToggleExpand, onToggleSelect }: {
  course: Course
  isSelected: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleSelect: () => void
}) {
  const updateCourseName = useStore(s => s.updateCourseName)
  const updateCourseColor = useStore(s => s.updateCourseColor)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(course.name)

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 transition-colors ${
          isSelected
            ? 'bg-orange-100'
            : 'hover:bg-gray-50'
        } ${isExpanded ? 'rounded-t-lg border border-b-0 border-orange-200' : 'rounded-lg mb-1'}`}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggleExpand() }}
          className="text-gray-400 hover:text-orange-600 transition-colors shrink-0"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {isExpanded ? (
          <input
            type="color"
            value={course.color}
            onChange={e => updateCourseColor(course.id, e.target.value)}
            className="w-4 h-4 rounded cursor-pointer border-0 p-0 shrink-0"
            title="Course color"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: course.color }} />
        )}
        <div
          onClick={onToggleSelect}
          className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
        >
          {editingName ? (
            <input
              autoFocus
              className="flex-1 text-sm font-semibold bg-white border rounded px-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
              value={nameVal}
              onClick={e => e.stopPropagation()}
              onChange={e => setNameVal(e.target.value)}
              onBlur={() => { updateCourseName(course.id, nameVal); setEditingName(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { updateCourseName(course.id, nameVal); setEditingName(false) } }}
            />
          ) : (
            <span
              className="edit-icon-group text-sm font-medium flex-1 truncate flex items-center gap-1"
              onDoubleClick={e => { e.stopPropagation(); setNameVal(course.name); setEditingName(true) }}
            >
              {course.name}
              <Pencil
                size={11}
                className="edit-icon shrink-0 cursor-pointer"
                onClick={e => { e.stopPropagation(); setNameVal(course.name); setEditingName(true) }}
              />
            </span>
          )}
          <span className="text-xs text-gray-400 shrink-0">{Math.max(0, course.controls.length-2)} ctrls</span>
        </div>
      </div>
      {isExpanded && <CourseEditor course={course} />}
    </div>
  )
}

export function CoursesPanel() {
  useRenderTracker('CoursesPanel')
  const courses = useStore(s => s.project!.courses)
  const controlCount = useStore(s => s.project!.controls.length)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const addCourse = useStore(s => s.addCourse)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showClueOpts, setShowClueOpts] = useState(false)
  const clueOptsBtnRef = useRef<HTMLButtonElement>(null)
  const isAllControls = selectedCourseId === null

  useEffect(() => {
    if (selectedCourseId) {
      setExpanded(prev => {
        if (prev.has(selectedCourseId)) return prev
        return new Set([...prev, selectedCourseId])
      })
    }
  }, [selectedCourseId])

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-2 border-b border-gray-100">
        <button
          onClick={() => { const c = addCourse(`Course ${courses.length + 1}`); setExpanded(p => new Set([...p, c.id])); setSelectedCourse(c.id) }}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-orange-600 text-white rounded-lg px-3 py-1.5 hover:bg-orange-700 transition-colors"
        >
          <Plus size={13} /> Linear course
        </button>
        <button
          onClick={() => { const c = addCourse(`Score ${courses.length + 1}`, 'score'); setExpanded(p => new Set([...p, c.id])); setSelectedCourse(c.id) }}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-orange-500 text-white rounded-lg px-3 py-1.5 hover:bg-orange-600 transition-colors"
        >
          <Plus size={13} /> Score-O
        </button>
      </div>

      <div className="flex-1 overflow-y-auto panel-scroll p-2">
        {/* All controls view */}
        {controlCount > 0 && (
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
            <span className="text-xs text-gray-400">{controlCount} controls</span>
          </div>
        )}

        {courses.length === 0 && controlCount === 0 ? (
          <div className="text-sm text-gray-400 text-center py-6">
            No courses yet. Create one above.
          </div>
        ) : (
          courses.map(course => (
            <CourseRow
              key={course.id}
              course={course}
              isSelected={course.id === selectedCourseId}
              isExpanded={expanded.has(course.id)}
              onToggleExpand={() => {
                const wasExpanded = expanded.has(course.id)
                setExpanded(prev => {
                  const next = new Set(prev)
                  if (wasExpanded) next.delete(course.id); else next.add(course.id)
                  return next
                })
                if (wasExpanded) setSelectedCourse(null)
                else setSelectedCourse(course.id)
              }}
              onToggleSelect={() => {
                if (course.id === selectedCourseId) {
                  setSelectedCourse(null)
                } else {
                  setSelectedCourse(course.id)
                  setExpanded(prev => new Set([...prev, course.id]))
                }
              }}
            />
          ))
        )}

        <ClassesSection />
      </div>

      <div className="relative p-2 border-t border-gray-100">
        <button
          ref={clueOptsBtnRef}
          onClick={() => setShowClueOpts(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium transition-colors ${
            showClueOpts
              ? 'bg-orange-100 text-orange-700'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <FileText size={13} />
          Clue sheet options
        </button>
        <ClueSheetPopover open={showClueOpts} onClose={() => setShowClueOpts(false)} anchorRef={clueOptsBtnRef} />
      </div>
    </div>
  )
}
