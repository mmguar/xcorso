// Unified SVG string generators for course overprint symbols.
// Single source of truth consumed by:
//   - Canvas: React components embed via dangerouslySetInnerHTML
//   - PDF export: parsed and embedded via svg2pdf.js
//   - Image export: rasterized to canvas

import type { MapPoint, CircleGap, LegGap, EventSpec, AppearanceSettings, Annotation, ScaleBar, TextLabel, ImageOverlay, Course, Control } from '../types'
import type { SymbolDims } from './symbolSpec'
import { symbolScaleFactor, symbolLabelOffset, getAnnotationDims } from './symbolSpec'
import type { AnnotationDims } from './symbolSpec'
import { circleGapDashArray, legGapDashArray } from './gapDash'
import {
  startTriangleVertices,
  exchangeTriangleVertices,
  routeXMarkSegments,
  crossingPointCurve,
  northArrowGeometry,
  startTriangleAngle,
  exchangeTriangleAngle,
} from './symbolGeometry'
import { walkPath, clipPolyline, clipPolylineEnd, polylineLength, smoothPathD, interpolatePolyline, flattenSmooth } from './geometry'
import { darkenHex } from './color'
import { formatScaleBarDistance, scaleBarLayoutMm } from './distance'
import { measureTextWidth } from './textMeasure'
import { controlSymbolRadiusMm } from './symbolSpec'
import type { ControlType } from '../types'
import { buildSequenceMap, defaultControlLabel, formatSequenceLabel, IOF_PURPLE } from './courseUtils'

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function dashAttr(dashes: number[] | null): string {
  return dashes ? ` stroke-dasharray="${dashes.join(' ')}"` : ''
}

// ── Control symbols ─────────────────────────────────────────────────────────

interface ControlRenderOpts {
  type: ControlType
  position: MapPoint
  /** Pre-baked dims (use dimsFor(spec, appearance)) */
  dims: SymbolDims
  /** symbolScaleFactor(spec, mapScale) * unitsPerMm — or just sf for PDF (1 unit = 1 mm) */
  scale: number
  color: string
  appearance: AppearanceSettings
  isExchange?: boolean
  gaps?: CircleGap[]
  rotation?: number
  label?: string
  labelOffset?: MapPoint
}

export function renderControlSymbol(opts: ControlRenderOpts): string {
  const { type, position, dims, scale, color, appearance, isExchange, gaps, rotation = 0, label, labelOffset } = opts
  const { x, y } = position
  const sf = scale

  let svg = ''

  function shapePass(sw: number, strokeColor: string, extraAttrs = ''): string {
    let s = ''
    if (type === 'start') {
      const side = dims.startSide * sf
      const pts = startTriangleVertices({ x, y }, side, rotation).map(p => `${p.x},${p.y}`).join(' ')
      const perimeter = side * 3
      const dash = gaps?.length ? circleGapDashArray(gaps, perimeter) : null
      s += `<polygon points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"${dashAttr(dash)} stroke-linejoin="round"${extraAttrs}/>`
    } else if (type === 'finish') {
      const rOuter = dims.finishROuter * sf
      const rInner = dims.finishRInner * sf
      const outerDash = gaps?.length ? circleGapDashArray(gaps, 2 * Math.PI * rOuter) : null
      const innerDash = gaps?.length ? circleGapDashArray(gaps, 2 * Math.PI * rInner) : null
      s += `<circle cx="${x}" cy="${y}" r="${rInner}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"${dashAttr(innerDash)}${extraAttrs}/>`
      s += `<circle cx="${x}" cy="${y}" r="${rOuter}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"${dashAttr(outerDash)}${extraAttrs}/>`
    } else if (isExchange) {
      const r = dims.finishROuter * sf
      const circ = 2 * Math.PI * r
      const dash = gaps?.length ? circleGapDashArray(gaps, circ) : null
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"${dashAttr(dash)}${extraAttrs}/>`
      const triPts = exchangeTriangleVertices({ x, y }, r, rotation).map(p => `${p.x},${p.y}`).join(' ')
      s += `<polygon points="${triPts}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" stroke-linejoin="round"${extraAttrs}/>`
    } else {
      const cr = dims.controlR * sf
      const circ = 2 * Math.PI * cr
      const dash = gaps?.length ? circleGapDashArray(gaps, circ) : null
      s += `<circle cx="${x}" cy="${y}" r="${cr}" fill="none" stroke="${strokeColor}" stroke-width="${sw}"${dashAttr(dash)}${extraAttrs}/>`
    }
    return s
  }

  const strokeW = dims.strokeW * sf

  if (appearance.outlineEnabled) {
    svg += shapePass(strokeW + appearance.outlineWidth * 2, appearance.outlineColor)
  }
  svg += shapePass(strokeW, color)

  if (label) {
    svg += renderControlLabel({
      position, type, dims, scale, color, label,
      appearance, labelOffset,
    })
  }

  return svg
}

