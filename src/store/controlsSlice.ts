import { v4 as uuidv4 } from 'uuid'
import type { Control, ControlType, MapPoint } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'

function nextControlCode(controls: Control[]): number {
  const codes = controls.filter(c => c.type === 'control' || c.type === 'exchange').map(c => c.code)
  if (codes.length === 0) return 31
  return Math.max(...codes) + 1
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
      if ((type === 'control' || type === 'exchange') && !code) finalCode = nextControlCode(project.controls)
      if (type === 'start' && !code) finalCode = nextTypeCode(project.controls, 'start')
      if (type === 'finish' && !code) finalCode = nextTypeCode(project.controls, 'finish')
      const control: Control = { id: uuidv4(), type, code: finalCode, position }
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
      const existing = project.controls.find(c => c.id !== id && c.code === code && (c.type === 'control' || c.type === 'exchange'))
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
  }
}
