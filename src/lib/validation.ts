import type { Project, Control, Course, MapConfig, MapPoint } from '../types'
import { controlsById } from './courseUtils'
import { distance } from './geometry'
import { mapUnitsToMetres } from './distance'

// ── Types ────────────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  key: string
  courseId?: string
  controlId?: string
  controlId2?: string
  courseId2?: string
  legIndex?: number
  legIndex2?: number
  distanceM?: number
}

export interface ValidationCriterion {
  id: string
  severity: ValidationSeverity
  issues: ValidationIssue[]
}

export interface ValidationResult {
  criteria: ValidationCriterion[]
  canMeasureDistances: boolean
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)
}

function segmentsIntersect(a1: MapPoint, a2: MapPoint, b1: MapPoint, b2: MapPoint): boolean {
  const d1 = cross(b1.x, b1.y, b2.x, b2.y, a1.x, a1.y)
  const d2 = cross(b1.x, b1.y, b2.x, b2.y, a2.x, a2.y)
  const d3 = cross(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y)
  const d4 = cross(a1.x, a1.y, a2.x, a2.y, b2.x, b2.y)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function pointToSegmentDistSq(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  const px = a.x + t * dx, py = a.y + t * dy
  return (p.x - px) ** 2 + (p.y - py) ** 2
}

// ── Thresholds (metres) ──────────────────────────────────────────────────────

const THRESHOLDS = {
  'isom-2017': { closeControl: 30, shortLeg: 50, longLeg: 3000, controlOnLeg: 30, parallelLeg: 30 },
  'issprm-2019': { closeControl: 15, shortLeg: 25, longLeg: 800, controlOnLeg: 15, parallelLeg: 15 },
} as const

// ── Helpers ──────────────────────────────────────────────────────────────────

function metresToMapUnits(metres: number, map: MapConfig): number {
  if (map.type === 'ocad') return metres * 100000 / map.scale
  if (map.scaleMeasurement) {
    const { p1, p2, realWorldMeters } = map.scaleMeasurement
    const d = distance(p1, p2)
    if (d > 0 && realWorldMeters > 0) return metres * d / realWorldMeters
  }
  return 0
}

interface ResolvedLeg {
  from: MapPoint; to: MapPoint
  fromControlId: string; toControlId: string
  index: number; distM: number
}

function resolveLegs(course: Course, cmap: Map<string, Control>, map: MapConfig): ResolvedLeg[] {
  const legs: ResolvedLeg[] = []
  for (let i = 0; i < course.controls.length - 1; i++) {
    const a = cmap.get(course.controls[i].controlId)
    const b = cmap.get(course.controls[i + 1].controlId)
    if (!a || !b) continue
    legs.push({
      from: a.position, to: b.position,
      fromControlId: a.id, toControlId: b.id,
      index: i, distM: mapUnitsToMetres(distance(a.position, b.position), map),
    })
  }
  return legs
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function validateProject(project: Project): ValidationResult {
  const { controls, courses, classes, map } = project
  const controlMap = controlsById(controls)
  const canMeasure = map.type === 'ocad' || !!map.scaleMeasurement
  const spec = project.spec ?? 'isom-2017'
  const th = THRESHOLDS[spec] ?? THRESHOLDS['isom-2017']
  const criteria: ValidationCriterion[] = []

  const courseLegs = new Map<string, ResolvedLeg[]>()
  for (const c of courses) courseLegs.set(c.id, resolveLegs(c, controlMap, map))

  const usedIds = new Set<string>()
  for (const c of courses) for (const cc of c.controls) usedIds.add(cc.controlId)

  const forkIds = new Map<string, Set<string>>()
  for (const c of courses) {
    const s = new Set<string>()
    for (const l of c.loops ?? []) {
      s.add(l.forkControlId)
      if (l.forkControlId2) s.add(l.forkControlId2)
    }
    forkIds.set(c.id, s)
  }

  // 1. No start
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear') continue
      if (!c.controls.some(cc => controlMap.get(cc.controlId)?.type === 'start'))
        issues.push({ key: `no-start:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'no-start', severity: 'error', issues })
  }

  // 2. No finish
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear') continue
      if (!c.controls.some(cc => controlMap.get(cc.controlId)?.type === 'finish'))
        issues.push({ key: `no-finish:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'no-finish', severity: 'error', issues })
  }

  // 3. No controls
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (!c.controls.some(cc => controlMap.get(cc.controlId)?.type === 'control'))
        issues.push({ key: `no-controls:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'no-controls', severity: 'error', issues })
  }

  // 4. Start not first
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear' || c.controls.length === 0) continue
      const first = controlMap.get(c.controls[0].controlId)
      if (first?.type !== 'start' && c.controls.some(cc => controlMap.get(cc.controlId)?.type === 'start'))
        issues.push({ key: `start-not-first:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'start-not-first', severity: 'error', issues })
  }

  // 5. Finish not last
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear' || c.controls.length === 0) continue
      const last = controlMap.get(c.controls[c.controls.length - 1].controlId)
      if (last?.type !== 'finish' && c.controls.some(cc => controlMap.get(cc.controlId)?.type === 'finish'))
        issues.push({ key: `finish-not-last:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'finish-not-last', severity: 'error', issues })
  }

  // 6. Duplicate control in course (outside loops)
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      const forks = forkIds.get(c.id)!
      const counts = new Map<string, number>()
      for (const cc of c.controls) {
        if (forks.has(cc.controlId)) continue
        counts.set(cc.controlId, (counts.get(cc.controlId) ?? 0) + 1)
      }
      for (const [ctrlId, n] of counts) {
        if (n > 1) issues.push({ key: `dup-in-course:${c.id}:${ctrlId}`, courseId: c.id, controlId: ctrlId })
      }
    }
    criteria.push({ id: 'duplicate-in-course', severity: 'warning', issues })
  }

  // 7. Duplicate codes (same type, different controls)
  {
    const issues: ValidationIssue[] = []
    const byCodeType = new Map<string, Control[]>()
    for (const ctrl of controls) {
      const k = `${ctrl.code}:${ctrl.type}`
      const list = byCodeType.get(k) ?? []
      list.push(ctrl)
      byCodeType.set(k, list)
    }
    for (const [, ctrls] of byCodeType) {
      if (ctrls.length > 1) {
        const [a, b] = ctrls.map(c => c.id).sort()
        issues.push({ key: `dup-code:${a}:${b}`, controlId: ctrls[0].id, controlId2: ctrls[1].id })
      }
    }
    criteria.push({ id: 'duplicate-codes', severity: 'error', issues })
  }

  // 8. Controls too close
  {
    const issues: ValidationIssue[] = []
    if (canMeasure) {
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const d = mapUnitsToMetres(distance(controls[i].position, controls[j].position), map)
          if (d > 0 && d < th.closeControl) {
            const [a, b] = [controls[i].id, controls[j].id].sort()
            issues.push({ key: `close:${a}:${b}`, controlId: controls[i].id, controlId2: controls[j].id, distanceM: d })
          }
        }
      }
    }
    criteria.push({ id: 'controls-close', severity: 'warning', issues })
  }

  // 9. Unused controls
  {
    const issues: ValidationIssue[] = []
    for (const ctrl of controls) {
      if (!usedIds.has(ctrl.id)) issues.push({ key: `unused:${ctrl.id}`, controlId: ctrl.id })
    }
    criteria.push({ id: 'unused-controls', severity: 'info', issues })
  }

  // 10. Missing descriptions
  {
    const issues: ValidationIssue[] = []
    for (const ctrl of controls) {
      if (ctrl.type !== 'control') continue
      const d = ctrl.description
      if (!d || !Object.values(d).some(v => v != null && v !== ''))
        issues.push({ key: `no-desc:${ctrl.id}`, controlId: ctrl.id })
    }
    criteria.push({ id: 'missing-descriptions', severity: 'info', issues })
  }

  // 11. Dog leg (A→B→A outside loops)
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear') continue
      const forks = forkIds.get(c.id)!
      for (let i = 0; i < c.controls.length - 2; i++) {
        const a = c.controls[i].controlId
        const b = c.controls[i + 1].controlId
        const cc = c.controls[i + 2].controlId
        if (a === cc && a !== b && !forks.has(a))
          issues.push({ key: `dog-leg:${c.id}:${i}`, courseId: c.id, controlId: a, controlId2: b })
      }
    }
    criteria.push({ id: 'dog-leg', severity: 'warning', issues })
  }

  // 12. Leg crossing (within same course)
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear') continue
      const legs = courseLegs.get(c.id)!
      for (let i = 0; i < legs.length; i++) {
        for (let j = i + 2; j < legs.length; j++) {
          if (segmentsIntersect(legs[i].from, legs[i].to, legs[j].from, legs[j].to))
            issues.push({ key: `leg-cross:${c.id}:${i}:${j}`, courseId: c.id, legIndex: i, legIndex2: j })
        }
      }
    }
    criteria.push({ id: 'leg-crossing', severity: 'warning', issues })
  }

  // 13. Control on another course's leg
  {
    const issues: ValidationIssue[] = []
    if (canMeasure) {
      const thU = metresToMapUnits(th.controlOnLeg, map)
      const thSq = thU * thU
      if (thU > 0) {
        for (const ctrl of controls) {
          for (const c of courses) {
            if (c.controls.some(cc => cc.controlId === ctrl.id)) continue
            const legs = courseLegs.get(c.id)!
            for (const leg of legs) {
              if (pointToSegmentDistSq(ctrl.position, leg.from, leg.to) < thSq) {
                const d = mapUnitsToMetres(Math.sqrt(pointToSegmentDistSq(ctrl.position, leg.from, leg.to)), map)
                issues.push({ key: `on-leg:${ctrl.id}:${c.id}`, controlId: ctrl.id, courseId: c.id, legIndex: leg.index, distanceM: d })
                break
              }
            }
          }
        }
      }
    }
    criteria.push({ id: 'control-on-leg', severity: 'warning', issues })
  }

  // 14. No classes assigned
  {
    const issues: ValidationIssue[] = []
    const withClasses = new Set(classes.map(c => c.courseId))
    for (const c of courses) {
      if (!withClasses.has(c.id)) issues.push({ key: `no-class:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'no-classes', severity: 'info', issues })
  }

  // 15. Class references invalid course
  {
    const issues: ValidationIssue[] = []
    const courseIdSet = new Set(courses.map(c => c.id))
    for (const cls of classes) {
      if (!courseIdSet.has(cls.courseId))
        issues.push({ key: `invalid-class:${cls.id}`, controlId: cls.id })
    }
    criteria.push({ id: 'class-invalid-course', severity: 'error', issues })
  }

  // 16. Short legs
  {
    const issues: ValidationIssue[] = []
    if (canMeasure) {
      for (const c of courses) {
        if (c.type !== 'linear') continue
        for (const leg of courseLegs.get(c.id)!) {
          if (leg.distM > 0 && leg.distM < th.shortLeg)
            issues.push({ key: `short:${c.id}:${leg.index}`, courseId: c.id, controlId: leg.fromControlId, controlId2: leg.toControlId, distanceM: leg.distM })
        }
      }
    }
    criteria.push({ id: 'short-legs', severity: 'info', issues })
  }

  // 17. Long legs
  {
    const issues: ValidationIssue[] = []
    if (canMeasure) {
      for (const c of courses) {
        if (c.type !== 'linear') continue
        for (const leg of courseLegs.get(c.id)!) {
          if (leg.distM > th.longLeg)
            issues.push({ key: `long:${c.id}:${leg.index}`, courseId: c.id, controlId: leg.fromControlId, controlId2: leg.toControlId, distanceM: leg.distM })
        }
      }
    }
    criteria.push({ id: 'long-legs', severity: 'info', issues })
  }

  // 18. Parallel legs (different courses, endpoints close, no shared controls)
  {
    const issues: ValidationIssue[] = []
    if (canMeasure) {
      const thU = metresToMapUnits(th.parallelLeg, map)
      const thSq = thU * thU
      if (thU > 0) {
        for (let ci = 0; ci < courses.length; ci++) {
          if (courses[ci].type !== 'linear') continue
          const la = courseLegs.get(courses[ci].id)!
          for (let cj = ci + 1; cj < courses.length; cj++) {
            if (courses[cj].type !== 'linear') continue
            const lb = courseLegs.get(courses[cj].id)!
            for (const a of la) {
              for (const b of lb) {
                if (a.fromControlId === b.fromControlId || a.fromControlId === b.toControlId ||
                    a.toControlId === b.fromControlId || a.toControlId === b.toControlId) continue
                const d11 = (a.from.x - b.from.x) ** 2 + (a.from.y - b.from.y) ** 2
                const d22 = (a.to.x - b.to.x) ** 2 + (a.to.y - b.to.y) ** 2
                const d12 = (a.from.x - b.to.x) ** 2 + (a.from.y - b.to.y) ** 2
                const d21 = (a.to.x - b.from.x) ** 2 + (a.to.y - b.from.y) ** 2
                if ((d11 < thSq && d22 < thSq) || (d12 < thSq && d21 < thSq)) {
                  issues.push({
                    key: `parallel:${courses[ci].id}:${a.index}:${courses[cj].id}:${b.index}`,
                    courseId: courses[ci].id, courseId2: courses[cj].id,
                    controlId: a.fromControlId, controlId2: a.toControlId,
                  })
                }
              }
            }
          }
        }
      }
    }
    criteria.push({ id: 'parallel-legs', severity: 'warning', issues })
  }

  // 19. Missing map issue point (taped start without map issue)
  {
    const issues: ValidationIssue[] = []
    for (const c of courses) {
      if (c.type !== 'linear' || c.controls.length === 0) continue
      const cc0 = c.controls[0]
      const ctrl = controlMap.get(cc0.controlId)
      if (ctrl?.type === 'start' && cc0.markedRoute && cc0.mapIssueT == null)
        issues.push({ key: `no-map-issue:${c.id}`, courseId: c.id })
    }
    criteria.push({ id: 'missing-map-issue', severity: 'warning', issues })
  }

  return { criteria, canMeasureDistances: canMeasure }
}

// ── Counts ───────────────────────────────────────────────────────────────────

export function countActiveIssues(
  result: ValidationResult,
  ignoredCriteria: string[],
  ignoredInstances: string[],
): number {
  const ic = new Set(ignoredCriteria)
  const ii = new Set(ignoredInstances)
  let n = 0
  for (const c of result.criteria) {
    if (c.severity === 'info' || ic.has(c.id)) continue
    for (const issue of c.issues) if (!ii.has(issue.key)) n++
  }
  return n
}
