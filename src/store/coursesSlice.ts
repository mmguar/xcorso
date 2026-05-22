import { v4 as uuidv4 } from 'uuid'
import type { Control, Course, CourseType, CourseControl, RaceClass, EventSpec, FinishType } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { generateAllPermutations } from '../lib/courseUtils'

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
        if (starts.length === 1) controls.push({ id: uuidv4(), controlId: starts[0].id })
        if (finishes.length === 1) controls.push({ id: uuidv4(), controlId: finishes[0].id })
      }
      const course: Course = { id: uuidv4(), name, type, controls, color: '#7B2FBE' }
      h.mutateProject(p => { p.courses.push(course) })
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

    deleteCourse: (id: string) => {
      h.mutateProject(p => {
        p.courses = p.courses.filter(c => c.id !== id)
        p.classes = p.classes.filter(c => c.courseId !== id)
      })
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
      })
    },

    updateCourseColor: (id: string, color: string) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id); if (c) c.color = color
      })
    },

    addControlToCourse: (courseId: string, controlId: string) => {
      const { project } = get()
      if (!project) return
      const control = project.controls.find(c => c.id === controlId)
      if (!control) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return

      const getType = (id: string) => project.controls.find(c => c.id === id)?.type

      if (control.type === 'start') {
        const existing = course.controls.find(cc => getType(cc.controlId) === 'start')
        if (existing?.controlId === controlId) return
        h.mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          c.controls = c.controls.filter(cc => getType(cc.controlId) !== 'start')
          c.controls.unshift({ id: uuidv4(), controlId })
        })
        return
      }

      if (control.type === 'finish') {
        const existing = course.controls.find(cc => getType(cc.controlId) === 'finish')
        if (existing?.controlId === controlId) return
        h.mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          c.controls = c.controls.filter(cc => getType(cc.controlId) !== 'finish')
          c.controls.push({ id: uuidv4(), controlId })
        })
        return
      }

      const finishIdx = course.controls.findIndex(cc => getType(cc.controlId) === 'finish')
      const insertIdx = finishIdx >= 0 ? finishIdx : course.controls.length
      const prev = insertIdx > 0 ? course.controls[insertIdx - 1] : null
      if (prev && prev.controlId === controlId) return

      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        insertBeforeFinish(c, p.controls, [{ id: uuidv4(), controlId }])
      })
    },

    addAllControlsToCourse: (courseId: string) => {
      const { project } = get()
      if (!project) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return
      const regularControls = project.controls
        .filter(c => c.type === 'control')
        .sort((a, b) => a.code - b.code)
      if (regularControls.length === 0) return
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        insertBeforeFinish(c, p.controls, regularControls.map(ctrl => ({ id: uuidv4(), controlId: ctrl.id })))
      })
    },

    addControlsToCourseByCode: (courseId: string, codes: number[]) => {
      const { project } = get()
      if (!project) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return
      const controlsByCode = new Map(project.controls.map(c => [c.code, c]))
      const validControls = codes.map(code => controlsByCode.get(code)).filter((c): c is Control => c != null)
      if (validControls.length === 0) return
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        insertBeforeFinish(c, p.controls, validControls.map(ctrl => ({ id: uuidv4(), controlId: ctrl.id })))
      })
    },

    removeControlFromCourse: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (c) c.controls = c.controls.filter(cc => cc.id !== courseControlId)
      })
    },

    reorderCourseControls: (courseId: string, controls: CourseControl[]) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (c) c.controls = controls
      })
    },

    updateScorePoints: (courseId: string, courseControlId: string, points: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.scorePoints = points
      })
    },

    updateCourseClimb: (id: string, climb: number | undefined) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.climb = climb
      })
    },

    updateCourseFinishType: (id: string, finishType: FinishType) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.finishType = finishType
      })
    },

    updateCourseShowPoints: (id: string, showPoints: boolean) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.showPoints = showPoints
      })
    },

    updateCourseTextDescriptions: (id: string, textDescriptions: boolean) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.textDescriptions = textDescriptions
      })
    },

    updateCourseSpec: (id: string, spec: EventSpec | undefined) => {
      h.mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.spec = spec
      })
    },

    addClass: (name: string, courseId: string): RaceClass => {
      const rc: RaceClass = { id: uuidv4(), name, courseId }
      h.mutateProject(p => { p.classes.push(rc) })
      return rc
    },

    deleteClass: (id: string) => {
      h.mutateProject(p => { p.classes = p.classes.filter(c => c.id !== id) })
    },

    updateClassName: (id: string, name: string) => {
      h.mutateProject(p => {
        const c = p.classes.find(c => c.id === id)
        if (c) c.name = name
      })
    },

    updateClassCourse: (id: string, courseId: string) => {
      h.mutateProject(p => {
        const c = p.classes.find(c => c.id === id)
        if (c) c.courseId = courseId
      })
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
          const loop = { id: uuidv4(), forkControlId, branchNames: names }
          course.loops.push(loop)
          course.variations = generateAllPermutations(course)
        }
      })
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
      })
    },

    setExchangeMode: (courseId: string, courseControlId: string, mode: 'exchange' | 'flip') => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.exchangeMode = mode
      })
    },

    toggleExchangeControl: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.exchangeMode = cc.exchangeMode ? undefined : 'exchange'
      })
    },

    setSelectedVariation: (id: string | null) => {
      set(state => ({
        editor: { ...state.editor, selectedVariationId: id },
      }))
    },
  }
}