// ── Control label ───────────────────────────────────────────────────────────

interface LabelRenderOpts {
  position: MapPoint
  type: ControlType
  dims: SymbolDims
  scale: number
  color: string
  label: string
  appearance: AppearanceSettings
  labelOffset?: MapPoint
}

export function renderControlLabel(opts: LabelRenderOpts): string {
  const { position, type, dims, scale, color, label, appearance, labelOffset } = opts
  if (!label) return ''
  const fontSize = dims.labelH * scale
  const off = labelOffset ?? symbolLabelOffset(type, dims, scale)
  const lx = position.x + off.x
  const ly = position.y + off.y

  let outlineAttrs = ''
  if (appearance.outlineEnabled) {
    const outlineSw = appearance.outlineWidth * 2
    outlineAttrs = ` stroke="${appearance.outlineColor}" stroke-width="${outlineSw}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"`
  }

  return `<text x="${lx}" y="${ly}" font-size="${fontSize}" fill="${color}" font-family="Arial, sans-serif" text-anchor="start" dominant-baseline="auto"${outlineAttrs}>${esc(label)}</text>`
}

// ── Legs ────────────────────────────────────────────────────────────────────

interface LegRenderOpts {
  from: MapPoint
  to: MapPoint
  fromType: ControlType
  toType: ControlType
  dims: SymbolDims
  scale: number
  color: string
  appearance: AppearanceSettings
  bendPoints?: MapPoint[]
  gaps?: LegGap[]
  markedRoute?: string
}

