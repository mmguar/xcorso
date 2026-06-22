import type { Control, ControlType, MapPoint } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

function nextControlCode(controls: Control[], skipCodes?: number[]): number {
  const used = new Set(controls.filter(c => c.type === 'control').map(c => c.code))
  const skip = new Set(skipCodes)
  let code = 31
  while (used.has(code) || skip.has(code)) code++
  return code
}

function nextTypeCode(controls: Control[], type: ControlType): number {
  const codes = controls.filter(c => c.type === type).map(c => c.code)
  if (codes.length === 0) return 1
  return Math.max(...codes) + 1
}

export function createControlsSlice(_set: SetState, get: GetState, h: StoreHelpers) {
  return {
    addControl: (type: ControlType, position: MapPoint, code?: number): Control => {
      const { project } = get()
      if (!project) throw new Error('No project')
      let finalCode = code ?? 0
      if (type === 'control' && !code) finalCode = nextControlCode(project.controls, project.skipCodes)
      if (type === 'start' && !code) finalCode = nextTypeCode(project.controls, 'start')
      if (type === 'finish' && !code) finalCode = nextTypeCode(project.controls, 'finish')
      const control: Control = { id: crypto.randomUUID(), type, code: finalCode, position }
      h.mutateProject(p => { p.controls.push(control) })
      return control
    },

    beginMoveControl: () => h.pushUndoSnapshot(),

    moveControl: (id: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.controls.findIndex(c => c.id === id)
        if (i === -1) return
        p.controls = p.controls.map((c, j) => (j === i ? { ...c, position } : c))
      })
    },

    // Split a control that is shared across courses: leave the original where it
    // was (it stays in the other courses) and create a brand-new control at the
    // drop position, repointing every reference in `courseId` to it. The new
    // control inherits only its type — fresh code, no description/label/points.
    splitControl: (controlId: string, courseId: string, newPos: MapPoint, originPos: MapPoint): Control => {
      const { project } = get()
      if (!project) throw new Error('No project')
      const orig = project.controls.find(c => c.id === controlId)
      if (!orig) throw new Error('Control not found')
      const code = orig.type === 'control'
        ? nextControlCode(project.controls, project.skipCodes)
        : nextTypeCode(project.controls, orig.type)
      const newControl: Control = { id: crypto.randomUUID(), type: orig.type, code, position: newPos }
      h.mutateProject(p => {
        const o = p.controls.find(c => c.id === controlId)
        if (o) o.position = originPos
        p.controls.push(newControl)
        const course = p.courses.find(c => c.id === courseId)
        if (course) {
          course.controls.forEach(cc => { if (cc.controlId === controlId) cc.controlId = newControl.id })
        }
      })
      return newControl
    },

    beginMoveControlLabel: () => h.pushUndoSnapshot(),

    moveControlLabel: (id: string, offset: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.controls.findIndex(c => c.id === id)
        if (i === -1) return
        p.controls = p.controls.map((c, j) => (j === i ? { ...c, labelOffset: offset } : c))
      })
    },

    deleteControl: (id: string) => {
      h.mutateProject(p => {
        p.controls = p.controls.filter(c => c.id !== id)
        p.courses.forEach(course => {
          course.controls = course.controls.filter(cc => cc.controlId !== id)
        })
      })
    },

    updateControlCode: (id: string, code: number) => {
      const { project } = get()
      if (!project) return
      const existing = project.controls.find(c => c.id !== id && c.code === code && c.type === 'control')
      if (existing) return
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (c) c.code = code
      })
    },

    updateControlLabel: (id: string, label: string) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (c) c.label = label || undefined
      })
    },

    updateControlPoints: (id: string, points: number | undefined) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (c) c.points = points
      })
    },

    updateControlDescription: (id: string, field: string, value: string | undefined) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (!c) return
        if (!c.description) c.description = {}
        ;(c.description as any)[field] = value
        if (Object.values(c.description).every(v => v === undefined)) {
          c.description = undefined
        }
      })
    },

    updateSkipCodes: (codes: number[]) => {
      h.mutateProject(p => {
        if (codes.length > 0) p.skipCodes = codes
        else delete p.skipCodes
      })
    },

    reassignControlIds: () => {
      h.mutateProject(p => {
        const skip = new Set(p.skipCodes)
        const regulars = p.controls.filter(c => c.type === 'control').sort((a, b) => a.code - b.code)
        let code = 31
        for (const ctrl of regulars) {
          while (skip.has(code)) code++
          ctrl.code = code
          code++
        }
      })
    },
  }
}
