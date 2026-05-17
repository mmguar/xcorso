import type { MapPoint } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

export function createLegsSlice(_set: SetState, _get: GetState, h: StoreHelpers) {
  return {
    addLegBendPoint: (courseId: string, courseControlId: string, point: MapPoint, index?: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return
        if (!cc.legBendPoints) cc.legBendPoints = []
        if (index !== undefined) {
          cc.legBendPoints.splice(index, 0, point)
        } else {
          cc.legBendPoints.push(point)
        }
      })
    },

    beginMoveLegBendPoint: () => h.pushUndoSnapshot(),

    moveLegBendPoint: (courseId: string, courseControlId: string, index: number, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return
        const cc = course.controls[cci]
        if (!cc.legBendPoints?.[index]) return
        const legBendPoints = cc.legBendPoints.map((pt, j) => (j === index ? position : pt))
        const newCc = { ...cc, legBendPoints }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },

    removeLegBendPoint: (courseId: string, courseControlId: string, index: number) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc?.legBendPoints) return
        cc.legBendPoints.splice(index, 1)
        if (cc.legBendPoints.length === 0) cc.legBendPoints = undefined
      })
    },

    clearLegBendPoints: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.legBendPoints = undefined
      })
    },

    beginMoveCourseLabel: () => h.pushUndoSnapshot(),

    moveCourseLabel: (courseId: string, courseControlId: string, offset: MapPoint) => {
      h.mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return
        const cc = course.controls[cci]
        const newCc = { ...cc, labelOffset: offset }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },
  }
}