export function renderLeg(opts: LegRenderOpts): string {
  const { from, to, fromType, toType, dims, scale, color, appearance, bendPoints, gaps, markedRoute } = opts
  const sf = scale
  const strokeW = dims.legW * sf
  const noGap = !!markedRoute
  const gapMul = noGap ? 1 : 1.4
  const fromR = controlSymbolRadiusMm(fromType, dims) * sf * gapMul
  const toR = controlSymbolRadiusMm(toType, dims) * sf * gapMul

  const fullPts: MapPoint[] = bendPoints?.length ? [from, ...bendPoints, to] : [from, to]
  const fullLen = polylineLength(fullPts)

  const clipped = clipPolyline(fullPts, fromR, toR)
  if (clipped.length < 2) return ''

  const clippedLen = polylineLength(clipped)

  let remapped: LegGap[] | undefined
  if (gaps?.length && fullLen > 0) {
    const clipStart = fromR / fullLen
    const clipEnd = 1 - toR / fullLen
    const clipRange = clipEnd - clipStart
    if (clipRange > 0) {
      remapped = gaps
        .map(g => ({
          start: Math.max(0, (g.start - clipStart) / clipRange),
          end: Math.min(1, (g.end - clipStart) / clipRange),
        }))
        .filter(g => g.end > 0 && g.start < 1)
    }
  }

  const markedDash = markedRoute ? [2 * sf, 0.5 * sf] : null
  const gapDash = !markedRoute && remapped?.length ? legGapDashArray(remapped, clippedLen) : null
  const dashes = markedDash ?? gapDash
  const linecap = dashes ? 'butt' : 'round'

  let pathD: string
  if (markedRoute && clipped.length >= 3) {
    pathD = smoothPathD(clipped)
  } else if (clipped.length === 2) {
    pathD = `M${clipped[0].x},${clipped[0].y} L${clipped[1].x},${clipped[1].y}`
  } else {
    pathD = clipped.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  }

  let svg = ''
  if (appearance.outlineEnabled) {
    svg += `<path d="${pathD}" fill="none" stroke="${appearance.outlineColor}" stroke-width="${strokeW + appearance.outlineWidth * 2}" stroke-linecap="${linecap}" stroke-linejoin="round"${dashAttr(dashes)}/>`
  }
  svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="${linecap}" stroke-linejoin="round"${dashAttr(dashes)}/>`

  return svg
}

// ── Partial marked route (split leg) ────────────────────────────────────────

interface PartialLegRenderOpts {
  from: MapPoint
  to: MapPoint
  divider: MapPoint
  fromType: ControlType
  toType: ControlType
  dims: SymbolDims
  scale: number
  color: string
  appearance: AppearanceSettings
  bendPoints?: MapPoint[]
  navBendPoints?: MapPoint[]
  isFunnelFinish: boolean
}

export function renderPartialLeg(opts: PartialLegRenderOpts): string {
  const { from, to, divider, fromType, toType, dims, scale, color, appearance, bendPoints, navBendPoints, isFunnelFinish } = opts
  const sf = scale
  const strokeW = dims.legW * sf
  const fromR = controlSymbolRadiusMm(fromType, dims) * sf
  const toR = controlSymbolRadiusMm(toType, dims) * sf
  const markedDash = [2 * sf, 0.5 * sf]

  let svg = ''

  function segment(pts: MapPoint[], smooth: boolean, dashed: boolean) {
    if (pts.length < 2) return
    const d = smooth && pts.length >= 3 ? smoothPathD(pts) : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    const cap = dashed ? 'butt' : 'round'
    const dash = dashed ? dashAttr(markedDash) : ''
    if (appearance.outlineEnabled) {
      svg += `<path d="${d}" fill="none" stroke="${appearance.outlineColor}" stroke-width="${strokeW + appearance.outlineWidth * 2}" stroke-linecap="${cap}" stroke-linejoin="round"${dash}/>`
    }
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="${cap}" stroke-linejoin="round"${dash}/>`
  }

  // First segment: from → bends → divider
  const tapedPts: MapPoint[] = bendPoints?.length ? [from, ...bendPoints, divider] : [from, divider]
  const tapedClipped = clipPolyline(tapedPts, fromR, 0)
  if (tapedClipped.length >= 2) {
    segment(tapedClipped, !isFunnelFinish, !isFunnelFinish)
  }

  // Second segment: divider → nav bends → to
  const navPts: MapPoint[] = navBendPoints?.length ? [divider, ...navBendPoints, to] : [divider, to]
  const navClipped = clipPolyline(navPts, 0, toR)
  if (navClipped.length >= 2) {
    segment(navClipped, isFunnelFinish, isFunnelFinish)
  }

  return svg
}

// ── Pre-start taped route ───────────────────────────────────────────────────

interface PreStartRouteOpts {
  startPosition: MapPoint
  startType: ControlType
  dims: SymbolDims
  scale: number
  color: string
  appearance: AppearanceSettings
  bendPoints: MapPoint[]
  mapIssueT?: number | null
}

export function renderPreStartRoute(opts: PreStartRouteOpts): string {
  const { startPosition, startType, dims, scale, color, appearance, bendPoints, mapIssueT } = opts
  const sf = scale
  const strokeW = dims.legW * sf
  const startR = controlSymbolRadiusMm(startType, dims) * sf
  const pts: MapPoint[] = [...bendPoints, startPosition]
  const clipped = clipPolylineEnd(pts, startR)
  if (clipped.length < 2) return ''

  const d = smoothPathD(clipped)
  const markedDash = [2 * sf, 0.5 * sf]

  let svg = ''
  if (appearance.outlineEnabled) {
    svg += `<path d="${d}" fill="none" stroke="${appearance.outlineColor}" stroke-width="${strokeW + appearance.outlineWidth * 2}" stroke-linecap="butt" stroke-linejoin="round"${dashAttr(markedDash)}/>`
  }
  svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="butt" stroke-linejoin="round"${dashAttr(markedDash)}/>`

  // Map issue point bar
  if (mapIssueT != null) {
    const flat = flattenSmooth(pts)
    const pos = interpolatePolyline(flat, mapIssueT)
    const barHalf = 1.25 * sf
    const barSw = 0.6 * sf * (dims.legW / 0.35) // normalize for lineWidth already baked in dims
    const perpX = -Math.sin(pos.angle), perpY = Math.cos(pos.angle)
    const x1 = pos.x + perpX * barHalf, y1 = pos.y + perpY * barHalf
    const x2 = pos.x - perpX * barHalf, y2 = pos.y - perpY * barHalf
    if (appearance.outlineEnabled) {
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${appearance.outlineColor}" stroke-width="${barSw + appearance.outlineWidth * 2}" stroke-linecap="butt"/>`
    }
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${barSw}" stroke-linecap="butt"/>`
  }

  return svg
}

