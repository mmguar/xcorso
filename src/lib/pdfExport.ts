// Type-only: jspdf (~350 KB) must not land in the startup chunk. Components and
// the store statically import page-geometry helpers from this module, so the
// runtime library is loaded on demand in exportCoursePdf instead.
import type { jsPDF } from 'jspdf'
import type { Project, Course, Control, MapPoint, MapConfig, EventSpec, MapBorder, OverprintMode, AppearanceSettings } from '../types'
import type { LoadedMap } from './mapLoader'
import { applyMapOverprint, pruneSvgToColors } from './overprint'
import { descriptionSheetSize, drawDescriptionSheet, drawDescriptionSheetOverlay, drawDescriptionSheetOverlayPart } from './pdfDescriptionSheet'
import type { DescSheetOpts } from './pdfDescriptionSheet'
import { defaultControlLabel, resolveVariation, computeSubmaps, submapLayoutView, controlsById, buildAllControlsCourse, IOF_PURPLE, buildPagePlan } from './courseUtils'
import { computeCourseDistances, resolveCourseLength } from './distance'
import { resolveSpec, getSymbolDims, dimsFor, symbolScaleFactor as specScaleFactor, controlSymbolRadiusMm, symbolLabelOffset } from './symbolSpec'
import { distance } from './geometry'
import { hexToRgb } from './color'
import {
  renderControlSymbol,
  renderAnnotationInk, renderNorthArrows,
  renderScaleBar, renderTextLabel,
  buildCourseInkSvg,
} from './courseRenderer'

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

/** Page dimensions in mm for a page size key + orientation (single source of
 * the landscape swap — use this instead of hand-writing the ternary). */
