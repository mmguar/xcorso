import type { MapPoint } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { defaultControlLabel } from '../lib/courseUtils'

type LegBendSegment = 'taped' | 'nav'

function bendArrayKey(segment: LegBendSegment): 'legBendPoints' | 'legNavBendPoints' {
  return segment === 'nav' ? 'legNavBendPoints' : 'legBendPoints'
}

export function createLegsSlice(_set: SetState, get: GetState, h: StoreHelpers) {
  function legName(courseId: string, courseControlId: string) {
    const p = get().project
    if (!p) return ''
    const course = p.courses.find(c => c.id === courseId)
    if (!course) return ''
    const idx = course.controls.findIndex(cc => cc.id === courseControlId)
    const from = idx > 0 ? p.controls.find(c => c.id === course.controls[idx - 1].controlId) : undefined
    const to = idx >= 0 ? p.controls.find(c => c.id === course.controls[idx].controlId) : undefined
    const leg = from && to ? `${defaultControlLabel(from)}-${defaultControlLabel(to)}` : '?'
    return `${leg} ${course.name}`
  }

  return {
    addLegBendPoint: (courseId: string, courseControlId: string, point: MapPoint, index?: number, segment: LegBendSegment = 'taped') => {
      const ln = legName(courseId, courseControlId)
      const key = bendArrayKey(segment)
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return false
        if (!cc[key]) cc[key] = []
        if (index !== undefined) {
          cc[key]!.splice(index, 0, point)
        } else {
          cc[key]!.push(point)
        }
      }, `Add bend ${ln}`)
    },

    beginMoveLegBendPoint: (label?: string) => h.pushUndoSnapshot(label ?? 'Move bend'),

    moveLegBendPoint: (courseId: string, courseControlId: string, index: number, position: MapPoint, segment: LegBendSegment = 'taped') => {
      const key = bendArrayKey(segment)
      h.mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return false
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return false
        const cc = course.controls[cci]
        if (!cc[key]?.[index]) return false
        const bends = cc[key]!.map((pt, j) => (j === index ? position : pt))
        const newCc = { ...cc, [key]: bends }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },

    removeLegBendPoint: (courseId: string, courseControlId: string, index: number, segment: LegBendSegment = 'taped') => {
      const key = bendArrayKey(segment)
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc?.[key]) return false
        cc[key]!.splice(index, 1)
        if (cc[key]!.length === 0) cc[key] = undefined
      }, `Remove bend ${legName(courseId, courseControlId)}`)
    },

    clearLegBendPoints: (courseId: string, courseControlId: string) => {
      const ln = legName(courseId, courseControlId)
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || (!cc.legBendPoints && !cc.legNavBendPoints)) return false
        cc.legBendPoints = undefined
        cc.legNavBendPoints = undefined
      }, `Clear bends ${ln}`)
    },

    beginMoveMapIssue: () => h.pushUndoSnapshot('Move map issue point'),

    moveMapIssue: (courseId: string, courseControlId: string, t: number) => {
      h.mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return false
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return false
        const cc = course.controls[cci]
        const newCc = { ...cc, mapIssueT: t }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },

    removeMapIssue: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || cc.mapIssueT === undefined) return false
        cc.mapIssueT = undefined
      }, 'Remove map issue point')
    },

    addMapIssue: (courseId: string, courseControlId: string) => {
      h.mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return false
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return false
        cc.mapIssueT = 0.5
      }, 'Add map issue point')
    },

    beginMoveCourseLabel: (label?: string) => h.pushUndoSnapshot(label ?? 'Move course label'),

    moveCourseLabel: (courseId: string, courseControlId: string, offset: MapPoint) => {
      h.mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return false
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return false
        const cc = course.controls[cci]
        const newCc = { ...cc, labelOffset: offset }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },
  }
}
