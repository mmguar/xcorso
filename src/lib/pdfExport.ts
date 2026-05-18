import { jsPDF } from 'jspdf'
import type { Project, Course, Control, MapPoint, MapConfig, ScaleBar, TextLabel, EventSpec } from '../types'
import type { LoadedMap } from './mapLoader'
import { drawDescriptionSheet, drawDescriptionSheetOverlay } from './pdfDescriptionSheet'
import { defaultControlLabel, buildSequenceMap, formatSequenceLabel, resolveVariation } from './courseUtils'
import { computeCourseDistances } from './distance'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor, getAnnotationDims, MM_TO_PT } from './symbolSpec'
import { walkPath, clipPolyline } from './geometry'

export const MARGIN = 10
const TILE_OVERLAP = 15
const MAX_RASTER_PX = 5000

export const ALL_CONTROLS_ID = '__all_controls__'

interface ExportCourse extends Course {
  _parentId?: string
}

function expandVariations(courses: Course[]): ExportCourse[] {
  const result: ExportCourse[] = []
  for (const course of courses) {
    if (course.variations && course.variations.length > 0 && course.loops && course.loops.length > 0) {
      for (const variation of course.variations) {
        result.push({
          ...course,
          id: `${course.id}__${variation.id}`,
          _parentId: course.id,
          name: `${course.name} - ${variation.name}`,
          controls: resolveVariation(course, variation),
          loops: undefined,
          variations: undefined,
        })
      }
    } else {
      result.push(course)
    }
  }
  return result
}

function optionKey(course: ExportCourse): string {
  return course._parentId ?? course.id
}

// ── Page sizes ──────────────────────────────────────────────────────────────

export const PAGE_SIZES: Record<string, { w: number; h: number; label: string }> = {
  a4:     { w: 210,   h: 297,   label: 'A4' },
  a3:     { w: 297,   h: 420,   label: 'A3' },
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  legal:  { w: 215.9, h: 355.6, label: 'US Legal' },
}

// ── Types ───────────────────────────────────────────────────────────────────

export type DescMode = 'none' | 'separate' | 'on-map'

export interface PdfExportOptions {
  pageSize: string
  orientation: 'portrait' | 'landscape'
  printScale: number
  scaleOverrides?: Record<string, number>
  courseIds: string[]
  allControls?: boolean
  descModes?: Record<string, DescMode>
  offsets?: Record<string, { x: number; y: number }>
  sheetPositions?: Record<string, { x: number; y: number }>
  tiling?: boolean
  mapOpacity?: number
}

export interface CourseFitInfo {
  courseId: string
  courseName: string
  fits: boolean
  widthMm: number
  heightMm: number
  printableW: number
  printableH: number
}

interface Pos { x: number; y: number }

interface Bounds {
  minX: number; minY: number; maxX: number; maxY: number
  width: number; height: number
  centerX: number; centerY: number
}

// ── Coordinate conversion ───────────────────────────────────────────────────

export function mapToMm(point: MapPoint, map: MapConfig, printScale: number): Pos {
  if (map.type === 'ocad') {
    const factor = map.scale / (100 * printScale)
    return { x: point.x * factor, y: point.y * factor }
  }
  if (map.scaleMeasurement) {
    const { p1, p2, realWorldMeters } = map.scaleMeasurement
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const pixelDist = Math.sqrt(dx * dx + dy * dy)
    if (pixelDist === 0) return { x: 0, y: 0 }
    const factor = realWorldMeters * 1000 / (pixelDist * printScale)
    return { x: point.x * factor, y: point.y * factor }
  }
  return { x: 0, y: 0 }
}

export function canExportPdf(map: MapConfig): boolean {
  return map.type === 'ocad' || map.scaleMeasurement != null
}

// ── Map rasterization ──────────────────────────────────────────────────────