export function pageDimsFor(pageSize: string, orientation: 'portrait' | 'landscape'): { w: number; h: number } {
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
  const fitsAtCenter = mapCenter && bounds
    ? checkFitsAtCenter(bounds, mapCenter, map, printScale, pw, ph, printableW, printableH, border)
    : undefined
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

export function checkFitForAllControls(
  controls: Control[],
  map: MapConfig,
  pageSize: string,
  orientation: 'portrait' | 'landscape',
  printScale: number,
  border?: MapBorder,
  mapCenter?: MapPoint,
  projectSpec?: EventSpec,
): (CourseTileInfo & { fits: boolean; widthMm: number; heightMm: number; fitsAtCenter?: boolean }) | null {
  const { w: pw, h: ph } = pageDimsFor(pageSize, orientation)
  const { w: printableW, h: printableH } = printableSize(pw, ph, border)
  const bounds = allControlsBoundsMm(controls, map, printScale, projectSpec)
  if (!bounds) return null
  const cols = tileCount(bounds.width, printableW)
  const rows = tileCount(bounds.height, printableH)
  const fitsAtCenter = mapCenter && bounds
    ? checkFitsAtCenter(bounds, mapCenter, map, printScale, pw, ph, printableW, printableH, border)
    : undefined
  return {
    courseId: ALL_CONTROLS_ID,
    courseName: '',
    fits: bounds.width <= printableW && bounds.height <= printableH,
    fitsAtCenter,
    widthMm: bounds.width,
    heightMm: bounds.height,
    cols, rows, totalPages: cols * rows,
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

// ── Page rendering helpers ─────────────────────────────────────────────────

function checkFitsAtCenter(
  bounds: Bounds, mapCenter: MapPoint, map: MapConfig, printScale: number,
  pw: number, ph: number, printableW: number, printableH: number, border?: MapBorder,
): boolean {
  const c = mapToMm(mapCenter, map, printScale)
  const winX = c.x - pw / 2 + (border ? border.x : MARGIN)
  const winY = c.y - ph / 2 + (border ? border.y : MARGIN)
  return bounds.minX >= winX && bounds.maxX <= winX + printableW &&
         bounds.minY >= winY && bounds.maxY <= winY + printableH
}

function computeViewCenter(
  layout: { mapCenter: MapPoint } | undefined,
  bounds: Bounds | null,
  map: MapConfig,
  printScale: number,
  offset: Pos,
  tile: { col: number; row: number; printableW: number; printableH: number } | null,
): Pos {
  if (layout && !tile) {
    const mc = mapToMm(layout.mapCenter, map, printScale)
    return { x: mc.x + offset.x, y: mc.y + offset.y }
  }
  if (tile && bounds) {
    return {
      x: bounds.minX + offset.x + tile.col * (tile.printableW - TILE_OVERLAP) + tile.printableW / 2,
      y: bounds.minY + offset.y + tile.row * (tile.printableH - TILE_OVERLAP) + tile.printableH / 2,
    }
  }
  if (bounds) return { x: bounds.centerX + offset.x, y: bounds.centerY + offset.y }
  return { x: 0, y: 0 }
}

function makeToPage(map: MapConfig, printScale: number, viewCenter: Pos, pageCenter: Pos): (pt: MapPoint) => Pos {
  return (pt) => {
    const mm = mapToMm(pt, map, printScale)
    return { x: pageCenter.x + mm.x - viewCenter.x, y: pageCenter.y + mm.y - viewCenter.y }
  }
}

function drawBorderMask(doc: jsPDF, border: MapBorder, pw: number, ph: number) {
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, pw, border.y, 'F')
  doc.rect(0, border.y + border.height, pw, ph - border.y - border.height, 'F')
  doc.rect(0, border.y, border.x, border.height, 'F')
  doc.rect(border.x + border.width, border.y, pw - border.x - border.width, border.height, 'F')
  const [r, g, b] = hexToRgb(border.color)
  doc.setDrawColor(r, g, b)
  doc.setLineWidth(border.strokeWidth)
  doc.rect(border.x, border.y, border.width, border.height, 'S')
}

// ── SVG embedding helpers ──────────────────────────────────────────────────

function parseSvgStr(content: string, w: number, h: number): SVGElement {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${content}</svg>`
  const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml')
  return parsed.documentElement as unknown as SVGElement
}

async function embedSvg(doc: jsPDF, content: string, w: number, h: number) {
  if (!content) return
  const el = parseSvgStr(content, w, h)
  await doc.svg(el, { x: 0, y: 0, width: w, height: h })
}

async function overprintSvg(doc: jsPDF, overprint: number, inkSvg: string, w: number, h: number) {
  if (!inkSvg) return
  const t = Math.max(0, Math.min(1, overprint))
  if (t < 1) {
    doc.setGState(doc.GState({ opacity: 1 - t, blendMode: 'Normal' }))
    await embedSvg(doc, inkSvg, w, h)
  }
  if (t > 0) {
    doc.setGState(doc.GState({ opacity: t, blendMode: 'Multiply' }))
    await embedSvg(doc, inkSvg, w, h)
  }
  doc.setGState(doc.GState({ opacity: 1, blendMode: 'Normal' }))
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

async function drawPageOverlays(
  doc: jsPDF,
  project: Project,
  overlayPositions: Record<string, MapPoint> | undefined,
  toPage: (pt: MapPoint) => Pos,
  printScale: number,
  pw: number, ph: number,
) {
  let overlaySvg = ''
  for (const sb of project.scaleBars) {
    const overridePos = overlayPositions?.[sb.id]
    const effectiveSb = overridePos ? { ...sb, position: overridePos } : sb
    overlaySvg += renderScaleBar({ ...effectiveSb, position: toPage(effectiveSb.position) }, printScale, 1)
  }
  for (const tl of project.textLabels) {
    const overridePos = overlayPositions?.[tl.id]
    const effectiveTl = overridePos ? { ...tl, position: overridePos } : tl
    overlaySvg += renderTextLabel({ ...effectiveTl, position: toPage(effectiveTl.position) }, 1)
  }
  if (overlaySvg) await embedSvg(doc, overlaySvg, pw, ph)
  for (const img of project.imageOverlays) {
    const overridePos = overlayPositions?.[img.id]
    const effectiveImg = overridePos ? { ...img, position: overridePos } : img
    const pos = toPage(effectiveImg.position)
    if (effectiveImg.widthMm > 0 && effectiveImg.heightMm > 0) {
      try {
        const { url, format } = await ensureJpegOrPng(effectiveImg.dataUrl)
        doc.addImage(url, format, pos.x, pos.y, effectiveImg.widthMm, effectiveImg.heightMm)
      } catch { /* skip */ }
    }
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function exportCoursePdf(
  project: Project,
  options: PdfExportOptions,
  loadedMap?: LoadedMap | null,
): Promise<Blob> {
  const { w: pw, h: ph } = pageDims(options)
  const orient = options.orientation === 'landscape' ? 'l' : 'p'

  const useRaster = options.mapRendering === 'raster'
  const [{ jsPDF: JsPdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
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
    const acL = project.allControlsLayout
    const acOrient = acL?.orientation ?? options.orientation
    const { w: acPw, h: acPh } = pageDimsFor(acL?.pageSize ?? options.pageSize, acOrient)
    const acOrientFlag = acOrient === 'landscape' ? 'l' : 'p'
    const acScale = acL?.printScale ?? options.scaleOverrides?.[ALL_CONTROLS_ID] ?? options.printScale
    const { w: acPrintableW, h: acPrintableH } = printableSize(acPw, acPh, acL?.mapBorder)
    const bounds = allControlsBoundsMm(project.controls, project.map, acScale, project.spec)
    if (bounds) {
      const useTiling = options.tiling && (bounds.width > acPrintableW || bounds.height > acPrintableH)
      const cols = useTiling ? tileCount(bounds.width, acPrintableW) : 1
      const rows = useTiling ? tileCount(bounds.height, acPrintableH) : 1

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (pageIndex > 0) doc.addPage([acPw, acPh], acOrientFlag)
          pageIndex++

          const offset = options.offsets?.[ALL_CONTROLS_ID] ?? { x: 0, y: 0 }
          const tile = useTiling ? { col, row, printableW: acPrintableW, printableH: acPrintableH } : null
          const viewCenter = computeViewCenter(acL, bounds, project.map, acScale, offset, tile)
          const toPage = makeToPage(project.map, acScale, viewCenter, { x: acPw / 2, y: acPh / 2 })

          await embedMap(toPage, acPw, acPh)

          const mapScale = acScale
          const ctrlColor = IOF_PURPLE
          const annColor = IOF_PURPLE
          const allCtrlSpec = resolveSpec(project.spec)
          const acDims = dimsFor(allCtrlSpec, app)
          const acSf = specScaleFactor(allCtrlSpec, acScale)
          const elongScale = project.map.scale > 0 ? project.map.scale / acScale : 1

          const colorMap = options.allControlsMulticolor ? assignControlColors(project.controls) : null

          const pageAnns = project.annotations.map(a => ({ ...a, points: a.points.map(p => toPage(p)) }))
          let inkSvg = renderAnnotationInk(pageAnns, mapScale, allCtrlSpec, annColor, 1, 'ac', elongScale)

          for (const ctrl of project.controls) {
            const cc = colorMap ? MULTICOLOR_PALETTE[colorMap.get(ctrl.id) ?? 0] : ctrlColor
            const pos = toPage(ctrl.position)
            const loMm = ctrl.labelOffset ? mapToMm(ctrl.labelOffset, project.map, acScale) : undefined
            inkSvg += renderControlSymbol({
              type: ctrl.type, position: pos, dims: acDims, scale: acSf,
              color: cc, appearance: app, isExchange: exchangeControlIds.has(ctrl.id),
              gaps: ctrl.gaps, label: defaultControlLabel(ctrl), labelOffset: loMm,
            })
            if (options.allControlsLinkId) {
              const off = loMm ?? symbolLabelOffset(ctrl.type, acDims, acSf)
              const sw = getSymbolDims(allCtrlSpec).strokeW * acSf * 0.4
              inkSvg += `<line x1="${pos.x}" y1="${pos.y}" x2="${pos.x + off.x}" y2="${pos.y + off.y}" stroke="${cc}" stroke-width="${sw}"/>`
            }
          }
          await overprintSvg(doc, courseOverprint, inkSvg, acPw, acPh)
          await embedTopColors(toPage, acPw, acPh)

          const northSvg = renderNorthArrows(pageAnns, mapScale, allCtrlSpec, 1)
          if (northSvg) await embedSvg(doc, northSvg, acPw, acPh)

          if (acL?.mapBorder) drawBorderMask(doc, acL.mapBorder, acPw, acPh)
          await drawPageOverlays(doc, project, acL?.overlayPositions, toPage, acScale, acPw, acPh)

          // Clue sheet on all-controls page
          if (acL?.clueSheet.visible && project.controls.length > 0) {
            const acCourse = buildAllControlsCourse(project.controls)
            const acBreaks = acL.clueSheetBreaks
            if (acBreaks && acBreaks.length > 0) {
              const partPositions = [acL.clueSheet, ...(acL.clueSheetParts ?? [])]
              for (let pi = 0; pi < acBreaks.length + 1; pi++) {
                const partPos = partPositions[pi] ?? { x: MARGIN, y: MARGIN }
                if (partPos.x < 0 || partPos.x > acPw || partPos.y < 0 || partPos.y > acPh) continue
                drawDescriptionSheetOverlayPart(doc, acCourse, project.controls, partPos.x, partPos.y, pi, acBreaks, {
                  distanceM: 0, eventName: project.meta.name,
                  cellSize: project.clueSheetFontSize, inkColor: project.clueSheetOverlayColor,
                })
              }
            } else {
              const sheetPos = acL.clueSheet
              if (sheetPos.x >= 0 && sheetPos.x <= acPw && sheetPos.y >= 0 && sheetPos.y <= acPh) {
                drawDescriptionSheetOverlay(doc, acCourse, project.controls, sheetPos.x, sheetPos.y, {
                  distanceM: 0, eventName: project.meta.name,
                  cellSize: project.clueSheetFontSize, inkColor: project.clueSheetOverlayColor,
                })
              }
            }
          }

        }
      }
    }
  }

  const pendingSheets: Array<{ course: Course } & DescSheetOpts> = []

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
      const plan = buildPagePlan(course, submap.index, project.controls, !!project.clueSheetHideSubmapRestart, sLayout?.clueSheetBreaks)
      const { pageCourse, clueSheetCourse, sheetBreaks, seqOffset, restartControlId, trailingFlip, trailingExchange } = plan

      const sOrient = sLayout?.orientation ?? options.orientation
      const { w: cpw, h: cph } = pageDimsFor(sLayout?.pageSize ?? options.pageSize, sOrient)
      const cOrientFlag = sOrient === 'landscape' ? 'l' : 'p'
      // ponytail: tiles still center on the page, an off-center border
      // shifts the crop slightly — center tiles inside the border if it matters.
      const { w: cPrintableW, h: cPrintableH } = printableSize(cpw, cph, sLayout?.mapBorder)

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

          const offset = options.offsets?.[smKey] ?? options.offsets?.[oKey] ?? { x: 0, y: 0 }
          const tile = useTiling ? { col, row, printableW: cPrintableW, printableH: cPrintableH } : null
          const viewCenter = computeViewCenter(sLayout, bounds, project.map, courseScale, offset, tile)
          const toPage = makeToPage(project.map, courseScale, viewCenter, { x: cpw / 2, y: cph / 2 })

          await embedMap(toPage, cpw, cph)

          const courseSpec = resolveSpec(project.spec, course.spec)
          const courseInk = app.color || course.color
          const cDims = dimsFor(courseSpec, app)
          const cSf = specScaleFactor(courseSpec, courseScale)
          const elongScale = project.map.scale > 0 ? project.map.scale / courseScale : 1

          const inkSvg = buildCourseInkSvg({
            pageCourse, controls: project.controls, controlMap,
            annotations: project.annotations, toPage,
            offsetToMm: pt => mapToMm(pt, project.map, courseScale),
            printScale: courseScale, spec: courseSpec, app,
            dims: cDims, sf: cSf, color: courseInk, elongScale,
            idPrefix: `c${pageIndex}`, hasSubmaps, submapIndex: submap.index,
            labelSubmapStart: project.labelSubmapStart,
          })
          await overprintSvg(doc, courseOverprint, inkSvg, cpw, cph)
          await embedTopColors(toPage, cpw, cph)

          const pageAnns = project.annotations.map(a => ({ ...a, points: a.points.map(p => toPage(p)) }))
          const northSvg = renderNorthArrows(pageAnns, courseScale, courseSpec, 1)
          if (northSvg) await embedSvg(doc, northSvg, cpw, cph)

          if (sLayout?.mapBorder) drawBorderMask(doc, sLayout.mapBorder, cpw, cph)
          await drawPageOverlays(doc, project, sLayout?.overlayPositions, toPage, courseScale, cpw, cph)
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
                drawDescriptionSheetOverlayPart(doc, clueSheetCourse, project.controls, partPos.x, partPos.y, pi, breaks, {
                  distanceM: sheetTotal, textDescriptions: course.textDescriptions, legDistances: dist.legs,
                  trailingFlip, trailingExchange, eventName: project.meta.name, seqOffset, restartControlId,
                  cellSize: project.clueSheetFontSize, inkColor: project.clueSheetOverlayColor,
                })
              }
            } else {
              const sheetPos = options.sheetPositions?.[smKey] ?? options.sheetPositions?.[oKey] ?? sLayout?.clueSheet ?? { x: MARGIN, y: MARGIN }
              if (sheetPos.x >= 0 && sheetPos.x <= cpw && sheetPos.y >= 0 && sheetPos.y <= cph) {
                drawDescriptionSheetOverlay(doc, clueSheetCourse, project.controls, sheetPos.x, sheetPos.y, {
                  distanceM: sheetTotal, textDescriptions: course.textDescriptions, legDistances: dist.legs,
                  trailingFlip, trailingExchange, eventName: project.meta.name, seqOffset, restartControlId,
                  cellSize: project.clueSheetFontSize, inkColor: project.clueSheetOverlayColor,
                })
              }
            }
          }

        }
      }

      if ((descMode === 'separate' || descMode === 'both') && clueSheetCourse.controls.length > 0 && (!hasSubmaps || project.clueSheetSplitSubmaps)) {
        const dist = computeCourseDistances(pageCourse, project.controls, project.map, project.measuredLegs)
        const sheetTotal = hasSubmaps ? fullCourseDistance : resolveCourseLength(course, dist)
        pendingSheets.push({ course: clueSheetCourse, distanceM: sheetTotal, textDescriptions: course.textDescriptions, legDistances: dist.legs, trailingFlip, trailingExchange, eventName: project.meta.name, seqOffset, restartControlId, cellSize: project.clueSheetFontSize, inkColor: project.clueSheetSeparateColor })
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
      pendingSheets.push({ course, distanceM: sheetTotal, textDescriptions: course.textDescriptions, legDistances: dist.legs, eventName: project.meta.name, cellSize: project.clueSheetFontSize, inkColor: project.clueSheetSeparateColor, inlineExchanges })
    }
  }

  // Tile clue sheets at the end — fill each page with as many copies as fit
  const TILE_GAP = 3
  for (const s of pendingSheets) {
    const { w: tpw, h: tph } = pageDims(options)
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
      drawDescriptionSheet(doc, s.course, project.controls, pw, ph, s)
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
        drawDescriptionSheetOverlay(doc, s.course, project.controls, x, y, s)
      }
    }
  }

  cleanupSvgIframe()
  const blob = doc.output('blob')
  return blob
}
