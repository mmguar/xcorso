/**
 * Floating toolbar — pill on desktop, bottom bar on mobile.
 * Shows tool selection + undo/redo in normal mode.
 * Shows course-building banner when a course is selected.
 */

import { useEffect, useRef, useState } from 'react'
import {
  MousePointer2, Triangle, Target, X, ChevronsRightLeft, Ruler, Undo2, Redo2, Circle, Ban, Trash2, CircleDashed, Waypoints,
  RulerDimensionLine, Type, ImagePlus, Navigation, Signpost, ChevronUp, Layers, Eraser, History, Spline,
} from 'lucide-react'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import type { ActiveTool } from '../../types'
import { IOF_PURPLE } from '../../lib/courseUtils'

type ToolEntry = { tool: ActiveTool; label: string; shortcut?: string }

const tools: ToolEntry[] = [
  { tool: 'select', label: 'editor.tool.select', shortcut: 'V' },
  { tool: 'place-start', label: 'editor.tool.placeStart', shortcut: 'S' },
  { tool: 'place-finish', label: 'editor.tool.placeFinish', shortcut: 'F' },
  { tool: 'place-control', label: 'editor.tool.placeControl', shortcut: 'C' },
  { tool: 'gap', label: 'toolbar.gapClickCircle', shortcut: 'G' },
  { tool: 'delete', label: 'toolbar.deleteClick', shortcut: 'D' },
  { tool: 'measure-scale', label: 'editor.tool.measureScale', shortcut: 'M' },
]

const annotationTools: ToolEntry[] = [
  { tool: 'forbidden-route', label: 'toolbar.forbiddenRouteHint', shortcut: 'B' },
  { tool: 'crossing-point', label: 'editor.tool.crossingPoint', shortcut: 'P' },
  { tool: 'out-of-bounds', label: 'toolbar.outOfBoundsHint', shortcut: 'O' },
  { tool: 'out-of-bounds-boundary', label: 'toolbar.oobBoundaryHint' },
]

const overlayTools: ToolEntry[] = [
  { tool: 'place-scalebar', label: 'editor.tool.scaleBar', shortcut: 'K' },
  { tool: 'place-text', label: 'editor.tool.text', shortcut: 'T' },
  { tool: 'place-image', label: 'editor.tool.image', shortcut: 'I' },
  { tool: 'place-north-arrow', label: 'editor.tool.northArrow', shortcut: 'N' },
]

const annotationToolSet = new Set<ActiveTool>(annotationTools.map(t => t.tool))
const overlayToolSet = new Set<ActiveTool>(overlayTools.map(t => t.tool))
const allTools = [...tools, ...annotationTools, ...overlayTools]
const lockedAllowedTools = new Set<ActiveTool>(['select'])

const toolIcons: Record<ActiveTool, (size: number) => React.ReactNode> = {
  'select': s => <MousePointer2 size={s} />,
  'place-start': s => <Triangle size={s} />,
  'place-finish': s => <Target size={s} />,
  'place-control': s => <Circle size={s} />,
  'forbidden-route': s => <X size={s} />,
  'crossing-point': s => <ChevronsRightLeft size={s} />,
  'out-of-bounds': s => <Ban size={s} />,
  'out-of-bounds-boundary': s => <Spline size={s} />,
  'place-north-arrow': s => <Navigation size={s} />,
  'gap': s => <CircleDashed size={s} />,
  'bend': s => <Waypoints size={s} />,
  'delete': s => <Trash2 size={s} />,
  'measure-scale': s => <Ruler size={s} />,
  'place-scalebar': s => <RulerDimensionLine size={s} />,
  'place-text': s => <Type size={s} />,
  'place-image': s => <ImagePlus size={s} />,
}

function GapSizeSlider() {
  const gapSize = useStore(s => s.editor.gapSize)
  const setGapSize = useStore(s => s.setGapSize)
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400 select-none">{gapSize}°</span>
      <input
        type="range"
        min={10}
        max={120}
        step={5}
        value={gapSize}
        onChange={e => setGapSize(parseInt(e.target.value))}
        className="w-16 h-1 accent-orange-600"
      />
    </div>
  )
}

