import type { Control, Course, CourseControl, CourseLoop, CourseVariation, MapConfig, MapPoint, ControlType, EventSpec, CourseLayout, SubmapLayout } from '../types'
import { getSymbolDims, symbolScaleFactor, symbolLabelOffset } from './symbolSpec'
import { distance } from './geometry'

// IOF CMYK 35/85/0/0 converted to sRGB via US SWOP profile (same method as Purple Pen).
export const IOF_PURPLE = '#AA499B'

export function controlsById(controls: Control[]): Map<string, Control> {
  return new Map(controls.map(c => [c.id, c]))
}

export function defaultControlLabel(control: { type: string; code: number; label?: string }): string {
  if (control.label) return control.label
  if (control.type === 'start') return `S${control.code}`
  if (control.type === 'finish') return `F${control.code}`
  return String(control.code)
}

const DEFAULT_PX_PER_MM = 4

export function unitsPerMm(map: MapConfig): number {
  if (map.type === 'ocad') return 100
  if (map.scaleMeasurement) {
    const { p1, p2, realWorldMeters } = map.scaleMeasurement
    const pixelDist = distance(p1, p2)
    if (pixelDist > 0 && map.scale > 0) {
      // realWorldMeters × 1000 = real-world mm; ÷ scale = mm on paper. Must stay
      // consistent with mapToMm/mmToMap in pdfExport.ts (same ×1000 factor).
      const mmOnPaper = (realWorldMeters * 1000) / map.scale
      return pixelDist / mmOnPaper
    }
  }
  return DEFAULT_PX_PER_MM
}

export function defaultLabelOffset(type: ControlType, upm: number, controlScale: number, spec: EventSpec = 'isom-2017', mapScale?: number): MapPoint {
  const sf = mapScale != null ? symbolScaleFactor(spec, mapScale) : 1
  return symbolLabelOffset(type, getSymbolDims(spec), upm * controlScale * sf)
}

export function buildSequenceMap(course: Course, controls: Control[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  let seq = 1
  for (const cc of course.controls) {
    const ctrl = controls.find(c => c.id === cc.controlId)
    if (ctrl && ctrl.type === 'control') {
      const existing = map.get(cc.controlId)
      if (existing) existing.push(seq)
      else map.set(cc.controlId, [seq])
      seq++
    }
  }
  return map
}

export function formatSequenceLabel(seqs: number[]): string {
  return seqs.join('/')
}

// ─── Submap utilities ─────────────────────────────────────────────────────

export interface Submap {
  index: number
  controls: CourseControl[]
  label: string
}

export function computeSubmaps(course: Course): Submap[] {
  const exchangeIndices: number[] = []
  for (let i = 0; i < course.controls.length; i++) {
    if (course.controls[i].exchangeMode) exchangeIndices.push(i)
  }
  if (exchangeIndices.length === 0) {
    return [{ index: 0, controls: course.controls, label: '1' }]
  }
  const submaps: Submap[] = []
  let start = 0
  for (let i = 0; i < exchangeIndices.length; i++) {
    const end = exchangeIndices[i]
    submaps.push({
      index: submaps.length,
      controls: course.controls.slice(start, end + 1),
      label: `Map ${submaps.length + 1}`,
    })
    start = end
  }
  submaps.push({
    index: submaps.length,
    controls: course.controls.slice(start),
    label: `Map ${submaps.length + 1}`,
  })
  return submaps
}

/**
 * The SubmapLayout for submap `index`. Submap 0 is the CourseLayout itself;
 * submaps 1..N-1 live in `layout.submapLayouts`. Returns undefined if missing.
 */
export function submapLayoutView(layout: CourseLayout, index: number): SubmapLayout | undefined {
  if (index <= 0) return layout
  return layout.submapLayouts?.[index - 1]
}

// ─── Loop utilities ────────────────────────────────────────────────────────

function extractBranches(course: Course, loop: CourseLoop): CourseControl[][] {
  const forkIndices: number[] = []
  for (let i = 0; i < course.controls.length; i++) {
    if (course.controls[i].controlId === loop.forkControlId) forkIndices.push(i)
  }
  const branches: CourseControl[][] = []
  for (let i = 0; i < forkIndices.length - 1; i++) {
    branches.push(course.controls.slice(forkIndices[i] + 1, forkIndices[i + 1]))
  }
  return branches
}

export function resolveVariation(course: Course, variation: CourseVariation): CourseControl[] {
  const loops = course.loops ?? []
  if (loops.length === 0) return course.controls

  type Span = { start: number; end: number; loopIdx: number }
  const spans: Span[] = []
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]
    const forkIndices: number[] = []
    for (let i = 0; i < course.controls.length; i++) {
      if (course.controls[i].controlId === loop.forkControlId) forkIndices.push(i)
    }
    if (forkIndices.length < 2) continue
    spans.push({ start: forkIndices[0], end: forkIndices[forkIndices.length - 1], loopIdx: li })
  }
  spans.sort((a, b) => a.start - b.start)

  const result: CourseControl[] = []
  let cursor = 0

  for (const span of spans) {
    result.push(...course.controls.slice(cursor, span.start))

    const loop = loops[span.loopIdx]
    const branches = extractBranches(course, loop)
    const perm = variation.loopOrders.find(lo => lo.loopId === loop.id)
    const order = perm ? perm.order : branches.map((_, i) => i)

    const forkCc = course.controls[span.start]
    for (const branchIdx of order) {
      result.push(forkCc)
      if (branchIdx >= 0 && branchIdx < branches.length) {
        result.push(...branches[branchIdx])
      }
    }
    result.push(course.controls[span.end])
    cursor = span.end + 1
  }

  result.push(...course.controls.slice(cursor))
  return result
}

export function generateAllPermutations(course: Course): CourseVariation[] {
  const loops = course.loops ?? []
  if (loops.length === 0) return []

  function permutations(n: number): number[][] {
    if (n <= 1) return [[0]]
    const result: number[][] = []
    for (const perm of permutations(n - 1)) {
      for (let i = n - 1; i >= 0; i--) {
        result.push([...perm.slice(0, i), n - 1, ...perm.slice(i)])
      }
    }
    return result
  }

  const perLoop = loops.map(loop => {
    const branchCount = loop.branchNames.length
    return permutations(branchCount)
  })

  function cartesian(arrays: number[][][]): number[][][] {
    if (arrays.length === 0) return [[]]
    const [first, ...rest] = arrays
    const restCombos = cartesian(rest)
    const result: number[][][] = []
    for (const item of first) {
      for (const combo of restCombos) {
        result.push([item, ...combo])
      }
    }
    return result
  }

  const combos = cartesian(perLoop)
  return combos.map((combo) => {
    const nameParts = combo.map((order, li) =>
      order.map(idx => loops[li].branchNames[idx]).join('')
    )
    return {
      id: crypto.randomUUID(),
      name: nameParts.join('-'),
      loopOrders: combo.map((order, li) => ({
        loopId: loops[li].id,
        order,
      })),
    } satisfies CourseVariation
  })
}
