/**
 * Draws legs for every course, each in a distinct overview color.
 * Used in the "all courses" overview view.
 */

import { memo, useMemo } from 'react'
import type { Course, Control, MapConfig, AppearanceSettings, EventSpec } from '../../types'
import { courseOverviewColor } from '../../lib/courseUtils'
import { LegsLayer } from './LegsLayer'

interface Props {
  courses: Course[]
  controls: Control[]
  map: MapConfig
  appearance: AppearanceSettings
  projectSpec?: EventSpec
  hiddenIds?: string[]
  _rev?: number
}

export const AllCoursesLegsLayer = memo(function AllCoursesLegsLayer({
  courses,
  controls,
  map,
  appearance,
  projectSpec,
  hiddenIds,
  _rev,
}: Props) {
  const linearCourses = useMemo(() => {
    const h = hiddenIds?.length ? new Set(hiddenIds) : null
    return courses
      .map((course, index) => ({ course, index }))
      .filter(({ course }) => course.type === 'linear' && course.controls.length >= 2 && (!h || !h.has(course.id)))
  }, [courses, hiddenIds])

  if (linearCourses.length === 0) return null

  return (
    <>
      {linearCourses.map(({ course, index }) => (
        <LegsLayer
          key={course.id}
          course={course}
          controls={controls}
          map={map}
          appearance={{ ...appearance, color: courseOverviewColor(index) }}
          projectSpec={projectSpec}
          _rev={_rev}
        />
      ))}
    </>
  )
})
