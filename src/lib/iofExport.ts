/**
 * Export project as IOF XML v3.0 CourseData.
 * Produces a string that can be saved as .xml and opened in Condes / Purple Pen.
 *
 * Structure follows IOF.xsd strictly:
 * - Control: Id (child element), MapPosition (child element), type (attribute)
 * - Course: Name (child element), CourseControl (child elements)
 * - CourseControl: Control (child element = code string), type (attribute), Score (child element)
 * - Map: Scale (child element), MapPositionTopLeft, MapPositionBottomRight (children)
 * - MapPosition: x, y (attributes, doubles), unit (attribute, optional)
 */

import type { Project, Course, Control, ControlType, MapType } from '../types'
import { computeCourseDistances } from './distance'
import { resolveVariation } from './courseUtils'

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}


function iofControlType(type: ControlType): string {
  switch (type) {
    case 'start': return 'Start'
    case 'finish': return 'Finish'
    case 'control': return 'Control'
  }
}

function controlCode(c: Control): string {
  return String(c.code)
}

function mapPositionUnit(mapType: MapType): string {
  if (mapType === 'bitmap' || mapType === 'pdf') return 'px'
  return 'mm'
}

export function exportIofXml(project: Project): string {
  const controlMap = new Map<string, Control>(project.controls.map(c => [c.id, c]))
  const unit = mapPositionUnit(project.map.type)
  const unitAttr = unit === 'mm' ? '' : ` unit="${unit}"`

  function mapPos(x: number, y: number): string {
    return `<MapPosition x="${x}" y="${y}"${unitAttr}/>`
  }

  // <Map> element: Scale + corners
  const mapXml = [
    '    <Map>',
    `      <Scale>${project.map.scale}</Scale>`,
    `      <MapPositionTopLeft x="0" y="0"${unitAttr}/>`,
    `      <MapPositionBottomRight x="${project.map.width}" y="${project.map.height}"${unitAttr}/>`,
    '    </Map>',
  ].join('\n')

  // <Control> elements
  const controlsXml = project.controls.map(c => {
    const lines = [
      `    <Control type="${iofControlType(c.type)}">`,
      `      <Id>${xmlEscape(controlCode(c))}</Id>`,
      `      ${mapPos(c.position.x, c.position.y)}`,
      '    </Control>',
    ]
    return lines.join('\n')
  }).join('\n')

  // Expand courses with variations into separate IOF courses
  interface ExportCourse { course: Course; family?: string }
  const exportCourses: ExportCourse[] = []
  for (const course of project.courses) {
    if (course.variations && course.variations.length > 0 && course.loops && course.loops.length > 0) {
      for (const variation of course.variations) {
        exportCourses.push({
          course: {
            ...course,
            name: `${course.name} - ${variation.name}`,
            controls: resolveVariation(course, variation),
            loops: undefined,
            variations: undefined,
          },
          family: course.name,
        })
      }
    } else {
      exportCourses.push({ course })
    }
  }

  // <Course> elements
  const coursesXml = exportCourses.map(({ course, family }) => {
    const resolvedControls = course.controls
      .map(cc => controlMap.get(cc.controlId))
      .filter((c): c is Control => c !== undefined)

    if (resolvedControls.length < 2) return ''

    const distances = computeCourseDistances(course, project.controls, project.map)
    const isScore = course.type === 'score'

    const courseControlsXml = course.controls.map((cc, idx) => {
      const control = controlMap.get(cc.controlId)
      if (!control) return ''

      const isFirst = idx === 0
      const isLast = idx === course.controls.length - 1
      let type: string
      if (control.type === 'start' || isFirst) type = 'Start'
      else if (control.type === 'finish' || isLast) type = 'Finish'
      else type = 'Control'

      const attrs: string[] = [`type="${type}"`]
      if (isScore && type === 'Control') attrs.push('randomOrder="true"')

      const children: string[] = [
        `        <Control>${xmlEscape(controlCode(control))}</Control>`,
      ]
      if (idx > 0 && distances.legs[idx - 1] > 0) {
        children.push(`        <LegLength>${Math.round(distances.legs[idx - 1])}</LegLength>`)
      }
      if (isScore && cc.scorePoints !== undefined) {
        children.push(`        <Score>${cc.scorePoints}</Score>`)
      }

      return [
        `      <CourseControl ${attrs.join(' ')}>`,
        ...children,
        '      </CourseControl>',
      ].join('\n')
    }).filter(Boolean).join('\n')

    const courseChildren: string[] = [
      `      <Name>${xmlEscape(course.name)}</Name>`,
    ]
    if (family) {
      courseChildren.push(`      <CourseFamily>${xmlEscape(family)}</CourseFamily>`)
    }
    if (distances.total > 0) {
      courseChildren.push(`      <Length>${Math.round(distances.total)}</Length>`)
    }

    return [
      '    <Course>',
      ...courseChildren,
      courseControlsXml,
      '    </Course>',
    ].join('\n')
  }).filter(Boolean).join('\n')

  // <ClassCourseAssignment> elements
  const classAssignmentsXml = project.classes.map(rc => {
    const course = project.courses.find(c => c.id === rc.courseId)
    if (!course) return ''
    return [
      '    <ClassCourseAssignment>',
      `      <ClassName>${xmlEscape(rc.name)}</ClassName>`,
      `      <CourseName>${xmlEscape(course.name)}</CourseName>`,
      '    </ClassCourseAssignment>',
    ].join('\n')
  }).filter(Boolean).join('\n')

  const now = new Date().toISOString()

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<CourseData iofVersion="3.0" creator="xcorso" createTime="${now}" xmlns="http://www.orienteering.org/datastandard/3.0">`,
    '  <Event>',
    `    <Name>${xmlEscape(project.meta.name)}</Name>`,
    '  </Event>',
    '  <RaceCourseData>',
    mapXml,
    controlsXml,
    coursesXml,
    classAssignmentsXml,
    '  </RaceCourseData>',
    '</CourseData>',
  ].filter(Boolean)

  return parts.join('\n')
}
