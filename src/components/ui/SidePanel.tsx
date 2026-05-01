/**
 * Right sidebar on desktop, bottom sheet on mobile/tablet.
 * Contains Controls tab and Courses tab.
 */

import { useEffect, useLayoutEffect, useState } from 'react'
import { MapPin, Navigation, PanelRightClose, PanelRight } from 'lucide-react'
import { useStore } from '../../store'
import { ControlsPanel } from '../panels/ControlsPanel'
import { CoursesPanel } from '../panels/CoursesPanel'

type Tab = 'controls' | 'courses'

const SIDEBAR_W = 288 // w-72 = 18rem = 288px

export function SidePanel() {
  const [tab, setTab] = useState<Tab>('controls')
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)

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
    if (selectedCourseId) {
      setTab('courses')
    }
  }, [selectedCourseId])

  return (
    <>
      {/* Desktop: right sidebar */}
      <aside className={`
        hidden md:flex flex-col
        shrink-0 border-l border-gray-200 bg-white
        overflow-hidden transition-[width] duration-200
        ${collapsed ? 'w-12' : 'w-72'}
      `}>
        {collapsed ? (
          <CollapsedSidebar onExpand={() => setCollapsed(false)} />
        ) : (
          <>
            <div className="flex border-b border-gray-200">
              {(['controls', 'courses'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors capitalize ${
                    tab === t
                      ? 'border-b-2 border-purple-600 text-purple-700 bg-purple-50/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t === 'controls' ? <MapPin size={13} /> : <Navigation size={13} />}
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
              {tab === 'controls' ? <ControlsPanel /> : <CoursesPanel />}
            </div>
          </>
        )}
      </aside>

      {/* Mobile/tablet: bottom sheet (collapsed by default, tap to expand) */}
      <MobileBottomSheet tab={tab} setTab={setTab} />
    </>
  )
}

const DEFAULT_NAME_RE = /^(?:Course|Score)\s+(\d+)$/i

function courseChipLabel(name: string): string {
  const m = name.match(DEFAULT_NAME_RE)
  if (m) return m[1]
  return name.slice(0, 2).toUpperCase()
}

function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  const courses = useStore(s => s.project?.courses ?? [])
  const selectedCourseId = useStore(s => s.editor.selectedCourseId)
  const setSelectedCourse = useStore(s => s.setSelectedCourse)

  return (
    <div className="flex flex-col items-center pt-2 gap-3">
      <button
        onClick={onExpand}
        className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
        title="Open Course Panel"
      >
        <PanelRight size={22} />
      </button>

      {courses.length > 0 && (
        <div className="flex flex-col items-center gap-1.5 px-1">
          {courses.map(course => {
            const isActive = course.id === selectedCourseId
            return (
              <button
                key={course.id}
                onClick={() => setSelectedCourse(isActive ? null : course.id)}
                title={isActive ? `${course.name} (click to deselect)` : course.name}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all shrink-0 ${
                  isActive
                    ? 'ring-2 ring-purple-500 ring-offset-1 scale-110'
                    : 'hover:scale-105 opacity-70 hover:opacity-100'
                }`}
                style={{ background: course.color, color: 'white' }}
              >
                {courseChipLabel(course.name)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MobileBottomSheet({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`
      md:hidden fixed bottom-0 left-0 right-0 z-30
      bg-white border-t border-gray-200 shadow-2xl
      transition-all duration-300 ease-out
      ${expanded ? 'h-[60vh]' : 'h-16'}
    `}>
      {/* Handle + tabs row */}
      <div className="flex items-center gap-0 h-16 px-4 shrink-0">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 mr-2"
          aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
        >
          <div className={`w-5 h-0.5 bg-gray-400 transition-transform ${expanded ? '' : 'rotate-180'}`} />
        </button>

        {(['controls', 'courses'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setExpanded(true) }}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors capitalize ${
              tab === t && expanded
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'controls' ? <MapPin size={13} /> : <Navigation size={13} />}
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {expanded && (
        <div className="flex-1 overflow-y-auto panel-scroll h-[calc(100%-4rem)]">
          {tab === 'controls' ? <ControlsPanel /> : <CoursesPanel />}
        </div>
      )}
    </div>
  )
}
