import type { CircleGap, LegGap } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

export function createGapsSlice(_set: SetState, _get: GetState, h: StoreHelpers) {
  return {
    addControlGap: (controlId: string, gap: CircleGap) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c) return
        if (!c.gaps) c.gaps = []
        c.gaps.push(gap)
      })
    },

    removeControlGap: (controlId: string, index: number) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c || !c.gaps) return
        c.gaps.splice(index, 1)
        if (c.gaps.length === 0) c.gaps = undefined
      })
    },

    // Rebuild: make the arc at `angle` visible again by dropping any gap covering it.
    removeControlGapAtAngle: (controlId: string, angle: number) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c || !c.gaps) return
        const a = ((angle % 360) + 360) % 360
        c.gaps = c.gaps.filter(g => {
          const span = ((g.endAngle - g.startAngle) + 360) % 360
          const dist = ((a - g.startAngle) + 360) % 360
          return dist > span
        })
        if (c.gaps.length === 0) c.gaps = undefined
      })
    },

    clearControlGaps: (controlId: string) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (c) c.gaps = undefined
      })
    },

    addLegGap: (courseId: string, courseControlId: string, gap: LegGap) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return
        if (!cc.legGaps) cc.legGaps = []
        cc.legGaps.push(gap)
      })
    },

    removeLegGap: (courseId: string, courseControlId: string, index: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || !cc.legGaps) return
        cc.legGaps.splice(index, 1)
        if (cc.legGaps.length === 0) cc.legGaps = undefined
      })
    },

    // Rebuild: make the leg visible at `t` again by dropping any gap covering it.
    removeLegGapAtT: (courseId: string, courseControlId: string, t: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || !cc.legGaps) return
        cc.legGaps = cc.legGaps.filter(g => t < g.start || t > g.end)
        if (cc.legGaps.length === 0) cc.legGaps = undefined
      })
    },

    clearLegGaps: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.legGaps = undefined
      })
    },
  }
}
