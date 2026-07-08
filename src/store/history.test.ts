import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store's transitive import (lib/perf) touches `window` at module load;
// tests run in plain node, so alias it before the store module is evaluated.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).window = globalThis
})

import { useStore } from './index'
import { defaultEditor } from './types'
import type { Project } from '../types'

function makeProject(): Project {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    version: '1.0',
    meta: { name: 'Test', createdAt: now, updatedAt: now },
    map: {
      type: 'ocad', filename: 'a.ocd', storage: { mode: 'embedded' },
      scale: 10000, width: 100, height: 100, originX: 0, originY: 0,
      scaleSource: 'ocad',
    },
    controls: [], courses: [], classes: [], annotations: [],
    scaleBars: [], textLabels: [], imageOverlays: [],
    overprint: 1, overprintMode: 'simulated',
  } as Project
}

beforeEach(() => {
  useStore.setState({
    project: makeProject(),
    projectId: 'test-project',
    projectRole: 'owner',
    undoStack: [],
    redoStack: [],
    editor: defaultEditor,
    projectRevision: 0,
    mapFileData: new ArrayBuffer(4),
  })
})

describe('no-op mutations', () => {
  it('do not push undo entries or dirty the project for stale ids', () => {
    const s = useStore.getState()
    const before = s.project!.meta.updatedAt
    s.deleteControl('nope')
    s.updateCourseName('nope', 'x')
    s.deleteAnnotation('nope')
    s.deleteScaleBar('nope')
    expect(useStore.getState().undoStack).toHaveLength(0)
    expect(useStore.getState().project!.meta.updatedAt).toBe(before)
  })
})

describe('blocked mutations', () => {
  it('locked project: addCourse returns null, nothing selected, no history', () => {
    useStore.setState({ project: { ...useStore.getState().project!, locked: true } })
    const c = useStore.getState().addCourse('C1')
    expect(c).toBeNull()
    expect(useStore.getState().editor.selectedCourseId).toBeNull()
    expect(useStore.getState().undoStack).toHaveLength(0)
  })

  it('locked project: drag snapshots are not pushed', () => {
    useStore.setState({ project: { ...useStore.getState().project!, locked: true } })
    useStore.getState().beginMoveControl()
    expect(useStore.getState().undoStack).toHaveLength(0)
  })
})

describe('undo/redo selection reconciliation', () => {
  it('undoing "Add course" clears the dangling course selection', () => {
    const c = useStore.getState().addCourse('C1')!
    expect(useStore.getState().editor.selectedCourseId).toBe(c.id)
    useStore.getState().undo()
    expect(useStore.getState().project!.courses).toHaveLength(0)
    expect(useStore.getState().editor.selectedCourseId).toBeNull()
    expect(useStore.getState().editor.courseViewMode).toBe('all-controls')
  })
})

describe('replaceMapFile', () => {
  it('is not undoable itself but keeps earlier edits undoable', () => {
    useStore.getState().updateProjectName('Renamed')
    const newData = new ArrayBuffer(8)
    useStore.getState().replaceMapFile('b.png', 'bitmap', newData)

    const s = useStore.getState()
    // Same history depth as before the replacement — no entry added.
    expect(s.undoStack).toHaveLength(1)
    // Every history entry carries the new map identity.
    expect(s.undoStack.every(e => e.project.map.filename === 'b.png' && e.project.map.type === 'bitmap')).toBe(true)

    // Undo reverts the rename but never the map file.
    useStore.getState().undo()
    const after = useStore.getState()
    expect(after.project!.meta.name).toBe('Test')
    expect(after.project!.map.filename).toBe('b.png')
    expect(after.project!.map.type).toBe('bitmap')
    expect(after.mapFileData).toBe(newData)
  })
})
