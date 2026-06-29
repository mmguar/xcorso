import type { Control, Course, CourseType, CourseControl, RaceClass, EventSpec, FinishType } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { defaultControlLabel, generateAllPermutations, IOF_PURPLE } from '../lib/courseUtils'

function insertBeforeFinish(course: Course, controls: Control[], entries: CourseControl[]) {
  const getType = (id: string) => controls.find(c => c.id === id)?.type
  const finishIdx = course.controls.findIndex(cc => getType(cc.controlId) === 'finish')
  const insertIdx = finishIdx >= 0 ? finishIdx : course.controls.length
  course.controls.splice(insertIdx, 0, ...entries)
}

export function createCoursesSlice(set: SetState, get: GetState, h: StoreHelpers) {
  return {
    addCourse: (name: string, type: CourseType = 'linear'): Course => {
      const { project } = get()
      const controls: CourseControl[] = []
      if (project) {
        const starts = project.controls.filter(c => c.type === 'start')
        const finishes = project.controls.filter(c => c.type === 'finish')
        if (starts.length === 1) controls.push({ id: crypto.randomUUID(), controlId: starts[0].id })
        if (finishes.length === 1) controls.push({ id: crypto.randomUUID(), controlId: finishes[0].id })
      }
      const course: Course = { id: crypto.randomUUID(), name, type, controls, color: IOF_PURPLE }
      h.mutateProject(p => { p.courses.push(course) }, `Add course "${name}"`)

      set(state => ({
        editor: {
          ...state.editor,
          selectedCourseId: course.id,
          selectedControlId: null,
          activeTool: 'select',
          pendingAnnotationPoints: [],
        },
      }))
      return course
    },

    duplicateCourse: (id: string): Course | null => {
      const { project } = get()
      if (!project) return null
      const idx = project.courses.findIndex(c => c.id === id)
      if (idx === -1) return null
      const copy = structuredClone(project.courses[idx])
      copy.id = crypto.randomUUID()
      copy.name = `${copy.name} (copy)`
      for (const cc of copy.controls) cc.id = crypto.randomUUID()
      // Loops are referenced by id from variation permutations — remap both.
      const loopIdMap = new Map<string, string>()
      for (const loop of copy.loops ?? []) {
        const nid = crypto.randomUUID()
        loopIdMap.set(loop.id, nid)
        loop.id = nid
      }
      for (const v of copy.variations ?? []) {
        v.id = crypto.randomUUID()
        for (const lo of v.loopOrders) lo.loopId = loopIdMap.get(lo.loopId) ?? lo.loopId
      }
      h.mutateProject(p => { p.courses.splice(idx + 1, 0, copy) }, `Duplicate course "${copy.name}"`)

      set(state => ({
        editor: {
          ...state.editor,
          selectedCourseId: copy.id,
          selectedControlId: null,
          activeTool: 'select',
          pendingAnnotationPoints: [],
        },
      }))
      return copy
    },

    deleteCourse: (id: string) => {
      const name = get().project?.courses.find(c => c.id === id)?.name
      h.mutateProject(p => {
        p.courses = p.courses.filter(c => c.id !== id)
        p.classes = p.classes.filter(c => c.courseId !== id)
      }, name ? `Delete course "${name}"` : 'Delete course')
      set(state => ({
        editor: {
          ...state.editor,
          selectedCourseId: state.editor.selectedCourseId === id ? null : state.editor.selectedCourseId,
        },
      }))
    },

    updateCourseName: (id: string, name: string) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id); if (c) c.name = name
      }, `Rename course → "${name}"`)
    },

    updateCourseColor: (id: string, color: string) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id); if (c) c.color = color
      }, 'Change course color')
    },

    addControlToCourse: (courseId: string, controlId: string) => {
      const { project } = get()
      if (!project) return
      const control = project.controls.find(c => c.id === controlId)
      if (!control) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return

      const getType = (id: string) => project.controls.find(c => c.id === id)?.type

      const label = `Add ${defaultControlLabel(control)} to ${course.name}`

      if (control.type === 'start') {
        const existing = course.controls.find(cc => getType(cc.controlId) === 'start')
        if (existing?.controlId === controlId) return
        h.mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          c.controls = c.controls.filter(cc => getType(cc.controlId) !== 'start')
          c.controls.unshift({ id: crypto.randomUUID(), controlId })
        }, label)
        return
      }

      if (control.type === 'finish') {
        const existing = course.controls.find(cc => getType(cc.controlId) === 'finish')
        if (existing?.controlId === controlId) return
        h.mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          c.controls = c.controls.filter(cc => getType(cc.controlId) !== 'finish')
          c.controls.push({ id: crypto.randomUUID(), controlId })
        }, label)
        return
      }

      const finishIdx = course.controls.findIndex(cc => getType(cc.controlId) === 'finish')
      const insertIdx = finishIdx >= 0 ? finishIdx : course.controls.length
      const prev = insertIdx > 0 ? course.controls[insertIdx - 1] : null
      if (prev && prev.controlId === controlId) return

      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        insertBeforeFinish(c, p.controls, [{ id: crypto.randomUUID(), controlId }])
      }, label)
    },

    addAllControlsToCourse: (courseId: string) => {
      const { project } = get()
      if (!project) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return
      if (get().editor.selectedCourseId !== courseId) get().setSelectedCourse(courseId)
      const alreadyInCourse = new Set(course.controls.map(cc => cc.controlId))
      const regularControls = project.controls
        .filter(c => c.type === 'control' && !alreadyInCourse.has(c.id))
        .sort((a, b) => a.code - b.code)
      if (regularControls.length === 0) return
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        insertBeforeFinish(c, p.controls, regularControls.map(ctrl => ({ id: crypto.randomUUID(), controlId: ctrl.id })))
      }, `Add all controls to ${course.name}`)
    },

    addControlsToCourseByCode: (courseId: string, codes: (number | string)[]) => {
      const { project } = get()
      if (!project) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return
      if (get().editor.selectedCourseId !== courseId) get().setSelectedCourse(courseId)
      // Tokens match display labels ("31", "S1", "F2", custom labels). Starts
      // and finishes are inserted first into the label map so a regular
      // control with a colliding label wins.
      const byLabel = new Map<string, Control>()
      for (const c of project.controls) {
        if (c.type !== 'control') byLabel.set(defaultControlLabel(c).toUpperCase(), c)
      }
      for (const c of project.controls) {
        if (c.type === 'control') byLabel.set(defaultControlLabel(c).toUpperCase(), c)
      }
      const resolved = codes
        .map(code => byLabel.get(String(code).trim().toUpperCase()))
        .filter((c): c is Control => c != null)
      if (resolved.length === 0) return
      const start = resolved.filter(c => c.type === 'start').pop()
      const finish = resolved.filter(c => c.type === 'finish').pop()
      const regulars = resolved.filter(c => c.type === 'control')
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        const typeOf = (id: string) => p.controls.find(ct => ct.id === id)?.type
        // Same placement rules as addControlToCourse: one start at the front,
        // one finish at the end, regular controls before the finish.
        if (start && !c.controls.some(cc => cc.controlId === start.id)) {
          c.controls = c.controls.filter(cc => typeOf(cc.controlId) !== 'start')
          c.controls.unshift({ id: crypto.randomUUID(), controlId: start.id })
        }
        if (finish && !c.controls.some(cc => cc.controlId === finish.id)) {
          c.controls = c.controls.filter(cc => typeOf(cc.controlId) !== 'finish')
          c.controls.push({ id: crypto.randomUUID(), controlId: finish.id })
        }
        if (regulars.length > 0) {
          insertBeforeFinish(c, p.controls, regulars.map(ctrl => ({ id: crypto.randomUUID(), controlId: ctrl.id })))
        }
      }, `Add controls to ${course.name}`)
    },

    removeControlFromCourse: (courseId: string, courseControlId: string) => {
      const proj = get().project
      const course = proj?.courses.find(c => c.id === courseId)
      const cc = course?.controls.find(cc => cc.id === courseControlId)
      const ctrl = cc ? proj?.controls.find(c => c.id === cc.controlId) : undefined
      const lbl = ctrl && course ? `Remove ${defaultControlLabel(ctrl)} from ${course.name}` : 'Remove control from course'
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (c) c.controls = c.controls.filter(cc => cc.id !== courseControlId)
      }, lbl)
    },

    reorderCourseControls: (courseId: string, controls: CourseControl[]) => {
      const cName = get().project?.courses.find(c => c.id === courseId)?.name ?? ''
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (c) c.controls = controls
      }, `Reorder controls ${cName}`)
    },

    updateScorePoints: (courseId: string, courseControlId: string, points: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.scorePoints = points
      }, 'Update score points')
    },

    updateCourseClimb: (id: string, climb: number | undefined) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.climb = climb
      }, 'Update climb')
    },

    setManualCourseLength: (id: string, metres: number | undefined) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.manualLength = metres
      }, 'Set course length')
    },

    updateCourseFinishType: (id: string, finishType: FinishType) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.finishType = finishType
      }, 'Change finish type')
    },

    updateCourseShowPoints: (id: string, showPoints: boolean) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.showPoints = showPoints
      }, 'Toggle show points')
    },

    updateCourseTextDescriptions: (id: string, textDescriptions: boolean) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.textDescriptions = textDescriptions
      }, 'Toggle text descriptions')
    },

    updateClueSheetFontSize: (size: number | undefined) => {
      h.mutateProject(p => { p.clueSheetFontSize = size }, 'Change font size')
    },

    updateClueSheetHideSubmapRestart: (hide: boolean) => {
      h.mutateProject(p => {
        if (hide) p.clueSheetHideSubmapRestart = true
        else delete p.clueSheetHideSubmapRestart
      }, 'Toggle hide submap restart')
    },

    updateClueSheetSplitSubmaps: (split: boolean) => {
      h.mutateProject(p => {
        if (split) p.clueSheetSplitSubmaps = true
        else delete p.clueSheetSplitSubmaps
      }, 'Toggle split submaps')
    },

    updateClueSheetOverlayColor: (color: string | undefined) => {
      h.mutateProject(p => { p.clueSheetOverlayColor = color || undefined }, 'Change clue sheet overlay color')
    },

    updateClueSheetSeparateColor: (color: string | undefined) => {
      h.mutateProject(p => { p.clueSheetSeparateColor = color || undefined }, 'Change clue sheet separate color')
    },

    updateLabelSubmapStart: (label: boolean) => {
      h.mutateProject(p => {
        if (label) p.labelSubmapStart = true
        else delete p.labelSubmapStart
      }, 'Toggle submap start label')
    },

    updateCourseSpec: (id: string, spec: EventSpec | undefined) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.spec = spec
      }, 'Update course spec')
    },

    addClass: (name: string, courseId: string): RaceClass => {
      const rc: RaceClass = { id: crypto.randomUUID(), name, courseId }
      h.mutateProject(p => { p.classes.push(rc) }, `Add class "${name}"`)
      return rc
    },

    deleteClass: (id: string) => {
      h.mutateProject(p => { p.classes = p.classes.filter(c => c.id !== id) }, 'Delete class')
    },

    updateClassName: (id: string, name: string) => {
      h.mutateProject(p => {
        const c = p.classes.find(c => c.id === id)
        if (c) c.name = name
      }, `Rename class → "${name}"`)
    },

    updateClassCourse: (id: string, courseId: string) => {
      h.mutateProject(p => {
        const c = p.classes.find(c => c.id === id)
        if (c) c.courseId = courseId
      }, 'Change class course')
    },

    toggleCourseLoop: (courseId: string, forkControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        if (!course.loops) course.loops = []
        const existing = course.loops.findIndex(l => l.forkControlId === forkControlId)
        if (existing >= 0) {
          const loopId = course.loops[existing].id
          course.loops.splice(existing, 1)
          if (course.loops.length === 0) course.loops = undefined
          if (course.variations) {
            course.variations = course.variations
              .map(v => ({ ...v, loopOrders: v.loopOrders.filter(lo => lo.loopId !== loopId) }))
            if (course.variations.every(v => v.loopOrders.length === 0)) course.variations = undefined
          }
        } else {
          const forkCount = course.controls.filter(cc => cc.controlId === forkControlId).length
          if (forkCount < 3) return
          const branchCount = forkCount - 1
          const names = Array.from({ length: branchCount }, (_, i) => String.fromCharCode(65 + i))
          const loop = { id: crypto.randomUUID(), forkControlId, branchNames: names }
          course.loops.push(loop)
          course.variations = generateAllPermutations(course)
        }
      }, 'Toggle loop')
    },

    removeCourseLoop: (courseId: string, loopId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course?.loops) return
        course.loops = course.loops.filter(l => l.id !== loopId)
        if (course.loops.length === 0) course.loops = undefined
        if (course.variations) {
          course.variations = course.variations
            .map(v => ({ ...v, loopOrders: v.loopOrders.filter(lo => lo.loopId !== loopId) }))
          if (course.variations.every(v => v.loopOrders.length === 0)) course.variations = undefined
        }
      }, 'Remove loop')
    },

    setExchangeMode: (courseId: string, courseControlId: string, mode: 'exchange' | 'flip') => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.exchangeMode = mode
      }, `Set exchange mode: ${mode}`)
    },

    toggleExchangeControl: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.exchangeMode = cc.exchangeMode ? undefined : 'exchange'
      }, 'Toggle exchange')
    },

    setSelectedVariation: (id: string | null) => {
      set(state => ({
        editor: { ...state.editor, selectedVariationId: id },
      }))
    },
  }
}
