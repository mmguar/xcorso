import type { Control, Course, CourseControl, RaceClass, MapConfig, ControlType } from '../types'
import { IOF_PURPLE } from './courseUtils'

export interface IofImportResult {
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

export function importIofXml(xmlString: string, map: MapConfig): IofImportResult {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Invalid XML')

  const root = doc.documentElement
  const rcd = childEl(root, 'RaceCourseData')
  if (!rcd) throw new Error('No RaceCourseData element found')

  // -- Controls --
  const controlEls = childEls(rcd, 'Control')
  const codeToId = new Map<string, string>()
  const controls: Control[] = []
  let nextCode = 31

  for (const el of controlEls) {
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

    let code: number
    let label: string | undefined

    if (type === 'start') {
      const m = idText.match(/^S(\d+)$/i)
      code = m ? parseInt(m[1]) : 1
      if (!m && !/^\d+$/.test(idText)) label = idText
    } else if (type === 'finish') {
      const m = idText.match(/^F(\d+)$/i)
      code = m ? parseInt(m[1]) : 1
      if (!m && !/^\d+$/.test(idText)) label = idText
    } else {
      const num = parseInt(idText)
      if (!isNaN(num)) { code = num } else { code = nextCode++; label = idText }
    }

    const id = crypto.randomUUID()
    codeToId.set(idText, id)
    controls.push({ id, type, code, position, ...(label ? { label } : {}) })
  }

  // -- Courses --
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

  // -- Class assignments --
  const classes: RaceClass[] = []

  for (const el of childEls(rcd, 'ClassCourseAssignment')) {
    const className = childText(el, 'ClassName')
    const courseName = childText(el, 'CourseName')
    if (!className || !courseName) continue
    const course = courses.find(c => c.name === courseName)
    if (!course) continue
    classes.push({ id: crypto.randomUUID(), name: className, courseId: course.id })
  }

  return { controls, courses, classes }
}
