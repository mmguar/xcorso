/**
 * Export project as IOF XML v3.0 CourseData.
 * Produces a string that can be saved as .xml and opened in Condes / Purple Pen.
 *
 * Spec: https://orienteering.sport/iof/it/data-standard-3-0/
 * Controls use MapPosition (map units, not georeferenced) since we don't have
 * a coordinate projection. Condes and Purple Pen both handle this gracefully.
 */

import type { Project, Control } from '../types'

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tag(name: string, attrs: Record<string, string | number>, children?: string): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${xmlEscape(String(v))}"`)
    .join('')
  if (children === undefined) return `<${name}${attrStr}/>`
  return `<${name}${attrStr}>${children}</${name}>`
}

function mapPositionTag(x: number, y: number): string {
  return tag('MapPosition', { x: Math.round(x), y: Math.round(y) })
}

function controlTypeToIof(control: Control, isFirstInCourse: boolean, isLastInCourse: boolean): string {
  if (control.type === 'start' || isFirstInCourse) return 'Start'
  if (control.type === 'finish' || isLastInCourse) return 'Finish'
  return 'Control'
}

export function exportIofXml(project: Project): string {
  const controlMap = new Map<string, Control>(project.controls.map(c => [c.id, c]))

  // Build <Control> elements — one per unique physical control
  const controlsXml = project.controls.map(c => {
    const typeAttr = c.type === 'start' ? 'Start' : c.type === 'finish' ? 'Finish' : 'Control'
    return tag('Control', { id: String(c.code), type: typeAttr },
      mapPositionTag(c.position.x, c.position.y),
    )
  }).join('\n    ')

  // Build <Course> elements
  const coursesXml = project.courses.map(course => {
    const resolvedControls = course.controls
      .map(cc => controlMap.get(cc.controlId))
      .filter((c): c is Control => c !== undefined)

    if (resolvedControls.length === 0) return ''

    const courseControls = course.controls.map((cc, idx) => {
      const control = controlMap.get(cc.controlId)
      if (!control) return ''
      const isFirst = idx === 0
      const isLast = idx === course.controls.length - 1
      const iofType = controlTypeToIof(control, isFirst, isLast)
      const attrs: Record<string, string | number> = {
        sequence: idx + 1,
        type: iofType,
        controlId: String(control.code),
      }
      if (course.type === 'score' && cc.scorePoints !== undefined) {
        attrs.score = cc.scorePoints
      }
      return `      ${tag('CourseControl', attrs)}`
    }).filter(Boolean).join('\n')

    const courseAttrs: Record<string, string> = { id: course.id, name: course.name }
    if (course.type === 'score') courseAttrs.type = 'Score'

    let courseChildren = courseControls
    if (course.type === 'score' && course.scoreTimeLimit) {
      courseChildren = `      ${tag('ScoreTimeLimit', { value: course.scoreTimeLimit })}\n` + courseChildren
    }

    return tag('Course', courseAttrs, '\n' + courseChildren + '\n    ')
  }).filter(Boolean).join('\n    ')

  const now = new Date().toISOString()

  const classAssignmentsXml = project.classes.map(rc => {
    const course = project.courses.find(c => c.id === rc.courseId)
    if (!course) return ''
    return tag('ClassCourseAssignment', {},
      `\n        ${tag('ClassName', {}, xmlEscape(rc.name))}\n        ${tag('CourseName', {}, xmlEscape(course.name))}\n      `,
    )
  }).filter(Boolean).join('\n    ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<CourseData xmlns="http://www.orienteering.org/datastandard/3.0"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            iofVersion="3.0"
            creator="xcorso"
            createTime="${now}">
  <Event>
    <Name>${xmlEscape(project.meta.name)}</Name>
  </Event>
  <RaceCourseData>
    <Map scale="${project.map.scale}"/>
    ${controlsXml}
    ${coursesXml}
    ${classAssignmentsXml}
  </RaceCourseData>
</CourseData>`
}