// ── Annotations ─────────────────────────────────────────────────────────────

/** Annotation dims in the caller's coordinate system. unitScale = upm for canvas, 1 for PDF. */
function annDimsScaled(mapScale: number, spec: EventSpec, unitScale: number): AnnotationDims {
  const s = mapScale > 0 ? symbolScaleFactor(spec, mapScale) : 1.5
  return getAnnotationDims(s * unitScale)
}

export function renderForbiddenRoute(points: MapPoint[], mapScale: number, spec: EventSpec, color: string, unitScale: number): string {
  if (points.length < 2) return ''
  const d = annDimsScaled(mapScale, spec, unitScale)

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const marks = walkPath(points, d.routeXSpace)

  let svg = `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${d.routeLineW}" stroke-linecap="round" stroke-linejoin="round"/>`
  for (const m of marks) {
    const [s1, s2] = routeXMarkSegments(m, d.routeXArm)
    svg += `<line x1="${s1[0].x}" y1="${s1[0].y}" x2="${s1[1].x}" y2="${s1[1].y}" stroke="${color}" stroke-width="${d.routeXW}" stroke-linecap="round"/>`
    svg += `<line x1="${s2[0].x}" y1="${s2[0].y}" x2="${s2[1].x}" y2="${s2[1].y}" stroke="${color}" stroke-width="${d.routeXW}" stroke-linecap="round"/>`
  }
  return svg
}

/** `elongation` must be pre-scaled to the caller's coordinate system. Canvas
 * passes `ann.elongation * upm`, PDF passes `ann.elongation * (nativeScale/printScale)`. */
export function renderCrossingPoint(center: MapPoint, rotation: number, elongation: number, mapScale: number, spec: EventSpec, color: string, unitScale: number): string {
  const d = annDimsScaled(mapScale, spec, unitScale)
  const ext = Math.max(0, elongation)
  const { spread, midX, ctrlY, totalHH } = crossingPointCurve(d, ext)
  const { x, y } = center

  const rightD =
    `M ${x + spread} ${y - totalHH} Q ${x + midX} ${y - ctrlY - ext} ${x + midX} ${y - ext}` +
    ` L ${x + midX} ${y + ext}` +
    ` Q ${x + midX} ${y + ctrlY + ext} ${x + spread} ${y + totalHH}`
  const leftD =
    `M ${x - spread} ${y - totalHH} Q ${x - midX} ${y - ctrlY - ext} ${x - midX} ${y - ext}` +
    ` L ${x - midX} ${y + ext}` +
    ` Q ${x - midX} ${y + ctrlY + ext} ${x - spread} ${y + totalHH}`

  return `<g transform="rotate(${rotation}, ${x}, ${y})"><path d="${rightD}" fill="none" stroke="${color}" stroke-width="${d.crossW}" stroke-linecap="round"/><path d="${leftD}" fill="none" stroke="${color}" stroke-width="${d.crossW}" stroke-linecap="round"/></g>`
}

export function renderOutOfBoundsArea(points: MapPoint[], mapScale: number, spec: EventSpec, color: string, patternId: string, unitScale: number, boundaryMarking: 'none' | 'continuous' | 'intermittent'): string {
  if (points.length < 3) return ''
  const d = annDimsScaled(mapScale, spec, unitScale)
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
  const sp = d.hatchSpace
  const dashArray = boundaryMarking === 'intermittent' ? ` stroke-dasharray="${d.oobMarkDash} ${d.oobMarkGap}"` : ''
  const clipId = `${patternId}-clip`

  // Bounding box of the polygon
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
  }
  const pad = sp
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const diag = Math.hypot(maxX - minX, maxY - minY)

  // Explicit hatch lines clipped to the polygon (works in both browser SVG and svg2pdf.js)
  let svg = `<defs><clipPath id="${esc(clipId)}"><path d="${pathD}"/></clipPath></defs>`
  svg += `<g clip-path="url(#${esc(clipId)})">`
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const hw = d.hatchW
  const nLines = Math.ceil(diag / sp)
  for (let i = -nLines; i <= nLines; i++) {
    const offset = i * sp
    // +45° lines
    svg += `<line x1="${cx + offset - diag}" y1="${cy - diag}" x2="${cx + offset + diag}" y2="${cy + diag}" stroke="${color}" stroke-width="${hw}"/>`
    // -45° lines
    svg += `<line x1="${cx + offset + diag}" y1="${cy - diag}" x2="${cx + offset - diag}" y2="${cy + diag}" stroke="${color}" stroke-width="${hw}"/>`
  }
  svg += '</g>'
  if (boundaryMarking !== 'none') {
    svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${d.oobMarkW}"${dashArray} stroke-linejoin="round"/>`
  }
  return svg
}

