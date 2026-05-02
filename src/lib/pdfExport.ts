import { jsPDF } from 'jspdf'
import type { Project, Course, Control, MapPoint, MapConfig } from '../types'
import type { LoadedMap } from './mapLoader'
import { drawDescriptionSheet, drawDescriptionSheetOverlay } from './pdfDescriptionSheet'
import { defaultControlLabel, buildSequenceMap } from './courseUtils'

// ── ISOM 2017-2 symbol dimensions (mm on paper) ────────────────────────────

const CONTROL_R = 2.5
const CONTROL_SW = 0.35

const START_SIDE = 6.0
const START_SW = 0.35

const FINISH_R_OUTER = 2.5
const FINISH_R_INNER = 1.75
const FINISH_SW = 0.35

const LEG_W = 0.35

const NUMBER_SIZE_PT = 8.5

const ROUTE_LINE_W = 0.35
const ROUTE_X_ARM = 1.5
const ROUTE_X_W = 0.35
const ROUTE_X_SPACE = 5.0

const CROSS_W = 0.6
const CROSS_HALF = 1.5
const CROSS_H = 1.5

const OOB_HATCH_SPACE = 0.8
const OOB_HATCH_W = 0.25
const OOB_BOUNDARY_W = 0.7

export const MARGIN = 10
const TILE_OVERLAP = 15
const MAX_RASTER_PX = 5000

export const ALL_CONTROLS_ID = '__all_controls__'

// ── Page sizes ──────────────────────────────────────────────────────────────

