import type { Project, Course, Control, MapPoint, AppearanceSettings, EventSpec, OverprintMode } from '../types'
import type { LoadedMap } from './mapLoader'
import {
  mapToMm, courseBoundsMm, PAGE_SIZES, MARGIN, ALL_CONTROLS_ID,
  assignControlColors, MULTICOLOR_PALETTE, clueSheetHiddenRestartView,
} from './pdfExport'
import { resolveSpec, dimsFor, symbolScaleFactor as specScaleFactor } from './symbolSpec'
import {
  IOF_PURPLE, controlsById, computeSubmaps,
  submapLayoutView, defaultControlLabel,
} from './courseUtils'
import { computeCourseDistances, resolveCourseLength } from './distance'
import { descriptionSheetSize, descriptionSheetPartSizes, drawDescriptionSheetOverlay, drawDescriptionSheetOverlayPart } from './pdfDescriptionSheet'
import { hexToRgb } from './color'
import { applyMapOverprint } from './overprint'
import {
  renderControlSymbol,
  renderAnnotationInk, renderNorthArrows, renderScaleBar, renderTextLabel,
  buildCourseInkSvg,
} from './courseRenderer'

interface Pos { x: number; y: number }

const DEFAULT_APPEARANCE: AppearanceSettings = {
  controlScale: 1, lineWidth: 1, color: '',
  outlineEnabled: false, outlineColor: '#ffffff', outlineWidth: 0.7,
}

export interface ImageExportOptions {
  pageSize: string
  orientation: 'portrait' | 'landscape'
  printScale: number
  courseIds: string[]
  allControls?: boolean
  allControlsMulticolor?: boolean
  allControlsLinkId?: boolean
  appearance?: AppearanceSettings
  mapOpacity?: number
  overprint?: number
  overprintMode?: OverprintMode
  mapOverprint?: boolean
  dpi?: number
  scaleOverrides?: Record<string, number>
}


async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  return img
}