async function rasterizeMap(loadedMap: LoadedMap, opacity = 1): Promise<string> {
  if (loadedMap.type === 'svg') {
    const svgEl = loadedMap.content as SVGElement
    const clone = svgEl.cloneNode(true) as SVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    const { width, height } = loadedMap.bounds
    const maxDim = Math.max(width, height)
    const renderScale = MAX_RASTER_PX / maxDim
    const canvasW = Math.ceil(width * renderScale)
    const canvasH = Math.ceil(height * renderScale)

    clone.setAttribute('width', String(canvasW))
    clone.setAttribute('height', String(canvasH))

    const svgString = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    try {
      const img = new Image()
      img.src = url
      await img.decode()

      const canvas = document.createElement('canvas')
      canvas.width = canvasW
      canvas.height = canvasH
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvasW, canvasH)
      ctx.globalAlpha = opacity
      ctx.drawImage(img, 0, 0, canvasW, canvasH)
      return canvas.toDataURL('image/jpeg', 0.92)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const url = loadedMap.content as string
  if (url.startsWith('data:')) return url

  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalAlpha = opacity
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}

/**
 * svg2pdf resolves inline `style` blocks via the browser selector engine. Running it on SVG
 * attached to the main document can leave engine state that breaks fills on a later export.
 * A one-off iframe document matches “open file then export” every time.
 */
async function svg2pdfInIsolatedDocument(
  svg: SVGElement,
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  const markup = new XMLSerializer().serializeToString(svg)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'pdf map svg')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)
  try {
    await new Promise<void>((resolve, reject) => {
      const ms = 10_000
      const to = window.setTimeout(() => reject(new Error('PDF SVG iframe load timeout')), ms)
      iframe.onload = () => {
        window.clearTimeout(to)
        resolve()
      }
      iframe.srcdoc =
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">' +
        markup +
        '</body></html>'
    })
    const idoc = iframe.contentDocument
    const mounted = idoc?.body?.querySelector('svg')
    if (!mounted) throw new Error('PDF SVG iframe: no root <svg>')
    await pdf.svg(mounted as SVGElement, { x, y, width: w, height: h })
  } finally {
    iframe.remove()
  }
}

// ── Bounding box ────────────────────────────────────────────────────────────

const BOUNDS_PAD = 15

function computeBounds(positions: Pos[]): Bounds | null {
  if (positions.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of positions) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  minX -= BOUNDS_PAD; minY -= BOUNDS_PAD; maxX += BOUNDS_PAD; maxY += BOUNDS_PAD
  const width = maxX - minX
  const height = maxY - minY
  return { minX, minY, maxX, maxY, width, height, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 }
}

function courseBoundsMm(
  course: Course,
  controls: Control[],
  map: MapConfig,
  printScale: number,
): Bounds | null {
  const controlMap = new Map(controls.map(c => [c.id, c]))
  const positions = course.controls
    .map(cc => controlMap.get(cc.controlId))
    .filter((c): c is Control => c != null)
    .map(c => mapToMm(c.position, map, printScale))
  for (const cc of course.controls) {
    if (cc.legBendPoints) {
      for (const bp of cc.legBendPoints) {
        positions.push(mapToMm(bp, map, printScale))
      }
    }
  }
  return computeBounds(positions)
}

function allControlsBoundsMm(
  controls: Control[],
  map: MapConfig,
  printScale: number,
): Bounds | null {
  return computeBounds(controls.map(c => mapToMm(c.position, map, printScale)))
}

function pageDims(opts: PdfExportOptions): { w: number; h: number } {
  const base = PAGE_SIZES[opts.pageSize] ?? PAGE_SIZES.a4
  return opts.orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h }
}

export function checkFit(project: Project, options: PdfExportOptions): CourseFitInfo[] {
  const { w: pw, h: ph } = pageDims(options)
  const printableW = pw - 2 * MARGIN
  const printableH = ph - 2 * MARGIN

  const results: CourseFitInfo[] = []

  if (options.allControls) {
    const acScale = options.scaleOverrides?.[ALL_CONTROLS_ID] ?? options.printScale
    const bounds = allControlsBoundsMm(project.controls, project.map, acScale)
    results.push({
      courseId: ALL_CONTROLS_ID,
      courseName: 'All controls',
      fits: !bounds || (bounds.width <= printableW && bounds.height <= printableH),
      widthMm: bounds?.width ?? 0,
      heightMm: bounds?.height ?? 0,
      printableW,
      printableH,
    })
  }

  for (const course of project.courses.filter(c => options.courseIds.includes(c.id))) {
    const courseScale = options.scaleOverrides?.[course.id] ?? options.printScale
    const bounds = courseBoundsMm(course, project.controls, project.map, courseScale)
    results.push({
      courseId: course.id,
      courseName: course.name,
      fits: !bounds || (bounds.width <= printableW && bounds.height <= printableH),
      widthMm: bounds?.width ?? 0,
      heightMm: bounds?.height ?? 0,
      printableW,
      printableH,
    })
  }

  return results
}

// ── Common scales ──────────────────────────────────────────────────────

export const COMMON_SCALES = [
  15000, 10000, 7500, 5000, 4000, 3000, 2500, 2000, 1500, 1000,
]