function GapRebuildToggle() {
  const t = useT()
  const gapRebuild = useStore(s => s.editor.gapRebuild)
  const setGapRebuild = useStore(s => s.setGapRebuild)
  return (
    <button
      onClick={() => setGapRebuild(!gapRebuild)}
      title={t('toolbar.gapRebuild')}
      className={`w-7 h-7 md:w-9 md:h-9 flex items-center justify-center rounded-xl transition-all ${
        gapRebuild
          ? 'bg-green-600 text-white shadow-inner'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      <Eraser size={16} />
    </button>
  )
}

function HistoryDropdown({ onJump, onClose }: { onJump: (index: number) => void; onClose: () => void }) {
  const t = useT()
  const undoStack = useStore(s => s.undoStack)
  const redoStack = useStore(s => s.redoStack)
  const redo = useStore(s => s.redo)

  return (
    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50 max-h-64 overflow-y-auto">
      {/* Natural order: redoStack[0] is the furthest-future state (top), the
          last entry is the next redo step (adjacent to "current"). Clicking an
          entry redoes all the way to it, mirroring how undo entries jump. */}
      {redoStack.map((entry, i) => (
        <button key={`redo-${i}`}
          onClick={() => {
            const steps = redoStack.length - i
            for (let k = 0; k < steps; k++) redo()
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50 transition-colors"
        >
          <span className="opacity-50">↻</span> {entry.label}
        </button>
      ))}
      <div className="px-3 py-1.5 text-xs font-medium text-orange-600 bg-orange-50 border-y border-orange-100">
        ● {t('toolbar.currentState')}
      </div>
      {undoStack.slice().reverse().map((entry, i) => {
        const stackIndex = undoStack.length - 1 - i
        return (
          <button key={`undo-${i}`}
            onClick={() => onJump(stackIndex)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}

export function Toolbar() {
  const t = useT()
  const activeTool = useStore(s => s.editor.activeTool)
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const layoutMode = useStore(s => s.editor.layoutMode)
  const measureMode = useStore(s => s.editor.measureMode)
  const gapRebuild = useStore(s => s.editor.gapRebuild)
  const setActiveTool = useStore(s => s.setActiveTool)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const exitLayoutMode = useStore(s => s.exitLayoutMode)
  const undo = useStore(s => s.undo)
  const redo = useStore(s => s.redo)
  const jumpToHistory = useStore(s => s.jumpToHistory)
  const locked = useStore(s => !!s.project?.locked)
  const canUndo = useStore(s => s.undoStack.length > 0)
  const canRedo = useStore(s => s.redoStack.length > 0)

  useEffect(() => {
    if (locked && !lockedAllowedTools.has(activeTool)) setActiveTool('select')
  }, [locked, activeTool, setActiveTool])

  const selectedCourse = useStore(s =>
    s.project?.courses.find(c => c.id === s.editor.selectedCourseId) ?? null
  )
  const layoutCourse = useStore(s =>
    s.editor.layoutCourseId ? s.project?.courses.find(c => c.id === s.editor.layoutCourseId) ?? null : null
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // An open modal keeps keyboard focus on <body>, so target-based checks
      // miss it — block editor shortcuts whenever any modal overlay is up.
      if (document.querySelector('.fixed.inset-0')) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useStore.getState()
        const sel = state.editor.selectedControlId
        if (sel) { e.preventDefault(); state.deleteControl(sel); return }
        const oid = state.editor.selectedOverlayId
        if (oid) {
          e.preventDefault()
          const proj = state.project
          if (proj?.scaleBars.some(s => s.id === oid)) state.deleteScaleBar(oid)
          else if (proj?.textLabels.some(t => t.id === oid)) state.deleteTextLabel(oid)
          else if (proj?.imageOverlays.some(o => o.id === oid)) state.deleteImageOverlay(oid)
          return
        }
        const aid = state.editor.selectedAnnotationId
        if (aid) { e.preventDefault(); state.deleteAnnotation(aid); return }
      }
      if (e.key === 'Escape') {
        const st = useStore.getState()
        if (st.editor.activeTool !== 'select') { setActiveTool('select'); return }
        if (st.editor.layoutMode) { exitLayoutMode(); return }
        if (st.editor.measureMode) { st.exitMeasureMode(); return }
        if (st.editor.pendingAnnotationPoints.length > 0) { st.cancelAnnotation(); return }
        if (st.editor.selectedControlId) { st.setSelectedControl(null); return }
        if (st.editor.selectedOverlayId) { st.setSelectedOverlay(null); return }
        if (st.editor.selectedAnnotationId) { st.setSelectedAnnotation(null); return }
        if (selectedCourseId) { setSelectedCourse(null); return }
        return
      }
      const ed = useStore.getState().editor
      if (ed.layoutMode || ed.measureMode) return
      if (selectedCourseId) {
        if (locked) return
        if (e.key.toLowerCase() === 'g') setActiveTool(activeTool === 'gap' ? 'select' : 'gap')
        else if (e.key.toLowerCase() === 'b') setActiveTool(activeTool === 'bend' ? 'select' : 'bend')
        return
      }
      const t = allTools.find(t => t.shortcut?.toLowerCase() === e.key.toLowerCase())
      if (t) {
        if (locked && !lockedAllowedTools.has(t.tool)) return
        // place-image needs an image first — go through the file picker like
        // the toolbar button does, instead of arming a tool that does nothing.
        if (t.tool === 'place-image') {
          imageInputRef.current!.value = ''
          imageInputRef.current!.click()
        } else {
          setActiveTool(t.tool)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, setActiveTool, selectedCourseId, setSelectedCourse, exitLayoutMode, activeTool, locked])

  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  const imageInputRef = useRef<HTMLInputElement>(null)
  const [annMenuOpen, setAnnMenuOpen] = useState(false)
  const annMenuRef = useRef<HTMLDivElement>(null)
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false)
  const overlayMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!annMenuOpen && !overlayMenuOpen && !historyOpen) return
    function handleClick(e: MouseEvent) {
      if (annMenuOpen && annMenuRef.current && !annMenuRef.current.contains(e.target as Node)) {
        setAnnMenuOpen(false)
      }
      if (overlayMenuOpen && overlayMenuRef.current && !overlayMenuRef.current.contains(e.target as Node)) {
        setOverlayMenuOpen(false)
      }
      if (historyOpen && historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [annMenuOpen, overlayMenuOpen, historyOpen])

  function handleImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        useStore.getState().setPendingImage({
          dataUrl, filename: file.name,
          naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        })
        setActiveTool('place-image')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const isAnnotationToolActive = annotationToolSet.has(activeTool)
  const isOverlayToolActive = overlayToolSet.has(activeTool)

  const btnClass = "w-7 h-7 md:w-9 md:h-9 flex items-center justify-center rounded-xl transition-all"

  const undoRedo = (
    <>
      <button onClick={undo} disabled={!canUndo} title={t('toolbar.undo')}
        className={`${btnClass} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <Undo2 size={18} />
      </button>
      <div className="relative" ref={historyRef}>
        <button
          onClick={() => setHistoryOpen(o => !o)}
          disabled={!canUndo && !canRedo}
          title={t('toolbar.history')}
          className={`${btnClass} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <History size={14} />
        </button>
        {historyOpen && <HistoryDropdown
          onJump={(i) => { jumpToHistory(i); setHistoryOpen(false) }}
          onClose={() => setHistoryOpen(false)}
        />}
      </div>
      <button onClick={redo} disabled={!canRedo} title={t('toolbar.redo')}
        className={`${btnClass} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <Redo2 size={18} />
      </button>
    </>
  )

  if (layoutMode && layoutCourse) {
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
          style={{ background: layoutCourse.color }}
        />
        <span className="text-xs md:text-sm text-gray-700">
          <span className="hidden md:inline">{t('toolbar.layoutPan')}</span>
          <span className="md:hidden">{t('toolbar.layoutMode')}</span>
        </span>
        <div className="w-px h-5 md:h-6 bg-gray-200 mx-0.5 md:mx-1" />
        {undoRedo}
      </div>
    )
  }

  // Measure mode: the canvas intercepts all taps for measuring, so the
  // course-building banner and gap/bend toggles would be dead UI — the teal
  // top banner carries the instructions, keep only undo/redo down here.
  if (measureMode) {
    return (
      <div className="
        absolute bottom-4 left-1/2 -translate-x-1/2
        flex items-center gap-1.5 md:gap-2
        bg-white/95 backdrop-blur border border-teal-300 shadow-lg
        rounded-2xl px-3 py-1.5 md:px-4 md:py-2
        z-20
      ">
        {undoRedo}
      </div>
    )
  }

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
          style={{ background: selectedCourse?.color ?? IOF_PURPLE }}
        />
        {locked ? (
          <span className="text-xs md:text-sm text-gray-400">{t('header.viewOnly')}</span>
        ) : activeTool === 'gap' && gapRebuild ? (
          <span className="text-xs md:text-sm text-green-700">
            {t('toolbar.gapRebuildClick')}
          </span>
        ) : activeTool === 'gap' ? (
          <span className="text-xs md:text-sm text-gray-700">
            {t('toolbar.gapAddClick')}
          </span>
        ) : activeTool === 'bend' ? (
          <span className="text-xs md:text-sm text-gray-700">
            <span className="hidden md:inline">{t('toolbar.bendDesktop')}</span>
            <span className="md:hidden">{t('toolbar.bendMobile')}</span>
          </span>
        ) : (
          <span className="text-xs md:text-sm text-gray-700">
            <span className="hidden md:inline">{t('toolbar.courseAddDesktop')}</span>
            <span className="md:hidden">{t('toolbar.courseAddMobile')}</span>
          </span>
        )}
        {!locked && <>
        <button
          onClick={() => setActiveTool(activeTool === 'gap' ? 'select' : 'gap')}
          title={t('toolbar.gapTool')}
          className={`${btnClass} ${
            activeTool === 'gap'
              ? 'bg-orange-600 text-white shadow-inner'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
          }`}
        >
          {toolIcons['gap'](16)}
        </button>
        {activeTool === 'gap' && (
          <>
            <GapSizeSlider />
            <GapRebuildToggle />
          </>
        )}
        <button
          onClick={() => setActiveTool(activeTool === 'bend' ? 'select' : 'bend')}
          title={t('toolbar.bendTool')}
          className={`${btnClass} ${
            activeTool === 'bend'
              ? 'bg-orange-600 text-white shadow-inner'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
          }`}
        >
          {toolIcons['bend'](16)}
        </button>
        </>}
        <div className="w-px h-5 md:h-6 bg-gray-200 mx-0.5 md:mx-1" />
        {undoRedo}
      </div>
    )
  }

  return (
<div data-tour="toolbar" className="
  /* Position and Centering */
  absolute bottom-4 left-0 right-0 mx-auto w-fit
  
  /* Layout */
  flex flex-wrap justify-center items-center 
  gap-0.5 md:gap-1
  
  /* Constraints */
  max-w-[95vw] 
  
  /* Aesthetics */
  bg-white/95 backdrop-blur border border-gray-200 shadow-lg
  rounded-2xl px-1.5 py-1 md:px-2 md:py-1.5
  z-20
">
          {(locked ? tools.filter(t => lockedAllowedTools.has(t.tool)) : tools).map(({ tool, label, shortcut }) => (
        <button
          key={tool}
          onClick={() => setActiveTool(tool)}
          title={`${t(label)}${shortcut ? ` (${shortcut})` : ''}`}
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

      {!locked && <>
      {/* Annotations submenu */}
      <div className="relative" ref={annMenuRef}>
        <button
          onClick={() => { setAnnMenuOpen(o => !o); setOverlayMenuOpen(false) }}
          title={t('toolbar.annotations')}
          className={`
            ${btnClass}
            ${isAnnotationToolActive
              ? 'bg-orange-600 text-white shadow-inner'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}
          `}
        >
          {isAnnotationToolActive ? toolIcons[activeTool](16) : <Signpost size={16} />}
          <ChevronUp size={8} className="absolute top-0.5 right-0.5 opacity-50" />
        </button>
        {annMenuOpen && (
          <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-xl py-1 min-w-36 z-50">
            {annotationTools.map(({ tool, label, shortcut }) => (
              <button
                key={tool}
                onClick={() => { setActiveTool(tool); setAnnMenuOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  activeTool === tool
                    ? 'bg-orange-100 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="w-5 flex justify-center shrink-0">{toolIcons[tool](14)}</span>
                <span className="flex-1 text-left truncate">{t(label).replace(/ \(.*\)/, '')}</span>
                {shortcut && <span className="text-[10px] text-gray-400 font-mono">{shortcut}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Overlays submenu */}
      <div className="relative" ref={overlayMenuRef}>
        <button
          onClick={() => { setOverlayMenuOpen(o => !o); setAnnMenuOpen(false) }}
          title={t('toolbar.overlays')}
          className={`
            ${btnClass}
            ${isOverlayToolActive
              ? 'bg-orange-600 text-white shadow-inner'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}
          `}
        >
          {isOverlayToolActive ? toolIcons[activeTool](16) : <Layers size={16} />}
          <ChevronUp size={8} className="absolute top-0.5 right-0.5 opacity-50" />
        </button>
        {overlayMenuOpen && (
          <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-xl py-1 min-w-36 z-50">
            {overlayTools.map(({ tool, label, shortcut }) => (
              <button
                key={tool}
                onClick={() => {
                  if (tool === 'place-image') {
                    imageInputRef.current!.value = ''
                    imageInputRef.current!.click()
                  } else {
                    setActiveTool(tool)
                  }
                  setOverlayMenuOpen(false)
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  activeTool === tool
                    ? 'bg-orange-100 text-orange-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="w-5 flex justify-center shrink-0">{toolIcons[tool](14)}</span>
                <span className="flex-1 text-left truncate">{t(label)}</span>
                {shortcut && <span className="text-[10px] text-gray-400 font-mono">{shortcut}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleImageFile(file)
        }}
      />
      </>}

      {activeTool === 'gap' && (
        <>
          <div className="w-px h-5 md:h-6 bg-gray-200 mx-0.5 md:mx-1" />
          <GapSizeSlider />
        </>
      )}
      <div className="w-px h-5 md:h-6 bg-gray-200 mx-0.5 md:mx-1" />
      {undoRedo}
    </div>
  )
}