async function svgToImage(svgXml: string): Promise<HTMLImageElement> {
  const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function rasterizeMapRegion(
  loadedMap: LoadedMap,
  toPage: (pt: MapPoint) => Pos,
  pxPerMm: number,
  opacity: number,
  overprint: boolean,
): Promise<HTMLImageElement | null> {
  const b = loadedMap.bounds
  const tl = toPage({ x: b.minX, y: b.minY })
  const br = toPage({ x: b.maxX, y: b.maxY })

  if (loadedMap.type === 'svg') {
    const svgEl = loadedMap.content as SVGElement
    const clone = svgEl.cloneNode(true) as SVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('viewBox', `${b.minX} ${b.minY} ${b.width} ${b.height}`)
    const imgW = Math.round((br.x - tl.x) * pxPerMm)
    const imgH = Math.round((br.y - tl.y) * pxPerMm)
    if (imgW <= 0 || imgH <= 0) return Promise.resolve(null)
    clone.setAttribute('width', String(Math.min(imgW, 8000)))
    clone.setAttribute('height', String(Math.min(imgH, 8000)))
    if (overprint) applyMapOverprint(clone, b)
    if (opacity < 1) {
      const g = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('opacity', String(opacity))
      while (clone.firstChild) g.appendChild(clone.firstChild)
      clone.appendChild(g)
    }
    const xml = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    return img.decode().then(() => { URL.revokeObjectURL(url); return img })
  }

  // Bitmap/PDF-canvas map
  const url = loadedMap.content as string
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  return img.decode().then(() => img)
}

interface DescSheetInfo {
  course: Course
  position: Pos
  distanceM?: number
  textDescriptions?: boolean
  legDistances?: number[]
  trailingFlip?: boolean
  trailingExchange?: boolean
  seqOffset?: number
  restartControlId?: string
  cellSize?: number
  inkColor?: string
  breaks?: number[]
  partPositions?: Pos[]
}

async function rasterizeDescSheet(
  info: DescSheetInfo,
  controls: Control[],
  pxPerMm: number,
  eventName: string,
): Promise<{ canvas: HTMLCanvasElement; x: number; y: number } | null> {
  const parts = info.breaks?.length
    ? descriptionSheetPartSizes(info.course, controls, info.breaks, info.trailingFlip || info.trailingExchange, info.cellSize)
    : [descriptionSheetSize(info.course, controls, info.trailingFlip || info.trailingExchange, info.cellSize)]

  const totalW = Math.max(...parts.map(p => p.width))
  const totalH = parts.reduce((sum, p) => sum + p.height, 0)
  if (totalW === 0 || totalH === 0) return null

  const { jsPDF } = await import('jspdf')
  const resultCanvas = document.createElement('canvas')

  if (info.breaks?.length) {
    const positions = info.partPositions ?? parts.map((_, i) => ({
      x: info.position.x, y: info.position.y + parts.slice(0, i).reduce((s, p) => s + p.height, 0),
    }))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < parts.length; i++) {
      const pos = positions[i] ?? info.position
      minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + parts[i].width); maxY = Math.max(maxY, pos.y + parts[i].height)
    }
    const bw = maxX - minX, bh = maxY - minY
    resultCanvas.width = Math.round(bw * pxPerMm)
    resultCanvas.height = Math.round(bh * pxPerMm)
    const rctx = resultCanvas.getContext('2d')!
    for (let pi = 0; pi < parts.length; pi++) {
      const pos = positions[pi] ?? info.position
      const p = parts[pi]
      if (p.width === 0 || p.height === 0) continue
      const tempDoc = new jsPDF({ unit: 'mm', format: [p.width, p.height] })
      drawDescriptionSheetOverlayPart(tempDoc, info.course, controls, 0, 0, pi, info.breaks!, info.distanceM, info.textDescriptions, info.legDistances, info.trailingFlip, eventName, info.seqOffset, info.restartControlId, info.cellSize, info.inkColor, info.trailingExchange)
      const partCanvas = await pdfToCanvas(tempDoc, pxPerMm)
      if (partCanvas) rctx.drawImage(partCanvas, (pos.x - minX) * pxPerMm, (pos.y - minY) * pxPerMm)
    }
    return { canvas: resultCanvas, x: minX, y: minY }
  }

  const size = parts[0]
  const tempDoc = new jsPDF({ unit: 'mm', format: [size.width, size.height] })
  drawDescriptionSheetOverlay(tempDoc, info.course, controls, 0, 0, info.distanceM, info.textDescriptions, info.legDistances, info.trailingFlip, eventName, info.seqOffset, info.restartControlId, info.cellSize, info.inkColor, info.trailingExchange)
  const sheetCanvas = await pdfToCanvas(tempDoc, pxPerMm)
  if (!sheetCanvas) return null
  resultCanvas.width = sheetCanvas.width
  resultCanvas.height = sheetCanvas.height
  resultCanvas.getContext('2d')!.drawImage(sheetCanvas, 0, 0)
  return { canvas: resultCanvas, x: info.position.x, y: info.position.y }
}

async function pdfToCanvas(doc: import('jspdf').jsPDF, pxPerMm: number): Promise<HTMLCanvasElement | null> {
  const pdfBytes = doc.output('arraybuffer')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url,
    ).toString()
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes) }).promise
  const page = await pdf.getPage(1)
  const ptPerMm = 72 / 25.4
  const scale = pxPerMm / ptPerMm
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas
}