export function suggestFitScale(
  project: Project,
  courseIds: string[],
  pageSize: string,
  orientation: 'portrait' | 'landscape',
  allControls?: boolean,
): number | null {
  const base = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4
  const pw = orientation === 'landscape' ? base.h : base.w
  const ph = orientation === 'landscape' ? base.w : base.h
  const printableW = pw - 2 * MARGIN
  const printableH = ph - 2 * MARGIN

  const courses = project.courses.filter(c => courseIds.includes(c.id))
  if (courses.length === 0 && !allControls) return null

  const sorted = [...COMMON_SCALES].sort((a, b) => a - b)
  for (const scale of sorted) {
    let fits = true
    if (allControls) {
      const bounds = allControlsBoundsMm(project.controls, project.map, scale)
      if (bounds && (bounds.width > printableW || bounds.height > printableH)) fits = false
    }
    if (fits) {
      fits = courses.every(course => {
        const bounds = courseBoundsMm(course, project.controls, project.map, scale)
        if (!bounds) return true
        return bounds.width <= printableW && bounds.height <= printableH
      })
    }
    if (fits) return scale
  }

  return null
}

// ── Tiling ─────────────────────────────────────────────────────────────────

function tileCount(courseDim: number, printableDim: number): number {
  if (courseDim <= printableDim) return 1
  return Math.ceil((courseDim - TILE_OVERLAP) / (printableDim - TILE_OVERLAP))
}

export interface CourseTileInfo {
  courseId: string
  courseName: string
  cols: number
  rows: number
  totalPages: number
}

export function checkTiling(project: Project, options: PdfExportOptions): CourseTileInfo[] {
  const { w: pw, h: ph } = pageDims(options)
  const printableW = pw - 2 * MARGIN
  const printableH = ph - 2 * MARGIN

  const results: CourseTileInfo[] = []

  if (options.allControls) {
    const acScale = options.scaleOverrides?.[ALL_CONTROLS_ID] ?? options.printScale
    const bounds = allControlsBoundsMm(project.controls, project.map, acScale)
    if (bounds) {
      const cols = tileCount(bounds.width, printableW)
      const rows = tileCount(bounds.height, printableH)
      results.push({ courseId: ALL_CONTROLS_ID, courseName: 'All controls', cols, rows, totalPages: cols * rows })
    } else {
      results.push({ courseId: ALL_CONTROLS_ID, courseName: 'All controls', cols: 1, rows: 1, totalPages: 1 })
    }
  }

  for (const course of project.courses.filter(c => options.courseIds.includes(c.id))) {
    const courseScale = options.scaleOverrides?.[course.id] ?? options.printScale
    const bounds = courseBoundsMm(course, project.controls, project.map, courseScale)
    if (!bounds) { results.push({ courseId: course.id, courseName: course.name, cols: 1, rows: 1, totalPages: 1 }); continue }
    const cols = tileCount(bounds.width, printableW)
    const rows = tileCount(bounds.height, printableH)
    results.push({ courseId: course.id, courseName: course.name, cols, rows, totalPages: cols * rows })
  }

  return results
}

// ── Preview data ───────────────────────────────────────────────────────────

export interface CoursePreview {
  positions: Pos[]
  centerX: number
  centerY: number
}

export function coursePreviewMm(
  project: Project,
  courseId: string,
  printScale: number,
): CoursePreview | null {
  let positions: Pos[]

  if (courseId === ALL_CONTROLS_ID) {
    positions = project.controls.map(c => mapToMm(c.position, project.map, printScale))
  } else {
    const course = project.courses.find(c => c.id === courseId)
    if (!course) return null
    const controlMap = new Map(project.controls.map(c => [c.id, c]))
    positions = course.controls
      .map(cc => controlMap.get(cc.controlId))
      .filter((c): c is Control => c != null)
      .map(c => mapToMm(c.position, project.map, printScale))
    for (const cc of course.controls) {
      if (cc.legBendPoints) {
        for (const bp of cc.legBendPoints) {
          positions.push(mapToMm(bp, project.map, printScale))
        }
      }
    }
  }

  const bounds = computeBounds(positions)
  if (!bounds) return null

  return {
    positions,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  }
}

// ── Color helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function setColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex)
  doc.setDrawColor(r, g, b)
  doc.setFillColor(r, g, b)
  doc.setTextColor(r, g, b)
}

// ── Drawing primitives ──────────────────────────────────────────────────────