export function renderOobBoundary(points: MapPoint[], mapScale: number, spec: EventSpec, color: string, unitScale: number): string {
  if (points.length < 2) return ''
  const d = annDimsScaled(mapScale, spec, unitScale)
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${d.boundaryW}" stroke-linecap="round" stroke-linejoin="round"/>`
}

export function renderNorthArrow(center: MapPoint, rotation: number, annScale: number, mapScale: number, spec: EventSpec, color: string, textColor: string, unitScale: number): string {
  const d = annDimsScaled(mapScale, spec, unitScale)
  const h = d.northArrowH * annScale
  const { halfBase, apexLocalY, baseLocalY } = northArrowGeometry(h, 1)
  const strokeW = d.northStrokeW
  const strokeColor = darkenHex(color)

  const { x: cx, y: cy } = center
  const points = `${cx},${cy + apexLocalY} ${cx + halfBase},${cy + baseLocalY} ${cx - halfBase},${cy + baseLocalY}`
  const fontSize = h * 0.45

  return `<g transform="rotate(${rotation}, ${cx}, ${cy})"><polygon points="${points}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linejoin="round"/><text x="${cx}" y="${cy + h * 0.12}" text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-size="${fontSize}" font-weight="bold" font-family="sans-serif" style="pointer-events:none">N</text></g>`
}

// ── Overlays ────────────────────────────────────────────────────────────────

export function renderScaleBar(sb: ScaleBar, printScale: number, unitScale: number): string {
  const s = unitScale
  const scaleDen = printScale
  const lay = scaleBarLayoutMm(sb, scaleDen)
  const segRealM = sb.fixedCmSegments ? scaleDen / 100 : sb.segmentLengthM
  const { segMm, barH, textH, pad, strokeW, tickH, boxW, boxH } = lay

  const segU = segMm * s, barHU = barH * s, textHU = textH * s, padU = pad * s
  const strokeWU = strokeW * s, tickHU = tickH * s, boxWU = boxW * s, boxHU = boxH * s

  const { x, y } = sb.position
  const barX = x + padU
  const barY = y + padU + textHU + tickHU

  let svg = ''

  // Background
  if (sb.bgAlpha > 0) {
    svg += `<rect x="${x}" y="${y}" width="${boxWU}" height="${boxHU}" fill="white" opacity="${sb.bgAlpha}" rx="${0.5 * s}"/>`
  }

  // Alternating segments
  for (let i = 0; i < sb.segments; i++) {
    svg += `<rect x="${barX + i * segU}" y="${barY}" width="${segU}" height="${barHU}" fill="${i % 2 === 0 ? '#000000' : '#ffffff'}" stroke="#000000" stroke-width="${strokeWU}"/>`
  }

  // Tick marks and labels
  for (let i = 0; i <= sb.segments; i++) {
    const tx = barX + i * segU
    svg += `<line x1="${tx}" y1="${barY - tickHU}" x2="${tx}" y2="${barY}" stroke="#000000" stroke-width="${strokeWU}"/>`
    if (i === 0 || i === 1 || i === sb.segments) {
      svg += `<text x="${tx}" y="${barY - tickHU - textHU * 0.15}" text-anchor="middle" font-size="${textHU * 0.7}" font-family="Arial, sans-serif" fill="#000000">${esc(formatScaleBarDistance(i * segRealM))}</text>`
    }
  }

  // Scale text
  svg += `<text x="${x + boxWU / 2}" y="${barY + barHU + textHU + padU * 0.3}" text-anchor="middle" font-size="${textHU * 0.8}" font-family="Arial, sans-serif" fill="#000000">1:${scaleDen.toLocaleString()}</text>`

  return svg
}

