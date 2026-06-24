import { useEffect, useRef, useState } from 'react'
import { Trash2, MapPin, Plus, Minus, Palette } from 'lucide-react'
import { useStore } from '../../store'
import { defaultControlLabel } from '../../lib/courseUtils'
import { AppearancePanel } from './AppearancePanel'
import type { Control } from '../../types'

function ControlCodeInput({ control }: { control: Control }) {
  const updateControlCode = useStore(s => s.updateControlCode)
  const [val, setVal] = useState(String(control.code))

  function commit() {
    const n = parseInt(val)
    if (!isNaN(n) && n > 0) {
      updateControlCode(control.id, n)
    }
    setVal(String(control.code))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={val}
      onClick={e => e.stopPropagation()}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-10 text-sm font-mono border rounded px-1 py-0.5 ml-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
    />
  )
}

function ControlLabelInput({ control }: { control: Control }) {
  const updateControlLabel = useStore(s => s.updateControlLabel)
  const [val, setVal] = useState(control.label ?? defaultControlLabel(control))

  function commit() {
    const trimmed = val.trim()
    updateControlLabel(control.id, trimmed)
    if (!trimmed) setVal(defaultControlLabel(control))
  }

  return (
    <input
      type="text"
      value={val}
      onClick={e => e.stopPropagation()}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-14 text-sm font-mono border rounded px-1 py-0.5 ml-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
    />
  )
}

function AppearancePopover({ open, onClose, anchorRef }: { open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLButtonElement | null> }) {
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
      className="w-full mt-2 md:absolute md:bottom-full md:mb-2 md:right-0 md:w-64 md:mt-0 bg-white rounded-xl shadow-xl border border-gray-200 z-50"
    >
      <div className="hidden md:flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-xs font-semibold text-gray-700">Appearance</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>
      <AppearancePanel />
    </div>
  )
}

export function ControlsPanel() {
  const project = useStore(s => s.project!)
  const selectedControlId = useStore(s => s.editor.selectedControlId)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const setSelectedControl = useStore(s => s.setSelectedControl)
  const deleteControl = useStore(s => s.deleteControl)
  const updateControlPoints = useStore(s => s.updateControlPoints)
  const addControlToCourse = useStore(s => s.addControlToCourse)
  const removeControlFromCourse = useStore(s => s.removeControlFromCourse)
  const requestCenterOnControl = useStore(s => s.requestCenterOnControl)

  const [showPoints, setShowPoints] = useState(() =>
    project.controls.some(c => c.points != null)
  )
  const [showAppearance, setShowAppearance] = useState(false)
  const appearanceBtnRef = useRef<HTMLButtonElement>(null)

  const controls = project.controls
  const selectedCourse = selectedCourseId
    ? project.courses.find(c => c.id === selectedCourseId) ?? null
    : null

  const courseUsageCount = new Map<string, number>()
  for (const course of project.courses) {
    const seen = new Set<string>()
    for (const cc of course.controls) {
      if (!seen.has(cc.controlId)) {
        seen.add(cc.controlId)
        courseUsageCount.set(cc.controlId, (courseUsageCount.get(cc.controlId) ?? 0) + 1)
      }
    }
  }

  const appearanceButton = (
    <div className="relative p-2 border-t border-gray-100">
      <button
        ref={appearanceBtnRef}
        onClick={() => setShowAppearance(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium transition-colors ${
          showAppearance
            ? 'bg-orange-100 text-orange-700'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
        }`}
      >
        <Palette size={13} />
        Appearance
      </button>
      <AppearancePopover open={showAppearance} onClose={() => setShowAppearance(false)} anchorRef={appearanceBtnRef} />
    </div>
  )

  if (controls.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 p-4 text-sm text-gray-400 text-center">
          No controls placed yet.<br />
          Use the toolbar to add start, finish, or controls.
        </div>
        {appearanceButton}
      </div>
    )
  }

  if (selectedCourse) {
    const countInCourse = (controlId: string) =>
      selectedCourse.controls.filter(cc => cc.controlId === controlId).length

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
          <div className="px-3 py-2 mb-1 text-xs text-gray-500 bg-orange-50 rounded-lg border border-orange-100">
            Click <Plus size={10} className="inline" /> to add a control to <strong>{selectedCourse.name}</strong>.
            Click <Minus size={10} className="inline" /> to remove the last instance.
            <span className="md:hidden"> Long-press a control on the map to remove it.</span>
          </div>
          {controls.map(control => {
            const count = countInCourse(control.id)
            return (
              <div
                key={control.id}
                onClick={() => requestCenterOnControl(control.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border cursor-pointer ${
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
                    onClick={e => { e.stopPropagation(); addControlToCourse(selectedCourse.id, control.id) }}
                    className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-orange-600 hover:bg-orange-100 transition-colors"
                    title="Add to course"
                  >
                    <Plus size={14} />
                  </button>
                  {count > 0 && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
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
        {appearanceButton}
      </div>
    )
  }

  const skipCodes = project.skipCodes ?? []
  const updateSkipCodes = useStore(s => s.updateSkipCodes)
  const reassignControlIds = useStore(s => s.reassignControlIds)
  const skipCodesKey = skipCodes.join(',')
  const [skipCodesText, setSkipCodesText] = useState(() => skipCodes.join(', '))

  useEffect(() => { setSkipCodesText(skipCodes.join(', ')) }, [skipCodesKey])

  function commitSkipCodes() {
    const codes = skipCodesText.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0)
    updateSkipCodes(codes)
    setSkipCodesText(codes.join(', '))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
        <div className="px-3 py-2 flex flex-col gap-1.5 border-b border-gray-100 mb-1">
          <label className="text-xs text-gray-500">
            Control IDs to skip
            <input
              type="text"
              value={skipCodesText}
              onChange={e => setSkipCodesText(e.target.value)}
              onBlur={commitSkipCodes}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder="e.g. 33, 40, 55"
              className="mt-1 w-full text-xs font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </label>
          <button
            onClick={reassignControlIds}
            className="text-xs text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded px-2 py-1 self-start transition-colors"
          >
            Reassign IDs
          </button>
        </div>
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
            onClick={() => {
              const selecting = control.id !== selectedControlId
              setSelectedControl(selecting ? control.id : null)
              if (selecting) requestCenterOnControl(control.id)
            }}
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

            <span className="text-xs uppercase font-medium text-gray-500 w-16 shrink-0">
              {control.type}
            </span>

            {control.type === 'control' ? (
              <ControlCodeInput key={`${control.id}-${control.code}`} control={control} />
            ) : (
              <ControlLabelInput key={`${control.id}-${control.label ?? ''}`} control={control} />
            )}

            {(courseUsageCount.get(control.id) ?? 0) > 0 && (
              <span className="text-xs text-gray-400 font-medium">
                {courseUsageCount.get(control.id)}x
              </span>
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
      {appearanceButton}
    </div>
  )
}