function drawControlSymbol(doc: jsPDF, type: string, pos: Pos, printScale: number, spec: EventSpec) {
  const dims = getSymbolDims(spec)
  const sf = specScaleFactor(spec, printScale)
  const startSide = dims.startSide * sf
  const startSw = dims.strokeW * sf
  const finishOuter = dims.finishROuter * sf
  const finishInner = dims.finishRInner * sf
  const finishSw = dims.strokeW * sf
  const controlR = dims.controlR * sf
  const controlSw = dims.strokeW * sf

  if (type === 'start') {
    const h = startSide * Math.sqrt(3) / 2
    doc.setLineWidth(startSw)
    doc.triangle(
      pos.x, pos.y - h * 2 / 3,
      pos.x - startSide / 2, pos.y + h / 3,
      pos.x + startSide / 2, pos.y + h / 3,
      'S',
    )
  } else if (type === 'finish') {
    doc.setLineWidth(finishSw)
    doc.circle(pos.x, pos.y, finishOuter, 'S')
    doc.circle(pos.x, pos.y, finishInner, 'S')
  } else {
    doc.setLineWidth(controlSw)
    doc.circle(pos.x, pos.y, controlR, 'S')
  }
}

function clipR(type: string, printScale: number, spec: EventSpec): number {
  const dims = getSymbolDims(spec)
  const sf = specScaleFactor(spec, printScale)
  if (type === 'start') return (dims.startSide * sf) * Math.sqrt(3) / 2 * 2 / 3
  if (type === 'finish') return dims.finishROuter * sf
  return dims.controlR * sf
}

function drawLeg(doc: jsPDF, from: Pos, to: Pos, fromType: string, toType: string, printScale: number, spec: EventSpec, bendPoints?: Pos[]) {
  const dims = getSymbolDims(spec)
  const sf = specScaleFactor(spec, printScale)
  doc.setLineWidth(dims.legW * sf)
  doc.setLineCap(1)
  const fromR = clipR(fromType, printScale, spec)
  const toR = clipR(toType, printScale, spec)

  if (bendPoints && bendPoints.length > 0) {
    const pts: Pos[] = [from, ...bendPoints, to]
    const clipped = clipPolyline(pts, fromR, toR)
    if (clipped.length < 2) return
    for (let i = 0; i < clipped.length - 1; i++) {
      doc.line(clipped[i].x, clipped[i].y, clipped[i + 1].x, clipped[i + 1].y)
    }
  } else {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) return
    const ux = dx / len
    const uy = dy / len
    doc.line(
      from.x + ux * fromR, from.y + uy * fromR,
      to.x - ux * toR, to.y - uy * toR,
    )
  }
}


function drawLabel(doc: jsPDF, label: string, pos: Pos, type: string, printScale: number, spec: EventSpec, labelOffsetMm?: Pos) {
  const dims = getSymbolDims(spec)
  const sf = specScaleFactor(spec, printScale)
  const controlR = dims.controlR * sf
  const startSide = dims.startSide * sf
  const finishOuter = dims.finishROuter * sf
  const fontSizePt = controlR * 1.1 * MM_TO_PT

  doc.setFontSize(fontSizePt)
  doc.setFont('helvetica', 'bold')

  let ox: number, oy: number
  if (labelOffsetMm) {
    ox = labelOffsetMm.x
    oy = labelOffsetMm.y
  } else if (type === 'start') {
    const h = startSide * Math.sqrt(3) / 2
    ox = startSide / 2 * 1.1
    oy = -h * 0.4
  } else if (type === 'finish') {
    ox = finishOuter * 1.3
    oy = -finishOuter * 1.1
  } else {
    ox = controlR * 1.1
    oy = -controlR * 1.1
  }

  doc.text(label, pos.x + ox, pos.y + oy)
}

function annotationDimsMm(mapScale: number, spec: EventSpec) {
  const s = mapScale > 0 ? specScaleFactor(spec, mapScale) : 1.5
  return getAnnotationDims(s)
}

// ── Forbidden route ─────────────────────────────────────────────────────────

function drawForbiddenRoute(doc: jsPDF, points: Pos[], mapScale: number, spec: EventSpec) {
  if (points.length < 2) return
  const d = annotationDimsMm(mapScale, spec)

  doc.setLineCap(1)
  doc.setLineJoin(1)
  doc.setLineWidth(d.routeLineW)
  for (let i = 0; i < points.length - 1; i++) {
    doc.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y)
  }

  doc.setLineWidth(d.routeXW)
  for (const m of walkPath(points, d.routeXSpace)) {
    const a1 = m.angle + Math.PI / 4
    const a2 = m.angle - Math.PI / 4
    doc.line(
      m.x - Math.cos(a1) * d.routeXArm, m.y - Math.sin(a1) * d.routeXArm,
      m.x + Math.cos(a1) * d.routeXArm, m.y + Math.sin(a1) * d.routeXArm,
    )
    doc.line(
      m.x - Math.cos(a2) * d.routeXArm, m.y - Math.sin(a2) * d.routeXArm,
      m.x + Math.cos(a2) * d.routeXArm, m.y + Math.sin(a2) * d.routeXArm,
    )
  }
}