export function renderTextLabel(tl: TextLabel, unitScale: number): string {
  const s = unitScale
  const fontSize = tl.fontSizeMm * s
  const lines = tl.text.split('\n')
  const lineHeight = fontSize * 1.25
  const maxLineW = Math.max(...lines.map(l => measureTextWidth(l, fontSize)))
  const blockH = lineHeight * lines.length
  const pad = 0.15 * fontSize

  let svg = ''

  if (tl.bgAlpha > 0) {
    svg += `<rect x="${tl.position.x - pad}" y="${tl.position.y - fontSize - pad}" width="${maxLineW + pad * 2}" height="${blockH + pad * 2}" fill="white" opacity="${tl.bgAlpha}" rx="${0.15 * fontSize}"/>`
  }

  svg += `<text x="${tl.position.x}" y="${tl.position.y}" font-size="${fontSize}" font-family="Arial, sans-serif" fill="${tl.color}">`
  for (let i = 0; i < lines.length; i++) {
    svg += `<tspan x="${tl.position.x}" dy="${i === 0 ? 0 : lineHeight}">${esc(lines[i])}</tspan>`
  }
  svg += '</text>'

  return svg
}

export function renderImageOverlay(img: ImageOverlay, unitScale: number): string {
  const s = unitScale
  const w = img.widthMm * s
  const h = img.heightMm * s
  if (w <= 0 || h <= 0) return ''
  return `<image x="${img.position.x}" y="${img.position.y}" width="${w}" height="${h}" href="${esc(img.dataUrl)}" preserveAspectRatio="none"/>`
}

// ── Full annotation ink pass ────────────────────────────────────────────────

export function renderAnnotationInk(
  annotations: Annotation[],
  mapScale: number,
  spec: EventSpec,
  color: string,
  unitScale: number,
  patternIdPrefix: string,
  elongationScale = 1,
): string {
  let svg = ''
  for (const ann of annotations) {
    if (ann.type === 'forbidden_route') {
      svg += renderForbiddenRoute(ann.points, mapScale, spec, color, unitScale)
    } else if (ann.type === 'crossing_point' && ann.points[0]) {
      svg += renderCrossingPoint(ann.points[0], ann.rotation ?? 0, (ann.elongation ?? 0) * elongationScale, mapScale, spec, color, unitScale)
    } else if (ann.type === 'out_of_bounds') {
      svg += renderOutOfBoundsArea(ann.points, mapScale, spec, color, `${patternIdPrefix}-oob-${ann.id}`, unitScale, ann.boundaryMarking ?? 'none')
    } else if (ann.type === 'oob_boundary') {
      svg += renderOobBoundary(ann.points, mapScale, spec, color, unitScale)
    }
  }
  return svg
}

export function renderNorthArrows(
  annotations: Annotation[],
  mapScale: number,
  spec: EventSpec,
  unitScale: number,
): string {
  let svg = ''
  for (const ann of annotations) {
    if (ann.type === 'north_arrow' && ann.points[0]) {
      svg += renderNorthArrow(ann.points[0], ann.rotation ?? 0, ann.scale ?? 1, mapScale, spec, ann.color ?? '#38bdf8', ann.textColor ?? '#ffffff', unitScale)
    }
  }
  return svg
}

// ── Course ink builder (shared by PDF + image export) ──────────────────────

interface Pos { x: number; y: number }

function getLabel(c: Control, seqMap: Map<string, number[]> | null): string {
  if (seqMap && c.type === 'control') {
    const seqs = seqMap.get(c.id)
    return seqs ? formatSequenceLabel(seqs) : defaultControlLabel(c)
  }
  return defaultControlLabel(c)
}

export interface BuildCourseInkOpts {
  pageCourse: Course
  controls: Control[]
  controlMap: Map<string, Control>
  annotations: Annotation[]
  toPage: (pt: MapPoint) => Pos
  offsetToMm: (pt: MapPoint) => Pos
  printScale: number
  spec: EventSpec
  app: AppearanceSettings
  dims: SymbolDims
  sf: number
  color: string
  elongScale: number
  idPrefix: string
  hasSubmaps: boolean
  submapIndex: number
  labelSubmapStart?: boolean
}

