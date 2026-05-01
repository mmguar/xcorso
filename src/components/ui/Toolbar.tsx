/**
 * Floating toolbar — pill on desktop, bottom bar on mobile.
 * Shows tool selection + undo/redo in normal mode.
 * Shows course-building banner when a course is selected.
 */

import { useEffect } from 'react'
import {
  MousePointer2, Triangle, Target, Slash, X, Ruler, Undo2, Redo2, Circle, Ban,
} from 'lucide-react'
import { useStore } from '../../store'
import type { ActiveTool } from '../../types'

const tools: { tool: ActiveTool; icon: React.ReactNode; label: string; shortcut?: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={18} />, label: 'Select / Pan', shortcut: 'V' },
  { tool: 'place-start', icon: <Triangle size={18} />, label: 'Place Start', shortcut: 'S' },
  { tool: 'place-finish', icon: <Target size={18} />, label: 'Place Finish', shortcut: 'F' },
  { tool: 'place-control', icon: <Circle size={18} />, label: 'Place Control', shortcut: 'C' },
  { tool: 'forbidden-route', icon: <Slash size={18} />, label: 'Forbidden Route (double-click to finish)', shortcut: 'B' },
  { tool: 'crossing-point', icon: <X size={18} />, label: 'Crossing Point', shortcut: 'P' },
  { tool: 'out-of-bounds', icon: <Ban size={18} />, label: 'Out-of-bounds Area (double-click to finish)', shortcut: 'O' },
  { tool: 'measure-scale', icon: <Ruler size={18} />, label: 'Measure Scale', shortcut: 'M' },
]

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

  const undoRedo = (
    <>
      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <Undo2 size={18} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <Redo2 size={18} />
      </button>
    </>
  )

  if (selectedCourseId) {
    return (
      <div className="
        absolute bottom-4 left-1/2 -translate-x-1/2
        flex items-center gap-2
        bg-white/95 backdrop-blur border border-purple-300 shadow-lg
        rounded-2xl px-4 py-2
        z-20
      ">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: selectedCourse?.color ?? '#7B2FBE' }}
        />
        <span className="text-sm text-gray-700">
          Click controls to add · right-click to remove
        </span>
        <button
          onClick={() => setSelectedCourse(null)}
          className="ml-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg px-3 py-1.5 transition-colors"
        >
          Done
        </button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        {undoRedo}
      </div>
    )
  }

  return (
    <div className="
      absolute bottom-4 left-1/2 -translate-x-1/2
      flex items-center gap-1
      bg-white/95 backdrop-blur border border-gray-200 shadow-lg
      rounded-2xl px-2 py-1.5
      z-20
    ">
      {tools.map(({ tool, icon, label, shortcut }) => (
        <button
          key={tool}
          onClick={() => setActiveTool(tool)}
          title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
          className={`
            w-9 h-9 flex items-center justify-center rounded-xl transition-all
            ${activeTool === tool
              ? 'bg-purple-600 text-white shadow-inner'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}
          `}
        >
          {icon}
        </button>
      ))}

      <div className="w-px h-6 bg-gray-200 mx-1" />
      {undoRedo}
    </div>
  )
}