// ── Crossing point ──────────────────────────────────────────────────────────

function drawCrossingPoint(doc: jsPDF, center: Pos, rotation: number, mapScale: number, spec: EventSpec) {
  const d = annotationDimsMm(mapScale, spec)
  const hw = d.crossHalf
  const hh = d.crossH
  const { x, y } = center
  const cos = Math.cos(rotation * Math.PI / 180)
  const sin = Math.sin(rotation * Math.PI / 180)
  function rot(px: number, py: number): Pos {
    const dx = px - x, dy = py - y
    return { x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos }
  }

  // Same control points as AnnotationsLayer CrossingPoint (quadratic beziers)
  const l0 = rot(x - 0.8 * hw, y - hh)
  const lq = rot(x + 0.01 * hw, y)
  const l1 = rot(x - 0.8 * hw, y + hh)

  const r0 = rot(x + 0.8 * hw, y - hh)
  const rq = rot(x - 0.01 * hw, y)
  const r1 = rot(x + 0.8 * hw, y + hh)

  doc.setLineWidth(d.crossW)
  doc.setLineCap(1)

  // Quadratic bezier → cubic: C1 = P0 + 2/3(Q-P0), C2 = P1 + 2/3(Q-P1)
  doc.moveTo(l0.x, l0.y)
  doc.curveTo(
    l0.x + 2 / 3 * (lq.x - l0.x), l0.y + 2 / 3 * (lq.y - l0.y),
    l1.x + 2 / 3 * (lq.x - l1.x), l1.y + 2 / 3 * (lq.y - l1.y),
    l1.x, l1.y,
  )
  doc.moveTo(r0.x, r0.y)
  doc.curveTo(
    r0.x + 2 / 3 * (rq.x - r0.x), r0.y + 2 / 3 * (rq.y - r0.y),
    r1.x + 2 / 3 * (rq.x - r1.x), r1.y + 2 / 3 * (rq.y - r1.y),
    r1.x, r1.y,
  )
  doc.stroke()
}

// ── Out-of-bounds area ──────────────────────────────────────────────────────

function drawOutOfBoundsArea(doc: jsPDF, points: Pos[], mapScale: number, spec: EventSpec) {
  if (points.length < 3) return
  const d = annotationDimsMm(mapScale, spec)

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  // Save state, build clipping path, draw hatching, restore
  const internal = (doc as any).internal
  internal.write('q')

  // Clipping path via moveTo/lineTo (writes correct PDF coords)
  doc.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    doc.lineTo(points[i].x, points[i].y)
  }
  internal.write('h W n')

  // 45° hatch — spacing matches AnnotationsLayer hatchSpace along the diagonal family y = x + c
  const hatchW = d.hatchW / 0.707
  doc.setLineWidth(hatchW)
  const cMin1 = minY - maxX
  const cMax1 = maxY - minX
  const cStep = d.hatchSpace * Math.SQRT2

  for (let c = cMin1; c <= cMax1; c += cStep) {
    const xStart = Math.max(minX, minY - c)
    const xEnd = Math.min(maxX, maxY - c)
    if (xStart >= xEnd) continue
    doc.line(xStart, xStart + c, xEnd, xEnd + c)
  }

  const cMin2 = minX + minY
  const cMax2 = maxX + maxY

  for (let c = cMin2; c <= cMax2; c += cStep) {
    const xStart = Math.max(minX, c - maxY)
    const xEnd = Math.min(maxX, c - minY)
    if (xStart <= xEnd) {
      doc.line(xStart, c - xStart, xEnd, c - xEnd)
    }
  }

  internal.write('Q')
}

// ── Labelling ───────────────────────────────────────────────────────────────

function getLabel(c: Control, seqMap: Map<string, number[]> | null): string {
  if (seqMap && c.type === 'control') {
    const seqs = seqMap.get(c.id)
    return seqs ? formatSequenceLabel(seqs) : defaultControlLabel(c)
  }
  return defaultControlLabel(c)
}

// ── Scale bar ──────────────────────────────────────────────────────────────

