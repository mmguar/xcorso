/**
 * Floating toolbar — pill on desktop, bottom bar on mobile.
 * Shows tool selection + undo/redo in normal mode.
 * Shows course-building banner when a course is selected.
 */

import { useEffect } from 'react'
import {
  MousePointer2, Triangle, Target, Slash, X, Ruler, Undo2, Redo2, Circle, Ban, Trash2,
} from 'lucide-react'
import { useStore } from '../../store'
import type { ActiveTool } from '../../types'

const tools: { tool: ActiveTool; label: string; shortcut?: string }[] = [
  { tool: 'select', label: 'Select / Pan', shortcut: 'V' },
  { tool: 'place-start', label: 'Place Start', shortcut: 'S' },
  { tool: 'place-finish', label: 'Place Finish', shortcut: 'F' },
  { tool: 'place-control', label: 'Place Control', shortcut: 'C' },
  { tool: 'forbidden-route', label: 'Forbidden Route (double-click to finish)', shortcut: 'B' },
  { tool: 'crossing-point', label: 'Crossing Point', shortcut: 'P' },
  { tool: 'out-of-bounds', label: 'Out-of-bounds Area (double-click to finish)', shortcut: 'O' },
  { tool: 'delete', label: 'Delete (click control or annotation)', shortcut: 'D' },
  { tool: 'measure-scale', label: 'Measure Scale', shortcut: 'M' },
]

const toolIcons: Record<ActiveTool, (size: number) => React.ReactNode> = {
  'select': s => <MousePointer2 size={s} />,
  'place-start': s => <Triangle size={s} />,
  'place-finish': s => <Target size={s} />,
  'place-control': s => <Circle size={s} />,
  'forbidden-route': s => <Slash size={s} />,
  'crossing-point': s => <X size={s} />,
  'out-of-bounds': s => <Ban size={s} />,
  'delete': s => <Trash2 size={s} />,
  'measure-scale': s => <Ruler size={s} />,
}

export function Toolbar() {
  const activeTool = useStore(s => s.editor.activeTool)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const setActiveTool = useStore(s => s.setActiveTool)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const undo = useStore(s => s.undo)
  const redo = useStore(s => s.redo)
  const canUndo = useStore(s => s.undoStack.length > 0)
  const canRedo = useStore(s => s.redoStack.length > 0)

  const selectedCourse = useStore(s =>
    s.project?.courses.find(c => c.id === s.editor.selectedCourseId) ?? null
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useStore.getState().editor.selectedControlId
        if (sel) { e.preventDefault(); useStore.getState().deleteControl(sel); return }
      }
      if (selectedCourseId) {
        if (e.key === 'Escape') setSelectedCourse(null)
        return
      }
      const t = tools.find(t => t.shortcut?.toLowerCase() === e.key.toLowerCase())
      if (t) setActiveTool(t.tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, setActiveTool, selectedCourseId, setSelectedCourse])

  const btnClass = "w-7 h-7 md:w-9 md:h-9 flex items-center justify-center rounded-xl transition-all"

  const undoRedo = (
    <>
      <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
        className={`${btnClass} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <Undo2 size={18} />
      </button>
      <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
        className={`${btnClass} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <Redo2 size={18} />
      </button>
    </>
  )

  if (selectedCourseId) {
    return (
      <div className="
        absolute bottom-4 left-1/2 -translate-x-1/2
        flex items-center gap-1.5 md:gap-2
        bg-white/95 backdrop-blur border border-orange-300 shadow-lg
        rounded-2xl px-3 py-1.5 md:px-4 md:py-2
        z-20
      ">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: selectedCourse?.color ?? '#7B2FBE' }}
        />
        <span className="text-xs md:text-sm text-gray-700">
          <span className="hidden md:inline">Click controls to add · right-click to remove</span>
          <span className="md:hidden">Tap to add · hold to remove</span>
        </span>
        <button
          onClick={() => setSelectedCourse(null)}
          className="ml-1 md:ml-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg px-2.5 py-1 md:px-3 md:py-1.5 transition-colors"
        >
          Done
        </button>
        <div className="w-px h-5 md:h-6 bg-gray-200 mx-0.5 md:mx-1" />
        {undoRedo}
      </div>
    )
  }

  return (
    <div className="
      absolute bottom-4 left-1/2 -translate-x-1/2
      flex items-center gap-0.5 md:gap-1
      bg-white/95 backdrop-blur border border-gray-200 shadow-lg
      rounded-2xl px-1.5 py-1 md:px-2 md:py-1.5
      z-20
    ">
      {tools.map(({ tool, label, shortcut }) => (
        <button
          key={tool}
          onClick={() => setActiveTool(tool)}
          title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
          className={`
            ${btnClass}
            ${activeTool === tool
              ? 'bg-orange-600 text-white shadow-inner'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}
          `}
        >
          {toolIcons[tool](16)}
        </button>
      ))}

      <div className="w-px h-5 md:h-6 bg-gray-200 mx-0.5 md:mx-1" />
      {undoRedo}
    </div>
  )
}
