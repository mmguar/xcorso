/**
 * Right sidebar on desktop, bottom sheet on mobile/tablet.
 * Contains Controls tab and Courses tab.
 */

import { Fragment, useEffect, useLayoutEffect, useState } from 'react'
import { MapPin, Navigation, LayoutPanelLeft, PanelRightClose, PanelRight, Plus } from 'lucide-react'
import { useStore } from '../../store'
import { computeSubmaps } from '../../lib/courseUtils'
import { ControlsPanel } from '../panels/ControlsPanel'
import { CoursesPanel } from '../panels/CoursesPanel'
import { LayoutPanel } from '../panels/LayoutPanel'
import type { Course } from '../../types'

type Tab = 'controls' | 'courses' | 'layout'

const SIDEBAR_W = 352 // w-88 = 22 rem = 352px


export function SidePanel() {
  const [tab, setTab] = useState<Tab>('controls')
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const layoutMode = useStore(s => s.editor.layoutMode)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const enterLayoutMode = useStore(s => s.enterLayoutMode)
  const exitLayoutMode = useStore(s => s.exitLayoutMode)

  const projectId = useStore(s => s.projectId)
  useEffect(() => { setTab('controls') }, [projectId])

  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' && SIDEBAR_W > window.innerWidth / 3
  )

  useLayoutEffect(() => {
    function check() {
      if (SIDEBAR_W > window.innerWidth / 3) setCollapsed(true)
      else setCollapsed(false)
    }
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (selectedCourseId && !layoutMode) {
      setTab('courses') // eslint-disable-line react-hooks/set-state-in-effect -- auto-switch tab on selection
    }
  }, [selectedCourseId, layoutMode])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-switch tab on layout mode
    if (layoutMode) setTab('layout')
  }, [layoutMode])

  const tourPanel = useStore(s => s.editor.tourPanel)
  useEffect(() => {
    if (!tourPanel) return
    /* eslint-disable react-hooks/set-state-in-effect -- tour requests panel open */
    setTab(tourPanel)
    setCollapsed(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tourPanel])

  function switchMode(t: Tab) {
    if (t === 'controls') {
      if (layoutMode) exitLayoutMode()
      if (selectedCourseId) setSelectedCourse(null)
    } else if (t === 'courses') {
      if (layoutMode) exitLayoutMode()
    } else if (t === 'layout') {
      if (selectedCourseId && !layoutMode) enterLayoutMode(selectedCourseId)
    }
  }

  return (
    <>
      {/* Desktop: right sidebar */}
      <aside className={`
        hidden md:flex flex-col
        shrink-0 border-l border-gray-200 bg-white
        transition-[width] duration-200
        ${collapsed ? 'w-12' : 'w-88 overflow-hidden'}
      `}>
        {collapsed ? (
          <CollapsedSidebar onExpand={() => setCollapsed(false)} />
        ) : (
          <>
            <div className="flex border-b border-gray-200">
              {(['controls', 'courses', 'layout'] as Tab[]).map(t => (
                <button
                  key={t}
                  data-tour={t === 'courses' ? 'courses-tab' : t === 'layout' ? 'layout-tab' : undefined}
                  onClick={() => { switchMode(t); setTab(t) }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors capitalize ${
                    tab === t
                      ? 'border-b-2 border-orange-600 text-orange-700 bg-orange-50/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t === 'controls' ? <MapPin size={13} /> : t === 'courses' ? <Navigation size={13} /> : <LayoutPanelLeft size={13} />}
                  {t}
                </button>
              ))}
              <button
                onClick={() => setCollapsed(true)}
                className="px-2 text-gray-300 hover:text-gray-500 transition-colors"
                title="Close panel"
              >
                <PanelRightClose size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto panel-scroll">
              {tab === 'controls' ? <ControlsPanel /> : tab === 'courses' ? <CoursesPanel /> : <LayoutPanel />}
            </div>
          </>
        )}
      </aside>

      {/* Mobile/tablet: top bar */}
      <MobileTopBar tab={tab} setTab={setTab} switchMode={switchMode} />
    </>
  )
}

const DEFAULT_NAME_RE = /^(?:Course|Score)\s+(\d+)$/i

function courseChipLabel(name: string): string {
  const m = name.match(DEFAULT_NAME_RE)
  if (m) return m[1]
  return name.slice(0, 2).toUpperCase()
}

/** M1/M2… chips shown next to the active course chip for exchange/flip courses. */
function SubmapChips({ course }: { course: Course }) {
  const selectedSubmapIndex = useStore(s => s.editor.selectedSubmapIndex)
  const layoutMode = useStore(s => s.editor.layoutMode)
  const layoutCourseId = useStore(s => s.editor.layoutCourseId)
  const setSelectedSubmap = useStore(s => s.setSelectedSubmap)
  const setLayoutSubmap = useStore(s => s.setLayoutSubmap)
  const submaps = computeSubmaps(course)
  if (submaps.length <= 1) return null
  // In layout mode the chips switch the layout submap (which keeps the canvas
  // filter in sync); otherwise they toggle the canvas submap filter.
  const inLayout = layoutMode && layoutCourseId === course.id
  return (
    <>
      {submaps.map(sm => {
        const active = selectedSubmapIndex === sm.index
        return (
          <button
            key={sm.index}
            onClick={() => {
              if (inLayout) setLayoutSubmap(sm.index)
              else setSelectedSubmap(active ? null : sm.index)
            }}
            title={active && !inLayout ? `${sm.label} (click to show all)` : sm.label}
            className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold transition-all shrink-0 ${
              active
                ? 'bg-orange-600 text-white'
                : 'bg-white border border-gray-300 text-gray-500 hover:border-orange-400'
            }`}
          >
            M{sm.index + 1}
          </button>
        )
      })}
    </>
  )
}

function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  const courses = useStore(s => s.project?.courses ?? [])
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const addCourse = useStore(s => s.addCourse)
  const [showNewMenu, setShowNewMenu] = useState(false)

  return (
    <div className="flex flex-col items-center pt-2 gap-3 flex-1 min-h-0">
      <button
        onClick={onExpand}
        className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors shrink-0"
        title="Open Course Panel"
      >
        <PanelRight size={22} />
      </button>

      {courses.length > 0 && (
        <>
          {/* Scrollable course (+ submap) chips; the + menu stays outside so
              its dropdown isn't clipped by the scroll container. */}
          <div className="flex flex-col items-center gap-1.5 px-1 overflow-y-auto panel-scroll min-h-0">
            {courses.map(course => {
              const isActive = course.id === selectedCourseId
              return (
                <Fragment key={course.id}>
                  <button
                    onClick={() => {
                      if (isActive) { setSelectedCourse(null) }
                      else { setSelectedCourse(course.id) }
                    }}
                    title={isActive ? `${course.name} (click to deselect)` : course.name}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all shrink-0 ${
                      isActive
                        ? 'ring-2 ring-orange-500 ring-offset-1 scale-110'
                        : 'hover:scale-105 opacity-70 hover:opacity-100'
                    }`}
                    style={{ background: course.color, color: 'white' }}
                  >
                    {courseChipLabel(course.name)}
                  </button>
                  {isActive && <SubmapChips course={course} />}
                </Fragment>
              )
            })}
          </div>
          {/* Create new course button with dropdown */}
          <div className="relative shrink-0 pb-2">
            <button
              onClick={() => setShowNewMenu(m => !m)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all shrink-0 opacity-70 hover:opacity-100"
            >
              <Plus size={13} />
            </button>
            {showNewMenu && (
              <div className="absolute right-full bottom-0 mr-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-28 z-50">
                <button
                  onClick={() => { const c = addCourse(`Course ${courses.length + 1}`, 'linear'); setSelectedCourse(c.id); setShowNewMenu(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 transition-colors"
                >
                  Linear
                </button>
                <button
                  onClick={() => { const c = addCourse(`Score ${courses.length + 1}`, 'score'); setSelectedCourse(c.id); setShowNewMenu(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 transition-colors"
                >
                  Score-O
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MobileTopBar({ tab, setTab, switchMode }: { tab: Tab; setTab: (t: Tab) => void; switchMode: (t: Tab) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const courses = useStore(s => s.project?.courses ?? [])
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)
  const addCourse = useStore(s => s.addCourse)

  return (
    <div className={`
      md:hidden fixed top-12 left-0 right-0 z-30
      bg-white border-b border-gray-200 shadow-2xl
      transition-all duration-300 ease-out
      ${expanded ? 'h-[50vh] flex flex-col overflow-hidden' : 'h-10'}
    `}>
      {/* Icon tabs + course chips */}
      <div className="flex items-center gap-1.5 h-10 px-2 shrink-0">
        {(['controls', 'courses', 'layout'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { if (t !== tab) switchMode(t); setTab(t); setExpanded(e => t === tab ? !e : true) }}
            title={t}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              tab === t && expanded
                ? 'bg-orange-100 text-orange-700'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t === 'controls' ? <MapPin size={15} /> : t === 'courses' ? <Navigation size={15} /> : <LayoutPanelLeft size={15} />}
          </button>
        ))}

        {courses.length > 0 && (
          <>
            <div className="w-px h-5 bg-gray-200 mx-0.5 shrink-0" />
            <div className="flex items-center gap-1 py-0.5 overflow-x-auto min-w-0">
              {courses.map(course => {
                const isActive = course.id === selectedCourseId
                return (
                  <Fragment key={course.id}>
                    <button
                      onClick={() => {
                        if (isActive) { setSelectedCourse(null) }
                        else { setSelectedCourse(course.id); if (expanded) setTab('courses') }
                      }}
                      className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-bold transition-all shrink-0 ${
                        isActive
                          ? 'ring-2 ring-orange-500 ring-offset-1'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{ background: course.color, color: 'white' }}
                    >
                      {courseChipLabel(course.name)}
                    </button>
                    {isActive && <SubmapChips course={course} />}
                  </Fragment>
                )
              })}
            </div>
          </>
        )}

        {/* Create new course button */}
        <div className="relative">
          <button
            onClick={() => setShowNewMenu(m => !m)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all shrink-0 opacity-70 hover:opacity-100"
          >
            <Plus size={13} />
          </button>
          {showNewMenu && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-28 z-50">
              <button
                onClick={() => { const c = addCourse(`Course ${courses.length + 1}`, 'linear'); setSelectedCourse(c.id); setShowNewMenu(false) }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 transition-colors"
              >
                Linear
              </button>
              <button
                onClick={() => { const c = addCourse(`Score ${courses.length + 1}`, 'score'); setSelectedCourse(c.id); setShowNewMenu(false) }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 transition-colors"
              >
                Score-O
              </button>
            </div>
          )}
        </div>

        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="ml-auto flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 shrink-0"
            aria-label="Collapse panel"
          >
            <div className="w-5 h-0.5 bg-gray-400" />
          </button>
        )}
      </div>

      {/* Content */}
      {expanded && (
        <div className="overflow-y-auto panel-scroll flex-1 min-h-0">
          {tab === 'controls' ? <ControlsPanel /> : tab === 'courses' ? <CoursesPanel /> : <LayoutPanel />}
        </div>
      )}
    </div>
  )
}