export function buildCourseInkSvg(o: BuildCourseInkOpts): string {
  const { pageCourse: pc, controls, controlMap, annotations, toPage, offsetToMm,
    printScale, spec, app, dims, sf, color, elongScale, idPrefix, hasSubmaps, submapIndex } = o

  const pageAnns = annotations.map(a => ({ ...a, points: a.points.map(p => toPage(p)) }))
  let svg = renderAnnotationInk(pageAnns, printScale, spec, IOF_PURPLE, 1, idPrefix, elongScale)

  if (pc.type === 'linear' && pc.controls.length >= 2) {
    const firstCc = pc.controls[0]
    if (firstCc.markedRoute && firstCc.legBendPoints?.length) {
      const startCtrl = controlMap.get(firstCc.controlId)
      if (startCtrl) {
        svg += renderPreStartRoute({
          startPosition: toPage(startCtrl.position), startType: startCtrl.type,
          dims, scale: sf, color, appearance: app,
          bendPoints: firstCc.legBendPoints.map(p => toPage(p)),
          mapIssueT: firstCc.mapIssueT,
        })
      }
    }
    for (let i = 0; i < pc.controls.length - 1; i++) {
      const from = controlMap.get(pc.controls[i].controlId)
      const to = controlMap.get(pc.controls[i + 1].controlId)
      if (!from || !to) continue
      const cc = pc.controls[i + 1]
      const isLastLeg = i === pc.controls.length - 2
      const effectiveMarkedRoute = cc.markedRoute
        || (isLastLeg && pc.finishType === 'taped' ? 'full' as const
          : isLastLeg && pc.finishType === 'funnel' ? 'partial' as const
          : undefined)
      if (effectiveMarkedRoute === 'partial' && cc.markedRouteEnd) {
        const isFunnelFinish = isLastLeg && pc.finishType === 'funnel' && !cc.markedRoute
        svg += renderPartialLeg({
          from: toPage(from.position), to: toPage(to.position),
          divider: toPage(cc.markedRouteEnd),
          fromType: from.type, toType: to.type,
          dims, scale: sf, color, appearance: app,
          bendPoints: cc.legBendPoints?.map(p => toPage(p)),
          navBendPoints: cc.legNavBendPoints?.map(p => toPage(p)),
          isFunnelFinish,
        })
      } else {
        svg += renderLeg({
          from: toPage(from.position), to: toPage(to.position),
          fromType: from.type, toType: to.type,
          dims, scale: sf, color, appearance: app,
          bendPoints: cc.legBendPoints?.map(p => toPage(p)),
          gaps: cc.legGaps, markedRoute: effectiveMarkedRoute,
        })
      }
    }
  }

  const seqMap = pc.type === 'linear' ? buildSequenceMap(pc, controls) : null
  const drawn = new Set<string>()
  const lastCcId = pc.controls[pc.controls.length - 1]?.controlId
  const firstCcId = hasSubmaps && submapIndex > 0 ? pc.controls[0]?.controlId : null

  for (const cc of pc.controls) {
    if (drawn.has(cc.controlId)) continue
    drawn.add(cc.controlId)
    const ctrl = controlMap.get(cc.controlId)
    if (!ctrl) continue
    const pos = toPage(ctrl.position)
    const isExchange = !!cc.exchangeMode && !(hasSubmaps && cc.controlId === lastCcId)
    let sAngle = 0
    if (ctrl.type === 'start' || isExchange) {
      const ccIdx = pc.controls.findIndex(c => c.controlId === cc.controlId)
      const nextCtrl = ccIdx >= 0 ? controlMap.get(pc.controls[ccIdx + 1]?.controlId) : undefined
      if (nextCtrl) {
        sAngle = ctrl.type === 'start'
          ? startTriangleAngle(toPage(ctrl.position), toPage(nextCtrl.position))
          : exchangeTriangleAngle(toPage(ctrl.position), toPage(nextCtrl.position))
      }
    }
    const isSubmapStart = firstCcId != null && cc.controlId === firstCcId && !!cc.exchangeMode
    let label = ''
    if (ctrl.type === 'control' && (!isSubmapStart || o.labelSubmapStart)) {
      label = getLabel(ctrl, seqMap)
      if (pc.showPoints && ctrl.points != null) label += ` [${ctrl.points}]`
    }
    const lo = cc.labelOffset ?? ctrl.labelOffset
    const loMm = lo ? offsetToMm(lo) : undefined
    svg += renderControlSymbol({
      type: ctrl.type, position: pos, dims, scale: sf,
      color, appearance: app, isExchange,
      gaps: ctrl.gaps, rotation: sAngle,
      label, labelOffset: loMm,
    })
  }

  return svg
}
