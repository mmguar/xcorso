import type { Control, ControlType, MapPoint } from '../types'
import type { SetState, GetState, StoreHelpers } from './types'
import { defaultControlLabel } from '../lib/courseUtils'

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
  const ctrlName = (id: string) => {
    const c = get().project?.controls.find(c => c.id === id)
    return c ? defaultControlLabel(c) : '?'
  }

  return {
    addControl: (type: ControlType, position: MapPoint, code?: number): Control | null => {
      const { project } = get()
      if (!project) throw new Error('No project')
      let finalCode = code ?? 0
      if (type === 'control' && !code) finalCode = nextControlCode(project.controls, project.skipCodes)
      if (type === 'start' && !code) finalCode = nextTypeCode(project.controls, 'start')
      if (type === 'finish' && !code) finalCode = nextTypeCode(project.controls, 'finish')
      const control: Control = { id: crypto.randomUUID(), type, code: finalCode, position }
      // null when blocked (viewer/locked) — callers must not act on a control
      // that never made it into the project.
      return h.mutateProject(p => { p.controls.push(control) }, `Add ${type} ${finalCode}`) ? control : null
    },

    beginMoveControl: (label?: string) => h.pushUndoSnapshot(label ?? 'Move control'),

    moveControl: (id: string, position: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.controls.findIndex(c => c.id === id)
        if (i === -1) return false
        p.controls = p.controls.map((c, j) => (j === i ? { ...c, position } : c))
      })
    },

    // Split a control that is shared across courses: leave the original where it
    // was (it stays in the other courses) and create a brand-new control at the
    // drop position, repointing every reference in `courseId` to it. The new
    // control inherits only its type — fresh code, no description/label/points.
    splitControl: (controlId: string, courseId: string, newPos: MapPoint, originPos: MapPoint): Control | null => {
      const { project } = get()
      if (!project) throw new Error('No project')
      const orig = project.controls.find(c => c.id === controlId)
      if (!orig) throw new Error('Control not found')
      const code = orig.type === 'control'
        ? nextControlCode(project.controls, project.skipCodes)
        : nextTypeCode(project.controls, orig.type)
      const newControl: Control = { id: crypto.randomUUID(), type: orig.type, code, position: newPos }
      const ok = h.mutateProject(p => {
        const o = p.controls.find(c => c.id === controlId)
        if (o) o.position = originPos
        p.controls.push(newControl)
        const course = p.courses.find(c => c.id === courseId)
        if (course) {
          course.controls.forEach(cc => { if (cc.controlId === controlId) cc.controlId = newControl.id })
        }
      }, `Split control ${code}`)
      return ok ? newControl : null
    },

    beginMoveControlLabel: (label?: string) => h.pushUndoSnapshot(label ?? 'Move label'),

    moveControlLabel: (id: string, offset: MapPoint) => {
      h.mutateProjectSilent(p => {
        const i = p.controls.findIndex(c => c.id === id)
        if (i === -1) return false
        p.controls = p.controls.map((c, j) => (j === i ? { ...c, labelOffset: offset } : c))
      })
    },

    deleteControl: (id: string) => {
      const ctrl = get().project?.controls.find(c => c.id === id)
      if (!ctrl) return
      const ok = h.mutateProject(p => {
        p.controls = p.controls.filter(c => c.id !== id)
        p.courses.forEach(course => {
          course.controls = course.controls.filter(cc => cc.controlId !== id)
        })
      }, `Delete ${defaultControlLabel(ctrl)}`)
      if (!ok) return
      _set(state => ({
        editor: { ...state.editor, selectedControlId: state.editor.selectedControlId === id ? null : state.editor.selectedControlId },
      }))
    },

    updateControlCode: (id: string, code: number) => {
      const { project } = get()
      if (!project) return
      const existing = project.controls.find(c => c.id !== id && c.code === code && c.type === 'control')
      if (existing) return
      const old = project.controls.find(c => c.id === id)
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (!c) return false
        c.code = code
      }, `Renumber ${old?.code ?? '?'} → ${code}`)
    },

    updateControlLabel: (id: string, label: string) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (!c) return false
        c.label = label || undefined
      }, `Edit label ${ctrlName(id)}`)
    },

    updateControlPoints: (id: string, points: number | undefined) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (!c) return false
        c.points = points
      }, `Edit points ${ctrlName(id)}`)
    },

    updateControlDescription: (id: string, field: string, value: string | undefined) => {
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (!c) return false
        if (!c.description) c.description = {}
        ;(c.description as Record<string, string | undefined>)[field] = value
        if (Object.values(c.description).every(v => v === undefined)) {
          c.description = undefined
        }
      }, `Edit description ${ctrlName(id)}`)
    },

    autoFillDescription: async (controlId: string) => {
      const state = get()
      if (!state.project || state.project.map.type !== 'ocad') return
      const control = state.project.controls.find(c => c.id === controlId)
      if (!control || control.description?.feature) return
      const index = await get().ensureFeatureIndex()
      if (!index) return
      const suggestions = index.suggest(control.position, state.project.map.scale)
      if (suggestions.length === 0) return
      const top = suggestions[0]
      const runner = suggestions[1]
      // Auto-fill only when the top suggestion is within 1 mm AND clearly ahead
      if (top.distanceMm > 1) return
      if (runner && top.distanceMm >= runner.distanceMm * 0.5) return
      h.mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c) return false
        if (c.description?.feature) return false
        if (!c.description) c.description = {}
        c.description.feature = top.code
      }, `Auto-fill description ${ctrlName(controlId)}`)
    },

    bulkAutoFillDescriptions: async (): Promise<{ filled: number; ambiguous: number; empty: number }> => {
      const state = get()
      if (!state.project || state.project.map.type !== 'ocad') return { filled: 0, ambiguous: 0, empty: 0 }
      const index = await get().ensureFeatureIndex()
      if (!index) return { filled: 0, ambiguous: 0, empty: 0 }
      let filled = 0, ambiguous = 0, empty = 0
      const fills: { id: string; code: string }[] = []
      for (const control of state.project.controls) {
        if (control.description?.feature) continue
        const suggestions = index.suggest(control.position, state.project.map.scale)
        if (suggestions.length === 0) { empty++; continue }
        const top = suggestions[0]
        const runner = suggestions[1]
        if (top.distanceMm > 1 || (runner && top.distanceMm >= runner.distanceMm * 0.5)) {
          ambiguous++; continue
        }
        fills.push({ id: control.id, code: top.code })
      }
      if (fills.length > 0) {
        h.mutateProject(p => {
          for (const { id, code } of fills) {
            const c = p.controls.find(c => c.id === id)
            if (!c) continue
            if (!c.description) c.description = {}
            if (!c.description.feature) {
              c.description.feature = code
              filled++
            }
          }
        }, `Auto-fill ${fills.length} descriptions`)
      }
      return { filled, ambiguous, empty }
    },

    updateSkipCodes: (codes: number[]) => {
      h.mutateProject(p => {
        if (codes.length > 0) p.skipCodes = codes
        else delete p.skipCodes
      }, 'Update skip codes')
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
      }, 'Reassign control IDs')
    },
  }
}
