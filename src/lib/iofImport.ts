import type { Control, Course, CourseControl, RaceClass, MapConfig, ControlType } from '../types'
import { IOF_PURPLE } from './courseUtils'

interface IofImportResult {
  controls: Control[]
  courses: Course[]
  classes: RaceClass[]
}

function fromIofCoords(iofX: number, iofY: number, map: MapConfig): { x: number; y: number } {
  const oy = map.originY ?? 0
  const yFlip = oy + oy + map.height
  if (map.type === 'ocad') {
    return { x: iofX * 100, y: yFlip - iofY * 100 }
  }
  return { x: iofX, y: yFlip - iofY }
}

function childText(el: Element, tag: string): string | null {
  const child = [...el.children].find(c => c.localName === tag)
  return child?.textContent?.trim() ?? null
}

function childEl(el: Element, tag: string): Element | null {
  return [...el.children].find(c => c.localName === tag) ?? null
}

function childEls(el: Element, tag: string): Element[] {
  return [...el.children].filter(c => c.localName === tag)
}

const DEFAULT_COURSE_COLOR = IOF_PURPLE

function parseXml(xmlString: string): Document {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Invalid XML')
  return doc
}

function parseIofCode(
  codeStr: string,
  type: ControlType,
  nextCode: { value: number },
): { code: number; label?: string } {
  if (type === 'start') {
    const m = codeStr.match(/^S(\d+)$/i)
    const code = m ? parseInt(m[1]) : /^\d+$/.test(codeStr) ? parseInt(codeStr) : 1
    const label = !m && !/^\d+$/.test(codeStr) ? codeStr : undefined
    return { code, label }
  }
  if (type === 'finish') {
    const m = codeStr.match(/^F(\d+)$/i)
    const code = m ? parseInt(m[1]) : /^\d+$/.test(codeStr) ? parseInt(codeStr) : 1
    const label = !m && !/^\d+$/.test(codeStr) ? codeStr : undefined
    return { code, label }
  }
  const num = parseInt(codeStr)
  if (!isNaN(num)) return { code: num }
  return { code: nextCode.value++, label: codeStr }
}

function importIofXmlV3(doc: Document, map: MapConfig): IofImportResult {
  const root = doc.documentElement
  const rcd = childEl(root, 'RaceCourseData')
  if (!rcd) throw new Error('No RaceCourseData element found')

  const codeToId = new Map<string, string>()
  const controls: Control[] = []
  const nextCode = { value: 31 }

  for (const el of childEls(rcd, 'Control')) {
    const typeAttr = (el.getAttribute('type') ?? 'Control').toLowerCase()
    const type: ControlType = typeAttr === 'start' ? 'start' : typeAttr === 'finish' ? 'finish' : 'control'

    const idText = childText(el, 'Id')
    if (!idText) continue

    const mapPos = childEl(el, 'MapPosition')
    if (!mapPos) continue

    const position = fromIofCoords(
      parseFloat(mapPos.getAttribute('x') ?? '0'),
      parseFloat(mapPos.getAttribute('y') ?? '0'),
      map,
    )

    const { code, label } = parseIofCode(idText, type, nextCode)
    const id = crypto.randomUUID()
    codeToId.set(idText, id)
    controls.push({ id, type, code, position, ...(label ? { label } : {}) })
  }

  const courses: Course[] = []

  for (const el of childEls(rcd, 'Course')) {
    const name = childText(el, 'Name') ?? 'Unnamed'
    const climbText = childText(el, 'Climb')

    const courseControls: CourseControl[] = []
    let isScore = false

    for (const ccEl of childEls(el, 'CourseControl')) {
      const ref = childText(ccEl, 'Control')
      if (!ref) continue
      const controlId = codeToId.get(ref)
      if (!controlId) continue

      const scoreText = childText(ccEl, 'Score')
      const scorePoints = scoreText ? parseFloat(scoreText) : undefined
      if (scorePoints !== undefined || ccEl.getAttribute('randomOrder') === 'true') isScore = true

      courseControls.push({
        id: crypto.randomUUID(),
        controlId,
        ...(scorePoints !== undefined ? { scorePoints } : {}),
      })
    }

    if (courseControls.length === 0) continue

    courses.push({
      id: crypto.randomUUID(),
      name,
      type: isScore ? 'score' : 'linear',
      controls: courseControls,
      color: DEFAULT_COURSE_COLOR,
      ...(climbText ? { climb: parseInt(climbText) } : {}),
    })
  }

  const classes: RaceClass[] = []

  for (const el of childEls(rcd, 'ClassCourseAssignment')) {
    const className = childText(el, 'ClassName')
    const courseName = childText(el, 'CourseName')
    if (!className || !courseName) continue
    const course = courses.find(c => c.name === courseName)
    if (!course) continue
    const noc = childText(el, 'NumberOfCompetitors')
    classes.push({ id: crypto.randomUUID(), name: className, courseId: course.id, ...(noc ? { competitors: parseInt(noc) } : {}) })
  }

  return { controls, courses, classes }
}

