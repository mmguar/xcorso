import type { CircleGap, LegGap } from '../types'

// Shared dash-pattern math for control circles and legs. Returns the raw dash
// segment lengths (visible, gap, visible, …) starting from the path origin, or
// null when there are no gaps. Call sites format this for SVG (join with ' ') or
// jsPDF ({ dash, phase }).
//
// `mirror` reflects the gap angles across the horizontal axis (start↔end about
// 0°). SVG circles wind clockwise from 3 o'clock; jsPDF's circle winds the
// opposite way from the same point, so PDF rendering must pass mirror=true to
// keep a gap visually in the same place as the canvas.

export function circleGapDashArray(gaps: CircleGap[], circumference: number, mirror = false): number[] | null {
  if (gaps.length === 0) return null

  // Split wrapping gaps into two non-wrapping segments
  const segments: { start: number; end: number }[] = []
  for (const g of gaps) {
    const a0 = mirror ? -g.endAngle : g.startAngle
    const a1 = mirror ? -g.startAngle : g.endAngle
    const s = ((a0 % 360) + 360) % 360
    const e = ((a1 % 360) + 360) % 360
    if (e < s) {
      segments.push({ start: s, end: 360 })
      if (e > 0) segments.push({ start: 0, end: e })
    } else if (e > s) {
      segments.push({ start: s, end: e })
    }
  }

  // Sort and merge overlapping segments
  segments.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end)
    } else {
      merged.push({ start: seg.start, end: seg.end })
    }
  }

  // Build dash pattern starting from angle 0 (3 o'clock, clockwise)
  const dashes: number[] = []
  let pos = 0
  for (const seg of merged) {
    const gapStart = (seg.start / 360) * circumference
    const gapEnd = (seg.end / 360) * circumference
    const visible = gapStart - pos
    if (visible > 0) dashes.push(visible)
    else if (dashes.length === 0) dashes.push(0)
    dashes.push(gapEnd - Math.max(pos, gapStart))
    pos = gapEnd
  }
  const remaining = circumference - pos
  if (remaining > 0) dashes.push(remaining)

  return dashes
}

export function legGapDashArray(gaps: LegGap[], lineLen: number): number[] | null {
  if (gaps.length === 0) return null
  const sorted = [...gaps].sort((a, b) => a.start - b.start)
  const dashes: number[] = []
  let pos = 0
  for (const g of sorted) {
    const gapStart = g.start * lineLen
    const gapEnd = g.end * lineLen
    // A gap fully inside an earlier one adds nothing; extending past `pos` by a
    // negative amount (and rewinding pos) would corrupt the dash pattern.
    if (gapEnd <= pos) continue
    if (gapStart > pos) {
      dashes.push(gapStart - pos)
      dashes.push(gapEnd - gapStart)
    } else if (dashes.length > 0) {
      dashes[dashes.length - 1] += gapEnd - pos
    } else {
      dashes.push(0)
      dashes.push(gapEnd - pos)
    }
    pos = gapEnd
  }
  const remaining = lineLen - pos
  if (remaining > 0) dashes.push(remaining)
  return dashes
}
