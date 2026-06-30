import type { Project, Viewport } from '../../types'
import { useStore } from '../../store'
import { unitsPerMm } from '../../lib/courseUtils'
import { normalizeDeg } from '../../lib/geometry'
import { resolveSpec, getSymbolDims, symbolScaleFactor } from '../../lib/symbolSpec'
import { screenToMap, findControlAt, findLegAt, findBendPointAt, legBendInsertIndex } from './hitTesting'

function gapArcLenMap(project: Project, selectedCourseId: string | null, controlScale: number, gapSize: number): number {
  const upm = unitsPerMm(project.map)
  const course = project.courses.find(c => c.id === selectedCourseId)
  const spec = resolveSpec(project.spec, course?.spec)
  const sf = symbolScaleFactor(spec, project.map.scale)
  return getSymbolDims(spec).controlR * upm * sf * controlScale * gapSize * Math.PI / 180
}

const GAP_EXTRA_PX = 12

export function handleGapTap(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const { gapSize, appearance: { controlScale } } = useStore.getState().editor
  const mapPt = screenToMap(sx, sy, vp)
  const hitControl = findControlAt(sx, sy, vp, project, selectedCourseId, controlScale, GAP_EXTRA_PX)

  if (hitControl) {
    const dx = mapPt.x - hitControl.position.x
    const dy = mapPt.y - hitControl.position.y
    const angle = normalizeDeg(Math.atan2(dy, dx) * 180 / Math.PI)
    const halfGap = gapSize / 2
    const startAngle = normalizeDeg(angle - halfGap)
    const endAngle = normalizeDeg(angle + halfGap)
    useStore.getState().addControlGap(hitControl.id, { startAngle, endAngle })
    return
  }

  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (legHit && legHit.totalLen > 0) {
    const arcLen = gapArcLenMap(project, selectedCourseId, controlScale, gapSize)
    const halfGap = (arcLen / legHit.totalLen) / 2
    const start = Math.max(0, legHit.t - halfGap)
    const end = Math.min(1, legHit.t + halfGap)
    useStore.getState().addLegGap(legHit.courseId, legHit.courseControlId, { start, end })
  }
}

// Rebuild gap: same hitboxes as the gap tool, but instead of cutting a gap it
// removes the gap covering the clicked point so that arc/leg becomes visible again.
export function handleGapRebuildTap(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const { appearance: { controlScale } } = useStore.getState().editor
  const mapPt = screenToMap(sx, sy, vp)
  const hitControl = findControlAt(sx, sy, vp, project, selectedCourseId, controlScale, GAP_EXTRA_PX)

  if (hitControl) {
    const dx = mapPt.x - hitControl.position.x
    const dy = mapPt.y - hitControl.position.y
    const angle = normalizeDeg(Math.atan2(dy, dx) * 180 / Math.PI)
    useStore.getState().removeControlGapAtAngle(hitControl.id, angle)
    return
  }

  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (legHit) {
    useStore.getState().removeLegGapAtT(legHit.courseId, legHit.courseControlId, legHit.t)
  }
}

export function handleGapRightClick(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const { controlScale } = useStore.getState().editor.appearance
  const hitControl = findControlAt(sx, sy, vp, project, selectedCourseId, controlScale)
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

  const { segment, index: insertIdx } = legBendInsertIndex(course, cc, legHit.segmentIndex)
  useStore.getState().addLegBendPoint(legHit.courseId, legHit.courseControlId, mapPt, insertIdx, segment)
}

export function handleBendRightClick(sx: number, sy: number, vp: Viewport, project: Project, selectedCourseId: string | null) {
  const bpHit = findBendPointAt(sx, sy, vp, project, selectedCourseId)
  if (bpHit) {
    useStore.getState().removeLegBendPoint(bpHit.courseId, bpHit.courseControlId, bpHit.bendIndex, bpHit.nav ? 'nav' : 'taped')
    return
  }
  const legHit = findLegAt(sx, sy, vp, project, selectedCourseId)
  if (legHit) {
    useStore.getState().clearLegBendPoints(legHit.courseId, legHit.courseControlId)
  }
}
