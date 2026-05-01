import type { Control, Course } from '../types'

export function defaultControlLabel(control: { type: string; code: number; label?: string }): string {
  if (control.label) return control.label
  if (control.type === 'start') return `S${control.code}`
  if (control.type === 'finish') return `F${control.code}`
  return String(control.code)
}

export function buildSequenceMap(course: Course, controls: Control[]): Map<string, number> {
  const map = new Map<string, number>()
  let seq = 1
  for (const cc of course.controls) {
    const ctrl = controls.find(c => c.id === cc.controlId)
    if (ctrl && ctrl.type === 'control') {
      if (!map.has(cc.controlId)) map.set(cc.controlId, seq)
      seq++
    }
  }
  return map
}
