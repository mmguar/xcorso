import { describe, it, expect } from 'vitest'
import { hashProject, makeSyncMeta } from './sync'
import type { Project } from '../types'

const project: Project = {
  version: '1.0',
  meta: { name: 'Test', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  map: { type: 'ocad', filename: 'x.ocd', storage: { mode: 'embedded' }, scale: 10000, width: 100, height: 100, scaleSource: 'ocad' },
  controls: [],
  courses: [],
  classes: [],
  annotations: [],
  scaleBars: [],
  textLabels: [],
  imageOverlays: [],
}

describe('makeSyncMeta', () => {
  it('always includes a projectHash matching hashProject', async () => {
    const meta = await makeSyncMeta('cloud-1', 3, 'abc', project)
    expect(meta.cloudId).toBe('cloud-1')
    expect(meta.syncVersion).toBe(3)
    expect(meta.mapHash).toBe('abc')
    expect(meta.projectHash).toBe(await hashProject(project))
  })

  it('hash is stable for identical content and changes when content changes', async () => {
    const a = await hashProject(project)
    const b = await hashProject(structuredClone(project))
    expect(a).toBe(b)
    const edited = structuredClone(project)
    edited.controls.push({ id: 'c1', type: 'control', code: 31, position: { x: 1, y: 2 } })
    expect(await hashProject(edited)).not.toBe(a)
  })
})