export async function exportCourseImages(
  project: Project,
  options: ImageExportOptions,
  loadedMap: LoadedMap | null,
): Promise<{ name: string; blob: Blob }[]> {
  const app = options.appearance ?? DEFAULT_APPEARANCE
  const dpi = options.dpi ?? 300
  const mapOpacity = options.mapOpacity ?? 1
  const courseOverprint = (project.overprintMode ?? 'simulated') === 'none' ? 0 : (options.overprint ?? 1)
  const mapOverprint = options.mapOverprint ?? false
  const controlMap = controlsById(project.controls)
  const results: { name: string; blob: Blob }[] = []

  const base = PAGE_SIZES[options.pageSize] ?? PAGE_SIZES.a4
  const pw = options.orientation === 'landscape' ? base.h : base.w
  const ph = options.orientation === 'landscape' ? base.w : base.h
  const pxPerMm = dpi / 25.4

  // ── All controls page ───────────────────────────────────────────────────
  if (options.allControls && project.controls.length > 0) {
    const acScale = options.scaleOverrides?.[ALL_CONTROLS_ID] ?? options.printScale
    const allCtrlSpec = resolveSpec(project.spec)
    const acSf = specScaleFactor(allCtrlSpec, acScale)
    const elongScale = project.map.scale > 0 ? project.map.scale / acScale : 1

    const positions = project.controls.map(c => mapToMm(c.position, project.map, acScale))
    const pad = 5 * acSf
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of positions) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
    }
    minX -= pad; minY -= pad; maxX += pad; maxY += pad
    const cx = pw / 2, cy = ph / 2
    const viewCenterX = (minX + maxX) / 2, viewCenterY = (minY + maxY) / 2

    function toPage(pt: MapPoint): Pos {
      const mm = mapToMm(pt, project.map, acScale)
      return { x: cx + (mm.x - viewCenterX), y: cy + (mm.y - viewCenterY) }
    }

    const blob = await renderPage(
      project, null, toPage, pw, ph, pxPerMm, acScale, allCtrlSpec, app, loadedMap,
      mapOpacity, mapOverprint, courseOverprint, elongScale, controlMap, options,
    )
    results.push({ name: `${project.meta.name}_all_controls.png`, blob })
  }

  // ── Course pages ────────────────────────────────────────────────────────
  for (const course of project.courses) {
    if (!options.courseIds.includes(course.id)) continue
    const submaps = computeSubmaps(course)

    for (const submap of submaps) {
      const pageCourse = submaps.length > 1
        ? { ...course, controls: submap.controls, name: `${course.name} - ${submap.index + 1}` }
        : course

      const sLayout = course.layout ? (submapLayoutView(course.layout, submap.index) ?? course.layout) : undefined
      const courseScale = sLayout?.printScale ?? options.scaleOverrides?.[course.id] ?? options.printScale
      const courseSpec = resolveSpec(project.spec, course.spec)
      const elongScale = project.map.scale > 0 ? project.map.scale / courseScale : 1

      const sPageBase = sLayout ? (PAGE_SIZES[sLayout.pageSize] ?? PAGE_SIZES.a4) : base
      const sOrient = sLayout?.orientation ?? options.orientation
      const cpw = sOrient === 'landscape' ? sPageBase.h : sPageBase.w
      const cph = sOrient === 'landscape' ? sPageBase.w : sPageBase.h

      const bounds = courseBoundsMm(pageCourse, project.controls, project.map, courseScale, project.spec)
      if (!bounds && !sLayout) continue

      let viewCenterX: number, viewCenterY: number
      if (sLayout) {
        const mc = mapToMm(sLayout.mapCenter, project.map, courseScale)
        viewCenterX = mc.x; viewCenterY = mc.y
      } else if (bounds) {
        viewCenterX = bounds.centerX; viewCenterY = bounds.centerY
      } else {
        continue
      }

      const ccx = cpw / 2, ccy = cph / 2
      const hasSubmaps = submaps.length > 1
      function toPage(pt: MapPoint): Pos {
        const mm = mapToMm(pt, project.map, courseScale)
        return { x: ccx + (mm.x - viewCenterX), y: ccy + (mm.y - viewCenterY) }
      }

      // Description sheet data (shared by on-map and separate)
      const descMode = course.layout?.descMode ?? 'none'
      let descSheetInfo: DescSheetInfo | undefined
      if (descMode !== 'none' && pageCourse.controls.length > 0) {
        let clueSheetControls = submap.controls
        let sheetBreaks = sLayout?.clueSheetBreaks
        let seqOffset = 0
        let restartControlId: string | undefined
        if (hasSubmaps && submap.index > 0) seqOffset = submaps.slice(0, submap.index).reduce((s, sm) => s + sm.controls.filter(c => controlMap.get(c.controlId)?.type === 'control').length, 0)
        if (project.clueSheetHideSubmapRestart && hasSubmaps && submap.index > 0) {
          const r = clueSheetHiddenRestartView(submap.controls, sheetBreaks)
          clueSheetControls = r.controls; sheetBreaks = r.breaks
          const firstCtrl = controlMap.get(submap.controls[0]?.controlId)
          if (firstCtrl) restartControlId = firstCtrl.id
        }
        const clueSheetCourse = clueSheetControls !== submap.controls
          ? { ...pageCourse, controls: clueSheetControls } : pageCourse
        const dist = computeCourseDistances(pageCourse, project.controls, project.map, project.measuredLegs)
        const sheetTotal = hasSubmaps
          ? resolveCourseLength(course, computeCourseDistances(course, project.controls, project.map, project.measuredLegs))
          : resolveCourseLength(course, dist)

        let trailingFlip = false, trailingExchange = false
        if (hasSubmaps && submap.index < submaps.length - 1) {
          const lastCc = submap.controls[submap.controls.length - 1]
          if (lastCc?.exchangeMode === 'flip') trailingFlip = true
          else if (lastCc?.exchangeMode === 'exchange') trailingExchange = true
        }

        const sheetPos = sLayout?.clueSheet ?? { x: MARGIN, y: MARGIN }
        descSheetInfo = {
          course: clueSheetCourse,
          position: sheetPos,
          distanceM: sheetTotal,
          textDescriptions: course.textDescriptions,
          legDistances: dist.legs,
          trailingFlip, trailingExchange,
          seqOffset, restartControlId,
          cellSize: project.clueSheetFontSize,
          inkColor: project.clueSheetOverlayColor,
          breaks: sheetBreaks,
          partPositions: sheetBreaks?.length
            ? [sheetPos, ...(sLayout?.clueSheetParts ?? [])]
            : undefined,
        }
      }

      const onMapSheet = (descMode === 'on-map' || descMode === 'both') ? descSheetInfo : undefined
      const blob = await renderPage(
        project, pageCourse, toPage, cpw, cph, pxPerMm, courseScale, courseSpec, app, loadedMap,
        mapOpacity, mapOverprint, courseOverprint, elongScale, controlMap, options, onMapSheet,
        hasSubmaps, submap.index,
      )
      const suffix = submaps.length > 1 ? `_${submap.index + 1}` : ''
      results.push({ name: `${project.meta.name}_${course.name}${suffix}.png`, blob })

      // Separate description sheet as its own PNG
      if ((descMode === 'separate' || descMode === 'both') && descSheetInfo) {
        try {
          const separateInfo: DescSheetInfo = {
            ...descSheetInfo,
            position: { x: 0, y: 0 },
            inkColor: project.clueSheetSeparateColor,
            breaks: undefined,
            partPositions: undefined,
          }
          const size = descriptionSheetSize(separateInfo.course, project.controls, separateInfo.trailingFlip || separateInfo.trailingExchange, separateInfo.cellSize)
          if (size.width > 0 && size.height > 0) {
            const { jsPDF } = await import('jspdf')
            const tempDoc = new jsPDF({ unit: 'mm', format: [size.width, size.height] })
            drawDescriptionSheetOverlay(tempDoc, separateInfo.course, project.controls, 0, 0, separateInfo.distanceM, separateInfo.textDescriptions, separateInfo.legDistances, separateInfo.trailingFlip, project.meta.name, separateInfo.seqOffset, separateInfo.restartControlId, separateInfo.cellSize, separateInfo.inkColor, separateInfo.trailingExchange)
            const sheetCanvas = await pdfToCanvas(tempDoc, pxPerMm)
            if (sheetCanvas) {
              const sheetBlob = await new Promise<Blob>((resolve, reject) => {
                sheetCanvas.toBlob(b => b ? resolve(b) : reject(new Error('Sheet PNG failed')), 'image/png')
              })
              results.push({ name: `${project.meta.name}_${course.name}${suffix}_clue_sheet.png`, blob: sheetBlob })
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  return results
}

async function renderPage(
  project: Project,
  course: Course | null,
  toPage: (pt: MapPoint) => Pos,
  pw: number,
  ph: number,
  pxPerMm: number,
  printScale: number,
  spec: EventSpec,
  app: AppearanceSettings,
  loadedMap: LoadedMap | null,
  mapOpacity: number,
  mapOverprint: boolean,
  courseOverprint: number,
  elongScale: number,
  controlMap: Map<string, Control>,
  options: ImageExportOptions,
  descSheet?: DescSheetInfo,
  hasSubmaps = false,
  submapIndex = 0,
): Promise<Blob> {
  const canvasW = Math.round(pw * pxPerMm)
  const canvasH = Math.round(ph * pxPerMm)
  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!

  // White background
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Draw map
  if (loadedMap) {
    const b = loadedMap.bounds
    const tl = toPage({ x: b.minX, y: b.minY })
    const br = toPage({ x: b.maxX, y: b.maxY })
    const mapImg = await rasterizeMapRegion(loadedMap, toPage, pxPerMm, mapOpacity, mapOverprint)
    if (mapImg) {
      if (loadedMap.type === 'svg') {
        ctx.drawImage(mapImg, tl.x * pxPerMm, tl.y * pxPerMm, (br.x - tl.x) * pxPerMm, (br.y - tl.y) * pxPerMm)
      } else {
        ctx.globalAlpha = mapOpacity
        ctx.drawImage(mapImg, tl.x * pxPerMm, tl.y * pxPerMm, (br.x - tl.x) * pxPerMm, (br.y - tl.y) * pxPerMm)
        ctx.globalAlpha = 1
      }
    }
  }

  // Build course ink SVG
  const dims = dimsFor(spec, app)
  const sf = specScaleFactor(spec, printScale)
  const courseInk = app.color || (course?.color ?? IOF_PURPLE)
  const offsetToMm = (pt: MapPoint) => mapToMm(pt, project.map, printScale)

  let inkSvg: string
  if (course) {
    inkSvg = buildCourseInkSvg({
      pageCourse: course, controls: project.controls, controlMap,
      annotations: project.annotations, toPage, offsetToMm,
      printScale, spec, app, dims, sf, color: courseInk, elongScale,
      idPrefix: 'img', hasSubmaps, submapIndex,
      labelSubmapStart: project.labelSubmapStart,
    })
  } else {
    // All-controls page
    const pageAnns = project.annotations.map(a => ({ ...a, points: a.points.map(p => toPage(p)) }))
    inkSvg = renderAnnotationInk(pageAnns, printScale, spec, IOF_PURPLE, 1, 'img', elongScale)
    const colorMap = options.allControlsMulticolor ? assignControlColors(project.controls) : null
    for (const ctrl of project.controls) {
      const pos = toPage(ctrl.position)
      const ctrlColor = colorMap ? MULTICOLOR_PALETTE[colorMap.get(ctrl.id) ?? 0] : IOF_PURPLE
      inkSvg += renderControlSymbol({
        type: ctrl.type, position: pos, dims, scale: sf,
        color: ctrlColor, appearance: app,
        gaps: ctrl.gaps,
        label: defaultControlLabel(ctrl),
        labelOffset: ctrl.labelOffset ? offsetToMm(ctrl.labelOffset) : undefined,
      })
    }
  }

  // Render course SVG overlay onto canvas
  if (inkSvg) {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${pw} ${ph}">${inkSvg}</svg>`
    const overlayImg = await svgToImage(svgXml)
    const t = Math.max(0, Math.min(1, courseOverprint))
    if (t < 1) {
      ctx.globalAlpha = 1 - t
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(overlayImg, 0, 0, canvasW, canvasH)
    }
    if (t > 0) {
      ctx.globalAlpha = t
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(overlayImg, 0, 0, canvasW, canvasH)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // North arrows (not part of overprint compositing)
  const pageAnns = project.annotations.map(a => ({ ...a, points: a.points.map(p => toPage(p)) }))
  const northSvg = renderNorthArrows(pageAnns, printScale, spec, 1)
  if (northSvg) {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${pw} ${ph}">${northSvg}</svg>`
    const northImg = await svgToImage(svgXml)
    ctx.drawImage(northImg, 0, 0, canvasW, canvasH)
  }

  // Border masking
  const sLayout = course?.layout
  const mb = sLayout?.mapBorder
  if (mb) {
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvasW, mb.y * pxPerMm)
    ctx.fillRect(0, (mb.y + mb.height) * pxPerMm, canvasW, canvasH)
    ctx.fillRect(0, mb.y * pxPerMm, mb.x * pxPerMm, mb.height * pxPerMm)
    ctx.fillRect((mb.x + mb.width) * pxPerMm, mb.y * pxPerMm, canvasW, mb.height * pxPerMm)
    const [r, g, b] = hexToRgb(mb.color)
    ctx.strokeStyle = `rgb(${r},${g},${b})`
    ctx.lineWidth = mb.strokeWidth * pxPerMm
    ctx.strokeRect(mb.x * pxPerMm, mb.y * pxPerMm, mb.width * pxPerMm, mb.height * pxPerMm)
  }

  // Overlays (scale bars, text labels)
  let overlaySvg = ''
  for (const sb of project.scaleBars) {
    const overridePos = sLayout?.overlayPositions?.[sb.id]
    const effectiveSb = overridePos ? { ...sb, position: overridePos } : sb
    overlaySvg += renderScaleBar({ ...effectiveSb, position: toPage(effectiveSb.position) }, printScale, 1)
  }
  for (const tl of project.textLabels) {
    const overridePos = sLayout?.overlayPositions?.[tl.id]
    const effectiveTl = overridePos ? { ...tl, position: overridePos } : tl
    overlaySvg += renderTextLabel({ ...effectiveTl, position: toPage(effectiveTl.position) }, 1)
  }
  if (overlaySvg) {
    const svgXml = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${pw} ${ph}">${overlaySvg}</svg>`
    const overlayImg = await svgToImage(svgXml)
    ctx.drawImage(overlayImg, 0, 0, canvasW, canvasH)
  }

  // Image overlays drawn directly
  for (const img of project.imageOverlays) {
    const overridePos = sLayout?.overlayPositions?.[img.id]
    const effectiveImg = overridePos ? { ...img, position: overridePos } : img
    if (effectiveImg.widthMm > 0 && effectiveImg.heightMm > 0 && effectiveImg.dataUrl) {
      try {
        const pos = toPage(effectiveImg.position)
        const imgEl = await loadImage(effectiveImg.dataUrl)
        ctx.drawImage(imgEl, pos.x * pxPerMm, pos.y * pxPerMm, effectiveImg.widthMm * pxPerMm, effectiveImg.heightMm * pxPerMm)
      } catch { /* skip */ }
    }
  }

  // Description sheet
  if (descSheet) {
    try {
      const result = await rasterizeDescSheet(descSheet, project.controls, pxPerMm, project.meta.name)
      if (result) {
        ctx.drawImage(result.canvas, result.x * pxPerMm, result.y * pxPerMm)
      }
    } catch { /* skip if jsPDF/pdf.js fails */ }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed')), 'image/png')
  })
}
