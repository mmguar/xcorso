import type { CircleGap, LegGap } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { defaultControlLabel } from '../lib/courseUtils'
import { normalizeDeg } from '../lib/geometry'

export function createGapsSlice(_set: SetState, get: GetState, h: StoreHelpers) {
  const ctrlName = (id: string) => {
    const c = get().project?.controls.find(c => c.id === id)
    return c ? defaultControlLabel(c) : '?'
  }
  function legName(courseId: string, courseControlId: string) {
    const p = get().project
    if (!p) return ''
    const course = p.courses.find(c => c.id === courseId)
    if (!course) return ''
    const idx = course.controls.findIndex(cc => cc.id === courseControlId)
    const from = idx >= 0 ? p.controls.find(c => c.id === course.controls[idx].controlId) : undefined
    const to = idx >= 0 && idx + 1 < course.controls.length ? p.controls.find(c => c.id === course.controls[idx + 1].controlId) : undefined
    return from && to ? `${defaultControlLabel(from)}-${defaultControlLabel(to)}` : '?'
  }

  return {
    addControlGap: (controlId: string, gap: CircleGap) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c) return false
        if (!c.gaps) c.gaps = []
        c.gaps.push(gap)
      }, `Add gap ${ctrlName(controlId)}`)
    },

    removeControlGap: (controlId: string, index: number) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c || !c.gaps) return false
        c.gaps.splice(index, 1)
        if (c.gaps.length === 0) c.gaps = undefined
      }, `Remove gap ${ctrlName(controlId)}`)
    },

    // Rebuild: make the arc at `angle` visible again by dropping any gap covering it.
    removeControlGapAtAngle: (controlId: string, angle: number) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c || !c.gaps) return false
        const a = normalizeDeg(angle)
        const before = c.gaps.length
        c.gaps = c.gaps.filter(g => {
          const span = normalizeDeg(g.endAngle - g.startAngle)
          const dist = normalizeDeg(a - g.startAngle)
          return dist > span
        })
        if (c.gaps.length === before) return false
        if (c.gaps.length === 0) c.gaps = undefined
      }, `Rebuild gap ${ctrlName(controlId)}`)
    },

    clearControlGaps: (controlId: string) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c || !c.gaps) return false
        c.gaps = undefined
      }, `Clear gaps ${ctrlName(controlId)}`)
    },

    addLegGap: (courseId: string, courseControlId: string, gap: LegGap) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return false
        if (!cc.legGaps) cc.legGaps = []
        cc.legGaps.push(gap)
      }, `Add leg gap ${legName(courseId, courseControlId)}`)
    },

    removeLegGap: (courseId: string, courseControlId: string, index: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || !cc.legGaps) return false
        cc.legGaps.splice(index, 1)
        if (cc.legGaps.length === 0) cc.legGaps = undefined
      }, `Remove leg gap ${legName(courseId, courseControlId)}`)
    },

    // Rebuild: make the leg visible at `t` again by dropping any gap covering it.
    removeLegGapAtT: (courseId: string, courseControlId: string, t: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || !cc.legGaps) return false
        const before = cc.legGaps.length
        cc.legGaps = cc.legGaps.filter(g => t < g.start || t > g.end)
        if (cc.legGaps.length === before) return false
        if (cc.legGaps.length === 0) cc.legGaps = undefined
      }, `Rebuild leg gap ${legName(courseId, courseControlId)}`)
    },

    clearLegGaps: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || !cc.legGaps) return false
        cc.legGaps = undefined
      }, `Clear leg gaps ${legName(courseId, courseControlId)}`)
    },
  }
}
