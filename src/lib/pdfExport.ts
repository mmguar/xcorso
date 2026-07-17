// Type-only: jspdf (~350 KB) must not land in the startup chunk. Components and
// the store statically import page-geometry helpers from this module, so the
// runtime library is loaded on demand in exportCoursePdf instead.
import type { jsPDF } from 'jspdf'
import type { Project, Course, Control, CourseControl, MapPoint, MapConfig, ScaleBar, TextLabel, ImageOverlay, EventSpec, MapBorder, CircleGap, LegGap, ControlType, Annotation, OverprintMode, AppearanceSettings } from '../types'
import type { LoadedMap } from './mapLoader'
import { applyMapOverprint, pruneSvgToColors } from './overprint'
import { descriptionSheetSize, drawDescriptionSheet, drawDescriptionSheetOverlay, drawDescriptionSheetOverlayPart } from './pdfDescriptionSheet'
import { defaultControlLabel, buildSequenceMap, formatSequenceLabel, resolveVariation, computeSubmaps, submapLayoutView, controlsById, IOF_PURPLE } from './courseUtils'
import { computeCourseDistances, resolveCourseLength, formatScaleBarDistance, scaleBarLayoutMm } from './distance'
import { resolveSpec, getSymbolDims, symbolScaleFactor as specScaleFactor, getAnnotationDims, controlSymbolRadiusMm, symbolLabelOffset, MM_TO_PT } from './symbolSpec'
import type { SymbolDims } from './symbolSpec'
import { circleGapDashArray, legGapDashArray } from './gapDash'
import { walkPath, clipPolyline, distance, polylineLength, interpolatePolyline, catmullRomToCubics, flattenSmooth } from './geometry'
import { hexToRgb, darkenHex } from './color'
import {
  startTriangleVertices, startTriangleAngle,
  exchangeTriangleVertices, exchangeTriangleAngle,
  routeXMarkSegments,
  crossingPointCurve,
  northArrowGeometry,
  rotateAround,
} from './symbolGeometry'

export const MARGIN = 10
export const TILE_OVERLAP = 15
const MAX_RASTER_PX = 5000

export const ALL_CONTROLS_ID = '__all_controls__'

export function submapPreviewId(courseId: string, index: number): string {
  return `${courseId}__sub${index}`
}


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

export type { DescMode } from '../types'
import type { DescMode } from '../types'

export interface PdfExportOptions {
  pageSize: string
  orientation: 'portrait' | 'landscape'
  printScale: number
  scaleOverrides?: Record<string, number>
  courseIds: string[]
  allControls?: boolean
  allControlsMulticolor?: boolean
  allControlsLinkId?: boolean
  descModes?: Record<string, DescMode>
  offsets?: Record<string, { x: number; y: number }>
  sheetPositions?: Record<string, { x: number; y: number }>
  tiling?: boolean
  mapOpacity?: number
  mapRendering?: 'vector' | 'raster'
  rasterDpi?: number
  /** Simulate spot-ink overprint on the base map. Forces the raster path. */
  mapOverprint?: boolean
  /** Annotation overprint level: 0 = solid knockout, 1 = full multiply overprint. Default 1. */
  overprint?: number
  /** Course/control/annotation ink stacking. 'below' redraws black/brown/blue map colours on top. */
  overprintMode?: OverprintMode
  /** Editor appearance settings — applied to the printed course ink so the PDF
   * matches the on-screen preview (symbol size, line width, color, outline). */
  appearance?: AppearanceSettings
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  controlScale: 1, lineWidth: 1, color: '',
  outlineEnabled: false, outlineColor: '#ffffff', outlineWidth: 0.7,
}

// Appearance-adjusted symbol dims: controlScale scales the geometry,
// lineWidth scales the strokes — mirrors ControlsLayer / LegsLayer.
function dimsFor(spec: EventSpec, app: AppearanceSettings): SymbolDims {
  const d = getSymbolDims(spec)
  if (app.controlScale === 1 && app.lineWidth === 1) return d
  return {
    ...d,
    controlR: d.controlR * app.controlScale,
    startSide: d.startSide * app.controlScale,
    finishROuter: d.finishROuter * app.controlScale,
    finishRInner: d.finishRInner * app.controlScale,
    labelH: d.labelH * app.controlScale,
    strokeW: d.strokeW * app.lineWidth,
    legW: d.legW * app.lineWidth,
  }
}

export interface CourseFitInfo {
  courseId: string
  courseName: string
  fits: boolean
  /** Whether the course lies inside the printable window at the layout's
   * current mapCenter (undefined when no mapCenter was supplied). `fits`
   * without this means "can fit" — the size is right but the map is
   * positioned so parts of the course fall off the page. */
  fitsAtCenter?: boolean
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
    const pixelDist = distance(p1, p2)
    if (pixelDist === 0) return { x: 0, y: 0 }
    const factor = realWorldMeters * 1000 / (pixelDist * printScale)
    return { x: point.x * factor, y: point.y * factor }
  }
  return { x: 0, y: 0 }
}

export function mmToMap(mm: { x: number; y: number }, map: MapConfig, printScale: number): MapPoint {
  if (map.type === 'ocad') {
    const factor = (100 * printScale) / map.scale
    return { x: mm.x * factor, y: mm.y * factor }
  }
  if (map.scaleMeasurement) {
    const { p1, p2, realWorldMeters } = map.scaleMeasurement
    const pixelDist = distance(p1, p2)
    if (pixelDist === 0) return { x: 0, y: 0 }
    const factor = (pixelDist * printScale) / (realWorldMeters * 1000)
    return { x: mm.x * factor, y: mm.y * factor }
  }
  return { x: 0, y: 0 }
}

export function canExportPdf(map: MapConfig): boolean {
  return map.type === 'ocad' || map.scaleMeasurement != null
}

// ── Map rasterization ──────────────────────────────────────────────────────

interface RasterCrop {
  minX: number; minY: number; width: number; height: number
}

async function canvasToImageBytes(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), type, quality)
  })
  return new Uint8Array(await blob.arrayBuffer())
}

// ponytail: render full SVG once, crop per page — avoids N re-renders
interface SvgRasterCache {
  img: HTMLImageElement
  bounds: RasterCrop
  pxW: number
  pxH: number
  opacity: number
}

const SVG_CACHE_MAX_PX = 8000

