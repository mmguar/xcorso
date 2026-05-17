import type { Project, Viewport } from '../../types'
import { useStore } from '../../store'
import { screenToMap, findControlAt, findLegAt, findBendPointAt } from './hitTesting'

export function handleGapTap(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const gapSize = useStore.getState().editor.gapSize
  const mapPt = screenToMap(sx, sy, vp)
  const hitControl = findControlAt(sx, sy, vp, project, selectedCourseId)

  if (hitControl) {
    const dx = mapPt.x - hitControl.position.x
    const dy = mapPt.y - hitControl.position.y
    const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360
    const halfGap = gapSize / 2
    const startAngle = (angle - halfGap + 360) % 360
    const endAngle = (angle + halfGap) % 360
    useStore.getState().addControlGap(hitControl.id, { startAngle, endAngle })
    return
  }

  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (legHit) {
    const legFraction = gapSize / 360
    const halfGap = legFraction / 2
    const start = Math.max(0, legHit.t - halfGap)
    const end = Math.min(1, legHit.t + halfGap)
    useStore.getState().addLegGap(legHit.courseId, legHit.courseControlId, { start, end })
  }
}

export function handleGapRightClick(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const hitControl = findControlAt(sx, sy, vp, project, selectedCourseId)
  if (hitControl && hitControl.gaps?.length) {
    useStore.getState().clearControlGaps(hitControl.id)
    return
  }
  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (legHit) {
    useStore.getState().clearLegGaps(legHit.courseId, legHit.courseControlId)
  }
}

export function handleBendTap(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const bpHit = findBendPointAt(sx, sy, vp, project, selectedCourseId)
  if (bpHit) return

  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (!legHit) return
  const mapPt = screenToMap(sx, sy, vp)

  const course = project.courses.find(c => c.id === legHit.courseId)
  if (!course) return
  const cc = course.controls.find(c => c.id === legHit.courseControlId)
  if (!cc) return

  const insertIdx = legHit.segmentIndex
  useStore.getState().addLegBendPoint(legHit.courseId, legHit.courseControlId, mapPt, insertIdx)
}

export function handleBendRightClick(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const bpHit = findBendPointAt(sx, sy, vp, project, selectedCourseId)
  if (bpHit) {
    useStore.getState().removeLegBendPoint(bpHit.courseId, bpHit.courseControlId, bpHit.bendIndex)
    return
  }
  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (legHit) {
    useStore.getState().clearLegBendPoints(legHit.courseId, legHit.courseControlId)
  }
}