export const PAGE_SIZES: Record<string, { w: number; h: number; label: string }> = {
  a4:     { w: 210,   h: 297,   label: 'A4' },
  a3:     { w: 297,   h: 420,   label: 'A3' },
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  legal:  { w: 215.9, h: 355.6, label: 'US Legal' },
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface PdfExportOptions {
  pageSize: string
  orientation: 'portrait' | 'landscape'
  printScale: number
  courseIds: string[]
  allControls?: boolean
  includeDescriptions?: boolean
  descriptionOnMap?: boolean
  sheetX?: number
  sheetY?: number
  tiling?: boolean
  offsetX?: number
  offsetY?: number
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
    const bounds = allControlsBoundsMm(project.controls, project.map, options.printScale)
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
    const bounds = courseBoundsMm(course, project.controls, project.map, options.printScale)
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
    const bounds = allControlsBoundsMm(project.controls, project.map, options.printScale)
    if (bounds) {
      const cols = tileCount(bounds.width, printableW)
      const rows = tileCount(bounds.height, printableH)
      results.push({ courseId: ALL_CONTROLS_ID, courseName: 'All controls', cols, rows, totalPages: cols * rows })
    } else {
      results.push({ courseId: ALL_CONTROLS_ID, courseName: 'All controls', cols: 1, rows: 1, totalPages: 1 })
    }
  }

  for (const course of project.courses.filter(c => options.courseIds.includes(c.id))) {
    const bounds = courseBoundsMm(course, project.controls, project.map, options.printScale)
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

function drawControlSymbol(doc: jsPDF, type: string, pos: Pos) {
  if (type === 'start') {
    const h = START_SIDE * Math.sqrt(3) / 2
    doc.setLineWidth(START_SW)
    doc.triangle(
      pos.x, pos.y - h * 2 / 3,
      pos.x - START_SIDE / 2, pos.y + h / 3,
      pos.x + START_SIDE / 2, pos.y + h / 3,
      'S',
    )
  } else if (type === 'finish') {
    doc.setLineWidth(FINISH_SW)
    doc.circle(pos.x, pos.y, FINISH_R_OUTER, 'S')
    doc.circle(pos.x, pos.y, FINISH_R_INNER, 'S')
  } else {
    doc.setLineWidth(CONTROL_SW)
    doc.circle(pos.x, pos.y, CONTROL_R, 'S')
  }
}

function clipR(type: string): number {
  if (type === 'start') return START_SIDE * Math.sqrt(3) / 2 * 2 / 3
  if (type === 'finish') return FINISH_R_OUTER
  return CONTROL_R
}

function drawLeg(doc: jsPDF, from: Pos, to: Pos, fromType: string, toType: string) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return

  const ux = dx / len
  const uy = dy / len
  const fromR = clipR(fromType)
  const toR = clipR(toType)

  doc.setLineWidth(LEG_W)
  doc.setLineCap(1)
  doc.line(
    from.x + ux * fromR, from.y + uy * fromR,
    to.x - ux * toR, to.y - uy * toR,
  )
}

function drawLabel(doc: jsPDF, label: string, pos: Pos, type: string) {
  doc.setFontSize(NUMBER_SIZE_PT)
  doc.setFont('helvetica', 'bold')

  let ox: number, oy: number
  if (type === 'start') {
    ox = START_SIDE / 2 + 1
    oy = -(START_SIDE * Math.sqrt(3) / 2 * 2 / 3 - 1)
  } else if (type === 'finish') {
    ox = FINISH_R_OUTER + 1
    oy = -(FINISH_R_OUTER - 0.5)
  } else {
    ox = CONTROL_R + 0.8
    oy = -(CONTROL_R - 0.3)
  }

  doc.text(label, pos.x + ox, pos.y + oy)
}

// ── Forbidden route ─────────────────────────────────────────────────────────

function walkPath(points: Pos[], spacing: number): { x: number; y: number; angle: number }[] {
  if (points.length < 2) return []

  const segs: { len: number; angle: number }[] = []
  let totalLen = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const len = Math.sqrt(dx * dx + dy * dy)
    segs.push({ len, angle: Math.atan2(dy, dx) })
    totalLen += len
  }

  const marks: { x: number; y: number; angle: number }[] = []
  const count = Math.max(2, Math.round(totalLen / spacing))
  const step = totalLen / count

  let dist = step / 2
  while (dist < totalLen) {
    let cum = 0
    for (let i = 0; i < segs.length; i++) {
      if (cum + segs[i].len >= dist) {
        const t = (dist - cum) / segs[i].len
        marks.push({
          x: points[i].x + t * (points[i + 1].x - points[i].x),
          y: points[i].y + t * (points[i + 1].y - points[i].y),
          angle: segs[i].angle,
        })
        break
      }
      cum += segs[i].len
    }
    dist += step
  }
  return marks
}

function drawForbiddenRoute(doc: jsPDF, points: Pos[]) {
  if (points.length < 2) return

  doc.setLineCap(1)
  doc.setLineJoin(1)
  doc.setLineWidth(ROUTE_LINE_W)
  for (let i = 0; i < points.length - 1; i++) {
    doc.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y)
  }

  doc.setLineWidth(ROUTE_X_W)
  for (const m of walkPath(points, ROUTE_X_SPACE)) {
    const a1 = m.angle + Math.PI / 4
    const a2 = m.angle - Math.PI / 4
    doc.line(
      m.x - Math.cos(a1) * ROUTE_X_ARM, m.y - Math.sin(a1) * ROUTE_X_ARM,
      m.x + Math.cos(a1) * ROUTE_X_ARM, m.y + Math.sin(a1) * ROUTE_X_ARM,
    )
    doc.line(
      m.x - Math.cos(a2) * ROUTE_X_ARM, m.y - Math.sin(a2) * ROUTE_X_ARM,
      m.x + Math.cos(a2) * ROUTE_X_ARM, m.y + Math.sin(a2) * ROUTE_X_ARM,
    )
  }
}

// ── Crossing point ──────────────────────────────────────────────────────────