function drawScaleBar(
  doc: jsPDF,
  sb: ScaleBar,
  toPage: (pt: MapPoint) => Pos,
  printScale: number,
) {
  const scaleDen =  printScale
  const segMm = (sb.segmentLengthM * 1000) / scaleDen
  const totalMm = segMm * sb.segments
  const barH = 2.0
  const textH = 2.5
  const pad = 3
  const strokeW = 0.2
  const tickH = 0.5

  const boxW = totalMm + pad * 2
  const boxH = barH + textH + tickH + pad * 0.5 + pad * 2 + textH

  const origin = toPage(sb.position)

  // Background
  if (sb.bgAlpha > 0) {
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(origin.x, origin.y, boxW, boxH, 0.5, 0.5, 'F')
  }

  const barX = origin.x + pad
  const barY = origin.y + pad + textH + tickH

  // Segments
  for (let i = 0; i < sb.segments; i++) {
    doc.setLineWidth(strokeW)
    doc.setDrawColor(0, 0, 0)
    if (i % 2 === 0) {
      doc.setFillColor(0, 0, 0)
    } else {
      doc.setFillColor(255, 255, 255)
    }
    doc.rect(barX + i * segMm, barY, segMm, barH, 'FD')
  }

  // Ticks and labels
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(textH * 0.7 * MM_TO_PT)

  const fmtDist = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`

  for (let i = 0; i <= sb.segments; i++) {
    const tx = barX + i * segMm
    doc.setLineWidth(strokeW)
    doc.setDrawColor(0, 0, 0)
    doc.line(tx, barY - tickH, tx, barY)

    if (i === 0 || i === 1 || i === sb.segments) {
      const label = fmtDist(i * sb.segmentLengthM)
      doc.text(label, tx, barY - tickH - textH * 0.15, { align: 'center' })
    }
  }

  // Scale text
  doc.setFontSize(textH * 0.8 * MM_TO_PT)
  doc.text(`1:${scaleDen.toLocaleString()}`, origin.x + boxW / 2, barY + barH + textH + pad * 0.3, { align: 'center' })
}

// ── Text label ─────────────────────────────────────────────────────────────

function drawTextLabel(
  doc: jsPDF,
  tl: TextLabel,
  toPage: (pt: MapPoint) => Pos,
) {
  const pos = toPage(tl.position)
  const [r, g, b] = hexToRgb(tl.color)
  doc.setTextColor(r, g, b)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(tl.fontSizeMm * MM_TO_PT)
  doc.text(tl.text, pos.x, pos.y)
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function exportCoursePdf(
  project: Project,
  options: PdfExportOptions,
  loadedMap?: LoadedMap | null,
): Promise<Blob> {
  const { w: pw, h: ph } = pageDims(options)
  const orient = options.orientation === 'landscape' ? 'l' : 'p'
  const printableW = pw - 2 * MARGIN
  const printableH = ph - 2 * MARGIN

  if (loadedMap?.type === 'svg') await import('svg2pdf.js')
  const doc = new jsPDF({ orientation: orient, unit: 'mm', format: [pw, ph] })
  const controlMap = new Map(project.controls.map(c => [c.id, c]))
  const courses = expandVariations(project.courses.filter(c => options.courseIds.includes(c.id)))

  /** After svg2pdf fails once, use raster fallback for remaining pages. */
  let svgEmbedDisabled = false
  let mapDataUrl: string | null = null

  if (loadedMap && loadedMap.type !== 'svg') {
    try { mapDataUrl = await rasterizeMap(loadedMap, options.mapOpacity ?? 1) } catch { /* fall back to no map */ }
  }

  /** XML round-trip so we never feed svg2pdf a live subtree it may have touched in an earlier export. */
  function prepareSvgForPdfEmbed(): SVGElement {
    const svgEl = loadedMap!.content as SVGElement
    let xml = new XMLSerializer().serializeToString(svgEl)
    if (!/^<svg[^>]*\sxmlns=/.test(xml)) {
      xml = xml.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
    }
    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml')
    const parseErr = parsed.querySelector('parsererror')
    const docEl = parsed.documentElement
    const root =
      !parseErr && docEl && docEl.namespaceURI === 'http://www.w3.org/2000/svg'
        ? (docEl as unknown as SVGElement)
        : (svgEl.cloneNode(true) as SVGElement)

    // ocad2geojson sets fill="transparent" on the root <svg>. svg2pdf.js treats
    // this as rgba(0,0,0,0) whose alpha zero poisons the PDF graphics-state
    // opacity for every descendant — even those with their own solid fill.
    // Replacing with "none" avoids the opacity side-effect while keeping the
    // same visual result (unfilled by default).
    if (root.getAttribute('fill') === 'transparent') {
      root.setAttribute('fill', 'none')
    }

    const opacity = options.mapOpacity ?? 1
    if (opacity < 1) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('opacity', String(opacity))
      while (root.firstChild) g.appendChild(root.firstChild)
      root.appendChild(g)
    }
    return root
  }

  async function embedMap(toPage: (pt: MapPoint) => Pos) {
    if (!loadedMap) return
    const tl = toPage({ x: loadedMap.bounds.minX, y: loadedMap.bounds.minY })
    const br = toPage({ x: loadedMap.bounds.maxX, y: loadedMap.bounds.maxY })
    const w = br.x - tl.x
    const h = br.y - tl.y
    if (loadedMap.type === 'svg' && !svgEmbedDisabled) {
      try {
        const svg = prepareSvgForPdfEmbed()
        await svg2pdfInIsolatedDocument(svg, doc, tl.x, tl.y, w, h)
        return
      } catch {
        svgEmbedDisabled = true
        if (!mapDataUrl) try { mapDataUrl = await rasterizeMap(loadedMap, options.mapOpacity ?? 1) } catch {}
      }
    }
    if (mapDataUrl) doc.addImage(mapDataUrl, 'JPEG', tl.x, tl.y, w, h)
  }

  let pageIndex = 0

  // All controls page (no legs, just control symbols with codes)
  if (options.allControls && project.controls.length > 0) {
    const acScale = options.scaleOverrides?.[ALL_CONTROLS_ID] ?? options.printScale
    const bounds = allControlsBoundsMm(project.controls, project.map, acScale)
    if (bounds) {
      const useTiling = options.tiling && (bounds.width > printableW || bounds.height > printableH)
      const cols = useTiling ? tileCount(bounds.width, printableW) : 1
      const rows = useTiling ? tileCount(bounds.height, printableH) : 1

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (pageIndex > 0) doc.addPage([pw, ph], orient)
          pageIndex++

          const { x: ox, y: oy } = options.offsets?.[ALL_CONTROLS_ID] ?? { x: 0, y: 0 }
          let viewCenterX: number, viewCenterY: number
          if (useTiling) {
            viewCenterX = bounds.minX + ox + col * (printableW - TILE_OVERLAP) + printableW / 2
            viewCenterY = bounds.minY + oy + row * (printableH - TILE_OVERLAP) + printableH / 2
          } else {
            viewCenterX = bounds.centerX + ox
            viewCenterY = bounds.centerY + oy
          }

          const cx = pw / 2
          const cy = ph / 2

          function toPage(pt: MapPoint): Pos {
            const mm = mapToMm(pt, project.map, acScale)
            return { x: cx + (mm.x - viewCenterX), y: cy + (mm.y - viewCenterY) }
          }

          await embedMap(toPage)

          const mapScale = project.map.scale
          const ctrlColor = '#7B2FBE'
          const annColor = '#a626ff'
          const allCtrlSpec = resolveSpec(project.spec)

          setColor(doc, annColor)
          for (const ann of project.annotations) {
            if (ann.type === 'forbidden_route') {
              drawForbiddenRoute(doc, ann.points.map(p => toPage(p)), mapScale, allCtrlSpec)
            } else if (ann.type === 'crossing_point' && ann.points[0]) {
              drawCrossingPoint(doc, toPage(ann.points[0]), ann.rotation ?? 0, mapScale, allCtrlSpec)
            } else if (ann.type === 'out_of_bounds') {
              drawOutOfBoundsArea(doc, ann.points.map(p => toPage(p)), mapScale, allCtrlSpec)
            }
          }

          setColor(doc, ctrlColor)
          for (const ctrl of project.controls) {
            const pos = toPage(ctrl.position)
            drawControlSymbol(doc, ctrl.type, pos, acScale, allCtrlSpec)
            drawLabel(doc, defaultControlLabel(ctrl), pos, ctrl.type, acScale, allCtrlSpec)
          }

          // Overlays
          for (const sb of project.scaleBars) drawScaleBar(doc, sb, toPage, acScale)
          for (const tl of project.textLabels) drawTextLabel(doc, tl, toPage)

          doc.setFontSize(8)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(130, 130, 130)
          const tileLabel = cols * rows > 1
            ? `All controls  —  1:${acScale.toLocaleString()}  —  Page ${row * cols + col + 1}/${cols * rows}`
            : ``
          doc.text(tileLabel, MARGIN, MARGIN + 3)
        }
      }
    }
  }

  for (const course of courses) {
    const oKey = optionKey(course)
    const courseScale = options.scaleOverrides?.[oKey] ?? options.printScale
    const descMode = options.descModes?.[oKey] ?? 'none'
    const bounds = courseBoundsMm(course, project.controls, project.map, courseScale)
    if (!bounds) continue

    // Build tile grid
    const useTiling = options.tiling && (bounds.width > printableW || bounds.height > printableH)
    const cols = useTiling ? tileCount(bounds.width, printableW) : 1
    const rows = useTiling ? tileCount(bounds.height, printableH) : 1

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (pageIndex > 0) doc.addPage([pw, ph], orient)
        pageIndex++

        // Each tile's viewport center in course-mm space
        const { x: ox, y: oy } = options.offsets?.[oKey] ?? { x: 0, y: 0 }
        let viewCenterX: number, viewCenterY: number
        if (useTiling) {
          viewCenterX = bounds.minX + ox + col * (printableW - TILE_OVERLAP) + printableW / 2
          viewCenterY = bounds.minY + oy + row * (printableH - TILE_OVERLAP) + printableH / 2
        } else {
          viewCenterX = bounds.centerX + ox
          viewCenterY = bounds.centerY + oy
        }

        const cx = pw / 2
        const cy = ph / 2

        function toPage(pt: MapPoint): Pos {
          const mm = mapToMm(pt, project.map, courseScale)
          return { x: cx + (mm.x - viewCenterX), y: cy + (mm.y - viewCenterY) }
        }

        // Map background
        await embedMap(toPage)

        const mapScale = project.map.scale
        const annColor = '#a626ff'
        const courseSpec = resolveSpec(project.spec, course.spec)
        setColor(doc, annColor)

        // Annotations
        for (const ann of project.annotations) {
          if (ann.type === 'forbidden_route') {
            drawForbiddenRoute(doc, ann.points.map(p => toPage(p)), mapScale, courseSpec)
          } else if (ann.type === 'crossing_point' && ann.points[0]) {
            drawCrossingPoint(doc, toPage(ann.points[0]), ann.rotation ?? 0, mapScale, courseSpec)
          } else if (ann.type === 'out_of_bounds') {
            drawOutOfBoundsArea(doc, ann.points.map(p => toPage(p)), mapScale, courseSpec)
          }
        }

        setColor(doc, course.color)

        // Legs
        if (course.type === 'linear' && course.controls.length >= 2) {
          for (let i = 0; i < course.controls.length - 1; i++) {
            const from = controlMap.get(course.controls[i].controlId)
            const to = controlMap.get(course.controls[i + 1].controlId)
            if (!from || !to) continue
            setColor(doc, course.color)
            const bends = course.controls[i + 1].legBendPoints?.map(p => toPage(p))
            drawLeg(doc, toPage(from.position), toPage(to.position), from.type, to.type, courseScale, courseSpec, bends)
          }
        }

        // Controls
        const seqMap = course.type === 'linear' ? buildSequenceMap(course, project.controls) : null
        const drawn = new Set<string>()

        for (const cc of course.controls) {
          if (drawn.has(cc.controlId)) continue
          drawn.add(cc.controlId)

          const ctrl = controlMap.get(cc.controlId)
          if (!ctrl) continue

          const pos = toPage(ctrl.position)
          setColor(doc, course.color)
          drawControlSymbol(doc, ctrl.type, pos, courseScale, courseSpec)
          const loMm = cc.labelOffset ? mapToMm(cc.labelOffset, project.map, courseScale) : undefined
          drawLabel(doc, getLabel(ctrl, seqMap), pos, ctrl.type, courseScale, courseSpec, loMm)
        }

        // Overlays
        for (const sb of project.scaleBars) drawScaleBar(doc, sb, toPage, courseScale)
        for (const tl of project.textLabels) drawTextLabel(doc, tl, toPage)

        // Description sheet overlay on map
        if (descMode === 'on-map' && course.controls.length > 0) {
          const { x: sx, y: sy } = options.sheetPositions?.[oKey] ?? { x: MARGIN, y: MARGIN }
          const dist = computeCourseDistances(course, project.controls, project.map)
          drawDescriptionSheetOverlay(doc, course, project.controls, courseScale, sx, sy, dist.total)
        }

        // Header line
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(130, 130, 130)
        const tileLabel = cols * rows > 1
          ? `${course.name}  —  1:${courseScale.toLocaleString()}  —  Page ${row * cols + col + 1}/${cols * rows}`
          : ``
        doc.text(tileLabel, MARGIN, MARGIN + 3)
      }
    }

    // Description sheet on separate page(s)
    if (descMode === 'separate' && course.controls.length > 0) {
      doc.addPage([pw, ph], orient)
      pageIndex++
      const dist = computeCourseDistances(course, project.controls, project.map)
      drawDescriptionSheet(doc, course, project.controls, courseScale, pw, ph, dist.total)
    }
  }

  return doc.output('blob')
}