async function prepareSvgRasterCache(
  svgEl: SVGElement,
  bounds: RasterCrop,
  opacity: number,
  overprint: boolean,
  extra: { keepColors?: string[]; transparent?: boolean } = {},
): Promise<SvgRasterCache> {
  const clone = svgEl.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`)
  const aspect = bounds.width / bounds.height
  const pxW = aspect >= 1 ? SVG_CACHE_MAX_PX : Math.max(1, Math.round(SVG_CACHE_MAX_PX * aspect))
  const pxH = aspect >= 1 ? Math.max(1, Math.round(SVG_CACHE_MAX_PX / aspect)) : SVG_CACHE_MAX_PX
  clone.setAttribute('width', String(pxW))
  clone.setAttribute('height', String(pxH))
  if (overprint) applyMapOverprint(clone, bounds)
  if (extra.keepColors?.length) pruneSvgToColors(clone, extra.keepColors)
  const svgString = new XMLSerializer().serializeToString(clone)
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { img, bounds, pxW, pxH, opacity }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function cropFromSvgCache(
  cache: SvgRasterCache,
  crop: RasterCrop,
  outW: number,
  outH: number,
  transparent: boolean,
): Promise<Uint8Array> {
  const { img, bounds, pxW, pxH, opacity } = cache
  const sx = (crop.minX - bounds.minX) / bounds.width * pxW
  const sy = (crop.minY - bounds.minY) / bounds.height * pxH
  const sw = crop.width / bounds.width * pxW
  const sh = crop.height / bounds.height * pxH
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  if (!transparent) {
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, outW, outH)
  }
  ctx.globalAlpha = opacity
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
  return canvasToImageBytes(canvas, transparent ? 'image/png' : 'image/jpeg', transparent ? undefined : 0.85)
}

async function rasterizeSvgRegion(
  svgEl: SVGElement,
  crop: RasterCrop,
  canvasW: number,
  canvasH: number,
  opacity: number,
  overprint = false,
  extra: { keepColors?: string[]; transparent?: boolean } = {},
): Promise<string> {
  const clone = svgEl.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `${crop.minX} ${crop.minY} ${crop.width} ${crop.height}`)
  clone.setAttribute('width', String(canvasW))
  clone.setAttribute('height', String(canvasH))
  if (overprint) applyMapOverprint(clone, crop)
  if (extra.keepColors && extra.keepColors.length > 0) pruneSvgToColors(clone, extra.keepColors)

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
    if (!extra.transparent) {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvasW, canvasH)
    }
    ctx.globalAlpha = opacity
    ctx.drawImage(img, 0, 0, canvasW, canvasH)
    // PNG preserves transparency for the top-colours overlay; JPEG is smaller
    // for the opaque base map.
    return extra.transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function rasterizeBitmap(loadedMap: LoadedMap, opacity: number): Promise<string> {
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
  return canvas.toDataURL('image/jpeg', 0.85)
}

/**
 * svg2pdf resolves inline `style` blocks via the browser selector engine. Running it on SVG
 * attached to the main document can leave engine state that breaks fills on a later export.
 * A reusable iframe isolates each svg2pdf call from the main document.
 */
// ponytail: one iframe reused across pages instead of create/destroy per page
let sharedIframe: HTMLIFrameElement | null = null

async function svg2pdfInIsolatedDocument(
  svg: SVGElement,
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  const markup = new XMLSerializer().serializeToString(svg)
  if (!sharedIframe || !sharedIframe.isConnected) {
    sharedIframe = document.createElement('iframe')
    sharedIframe.setAttribute('title', 'pdf map svg')
    sharedIframe.setAttribute('aria-hidden', 'true')
    sharedIframe.setAttribute('sandbox', 'allow-same-origin')
    sharedIframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;opacity:0;pointer-events:none'
    document.body.appendChild(sharedIframe)
  }
  const iframe = sharedIframe
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
}

function cleanupSvgIframe() {
  if (sharedIframe) { sharedIframe.remove(); sharedIframe = null }
}

// ── Bounding box ────────────────────────────────────────────────────────────

// Pad control-centre bounds by the largest symbol's circumradius plus a code-label
// allowance, scaled like the symbols themselves (baseScale/printScale).
const LABEL_PAD_MM = 2
function boundsPad(spec: EventSpec, printScale: number): number {
  const dims = getSymbolDims(spec)
  return (controlSymbolRadiusMm('start', dims) + LABEL_PAD_MM) * specScaleFactor(spec, printScale)
}

function computeBounds(positions: Pos[], pad: number): Bounds | null {
  if (positions.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of positions) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const width = maxX - minX
  const height = maxY - minY
  return { minX, minY, maxX, maxY, width, height, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 }
}

export function courseBoundsMm(
  course: Course,
  controls: Control[],
  map: MapConfig,
  printScale: number,
  projectSpec?: EventSpec,
): Bounds | null {
  const controlMap = controlsById(controls)
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
    if (cc.legNavBendPoints) {
      for (const bp of cc.legNavBendPoints) {
        positions.push(mapToMm(bp, map, printScale))
      }
    }
  }
  return computeBounds(positions, boundsPad(resolveSpec(projectSpec, course.spec), printScale))
}

function allControlsBoundsMm(
  controls: Control[],
  map: MapConfig,
  printScale: number,
  projectSpec?: EventSpec,
): Bounds | null {
  return computeBounds(
    controls.map(c => mapToMm(c.position, map, printScale)),
    boundsPad(resolveSpec(projectSpec), printScale),
  )
}

// ponytail: greedy graph coloring by proximity — not optimal 4-color but good enough
export const MULTICOLOR_PALETTE = [IOF_PURPLE, '#d946a8', '#a31515', '#e6199e'] as const

export function assignControlColors(controls: Control[]): Map<string, number> {
  if (controls.length === 0) return new Map()
  // Sort by nearest-neighbor distance so close controls get colored first
  const idxByDist: number[] = []
  const used = new Set<number>()
  // Start from first control
  let cur = 0
  for (let step = 0; step < controls.length; step++) {
    idxByDist.push(cur)
    used.add(cur)
    let bestDist = Infinity
    let bestIdx = -1
    for (let j = 0; j < controls.length; j++) {
      if (used.has(j)) continue
      const dx = controls[j].position.x - controls[cur].position.x
      const dy = controls[j].position.y - controls[cur].position.y
      const d = dx * dx + dy * dy
      if (d < bestDist) { bestDist = d; bestIdx = j }
    }
    if (bestIdx >= 0) cur = bestIdx
  }

  const byId = new Map(controls.map(c => [c.id, c]))
  const result = new Map<string, number>()
  for (const idx of idxByDist) {
    const neighbors: { dist: number; color: number }[] = []
    for (const [otherId, otherColor] of result) {
      const other = byId.get(otherId)!
      const dx = controls[idx].position.x - other.position.x
      const dy = controls[idx].position.y - other.position.y
      neighbors.push({ dist: dx * dx + dy * dy, color: otherColor })
    }
    neighbors.sort((a, b) => a.dist - b.dist)
    const blocked = new Set(neighbors.slice(0, 3).map(n => n.color))
    let pick = 0
    for (let c = 0; c < 4; c++) {
      if (!blocked.has(c)) { pick = c; break }
    }
    result.set(controls[idx].id, pick)
  }
  return result
}

function pageDimsFor(pageSize: string, orientation: 'portrait' | 'landscape'): { w: number; h: number } {
  const base = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4
  return orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h }
}

function pageDims(opts: PdfExportOptions): { w: number; h: number } {
  return pageDimsFor(opts.pageSize, opts.orientation)
}

/** Printable area inside the page margins, optionally clamped to a map border. */
export function printableSize(pw: number, ph: number, border?: MapBorder): { w: number; h: number } {
  const marginW = pw - 2 * MARGIN
  const marginH = ph - 2 * MARGIN
  return {
    w: border ? Math.min(border.width, marginW) : marginW,
    h: border ? Math.min(border.height, marginH) : marginH,
  }
}

// ── Common scales ──────────────────────────────────────────────────────

export const COMMON_SCALES = [
  15000, 10000, 7500, 5000, 4000, 3000, 2500, 2000, 1500, 1000,
]

/** Smallest common scale at which the given course (any control slice) fits the page. */
export function suggestFitScaleForCourseObj(
  course: Course,
  controls: Control[],
  map: MapConfig,
  pageSize: string,
  orientation: 'portrait' | 'landscape',
  border?: MapBorder,
  projectSpec?: EventSpec,
): number | null {
  const { w: pw, h: ph } = pageDimsFor(pageSize, orientation)
  const { w: printableW, h: printableH } = printableSize(pw, ph, border)
  const sorted = [...COMMON_SCALES].sort((a, b) => a - b)
  for (const scale of sorted) {
    const bounds = courseBoundsMm(course, controls, map, scale, projectSpec)
    if (!bounds) return scale
    if (bounds.width <= printableW && bounds.height <= printableH) return scale
  }
  return null
}

export function checkFitForCourseObj(
  course: Course,
  controls: Control[],
  map: MapConfig,
  pageSize: string,
  orientation: 'portrait' | 'landscape',
  printScale: number,
  border?: MapBorder,
  mapCenter?: MapPoint,
  projectSpec?: EventSpec,
): CourseFitInfo {
  const { w: pw, h: ph } = pageDimsFor(pageSize, orientation)
  const { w: printableW, h: printableH } = printableSize(pw, ph, border)
  const bounds = courseBoundsMm(course, controls, map, printScale, projectSpec)
  // Printable window at the current centering: export places mapCenter at the
  // page center, the border rect (or page margins) crops from there.
  let fitsAtCenter: boolean | undefined
  if (mapCenter && bounds) {
    const c = mapToMm(mapCenter, map, printScale)
    const winX = c.x - pw / 2 + (border ? border.x : MARGIN)
    const winY = c.y - ph / 2 + (border ? border.y : MARGIN)
    fitsAtCenter =
      bounds.minX >= winX && bounds.maxX <= winX + printableW &&
      bounds.minY >= winY && bounds.maxY <= winY + printableH
  }
  return {
    courseId: course.id,
    courseName: course.name,
    fits: !bounds || (bounds.width <= printableW && bounds.height <= printableH),
    fitsAtCenter,
    widthMm: bounds?.width ?? 0,
    heightMm: bounds?.height ?? 0,
    printableW,
    printableH,
  }
}

export function checkTilingForCourseObj(
  course: Course,
  controls: Control[],
  map: MapConfig,
  pageSize: string,
  orientation: 'portrait' | 'landscape',
  printScale: number,
  border?: MapBorder,
  projectSpec?: EventSpec,
): CourseTileInfo {
  const { w: pw, h: ph } = pageDimsFor(pageSize, orientation)
  const { w: printableW, h: printableH } = printableSize(pw, ph, border)
  const bounds = courseBoundsMm(course, controls, map, printScale, projectSpec)
  if (!bounds) return { courseId: course.id, courseName: course.name, cols: 1, rows: 1, totalPages: 1 }
  const cols = tileCount(bounds.width, printableW)
  const rows = tileCount(bounds.height, printableH)
  return { courseId: course.id, courseName: course.name, cols, rows, totalPages: cols * rows }
}

/** Fit/tiling info for the all-controls page (no layout, no border, no map center). */
export function checkFitForAllControls(
  controls: Control[],
  map: MapConfig,
  pageSize: string,
  orientation: 'portrait' | 'landscape',
  printScale: number,
  projectSpec?: EventSpec,
): (CourseTileInfo & { fits: boolean; widthMm: number; heightMm: number }) | null {
  const { w: pw, h: ph } = pageDimsFor(pageSize, orientation)
  const { w: printableW, h: printableH } = printableSize(pw, ph)
  const bounds = allControlsBoundsMm(controls, map, printScale, projectSpec)
  if (!bounds) return null
  const cols = tileCount(bounds.width, printableW)
  const rows = tileCount(bounds.height, printableH)
  return {
    courseId: ALL_CONTROLS_ID,
    courseName: '',
    fits: bounds.width <= printableW && bounds.height <= printableH,
    widthMm: bounds.width,
    heightMm: bounds.height,
    cols, rows, totalPages: cols * rows,
  }
}

/** Clue-sheet view when the submap restart control row is hidden
 * (project.clueSheetHideSubmapRestart): drop the first control and shift the
 * break indices, which are stored against the full submap control list. */
export function clueSheetHiddenRestartView(
  controls: CourseControl[],
  breaks: number[] | undefined,
): { controls: CourseControl[]; breaks: number[] | undefined } {
  return {
    controls: controls.slice(1),
    breaks: breaks?.map(b => b - 1).filter(b => b > 0),
  }
}

// ── Tiling ─────────────────────────────────────────────────────────────────

export function tileCount(courseDim: number, printableDim: number): number {
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

// ── Color helpers ───────────────────────────────────────────────────────────

function setColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex)
  doc.setDrawColor(r, g, b)
  doc.setFillColor(r, g, b)
  doc.setTextColor(r, g, b)
}

// ── Gap dash patterns ──────────────────────────────────────────────────────

function legGapDash(gaps: LegGap[], lineLen: number): { dash: number[]; phase: number } | null {
  const dash = legGapDashArray(gaps, lineLen)
  return dash ? { dash, phase: 0 } : null
}

// ── Drawing primitives ──────────────────────────────────────────────────────

function drawControlSymbol(doc: jsPDF, type: string, pos: Pos, printScale: number, spec: EventSpec, app: AppearanceSettings, color: string, isExchange = false, gaps?: CircleGap[], startAngle = 0) {
  const dims = dimsFor(spec, app)
  const sf = specScaleFactor(spec, printScale)
  const startSide = dims.startSide * sf
  const finishOuter = dims.finishROuter * sf
  const finishInner = dims.finishRInner * sf
  const controlR = dims.controlR * sf
  const strokeSw = dims.strokeW * sf

  // mirror=true for circles: jsPDF winds the opposite way from SVG (see gapDash.ts).
  // The start triangle is drawn with explicit, matching vertex order, so it uses mirror=false.
  const gapDash = gaps?.length
    ? (circ: number, mirror: boolean) => {
        const d = circleGapDashArray(gaps, circ, mirror)
        if (d) doc.setLineDashPattern(d, 0)
      }
    : () => {}
  const resetDash = gaps?.length ? () => doc.setLineDashPattern([], 0) : () => {}

  function pass(sw: number) {
    if (type === 'start') {
      const [a, b, c] = startTriangleVertices(pos, startSide, startAngle)
      doc.setLineWidth(sw)
      gapDash(startSide * 3, false)
      doc.triangle(a.x, a.y, b.x, b.y, c.x, c.y, 'S')
      resetDash()
    } else if (type === 'finish') {
      doc.setLineWidth(sw)
      gapDash(2 * Math.PI * finishOuter, true)
      doc.circle(pos.x, pos.y, finishOuter, 'S')
      resetDash()
      gapDash(2 * Math.PI * finishInner, true)
      doc.circle(pos.x, pos.y, finishInner, 'S')
      resetDash()
    } else if (isExchange) {
      // ISOM 715: circle ø 6.0 (= finish outer), apex toward the following
      // control (startAngle doubles as the triangle angle here).
      doc.setLineWidth(sw)
      gapDash(2 * Math.PI * finishOuter, true)
      doc.circle(pos.x, pos.y, finishOuter, 'S')
      resetDash()
      const [a, b, c] = exchangeTriangleVertices(pos, finishOuter, startAngle)
      doc.triangle(a.x, a.y, b.x, b.y, c.x, c.y, 'S')
    } else {
      doc.setLineWidth(sw)
      gapDash(2 * Math.PI * controlR, true)
      doc.circle(pos.x, pos.y, controlR, 'S')
      resetDash()
    }
  }

  if (app.outlineEnabled) {
    setColor(doc, app.outlineColor)
    doc.setLineJoin(1)
    pass(strokeSw + app.outlineWidth * 2)
  }
  setColor(doc, color)
  pass(strokeSw)
}

function clipR(type: string, printScale: number, spec: EventSpec, app: AppearanceSettings, gap = true): number {
  const dims = dimsFor(spec, app)
  const sf = specScaleFactor(spec, printScale)
  const gapMul = gap ? 1.4 : 1
  return controlSymbolRadiusMm(type as ControlType, dims) * sf * gapMul
}

function drawLeg(doc: jsPDF, from: Pos, to: Pos, fromType: string, toType: string, printScale: number, spec: EventSpec, app: AppearanceSettings, color: string, bendPoints?: Pos[], gaps?: LegGap[], markedRoute?: string) {
  const dims = dimsFor(spec, app)
  const sf = specScaleFactor(spec, printScale)
  doc.setLineCap(1)
  const noGap = !!markedRoute
  const fromR = clipR(fromType, printScale, spec, app, !noGap)
  const toR = clipR(toType, printScale, spec, app, !noGap)

  const fullPts: Pos[] = bendPoints?.length ? [from, ...bendPoints, to] : [from, to]
  const fullLen = polylineLength(fullPts)

  const clipped = clipPolyline(fullPts, fromR, toR)
  if (clipped.length < 2) return

  const clippedLen = polylineLength(clipped)

  // Remap gaps from full-leg fractions to clipped-leg fractions
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

  // ponytail: IOF 707 2mm dash, 0.5mm gap for marked/taped routes
  const gd = markedRoute ? { dash: [2 * sf, 0.5 * sf], phase: 0 }
    : remapped?.length ? legGapDash(remapped, clippedLen) : null
  if (gd) {
    doc.setLineDashPattern(gd.dash, gd.phase)
    doc.setLineCap(0)
  }

  function strokePath() {
    doc.moveTo(clipped[0].x, clipped[0].y)
    if (markedRoute && clipped.length >= 3) {
      const segs = catmullRomToCubics(clipped)
      for (const s of segs) doc.curveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.end.x, s.end.y)
    } else {
      for (let i = 1; i < clipped.length; i++) doc.lineTo(clipped[i].x, clipped[i].y)
    }
    doc.stroke()
  }

  if (app.outlineEnabled) {
    setColor(doc, app.outlineColor)
    doc.setLineJoin(1)
    doc.setLineWidth(dims.legW * sf + app.outlineWidth * 2)
    strokePath()
  }
  setColor(doc, color)
  doc.setLineWidth(dims.legW * sf)
  strokePath()

  if (gd) {
    doc.setLineDashPattern([], 0)
    doc.setLineCap(1)
  }
}


function drawLabel(doc: jsPDF, label: string, pos: Pos, type: ControlType, printScale: number, spec: EventSpec, app: AppearanceSettings, color: string, labelOffsetMm?: Pos) {
  const dims = dimsFor(spec, app)
  const sf = specScaleFactor(spec, printScale)

  // ISOM 704: control number in Arial 4.0 mm (dims.labelH), non-bold.
  doc.setFontSize(dims.labelH * sf * MM_TO_PT)
  doc.setFont('helvetica', 'normal')

  const off = labelOffsetMm ?? symbolLabelOffset(type, dims, sf)
  const x = pos.x + off.x
  const y = pos.y + off.y
  if (app.outlineEnabled) {
    setColor(doc, app.outlineColor)
    doc.setLineWidth(app.outlineWidth * 2)
    doc.setLineJoin(1)
    doc.text(label, x, y, { renderingMode: 'stroke' })
  }
  setColor(doc, color)
  doc.text(label, x, y)
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
  doc.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    doc.lineTo(points[i].x, points[i].y)
  }
  doc.stroke()

  doc.setLineWidth(d.routeXW)
  const marks = walkPath(points, d.routeXSpace)
  for (const m of marks) {
    for (const [p0, p1] of routeXMarkSegments(m, d.routeXArm)) {
      doc.moveTo(p0.x, p0.y)
      doc.lineTo(p1.x, p1.y)
    }
  }
  if (marks.length > 0) doc.stroke()
}

// ── Crossing point ──────────────────────────────────────────────────────────

function drawCrossingPoint(doc: jsPDF, center: Pos, rotation: number, elongation: number, mapScale: number, spec: EventSpec, elongScale: number) {
  const d = annotationDimsMm(mapScale, spec)
  // Elongation is anchored to map features (stored in mm at map scale, like the
  // canvas ext = elongation * upm), so it rescales with the print scale.
  const ext = Math.max(0, elongation) * elongScale
  // Split the pinch curve at its centre; elongation pulls the halves apart and
  // joins them with a vertical line at the inner pinch (matches canvas render).
  const { spread, midX, ctrlY, totalHH } = crossingPointCurve(d, ext)
  const { x, y } = center
  const rot = (px: number, py: number): Pos => rotateAround({ x: px, y: py }, center, rotation)
  // Quadratic (p0 → qc → p1) drawn as a cubic via the 2/3 control rule.
  function quad(p0: Pos, qc: Pos, p1: Pos) {
    doc.curveTo(
      p0.x + 2 / 3 * (qc.x - p0.x), p0.y + 2 / 3 * (qc.y - p0.y),
      p1.x + 2 / 3 * (qc.x - p1.x), p1.y + 2 / 3 * (qc.y - p1.y),
      p1.x, p1.y,
    )
  }

  doc.setLineWidth(d.crossW)
  doc.setLineCap(1)

  for (const s of [1, -1]) {
    const top      = rot(x + s * spread, y - totalHH)
    const pinchTop = rot(x + s * midX, y - ext)
    const ctrlTop  = rot(x + s * midX, y - ctrlY - ext)
    const pinchBot = rot(x + s * midX, y + ext)
    const ctrlBot  = rot(x + s * midX, y + ctrlY + ext)
    const bot      = rot(x + s * spread, y + totalHH)

    doc.moveTo(top.x, top.y)
    quad(top, ctrlTop, pinchTop)
    doc.lineTo(pinchBot.x, pinchBot.y)
    quad(pinchBot, ctrlBot, bot)
  }
  doc.stroke()
}

// ── Out-of-bounds area ──────────────────────────────────────────────────────

function drawOutOfBoundsArea(doc: jsPDF, points: Pos[], mapScale: number, spec: EventSpec, boundaryMarking: 'none' | 'continuous' | 'intermittent') {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsPDF undocumented internal API
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

  let hatchStarted = false
  for (let c = cMin1; c <= cMax1; c += cStep) {
    const xStart = Math.max(minX, minY - c)
    const xEnd = Math.min(maxX, maxY - c)
    if (xStart >= xEnd) continue
    doc.moveTo(xStart, xStart + c)
    doc.lineTo(xEnd, xEnd + c)
    hatchStarted = true
  }

  const cMin2 = minX + minY
  const cMax2 = maxX + maxY

  for (let c = cMin2; c <= cMax2; c += cStep) {
    const xStart = Math.max(minX, c - maxY)
    const xEnd = Math.min(maxX, c - minY)
    if (xStart <= xEnd) {
      doc.moveTo(xStart, c - xStart)
      doc.lineTo(xEnd, c - xEnd)
      hatchStarted = true
    }
  }
  if (hatchStarted) doc.stroke()

  internal.write('Q')

  // Boundary outline — drawn after restoring the clip so the stroke isn't clipped
  if (boundaryMarking !== 'none') {
    doc.setLineWidth(d.oobMarkW)
    if (boundaryMarking === 'intermittent') {
      doc.setLineDashPattern([d.oobMarkDash, d.oobMarkGap], 0)
    }
    doc.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      doc.lineTo(points[i].x, points[i].y)
    }
    doc.lineTo(points[0].x, points[0].y)
    doc.stroke()
    if (boundaryMarking === 'intermittent') doc.setLineDashPattern([], 0)
  }
}

// ── North arrow ────────────────────────────────────────────────────────────

function drawNorthArrow(
  doc: jsPDF,
  center: Pos,
  rotation: number,
  annScale: number,
  mapScale: number,
  spec: EventSpec,
  color: string,
  textColor: string,
) {
  const d = annotationDimsMm(mapScale, spec)
  const h = d.northArrowH * annScale
  const { halfBase, apexLocalY, baseLocalY } = northArrowGeometry(h, 1)
  const strokeW = d.northStrokeW

  const { x: cx, y: cy } = center
  const rot = (lx: number, ly: number): Pos => rotateAround({ x: cx + lx, y: cy + ly }, center, rotation)

  const apex = rot(0, apexLocalY)
  const br = rot(halfBase, baseLocalY)
  const bl = rot(-halfBase, baseLocalY)

  // Filled triangle
  const [r, g, b] = hexToRgb(color)
  doc.setFillColor(r, g, b)
  const [dr, dg, db] = hexToRgb(darkenHex(color))
  doc.setDrawColor(dr, dg, db)
  doc.setLineWidth(strokeW)
  doc.setLineJoin(1)
  doc.moveTo(apex.x, apex.y)
  doc.lineTo(br.x, br.y)
  doc.lineTo(bl.x, bl.y)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsPDF undocumented internal API
  ;(doc as any).internal.write('h')
  doc.fillStroke()

  // "N" text
  const fontSize = h * 0.45
  const textPos = rot(0, h * 0.12)
  const [tr, tg, tb] = hexToRgb(textColor)
  doc.setTextColor(tr, tg, tb)
  doc.setFontSize(fontSize * MM_TO_PT)
  doc.setFont('helvetica', 'bold')
  // baseline 'middle' matches the canvas dominantBaseline="central"
  doc.text('N', textPos.x, textPos.y, { align: 'center', baseline: 'middle', angle: -rotation })
}

// OOB boundary — a simple polyline with 0.7 mm stroke (at base scale).
function drawOobBoundary(doc: jsPDF, points: Pos[], mapScale: number, spec: EventSpec) {
  if (points.length < 2) return
  const d = annotationDimsMm(mapScale, spec)
  doc.setLineCap(1)
  doc.setLineJoin(1)
  doc.setLineWidth(d.boundaryW)
  doc.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    doc.lineTo(points[i].x, points[i].y)
  }
  doc.stroke()
}

// Purple ISOM symbols (709/710/711) — the overprint-able annotation ink.
function drawAnnotationInk(
  doc: jsPDF,
  annotations: Annotation[],
  toPage: (pt: MapPoint) => Pos,
  mapScale: number,
  spec: EventSpec,
  /** Native map scale — converts map-anchored mm (crossing elongation) to paper mm. */
  nativeScale: number,
) {
  const elongScale = mapScale > 0 ? nativeScale / mapScale : 1
  for (const ann of annotations) {
    if (ann.type === 'forbidden_route') {
      drawForbiddenRoute(doc, ann.points.map(p => toPage(p)), mapScale, spec)
    } else if (ann.type === 'crossing_point' && ann.points[0]) {
      drawCrossingPoint(doc, toPage(ann.points[0]), ann.rotation ?? 0, ann.elongation ?? 0, mapScale, spec, elongScale)
    } else if (ann.type === 'out_of_bounds') {
      drawOutOfBoundsArea(doc, ann.points.map(p => toPage(p)), mapScale, spec, ann.boundaryMarking ?? 'none')
    } else if (ann.type === 'oob_boundary') {
      drawOobBoundary(doc, ann.points.map(p => toPage(p)), mapScale, spec)
    }
  }
}

// North arrows — excluded from overprint (multiply would erase their white "N").
function drawNorthArrows(
  doc: jsPDF,
  annotations: Annotation[],
  toPage: (pt: MapPoint) => Pos,
  mapScale: number,
  spec: EventSpec,
) {
  for (const ann of annotations) {
    if (ann.type === 'north_arrow' && ann.points[0]) {
      drawNorthArrow(doc, toPage(ann.points[0]), ann.rotation ?? 0, ann.scale ?? 1, mapScale, spec, ann.color ?? '#38bdf8', ann.textColor ?? '#ffffff')
    }
  }
}

// Crossfade the course/annotation ink between a solid knockout pass and a
// multiply (overprint) pass against the rasterised map, mirroring the screen.
// t=0 → solid, t=1 → full overprint. GState is reset to opaque/Normal after.
function overprintPass(doc: jsPDF, overprint: number, drawInk: () => void) {
  const t = Math.max(0, Math.min(1, overprint))
  if (t < 1) {
    doc.setGState(doc.GState({ opacity: 1 - t, blendMode: 'Normal' }))
    drawInk()
  }
  if (t > 0) {
    doc.setGState(doc.GState({ opacity: t, blendMode: 'Multiply' }))
    drawInk()
  }
  doc.setGState(doc.GState({ opacity: 1, blendMode: 'Normal' }))
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
  const scaleDen = printScale
  const lay = scaleBarLayoutMm(sb, scaleDen)
  const { segMm, barH, textH, pad, strokeW, tickH, boxW, boxH } = lay
  const segRealM = sb.fixedCmSegments ? scaleDen / 100 : sb.segmentLengthM

  const origin = toPage(sb.position)

  // Background
  if (sb.bgAlpha > 0) {
    doc.setFillColor(255, 255, 255)
    doc.setGState(doc.GState({ opacity: sb.bgAlpha }))
    doc.roundedRect(origin.x, origin.y, boxW, boxH, 0.5, 0.5, 'F')
    doc.setGState(doc.GState({ opacity: 1 }))
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

  for (let i = 0; i <= sb.segments; i++) {
    const tx = barX + i * segMm
    doc.setLineWidth(strokeW)
    doc.setDrawColor(0, 0, 0)
    doc.line(tx, barY - tickH, tx, barY)

    if (i === 0 || i === 1 || i === sb.segments) {
      const label = formatScaleBarDistance(i * segRealM)
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
  const fontSize = tl.fontSizeMm
  const lines = tl.text.split('\n')
  const lineHeight = fontSize * 1.25

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize * MM_TO_PT)

  if (tl.bgAlpha > 0) {
    const pad = 0.15 * fontSize
    const maxLineW = Math.max(...lines.map(l => doc.getStringUnitWidth(l) * fontSize))
    const blockH = lineHeight * lines.length
    doc.setFillColor(255, 255, 255)
    doc.setGState(doc.GState({ opacity: tl.bgAlpha }))
    doc.roundedRect(pos.x - pad, pos.y - fontSize - pad, maxLineW + pad * 2, blockH + pad * 2, 0.15 * fontSize, 0.15 * fontSize, 'F')
    doc.setGState(doc.GState({ opacity: 1 }))
  }

  const [r, g, b] = hexToRgb(tl.color)
  doc.setTextColor(r, g, b)
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], pos.x, pos.y + i * lineHeight)
  }
}

async function ensureJpegOrPng(dataUrl: string): Promise<{ url: string; format: 'PNG' | 'JPEG' }> {
  if (dataUrl.startsWith('data:image/png')) return { url: dataUrl, format: 'PNG' }
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg'))
    return { url: dataUrl, format: 'JPEG' }
  // Only inline image payloads may reach img.src — a remote URL here would fire
  // an outbound request during export (validateProject filters these on load;
  // this guards overlays created before that check existed).
  if (!/^data:image\//i.test(dataUrl)) throw new Error('Image overlay is not an inline data:image URL')
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  return { url: canvas.toDataURL('image/png'), format: 'PNG' }
}

async function drawImageOverlay(
  doc: jsPDF,
  img: ImageOverlay,
  toPage: (pt: MapPoint) => Pos,
) {
  const pos = toPage(img.position)
  // widthMm/heightMm are true paper mm (like scale bars and text labels) — do
  // NOT convert through map units or the image rescales with the print scale.
  const w = img.widthMm
  const h = img.heightMm

  if (w <= 0 || h <= 0) return

  try {
    const { url, format } = await ensureJpegOrPng(img.dataUrl)
    doc.addImage(url, format, pos.x, pos.y, w, h)
  } catch { /* skip image if it can't be converted */ }
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

  const useRaster = options.mapRendering === 'raster'
  const [{ jsPDF: JsPdf }] = await Promise.all([
    import('jspdf'),
    loadedMap?.type === 'svg' && !useRaster ? import('svg2pdf.js') : Promise.resolve(),
  ])
  const doc = new JsPdf({ orientation: orient, unit: 'mm', format: [pw, ph], compress: true })
  const controlMap = controlsById(project.controls)
  const courses = expandVariations(project.courses.filter(c => options.courseIds.includes(c.id)))
  const app = options.appearance ?? DEFAULT_APPEARANCE

  // Controls used as exchanges in any course — the all-controls canvas view
  // marks these with the inner triangle, so the all-controls page does too.
  const exchangeControlIds = new Set<string>()
  for (const c of project.courses) {
    for (const cc of c.controls) if (cc.exchangeMode) exchangeControlIds.add(cc.controlId)
  }

  /** After svg2pdf fails once, use raster fallback for remaining pages. */
  let svgEmbedDisabled = useRaster
  let bitmapDataUrl: string | null = null

  // For bitmap (non-SVG) maps, pre-rasterize once — the source pixels are fixed.
  if (loadedMap && loadedMap.type !== 'svg') {
    try { bitmapDataUrl = await rasterizeBitmap(loadedMap, options.mapOpacity ?? 1) } catch { /* fall back to no map */ }
  }

  const rasterDpi = options.rasterDpi ?? 300
  const mapOpacity = options.mapOpacity ?? 1
  const mapOverprint = !!options.mapOverprint
  // 'below' overprint: purple ink sits beneath the black/brown/blue map colours.
  // Needs the vector map's colour separations, so it only applies to svg maps
  // with identifiable top colours; otherwise the export falls back to the
  // multiply intensity in options.overprint (the 'simulated' behaviour).
  const belowColors = loadedMap?.type === 'svg' ? (loadedMap.topOverprintColors ?? []) : []
  const belowActive = options.overprintMode === 'below' && belowColors.length > 0
  const courseOverprint = belowActive ? 0 : (options.overprint ?? 1)

  let svgBaseCache: SvgRasterCache | null = null
  let svgTopCache: SvgRasterCache | null = null

  async function ensureSvgRasterCache() {
    if (svgBaseCache || loadedMap?.type !== 'svg') return
    const svgEl = loadedMap.content as SVGElement
    const b = loadedMap.bounds
    try {
      svgBaseCache = await prepareSvgRasterCache(svgEl, b, mapOpacity, mapOverprint)
    } catch { /* raster fallback not critical */ }
    if (belowActive) {
      try {
        svgTopCache = await prepareSvgRasterCache(svgEl, b, mapOpacity, false, { keepColors: belowColors, transparent: true })
      } catch { /* raster fallback not critical */ }
    }
  }

  if (loadedMap?.type === 'svg' && svgEmbedDisabled) {
    await ensureSvgRasterCache()
  }

  // ponytail: serialize the SVG once, reparse per page (reparse is ~10× cheaper)
  let cachedSvgXml: string | null = null
  function prepareSvgForPdfEmbed(): SVGElement {
    if (!cachedSvgXml) {
      const svgEl = loadedMap!.content as SVGElement
      let xml = new XMLSerializer().serializeToString(svgEl)
      if (!/^<svg[^>]*\sxmlns=/.test(xml)) {
        xml = xml.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"')
      }
      if (mapOpacity < 1) {
        // Inject opacity wrapper into the cached XML so we don't DOM-walk per page
        xml = xml.replace(/(<svg[^>]*>)/, `$1<g opacity="${mapOpacity}">`)
        xml = xml.replace(/<\/svg>\s*$/, '</g></svg>')
      }
      cachedSvgXml = xml.replace(/\sfill="transparent"/g, ' fill="none"')
    }
    const parsed = new DOMParser().parseFromString(cachedSvgXml, 'image/svg+xml')
    const parseErr = parsed.querySelector('parsererror')
    const docEl = parsed.documentElement
    return !parseErr && docEl && docEl.namespaceURI === 'http://www.w3.org/2000/svg'
      ? (docEl as unknown as SVGElement)
      : (loadedMap!.content as SVGElement).cloneNode(true) as SVGElement
  }

  // Crop + capped pixel size for rasterising the visible page region of an SVG
  // map at the target DPI (so a zoomed-in page gets a fresh high-res render
  // instead of stretching one pre-rasterised image of the whole map).
  function svgPageRegion(toPage: (pt: MapPoint) => Pos, pageMmW: number, pageMmH: number) {
    const tl = toPage({ x: loadedMap!.bounds.minX, y: loadedMap!.bounds.minY })
    const br = toPage({ x: loadedMap!.bounds.maxX, y: loadedMap!.bounds.maxY })
    const w = br.x - tl.x
    const h = br.y - tl.y
    const mapBounds = loadedMap!.bounds
    const scaleX = mapBounds.width / w
    const scaleY = mapBounds.height / h
    const crop: RasterCrop = {
      minX: mapBounds.minX + (-tl.x) * scaleX,
      minY: mapBounds.minY + (-tl.y) * scaleY,
      width: pageMmW * scaleX,
      height: pageMmH * scaleY,
    }
    let capW = Math.ceil(pageMmW / 25.4 * rasterDpi)
    let capH = Math.ceil(pageMmH / 25.4 * rasterDpi)
    const longest = Math.max(capW, capH)
    if (longest > MAX_RASTER_PX) {
      const k = MAX_RASTER_PX / longest
      capW = Math.max(1, Math.round(capW * k))
      capH = Math.max(1, Math.round(capH * k))
    }
    return { crop, capW, capH, tl, w, h }
  }

  async function embedMap(toPage: (pt: MapPoint) => Pos, pageMmW: number, pageMmH: number) {
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
        await ensureSvgRasterCache()
      }
    }
    if (loadedMap.type === 'svg') {
      const { crop, capW, capH } = svgPageRegion(toPage, pageMmW, pageMmH)
      if (svgBaseCache) {
        try {
          const bytes = await cropFromSvgCache(svgBaseCache, crop, capW, capH, false)
          doc.addImage(bytes, 'JPEG', 0, 0, pageMmW, pageMmH)
          return
        } catch { /* fall through to per-page */ }
      }
      try {
        const svgEl = loadedMap.content as SVGElement
        const dataUrl = await rasterizeSvgRegion(svgEl, crop, capW, capH, mapOpacity, mapOverprint)
        doc.addImage(dataUrl, 'JPEG', 0, 0, pageMmW, pageMmH)
        return
      } catch { /* fall through */ }
    }
    if (bitmapDataUrl) {
      doc.addImage(bitmapDataUrl, 'JPEG', tl.x, tl.y, w, h)
    }
  }

  // 'Below' overprint: after the course ink is drawn, redraw only the
  // black/brown/blue map layers on top so the purple sits beneath them.
  async function embedTopColors(toPage: (pt: MapPoint) => Pos, pageMmW: number, pageMmH: number) {
    if (!belowActive || loadedMap?.type !== 'svg') return
    if (!svgTopCache) {
      try {
        const svgEl = loadedMap.content as SVGElement
        const b = loadedMap.bounds
        svgTopCache = await prepareSvgRasterCache(svgEl, b, mapOpacity, false, { keepColors: belowColors, transparent: true })
      } catch { /* fall through */ }
    }
    const { crop, capW, capH } = svgPageRegion(toPage, pageMmW, pageMmH)
    if (svgTopCache) {
      try {
        const bytes = await cropFromSvgCache(svgTopCache, crop, capW, capH, false)
        doc.setGState(doc.GState({ blendMode: 'Multiply' }))
        doc.addImage(bytes, 'JPEG', 0, 0, pageMmW, pageMmH)
        doc.setGState(doc.GState({ blendMode: 'Normal' }))
        return
      } catch { /* fall through to per-page */ }
    }
    try {
      const svgEl = loadedMap.content as SVGElement
      const dataUrl = await rasterizeSvgRegion(svgEl, crop, capW, capH, mapOpacity, false, {
        keepColors: belowColors,
        transparent: false,
      })
      doc.setGState(doc.GState({ blendMode: 'Multiply' }))
      doc.addImage(dataUrl, 'JPEG', 0, 0, pageMmW, pageMmH)
      doc.setGState(doc.GState({ blendMode: 'Normal' }))
    } catch { /* overlay is best-effort */ }
  }

  let pageIndex = 0

  // All controls page (no legs, just control symbols with codes)
  if (options.allControls && project.controls.length > 0) {
    const acScale = options.scaleOverrides?.[ALL_CONTROLS_ID] ?? options.printScale
    const bounds = allControlsBoundsMm(project.controls, project.map, acScale, project.spec)
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

          await embedMap(toPage, pw, ph)

          const mapScale = acScale
          const ctrlColor = IOF_PURPLE
          const annColor = IOF_PURPLE
          const allCtrlSpec = resolveSpec(project.spec)

          const colorMap = options.allControlsMulticolor ? assignControlColors(project.controls) : null

          overprintPass(doc, courseOverprint, () => {
            setColor(doc, annColor)
            drawAnnotationInk(doc, project.annotations, toPage, mapScale, allCtrlSpec, project.map.scale)

            const acDims = dimsFor(allCtrlSpec, app)
            const acSf = specScaleFactor(allCtrlSpec, acScale)

            for (const ctrl of project.controls) {
              const cc = colorMap ? MULTICOLOR_PALETTE[colorMap.get(ctrl.id) ?? 0] : ctrlColor
              const pos = toPage(ctrl.position)
              // Controls used as exchanges anywhere show their inner triangle,
              // matching the all-controls canvas view.
              drawControlSymbol(doc, ctrl.type, pos, acScale, allCtrlSpec, app, cc, exchangeControlIds.has(ctrl.id), ctrl.gaps)
              const loMm = ctrl.labelOffset ? mapToMm(ctrl.labelOffset, project.map, acScale) : undefined
              drawLabel(doc, defaultControlLabel(ctrl), pos, ctrl.type, acScale, allCtrlSpec, app, cc, loMm)

              if (options.allControlsLinkId) {
                const off = loMm ?? symbolLabelOffset(ctrl.type, acDims, acSf)
                doc.setLineWidth(getSymbolDims(allCtrlSpec).strokeW * acSf * 0.4)
                doc.line(pos.x, pos.y, pos.x + off.x, pos.y + off.y)
              }
            }
          })
          await embedTopColors(toPage, pw, ph)
          drawNorthArrows(doc, project.annotations, toPage, mapScale, allCtrlSpec)
          for (const sb of project.scaleBars) drawScaleBar(doc, sb, toPage, acScale)
          for (const tl of project.textLabels) drawTextLabel(doc, tl, toPage)
          for (const img of project.imageOverlays) await drawImageOverlay(doc, img, toPage)

        }
      }
    }
  }

  const pendingSheets: Array<{
    course: Course
    distance: number
    textDescriptions?: boolean
    legDistances?: number[]
    trailingFlip: boolean
    trailingExchange: boolean
    eventName: string
    seqOffset: number
    restartControlId?: string
    cellSize?: number
    inkColor?: string
    inlineExchanges?: Map<string, 'exchange' | 'flip'>
  }> = []

  for (const course of courses) {
    const oKey = optionKey(course)
    const origCourse = project.courses.find(c => c.id === (course._parentId ?? course.id))
    const layout = origCourse?.layout

    const descMode: DescMode = layout?.descMode ?? (layout?.clueSheet.visible ? 'on-map' : options.descModes?.[oKey] ?? 'none')

    const submaps = computeSubmaps(course)
    const hasSubmaps = submaps.length > 1
    const submapSlices = hasSubmaps ? submaps : [{ index: 0, controls: course.controls, label: '' }]
    const fullCourseDistance = hasSubmaps ? resolveCourseLength(course, computeCourseDistances(course, project.controls, project.map, project.measuredLegs)) : 0

    for (const submap of submapSlices) {
      const smKey = hasSubmaps ? submapPreviewId(oKey, submap.index) : oKey
      // Per-submap layout: each submap of an exchange/flip course is placed independently.
      const sLayout = layout ? (submapLayoutView(layout, submap.index) ?? layout) : undefined
      const courseScale = sLayout?.printScale ?? options.scaleOverrides?.[smKey] ?? options.scaleOverrides?.[oKey] ?? options.printScale
      let seqOffset = 0
      let restartControlId: string | undefined
      let clueSheetControls = submap.controls
      // Break indices are stored against the full submap control list; when the
      // restart row is hidden they must shift with the sliced list.
      let sheetBreaks = sLayout?.clueSheetBreaks
      if (hasSubmaps && submap.index > 0) {
        const cMap = controlsById(project.controls)
        for (const cc of course.controls) {
          const c = cMap.get(cc.controlId)
          if (c?.type === 'control') seqOffset++
          if (cc.id === submap.controls[0].id) break
        }
        if (project.clueSheetHideSubmapRestart) {
          ;({ controls: clueSheetControls, breaks: sheetBreaks } =
            clueSheetHiddenRestartView(submap.controls, sheetBreaks))
        }
        const firstCtrl = cMap.get(submap.controls[0].controlId)
        if (firstCtrl) restartControlId = firstCtrl.id
      }

      const pageCourse = hasSubmaps
        ? { ...course, controls: submap.controls, name: `${course.name} - ${submap.index + 1}` }
        : course
      const clueSheetCourse = clueSheetControls !== submap.controls
        ? { ...pageCourse, controls: clueSheetControls }
        : pageCourse

      const sPageBase = sLayout ? (PAGE_SIZES[sLayout.pageSize] ?? PAGE_SIZES.a4) : (PAGE_SIZES[options.pageSize] ?? PAGE_SIZES.a4)
      const sOrient = sLayout?.orientation ?? options.orientation
      const cpw = sOrient === 'landscape' ? sPageBase.h : sPageBase.w
      const cph = sOrient === 'landscape' ? sPageBase.w : sPageBase.h
      const cOrientFlag = sOrient === 'landscape' ? 'l' : 'p'
      // Border-clamped so the tile grid matches checkTilingForCourseObj's page
      // count. ponytail: tiles still center on the page, an off-center border
      // shifts the crop slightly — center tiles inside the border if it matters.
      const { w: cPrintableW, h: cPrintableH } = printableSize(cpw, cph, sLayout?.mapBorder)

      let trailingFlip = false
      let trailingExchange = false
      if (hasSubmaps && submap.index < submaps.length - 1) {
        const lastCc = submap.controls[submap.controls.length - 1]
        if (lastCc?.exchangeMode === 'flip') {
          trailingFlip = true
        } else if (lastCc?.exchangeMode === 'exchange') {
          trailingExchange = true
        }
      }

      // Each submap centers on its own controls (or its stored mapCenter).
      const bounds = courseBoundsMm(pageCourse, project.controls, project.map, courseScale, project.spec)
      if (!bounds && !sLayout) continue

      const useTiling = (sLayout?.tiling || (options.tiling && !layout)) && bounds && (bounds.width > cPrintableW || bounds.height > cPrintableH)
      const cols = useTiling ? tileCount(bounds!.width, cPrintableW) : 1
      const rows = useTiling ? tileCount(bounds!.height, cPrintableH) : 1

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (pageIndex > 0) doc.addPage([cpw, cph], cOrientFlag)
          pageIndex++

          const { x: ox, y: oy } = options.offsets?.[smKey] ?? options.offsets?.[oKey] ?? { x: 0, y: 0 }
          let viewCenterX: number, viewCenterY: number
          if (sLayout && !useTiling) {
            const mc = mapToMm(sLayout.mapCenter, project.map, courseScale)
            viewCenterX = mc.x + ox
            viewCenterY = mc.y + oy
          } else {
            if (useTiling && bounds) {
              viewCenterX = bounds.minX + ox + col * (cPrintableW - TILE_OVERLAP) + cPrintableW / 2
              viewCenterY = bounds.minY + oy + row * (cPrintableH - TILE_OVERLAP) + cPrintableH / 2
            } else if (bounds) {
              viewCenterX = bounds.centerX + ox
              viewCenterY = bounds.centerY + oy
            } else {
              viewCenterX = 0; viewCenterY = 0
            }
          }

          const cx = cpw / 2
          const cy = cph / 2

          function toPage(pt: MapPoint): Pos {
            const mm = mapToMm(pt, project.map, courseScale)
            return { x: cx + (mm.x - viewCenterX), y: cy + (mm.y - viewCenterY) }
          }

          await embedMap(toPage, cpw, cph)

          const mapScale = courseScale
          const annColor = IOF_PURPLE
          const courseSpec = resolveSpec(project.spec, course.spec)
          const courseInk = app.color || course.color
          overprintPass(doc, courseOverprint, () => {
          setColor(doc, annColor)
          drawAnnotationInk(doc, project.annotations, toPage, mapScale, courseSpec, project.map.scale)

          if (pageCourse.type === 'linear' && pageCourse.controls.length >= 2) {
            // Pre-start taped route
            const firstCc = pageCourse.controls[0]
            if (firstCc.markedRoute && firstCc.legBendPoints?.length) {
              const startCtrl = controlMap.get(firstCc.controlId)
              if (startCtrl) {
                const bends = firstCc.legBendPoints.map(p => toPage(p))
                const startPos = toPage(startCtrl.position)
                drawLeg(doc, bends[0], startPos, 'control', startCtrl.type, courseScale, courseSpec, app, courseInk,
                  bends.length > 1 ? bends.slice(1) : undefined, undefined, 'full')
                // Map issue point
                if (firstCc.mapIssueT != null) {
                  const pts = flattenSmooth([...bends, startPos])
                  const pos = interpolatePolyline(pts, firstCc.mapIssueT)
                  const sf = specScaleFactor(courseSpec, courseScale)
                  const barHalf = 1.25 * sf
                  const barSw = 0.6 * sf * app.lineWidth
                  const perpX = -Math.sin(pos.angle), perpY = Math.cos(pos.angle)
                  doc.setLineCap(0)
                  doc.setLineDashPattern([], 0)
                  const strokeBar = () => {
                    doc.moveTo(pos.x + perpX * barHalf, pos.y + perpY * barHalf)
                    doc.lineTo(pos.x - perpX * barHalf, pos.y - perpY * barHalf)
                    doc.stroke()
                  }
                  if (app.outlineEnabled) {
                    setColor(doc, app.outlineColor)
                    doc.setLineWidth(barSw + app.outlineWidth * 2)
                    strokeBar()
                  }
                  setColor(doc, courseInk)
                  doc.setLineWidth(barSw)
                  strokeBar()
                }
              }
            }
            for (let i = 0; i < pageCourse.controls.length - 1; i++) {
              const from = controlMap.get(pageCourse.controls[i].controlId)
              const to = controlMap.get(pageCourse.controls[i + 1].controlId)
              if (!from || !to) continue
              const cc = pageCourse.controls[i + 1]
              const isLastLeg = i === pageCourse.controls.length - 2
              const effectiveMarkedRoute = cc.markedRoute
                || (isLastLeg && course.finishType === 'taped' ? 'full'
                  : isLastLeg && course.finishType === 'funnel' ? 'partial'
                  : undefined)
              if (effectiveMarkedRoute === 'partial' && cc.markedRouteEnd) {
                const dims = dimsFor(courseSpec, app)
                const sf = specScaleFactor(courseSpec, courseScale)
                const divider = toPage(cc.markedRouteEnd)
                const fromPos = toPage(from.position)
                const toPos = toPage(to.position)
                const fromR = clipR(from.type, courseScale, courseSpec, app, false)
                const toR = clipR(to.type, courseScale, courseSpec, app, false)
                const bends = cc.legBendPoints?.map(p => toPage(p))
                const navBends = cc.legNavBendPoints?.map(p => toPage(p))
                const strokeSeg = (pts: Pos[], smooth: boolean) => {
                  doc.moveTo(pts[0].x, pts[0].y)
                  if (smooth && pts.length >= 3) {
                    const segs = catmullRomToCubics(pts)
                    for (const s of segs) doc.curveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.end.x, s.end.y)
                  } else {
                    for (let k = 1; k < pts.length; k++) doc.lineTo(pts[k].x, pts[k].y)
                  }
                  doc.stroke()
                }
                const segWithOutline = (pts: Pos[], smooth: boolean) => {
                  if (app.outlineEnabled) {
                    setColor(doc, app.outlineColor)
                    doc.setLineJoin(1)
                    doc.setLineWidth(dims.legW * sf + app.outlineWidth * 2)
                    strokeSeg(pts, smooth)
                  }
                  setColor(doc, courseInk)
                  doc.setLineWidth(dims.legW * sf)
                  strokeSeg(pts, smooth)
                }
                // Taped segment: from → bends → divider (dashed, clip start only)
                const tapedPts: Pos[] = bends?.length ? [fromPos, ...bends, divider] : [fromPos, divider]
                const tapedClipped = clipPolyline(tapedPts, fromR, 0)
                if (tapedClipped.length >= 2) {
                  doc.setLineDashPattern([2 * sf, 0.5 * sf], 0)
                  doc.setLineCap(0)
                  segWithOutline(tapedClipped, true)
                  doc.setLineDashPattern([], 0)
                  doc.setLineCap(1)
                }
                // Navigation segment: divider → nav bends → to (solid, clip end only)
                const navPts: Pos[] = navBends?.length ? [divider, ...navBends, toPos] : [divider, toPos]
                const navClipped = clipPolyline(navPts, 0, toR)
                if (navClipped.length >= 2) {
                  segWithOutline(navClipped, false)
                }
              } else {
                const bends = cc.legBendPoints?.map(p => toPage(p))
                drawLeg(doc, toPage(from.position), toPage(to.position), from.type, to.type, courseScale, courseSpec, app, courseInk, bends, cc.legGaps, effectiveMarkedRoute)
              }
            }
          }

          const seqMap = course.type === 'linear' ? buildSequenceMap(course, project.controls) : null
          const drawn = new Set<string>()
          const lastCcId = pageCourse.controls[pageCourse.controls.length - 1]?.controlId
          const firstCcId = hasSubmaps && submap.index > 0 ? pageCourse.controls[0]?.controlId : null

          for (const cc of pageCourse.controls) {
            if (drawn.has(cc.controlId)) continue
            drawn.add(cc.controlId)

            const ctrl = controlMap.get(cc.controlId)
            if (!ctrl) continue

            const pos = toPage(ctrl.position)
            const isExchange = !!cc.exchangeMode && !(hasSubmaps && cc.controlId === lastCcId)
            let sAngle = 0
            if (ctrl.type === 'start' || isExchange) {
              const ccIdx = pageCourse.controls.findIndex(c => c.controlId === cc.controlId)
              const nextCtrl = ccIdx >= 0 ? controlMap.get(pageCourse.controls[ccIdx + 1]?.controlId) : undefined
              if (nextCtrl) {
                sAngle = ctrl.type === 'start'
                  ? startTriangleAngle(toPage(ctrl.position), toPage(nextCtrl.position))
                  : exchangeTriangleAngle(toPage(ctrl.position), toPage(nextCtrl.position))
              }
            }
            drawControlSymbol(doc, ctrl.type, pos, courseScale, courseSpec, app, courseInk, isExchange, ctrl.gaps, sAngle)
            const isSubmapStart = firstCcId != null && cc.controlId === firstCcId && !!cc.exchangeMode
            if (ctrl.type === 'control' && (!isSubmapStart || project.labelSubmapStart)) {
              const lo = cc.labelOffset ?? ctrl.labelOffset
              const loMm = lo ? mapToMm(lo, project.map, courseScale) : undefined
              let label = getLabel(ctrl, seqMap)
              if (course.showPoints && ctrl.points != null) label += ` [${ctrl.points}]`
              drawLabel(doc, label, pos, ctrl.type, courseScale, courseSpec, app, courseInk, loMm)
            }
          }
          })
          await embedTopColors(toPage, cpw, cph)
          drawNorthArrows(doc, project.annotations, toPage, mapScale, courseSpec)

          const mb = sLayout?.mapBorder
          if (mb) {
            const bx = mb.x
            const by = mb.y
            const bw = mb.width
            const bh = mb.height
            doc.setFillColor(255, 255, 255)
            doc.rect(0, 0, cpw, by, 'F')               // top
            doc.rect(0, by + bh, cpw, cph - by - bh, 'F') // bottom
            doc.rect(0, by, bx, bh, 'F')                // left
            doc.rect(bx + bw, by, cpw - bx - bw, bh, 'F') // right
            const [r, g, b] = hexToRgb(mb.color)
            const sw = mb.strokeWidth
            doc.setDrawColor(r, g, b)
            doc.setLineWidth(sw)
            doc.rect(bx, by, bw, bh, 'S')
          }

          for (const sb of project.scaleBars) {
            const overridePos = sLayout?.overlayPositions?.[sb.id]
            const effectiveSb = overridePos ? { ...sb, position: overridePos } : sb
            drawScaleBar(doc, effectiveSb, toPage, courseScale)
          }
          for (const tl of project.textLabels) {
            const overridePos = sLayout?.overlayPositions?.[tl.id]
            const effectiveTl = overridePos ? { ...tl, position: overridePos } : tl
            drawTextLabel(doc, effectiveTl, toPage)
          }
          for (const img of project.imageOverlays) {
            const overridePos = sLayout?.overlayPositions?.[img.id]
            const effectiveImg = overridePos ? { ...img, position: overridePos } : img
            await drawImageOverlay(doc, effectiveImg, toPage)
          }
          if ((descMode === 'on-map' || descMode === 'both') && pageCourse.controls.length > 0) {
            const dist = computeCourseDistances(pageCourse, project.controls, project.map, project.measuredLegs)
            const sheetTotal = hasSubmaps ? fullCourseDistance : resolveCourseLength(course, dist)
            const breaks = sheetBreaks
            if (breaks && breaks.length > 0) {
              const partPositions = [sLayout!.clueSheet, ...(sLayout!.clueSheetParts ?? [])]
              for (let pi = 0; pi < breaks.length + 1; pi++) {
                const partKey = pi === 0 ? '' : `:part${pi}`
              const partPos = options.sheetPositions?.[`${smKey}${partKey}`]
                  ?? options.sheetPositions?.[`${oKey}${partKey}`]
                  ?? partPositions[pi]
                  ?? { x: MARGIN, y: MARGIN }
                if (partPos.x < 0 || partPos.x > cpw || partPos.y < 0 || partPos.y > cph) continue
                drawDescriptionSheetOverlayPart(doc, clueSheetCourse, project.controls, partPos.x, partPos.y, pi, breaks, sheetTotal, course.textDescriptions, dist.legs, trailingFlip, project.meta.name, seqOffset, restartControlId, project.clueSheetFontSize, project.clueSheetOverlayColor, trailingExchange)
              }
            } else {
              const sheetPos = options.sheetPositions?.[smKey] ?? options.sheetPositions?.[oKey] ?? sLayout?.clueSheet ?? { x: MARGIN, y: MARGIN }
              if (sheetPos.x >= 0 && sheetPos.x <= cpw && sheetPos.y >= 0 && sheetPos.y <= cph) {
                drawDescriptionSheetOverlay(doc, clueSheetCourse, project.controls, sheetPos.x, sheetPos.y, sheetTotal, course.textDescriptions, dist.legs, trailingFlip, project.meta.name, seqOffset, restartControlId, project.clueSheetFontSize, project.clueSheetOverlayColor, trailingExchange)
              }
            }
          }

        }
      }

      if ((descMode === 'separate' || descMode === 'both') && clueSheetCourse.controls.length > 0 && (!hasSubmaps || project.clueSheetSplitSubmaps)) {
        const dist = computeCourseDistances(pageCourse, project.controls, project.map, project.measuredLegs)
        const sheetTotal = hasSubmaps ? fullCourseDistance : resolveCourseLength(course, dist)
        pendingSheets.push({ course: clueSheetCourse, distance: sheetTotal, textDescriptions: course.textDescriptions, legDistances: dist.legs, trailingFlip, trailingExchange, eventName: project.meta.name, seqOffset, restartControlId, cellSize: project.clueSheetFontSize, inkColor: project.clueSheetSeparateColor })
      }
    }

    if (hasSubmaps && !project.clueSheetSplitSubmaps && (descMode === 'separate' || descMode === 'both') && course.controls.length > 0) {
      const inlineExchanges = new Map<string, 'exchange' | 'flip'>()
      for (const cc of course.controls) {
        if (cc.exchangeMode) {
          const ctrl = controlsById(project.controls).get(cc.controlId)
          if (ctrl) inlineExchanges.set(ctrl.id, cc.exchangeMode)
        }
      }
      const dist = computeCourseDistances(course, project.controls, project.map, project.measuredLegs)
      const sheetTotal = resolveCourseLength(course, dist)
      pendingSheets.push({ course, distance: sheetTotal, textDescriptions: course.textDescriptions, legDistances: dist.legs, trailingFlip: false, trailingExchange: false, eventName: project.meta.name, seqOffset: 0, restartControlId: undefined, cellSize: project.clueSheetFontSize, inkColor: project.clueSheetSeparateColor, inlineExchanges })
    }
  }

  // Tile clue sheets at the end — fill each page with as many copies as fit
  const TILE_GAP = 3
  for (const s of pendingSheets) {
    const tilePageBase = PAGE_SIZES[options.pageSize] ?? PAGE_SIZES.a4
    const tpw = options.orientation === 'landscape' ? tilePageBase.h : tilePageBase.w
    const tph = options.orientation === 'landscape' ? tilePageBase.w : tilePageBase.h
    const tOrient = options.orientation === 'landscape' ? 'l' : 'p'

    const extraRows = s.inlineExchanges?.size ?? 0
    const size = descriptionSheetSize(s.course, project.controls, s.trailingFlip || s.trailingExchange, s.cellSize, extraRows)

    let pw = tpw, ph = tph, po: 'l' | 'p' = tOrient
    if (size.height > ph - 2 * TILE_GAP && size.height <= pw - 2 * TILE_GAP) {
      pw = tph; ph = tpw; po = tOrient === 'l' ? 'p' : 'l'
    }

    if (size.height > ph - 2 * TILE_GAP) {
      doc.addPage([pw, ph], po)
      pageIndex++
      drawDescriptionSheet(doc, s.course, project.controls, pw, ph, s.distance, s.textDescriptions, s.legDistances, s.trailingFlip, s.eventName, s.seqOffset, s.restartControlId, s.cellSize, s.inkColor, s.trailingExchange, s.inlineExchanges)
      continue
    }

    const cols = Math.max(1, Math.floor((pw - TILE_GAP) / (size.width + TILE_GAP)))
    const rows = Math.max(1, Math.floor((ph - TILE_GAP) / (size.height + TILE_GAP)))
    const startX = (pw - cols * size.width - (cols - 1) * TILE_GAP) / 2
    const startY = (ph - rows * size.height - (rows - 1) * TILE_GAP) / 2

    doc.addPage([pw, ph], po)
    pageIndex++

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * (size.width + TILE_GAP)
        const y = startY + r * (size.height + TILE_GAP)
        drawDescriptionSheetOverlay(doc, s.course, project.controls, x, y, s.distance, s.textDescriptions, s.legDistances, s.trailingFlip, s.eventName, s.seqOffset, s.restartControlId, s.cellSize, s.inkColor, s.trailingExchange, s.inlineExchanges)
      }
    }
  }

  cleanupSvgIframe()
  const blob = doc.output('blob')
  return blob
}