function importIofXmlV2(doc: Document, map: MapConfig): IofImportResult {
  const root = doc.documentElement
  if (root.localName !== 'CourseData') throw new Error('No CourseData element found')

  const codeToId = new Map<string, string>()
  const controls: Control[] = []
  const nextCode = { value: 31 }

  function addControl(codeStr: string | null, type: ControlType, mapPosEl: Element | null) {
    if (!codeStr || codeToId.has(codeStr)) return
    if (!mapPosEl) return

    const position = fromIofCoords(
      parseFloat(mapPosEl.getAttribute('x') ?? '0'),
      parseFloat(mapPosEl.getAttribute('y') ?? '0'),
      map,
    )

    const { code, label } = parseIofCode(codeStr, type, nextCode)
    const id = crypto.randomUUID()
    codeToId.set(codeStr, id)
    controls.push({ id, type, code, position, ...(label ? { label } : {}) })
  }

  for (const el of childEls(root, 'StartPoint')) {
    addControl(childText(el, 'StartPointCode'), 'start', childEl(el, 'MapPosition'))
  }
  for (const el of childEls(root, 'Control')) {
    addControl(childText(el, 'ControlCode'), 'control', childEl(el, 'MapPosition'))
  }
  for (const el of childEls(root, 'FinishPoint')) {
    addControl(childText(el, 'FinishPointCode'), 'finish', childEl(el, 'MapPosition'))
  }

  function ensurePoint(
    parent: Element,
    codeTag: string,
    pointTag: string,
    type: ControlType,
  ): string | null {
    const code = childText(parent, codeTag)
    if (code) return code

    const pointEl = childEl(parent, pointTag)
    if (!pointEl) return null

    const pointCode = childText(pointEl, codeTag)
    if (!pointCode) return null

    addControl(pointCode, type, childEl(pointEl, 'MapPosition'))
    return pointCode
  }

  function courseControlCode(ccEl: Element): string | null {
    const code = childText(ccEl, 'ControlCode')
    if (code) return code

    const controlEl = childEl(ccEl, 'Control')
    if (!controlEl) return null

    const nestedCode = childText(controlEl, 'ControlCode')
    if (nestedCode && !codeToId.has(nestedCode)) {
      addControl(nestedCode, 'control', childEl(controlEl, 'MapPosition'))
    }
    return nestedCode
  }

  function isMarkedRoute(ccEl: Element): boolean {
    if (ccEl.getAttribute('markedRoute') === 'Y') return true
    return childEls(ccEl, 'SpecialInstruction').some(
      el => el.textContent?.trim().toLowerCase() === 'markedroute',
    )
  }

  const courses: Course[] = []
  const classes: RaceClass[] = []

  for (const courseEl of childEls(root, 'Course')) {
    const courseName = childText(courseEl, 'CourseName') ?? 'Unnamed'
    const classNames = childEls(courseEl, 'ClassShortName')
      .map(el => el.textContent?.trim())
      .filter((name): name is string => Boolean(name))
    const variations = childEls(courseEl, 'CourseVariation')

    for (const varEl of variations) {
      const varName = childText(varEl, 'Name')
      const name = variations.length > 1
        ? `${courseName} - ${varName ?? childText(varEl, 'CourseVariationId') ?? 'Variation'}`
        : (varName ?? courseName)

      const startCode = ensurePoint(varEl, 'StartPointCode', 'StartPoint', 'start')
      const finishCode = ensurePoint(varEl, 'FinishPointCode', 'FinishPoint', 'finish')

      const ccEls = childEls(varEl, 'CourseControl')
      ccEls.sort((a, b) => {
        const seqA = parseInt(childText(a, 'Sequence') ?? '0', 10)
        const seqB = parseInt(childText(b, 'Sequence') ?? '0', 10)
        return seqA - seqB
      })

      const courseControls: CourseControl[] = []

      if (startCode) {
        const controlId = codeToId.get(startCode)
        if (controlId) courseControls.push({ id: crypto.randomUUID(), controlId })
      }

      for (const ccEl of ccEls) {
        const code = courseControlCode(ccEl)
        if (!code) continue
        const controlId = codeToId.get(code)
        if (!controlId) continue
        courseControls.push({
          id: crypto.randomUUID(),
          controlId,
          ...(isMarkedRoute(ccEl) ? { markedRoute: 'full' as const } : {}),
        })
      }

      if (finishCode) {
        const controlId = codeToId.get(finishCode)
        if (controlId) courseControls.push({ id: crypto.randomUUID(), controlId })
      }

      if (courseControls.length === 0) continue

      const climbText = childText(varEl, 'CourseClimb')
      const course: Course = {
        id: crypto.randomUUID(),
        name,
        type: 'linear',
        controls: courseControls,
        color: DEFAULT_COURSE_COLOR,
        ...(climbText ? { climb: parseInt(climbText, 10) } : {}),
      }
      courses.push(course)

      for (const className of classNames) {
        classes.push({ id: crypto.randomUUID(), name: className, courseId: course.id })
      }
    }
  }

  return { controls, courses, classes }
}

export function importIofXml(xmlString: string, map: MapConfig): IofImportResult {
  const doc = parseXml(xmlString)
  const root = doc.documentElement

  if (childEl(root, 'RaceCourseData')) {
    return importIofXmlV3(doc, map)
  }

  if (root.localName === 'CourseData') {
    return importIofXmlV2(doc, map)
  }

  throw new Error('Unrecognized IOF XML format')
}
