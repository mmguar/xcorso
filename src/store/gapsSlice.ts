import type { CircleGap, LegGap } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

export function createGapsSlice(_set: SetState, _get: GetState, h: StoreHelpers) {
  return {
    addMissingControlGaps: (controlId: string, courseId: string, gapSize: number) => {
      h.mutateProject(p => {
        const controlMap = new Map(p.controls.map(c => [c.id, c]))
        const crs = p.courses.find(c => c.id === courseId)
        if (!crs) return
        const ctrl = controlMap.get(controlId)
        if (!ctrl) return

        const halfGap = gapSize / 2
        const existing = ctrl.gaps ?? []

        const angles: number[] = []
        for (let i = 0; i < crs.controls.length; i++) {
          const cc = crs.controls[i]
          if (cc.controlId !== controlId) continue

          if (i > 0) {
            const prevCtrl = controlMap.get(crs.controls[i - 1].controlId)
            if (prevCtrl) {
              const bends = cc.legBendPoints
              const fromPt = bends?.length ? bends[bends.length - 1] : prevCtrl.position
              angles.push(((Math.atan2(fromPt.y - ctrl.position.y, fromPt.x - ctrl.position.x) * 180 / Math.PI) + 360) % 360)
            }
          }

          if (i < crs.controls.length - 1) {
            const nextCc = crs.controls[i + 1]
            const nextCtrl = controlMap.get(nextCc.controlId)
            if (nextCtrl) {
              const bends = nextCc.legBendPoints
              const toPt = bends?.length ? bends[0] : nextCtrl.position
              angles.push(((Math.atan2(toPt.y - ctrl.position.y, toPt.x - ctrl.position.x) * 180 / Math.PI) + 360) % 360)
            }
          }
        }

        for (const angle of angles) {
          const alreadyCovered = existing.some(g => {
            const span = ((g.endAngle - g.startAngle) + 360) % 360
            const dist = ((angle - g.startAngle) + 360) % 360
            return dist <= span
          })
          if (!alreadyCovered) {
            if (!ctrl.gaps) ctrl.gaps = []
            ctrl.gaps.push({
              startAngle: (angle - halfGap + 360) % 360,
              endAngle: (angle + halfGap) % 360,
            })
          }
        }
      })
    },

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
