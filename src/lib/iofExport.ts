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

import type { Project, Course, Control, ControlType, MapConfig } from '../types'
import { computeCourseDistances, resolveCourseLength } from './distance'
import { defaultControlLabel, resolveVariation } from './courseUtils'
import { ocadToLatLng } from './utm'

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

const controlCode = defaultControlLabel

function toIofCoords(svgX: number, svgY: number, map: MapConfig): { x: number; y: number } {
  const oy = map.originY ?? 0
  // SVG uses Y-down; IOF uses Y-up. Flip Y (and for OCAD convert units, 1/100 mm → mm).
  const yFlip = oy + oy + map.height
  if (map.type === 'ocad') {
    return { x: svgX / 100, y: (yFlip - svgY) / 100 }
  }
  return { x: svgX, y: yFlip - svgY }
}

export function exportIofXml(project: Project): string {
  const controlMap = new Map<string, Control>(project.controls.map(c => [c.id, c]))
  const isOcad = project.map.type === 'ocad'
  const unitAttr = isOcad ? '' : ' unit="px"'

  function mapPos(x: number, y: number): string {
    const p = toIofCoords(x, y, project.map)
    return `<MapPosition x="${p.x}" y="${p.y}"${unitAttr}/>`
  }

  // <Map> element: Scale + corners
  const ox = project.map.originX ?? 0
  const oy = project.map.originY ?? 0
  const tl = toIofCoords(ox, oy, project.map)
  const br = toIofCoords(ox + project.map.width, oy + project.map.height, project.map)
  const mapXml = [
    '    <Map>',
    `      <Scale>${project.map.scale}</Scale>`,
    `      <MapPositionTopLeft x="${tl.x}" y="${tl.y}"${unitAttr}/>`,
    `      <MapPositionBottomRight x="${br.x}" y="${br.y}"${unitAttr}/>`,
    '    </Map>',
  ].join('\n')

  const georef = isOcad ? project.map.georef : undefined

  function positionEl(svgX: number, svgY: number): string {
    if (!georef) return ''
    const iof = toIofCoords(svgX, svgY, project.map)
    const pos = ocadToLatLng(iof.x, iof.y, project.map.scale, georef)
    return `      <Position lng="${pos.lng.toFixed(10)}" lat="${pos.lat.toFixed(10)}"/>`
  }

  // <Control> elements
  const controlsXml = project.controls.map(c => {
    const pos = positionEl(c.position.x, c.position.y)
    const lines = [
      `    <Control type="${iofControlType(c.type)}">`,
      `      <Id>${xmlEscape(controlCode(c))}</Id>`,
      ...(pos ? [pos] : []),
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

    const distances = computeCourseDistances(course, project.controls, project.map, project.measuredLegs)
    const totalLength = resolveCourseLength(course, distances)
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
      if (isScore && typeof cc.scorePoints === 'number' && Number.isFinite(cc.scorePoints)) {
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
    if (totalLength > 0) {
      courseChildren.push(`      <Length>${Math.round(totalLength)}</Length>`)
    }
    if (typeof course.climb === 'number' && Number.isFinite(course.climb) && course.climb > 0) {
      courseChildren.push(`      <Climb>${Math.round(course.climb)}</Climb>`)
    }

    return [
      '    <Course>',
      ...courseChildren,
      courseControlsXml,
      '    </Course>',
    ].join('\n')
  }).filter(Boolean).join('\n')

  // <ClassCourseAssignment> elements
  const classAssignments: string[] = []
  for (const rc of project.classes) {
    const course = project.courses.find(c => c.id === rc.courseId)
    if (!course) continue

    if (course.relayLegs && course.variations && course.variations.length > 0) {
      for (const v of course.variations) {
        if (v.relayLeg == null) continue
        const lines = [
          '    <ClassCourseAssignment>',
          `      <ClassName>${xmlEscape(rc.name)}</ClassName>`,
          `      <CourseName>${xmlEscape(`${course.name} - ${v.name}`)}</CourseName>`,
          `      <CourseFamily>${xmlEscape(course.name)}</CourseFamily>`,
          `      <AllowedOnLeg>${v.relayLeg}</AllowedOnLeg>`,
        ]
        if (rc.competitors != null) lines.push(`      <NumberOfCompetitors>${rc.competitors}</NumberOfCompetitors>`)
        lines.push('    </ClassCourseAssignment>')
        classAssignments.push(lines.join('\n'))
      }
    } else {
      const lines = [
        '    <ClassCourseAssignment>',
        `      <ClassName>${xmlEscape(rc.name)}</ClassName>`,
        `      <CourseName>${xmlEscape(course.name)}</CourseName>`,
      ]
      if (rc.competitors != null) lines.push(`      <NumberOfCompetitors>${rc.competitors}</NumberOfCompetitors>`)
      lines.push('    </ClassCourseAssignment>')
      classAssignments.push(lines.join('\n'))
    }
  }
  const classAssignmentsXml = classAssignments.join('\n')

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

export function exportIofXmlV2(project: Project): string {
  const controlMap = new Map<string, Control>(project.controls.map(c => [c.id, c]))
  const isOcad = project.map.type === 'ocad'
  const unitAttr = isOcad ? '' : ' unit="other"'

  function mapPos(x: number, y: number): string {
    const p = toIofCoords(x, y, project.map)
    return `<MapPosition x="${p.x}" y="${p.y}"${unitAttr}/>`
  }

  // Map element: Scale + upper-left corner
  const ox = project.map.originX ?? 0
  const oy = project.map.originY ?? 0
  const tl = toIofCoords(ox, oy, project.map)
  const mapXml = [
    '  <Map>',
    `    <Scale>${project.map.scale}</Scale>`,
    `    <MapPosition x="${tl.x}" y="${tl.y}"${unitAttr}/>`,
    '  </Map>',
  ].join('\n')

  const starts = project.controls.filter(c => c.type === 'start')
  const finishes = project.controls.filter(c => c.type === 'finish')
  const normals = project.controls.filter(c => c.type === 'control')

  const startPointsXml = starts.map(c => [
    '  <StartPoint>',
    `    <StartPointCode>${xmlEscape(controlCode(c))}</StartPointCode>`,
    `    ${mapPos(c.position.x, c.position.y)}`,
    '  </StartPoint>',
  ].join('\n')).join('\n')

  const controlsXml = normals.map(c => [
    '  <Control>',
    `    <ControlCode>${xmlEscape(controlCode(c))}</ControlCode>`,
    `    ${mapPos(c.position.x, c.position.y)}`,
    '  </Control>',
  ].join('\n')).join('\n')

  const finishPointsXml = finishes.map(c => [
    '  <FinishPoint>',
    `    <FinishPointCode>${xmlEscape(controlCode(c))}</FinishPointCode>`,
    `    ${mapPos(c.position.x, c.position.y)}`,
    '  </FinishPoint>',
  ].join('\n')).join('\n')

  // Expand variations
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

  // Per-parent-course variation counter: CourseVariationId must be unique
  // within a course family, not globally across all expanded export courses.
  const familyVarIdx = new Map<string, number>()
  const coursesXml = exportCourses.map(({ course, family }) => {
    const resolvedControls = course.controls
      .map(cc => controlMap.get(cc.controlId))
      .filter((c): c is Control => c !== undefined)

    if (resolvedControls.length < 2) return ''

    const distances = computeCourseDistances(course, project.controls, project.map, project.measuredLegs)
    const totalLength = resolveCourseLength(course, distances)

    const first = resolvedControls[0]
    const last = resolvedControls[resolvedControls.length - 1]

    // CourseControl for non-start/finish controls
    const ccXml = course.controls.map((cc, idx) => {
      if (idx === 0 || idx === course.controls.length - 1) return ''
      const control = controlMap.get(cc.controlId)
      if (!control) return ''
      const children: string[] = [
        `        <Sequence>${idx}</Sequence>`,
        `        <ControlCode>${xmlEscape(controlCode(control))}</ControlCode>`,
      ]
      if (idx > 0 && distances.legs[idx - 1] > 0) {
        children.push(`        <LegLength>${Math.round(distances.legs[idx - 1])}</LegLength>`)
      }
      if (cc.markedRoute) {
        children.push('        <SpecialInstruction>MarkedRoute</SpecialInstruction>')
      }
      return [
        '      <CourseControl>',
        ...children,
        '      </CourseControl>',
      ].join('\n')
    }).filter(Boolean).join('\n')

    const varKey = family ?? course.name
    const varId = (familyVarIdx.get(varKey) ?? 0) + 1
    familyVarIdx.set(varKey, varId)

    const varChildren: string[] = [
      `      <CourseVariationId>${varId}</CourseVariationId>`,
      `      <Name>${xmlEscape(course.name)}</Name>`,
      `      <CourseLength>${Math.round(totalLength)}</CourseLength>`,
    ]
    if (typeof course.climb === 'number' && Number.isFinite(course.climb) && course.climb > 0) {
      varChildren.push(`      <CourseClimb>${Math.round(course.climb)}</CourseClimb>`)
    }
    varChildren.push(`      <StartPointCode>${xmlEscape(controlCode(first))}</StartPointCode>`)

    const varEnd: string[] = []
    varEnd.push(`      <FinishPointCode>${xmlEscape(controlCode(last))}</FinishPointCode>`)

    // Class assignments for this course
    const classRefs = project.classes
      .filter(rc => rc.courseId === course.id)
      .map(rc => `    <ClassShortName>${xmlEscape(rc.name)}</ClassShortName>`)

    return [
      '  <Course>',
      `    <CourseName>${xmlEscape(course.name)}</CourseName>`,
      ...classRefs,
      '    <CourseVariation>',
      ...varChildren,
      ccXml,
      ...varEnd,
      '    </CourseVariation>',
      '  </Course>',
    ].join('\n')
  }).filter(Boolean).join('\n')

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CourseData>',
    '  <IOFVersion version="2.0.3"/>',
    mapXml,
    startPointsXml,
    controlsXml,
    finishPointsXml,
    coursesXml,
    '</CourseData>',
  ].filter(Boolean)

  return parts.join('\n')
}