function drawCrossingPoint(doc: jsPDF, center: Pos, rotation: number) {
  const { x, y } = center
  const cos = Math.cos(rotation * Math.PI / 180)
  const sin = Math.sin(rotation * Math.PI / 180)
  function rot(px: number, py: number): Pos {
    const dx = px - x, dy = py - y
    return { x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos }
  }

  const hw = CROSS_HALF
  const hh = CROSS_H

  const l0 = rot(x - hw * 0.15, y - hh)
  const lq = rot(x - hw, y)
  const l1 = rot(x - hw * 0.15, y + hh)

  const r0 = rot(x + hw * 0.15, y - hh)
  const rq = rot(x + hw, y)
  const r1 = rot(x + hw * 0.15, y + hh)

  doc.setLineWidth(CROSS_W)
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

function drawOutOfBoundsArea(doc: jsPDF, points: Pos[]) {
  if (points.length < 3) return

  // Boundary outline
  doc.setLineWidth(OOB_BOUNDARY_W)
  doc.setLineCap(1)
  doc.setLineJoin(1)
  doc.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    doc.lineTo(points[i].x, points[i].y)
  }
  doc.lineTo(points[0].x, points[0].y)
  doc.stroke()

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

  // 45° hatch lines: for line y = x + c, perpendicular spacing = step
  // means c changes by step * sqrt(2)
  doc.setLineWidth(OOB_HATCH_W)
  const cMin = minY - maxX
  const cMax = maxY - minX
  const cStep = OOB_HATCH_SPACE * Math.SQRT2

  for (let c = cMin; c <= cMax; c += cStep) {
    const xStart = Math.max(minX, minY - c)
    const xEnd = Math.min(maxX, maxY - c)
    if (xStart >= xEnd) continue
    doc.line(xStart, xStart + c, xEnd, xEnd + c)
  }

  internal.write('Q')
}

// ── Labelling ───────────────────────────────────────────────────────────────

