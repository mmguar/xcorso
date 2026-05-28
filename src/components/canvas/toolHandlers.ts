import type { Project, Viewport } from '../../types'
import { useStore } from '../../store'
import { unitsPerMm } from '../../lib/courseUtils'
import { resolveSpec, getSymbolDims, symbolScaleFactor } from '../../lib/symbolSpec'
import { screenToMap, findControlAt, findLegAt, findBendPointAt } from './hitTesting'

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
    const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360
    const halfGap = gapSize / 2
    const startAngle = (angle - halfGap + 360) % 360
    const endAngle = (angle + halfGap) % 360
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
