import { memo } from 'react'
import type { Course } from '../../types'
import { courseOverviewColor } from '../../lib/courseUtils'

interface Props {
  courses: Course[]
  hiddenIds?: string[]
}

export const AllCoursesLegend = memo(function AllCoursesLegend({ courses, hiddenIds }: Props) {
  const entries = courses
    .map((course, index) => ({ course, index }))
    .filter(({ course }) => course.type === 'linear' && course.controls.length >= 2)

  if (entries.length === 0) return null

  const h = hiddenIds?.length ? new Set(hiddenIds) : null

  return (
    <div className="bg-white/50 rounded-lg px-2 py-1.5 shadow-sm border border-gray-200/60 max-w-48 max-h-40 overflow-y-auto panel-scroll pointer-events-none">
      <div className="flex flex-col gap-1">
        {entries.map(({ course, index }) => {
          const hidden = h?.has(course.id)
          return (
            <div key={course.id} className="flex items-center gap-1.5 min-w-0" style={{ opacity: hidden ? 0.3 : 1 }}>
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                style={{ background: courseOverviewColor(index) }}
              />
              <span className="text-[11px] text-gray-800 truncate leading-tight">{course.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