function getLabel(c: Control, seqMap: Map<string, number> | null): string {
  if (seqMap && c.type === 'control') {
    return String(seqMap.get(c.id) ?? defaultControlLabel(c))
  }
  return defaultControlLabel(c)
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

  const doc = new jsPDF({ orientation: orient, unit: 'mm', format: [pw, ph] })
  const controlMap = new Map(project.controls.map(c => [c.id, c]))
  const courses = project.courses.filter(c => options.courseIds.includes(c.id))

  let mapDataUrl: string | null = null
  if (loadedMap) {
    try { mapDataUrl = await rasterizeMap(loadedMap, options.mapOpacity ?? 1) } catch { /* fall back to no map */ }
  }

  let pageIndex = 0

  // All controls page (no legs, just control symbols with codes)
  if (options.allControls && project.controls.length > 0) {
    const bounds = allControlsBoundsMm(project.controls, project.map, options.printScale)
    if (bounds) {
      const useTiling = options.tiling && (bounds.width > printableW || bounds.height > printableH)
      const cols = useTiling ? tileCount(bounds.width, printableW) : 1
      const rows = useTiling ? tileCount(bounds.height, printableH) : 1

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (pageIndex > 0) doc.addPage([pw, ph], orient)
          pageIndex++

          const ox = options.offsetX ?? 0
          const oy = options.offsetY ?? 0
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
            const mm = mapToMm(pt, project.map, options.printScale)
            return { x: cx + (mm.x - viewCenterX), y: cy + (mm.y - viewCenterY) }
          }

          if (mapDataUrl && loadedMap) {
            const tl = toPage({ x: loadedMap.bounds.minX, y: loadedMap.bounds.minY })
            const br = toPage({ x: loadedMap.bounds.maxX, y: loadedMap.bounds.maxY })
            doc.addImage(mapDataUrl, 'JPEG', tl.x, tl.y, br.x - tl.x, br.y - tl.y)
          }

          const color = '#7B2FBE'
          setColor(doc, color)

          for (const ann of project.annotations) {
            if (ann.type === 'forbidden_route') {
              drawForbiddenRoute(doc, ann.points.map(p => toPage(p)))
            } else if (ann.type === 'crossing_point' && ann.points[0]) {
              drawCrossingPoint(doc, toPage(ann.points[0]), ann.rotation ?? 0)
            } else if (ann.type === 'out_of_bounds') {
              drawOutOfBoundsArea(doc, ann.points.map(p => toPage(p)))
            }
          }

          for (const ctrl of project.controls) {
            const pos = toPage(ctrl.position)
            setColor(doc, color)
            drawControlSymbol(doc, ctrl.type, pos)
            drawLabel(doc, defaultControlLabel(ctrl), pos, ctrl.type)
          }

          doc.setFontSize(8)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(130, 130, 130)
          const tileLabel = cols * rows > 1
            ? `All controls  —  1:${options.printScale.toLocaleString()}  —  Page ${row * cols + col + 1}/${cols * rows}`
            : `All controls  —  1:${options.printScale.toLocaleString()}`
          doc.text(tileLabel, MARGIN, MARGIN + 3)
        }
      }
    }
  }

  for (const course of courses) {
    const bounds = courseBoundsMm(course, project.controls, project.map, options.printScale)
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
        const ox = options.offsetX ?? 0
        const oy = options.offsetY ?? 0
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
          const mm = mapToMm(pt, project.map, options.printScale)
          return { x: cx + (mm.x - viewCenterX), y: cy + (mm.y - viewCenterY) }
        }

        // Map background
        if (mapDataUrl && loadedMap) {
          const tl = toPage({ x: loadedMap.bounds.minX, y: loadedMap.bounds.minY })
          const br = toPage({ x: loadedMap.bounds.maxX, y: loadedMap.bounds.maxY })
          doc.addImage(mapDataUrl, 'JPEG', tl.x, tl.y, br.x - tl.x, br.y - tl.y)
        }

        setColor(doc, course.color)

        // Annotations
        for (const ann of project.annotations) {
          if (ann.type === 'forbidden_route') {
            drawForbiddenRoute(doc, ann.points.map(p => toPage(p)))
          } else if (ann.type === 'crossing_point' && ann.points[0]) {
            drawCrossingPoint(doc, toPage(ann.points[0]), ann.rotation ?? 0)
          } else if (ann.type === 'out_of_bounds') {
            drawOutOfBoundsArea(doc, ann.points.map(p => toPage(p)))
          }
        }

        // Legs
        if (course.type === 'linear' && course.controls.length >= 2) {
          for (let i = 0; i < course.controls.length - 1; i++) {
            const from = controlMap.get(course.controls[i].controlId)
            const to = controlMap.get(course.controls[i + 1].controlId)
            if (!from || !to) continue
            setColor(doc, course.color)
            drawLeg(doc, toPage(from.position), toPage(to.position), from.type, to.type)
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
          drawControlSymbol(doc, ctrl.type, pos)
          drawLabel(doc, getLabel(ctrl, seqMap), pos, ctrl.type)
        }

        // Description sheet overlay on map
        if (options.descriptionOnMap && course.controls.length > 0) {
          const sx = options.sheetX ?? MARGIN
          const sy = options.sheetY ?? MARGIN
          drawDescriptionSheetOverlay(doc, course, project.controls, options.printScale, sx, sy)
        }

        // Header line
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(130, 130, 130)
        const tileLabel = cols * rows > 1
          ? `${course.name}  —  1:${options.printScale.toLocaleString()}  —  Page ${row * cols + col + 1}/${cols * rows}`
          : `${course.name}  —  1:${options.printScale.toLocaleString()}`
        doc.text(tileLabel, MARGIN, MARGIN + 3)
      }
    }

    // Description sheet on separate page(s)
    if (options.includeDescriptions && !options.descriptionOnMap && course.controls.length > 0) {
      doc.addPage([pw, ph], orient)
      pageIndex++
      drawDescriptionSheet(doc, course, project.controls, options.printScale, pw, ph)
    }
  }

  return doc.output('blob')
}
