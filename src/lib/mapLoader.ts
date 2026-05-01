/**
 * Map loading pipeline.
 *
 * Returns a rendered SVG string (for OCAD) or an object URL (for bitmap/PDF)
 * that can be placed in the MapLayer.
 *
 * Also returns the map's native bounding box in map units for viewport setup.
 */

import { Buffer } from 'buffer'

export interface MapBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface LoadedMap {
  type: 'svg' | 'image' | 'pdf-canvas'
  /** SVG element (OCAD) or object URL (bitmap) */
  content: SVGElement | string
  bounds: MapBounds
  /** For OCAD: scale extracted from file header (denominator, e.g. 10000) */
  detectedScale?: number
  /** For PDF: render upscale factor (coordinates are in upscaled pixels, not PDF points) */
  renderScale?: number
}

export async function loadOcadMap(data: ArrayBuffer): Promise<LoadedMap> {
  // Dynamic import to keep initial bundle small
  const { readOcad, ocadToSvg } = await import('ocad2geojson')

  // ocad2geojson expects a Node.js Buffer; convert from ArrayBuffer
  const buffer = Buffer.from(data)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocadFile = await readOcad(buffer as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svgEl = (ocadToSvg as any)(ocadFile) as SVGElement

  // Extract viewBox from the generated SVG to get bounds
  const viewBox = svgEl.getAttribute('viewBox')
  let bounds: MapBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }

  if (viewBox) {
    const [minX, minY, width, height] = viewBox.split(/[\s,]+/).map(Number)
    bounds = { minX, minY, maxX: minX + width, maxY: minY + height, width, height }
  }

  // Extract scale from OCAD header
  // ocad2geojson exposes it via ocadFile.header or parameterStrings
  let detectedScale: number | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const header = (ocadFile as any).header
  if (header?.mapScale) detectedScale = header.mapScale
  // Also check parameterStrings for newer OCAD versions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = (ocadFile as any).parameterStrings
  if (params) {
    // ScalePar block stores the scale
    const scalePar = params[1039] // OCAD parameter string type 1039 = ScalePar
    if (scalePar?.[0]?.m) detectedScale = scalePar[0].m
  }

  // ocad2geojson has a bug: debug red circles with no renderOrder corrupt the
  // global sort, scrambling z-order for the entire map. Fix by removing them
  // and re-sorting elements by their color's renderOrder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fixSvgRenderOrder(svgEl, ocadFile as any)

  return { type: 'svg', content: svgEl, bounds, detectedScale }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixSvgRenderOrder(svgEl: SVGElement, ocadFile: any) {
  const colorDefs = ocadFile.parameterStrings[9] || []
  const rgbToOrder = new Map<string, number>()
  for (let i = 0; i < colorDefs.length; i++) {
    const colorNum = Number(colorDefs[i].n)
    const color = ocadFile.colors[colorNum]
    if (color && !rgbToOrder.has(color.rgb)) {
      rgbToOrder.set(color.rgb, color.renderOrder ?? i)
    }
  }

  // symNum → renderOrder for pattern-fill elements (hatch/struct fills)
  const symToOrder = new Map<number, number>()
  for (const sym of (ocadFile.symbols || [])) {
    const colorIdx = sym.hatchMode ? sym.hatchColor
      : sym.elements?.length ? Math.min(...sym.elements.map((e: { color: number }) => e.color))
      : sym.fillColor
    if (colorIdx != null) {
      const colorObj = ocadFile.colors[colorIdx]
      if (colorObj) symToOrder.set(sym.symNum, colorObj.renderOrder)
    }
  }

  const innerG = Array.from(svgEl.childNodes).find(
    n => n instanceof Element && n.tagName === 'g',
  ) as Element | undefined
  if (!innerG) return

  const children: Element[] = []
  for (let i = innerG.childNodes.length - 1; i >= 0; i--) {
    const node = innerG.childNodes[i]
    if (!(node instanceof Element)) continue
    if (node.tagName === 'circle' && node.getAttribute('fill') === 'red') {
      innerG.removeChild(node)
      continue
    }
    children.unshift(node)
  }

  function getOrder(el: Element): number {
    const style = el.getAttribute('style') || ''
    const patternMatch = style.match(/url\(#(?:struct|hatch)-fill-(\d+)/)
    if (patternMatch) {
      const symNum = parseInt(patternMatch[1])
      if (symToOrder.has(symNum)) return symToOrder.get(symNum)!
    }
    const fillMatch = style.match(/(?:^|;\s*)fill:\s*(rgb\([^)]+\))/)
    const strokeMatch = style.match(/stroke:\s*(rgb\([^)]+\))/)
    const rgb = fillMatch?.[1] || strokeMatch?.[1]
      || el.getAttribute('fill') || el.getAttribute('stroke')
    if (rgb && rgbToOrder.has(rgb)) return rgbToOrder.get(rgb)!
    return -1
  }

  const entries = children.map((node, origIdx) => ({
    node,
    order: getOrder(node),
    origIdx,
  }))

  entries.sort((a, b) => {
    if (a.order !== b.order) return b.order - a.order
    return a.origIdx - b.origIdx
  })

  for (const { node } of entries) {
    innerG.appendChild(node)
  }
}

let previousBitmapUrl: string | null = null

export async function loadBitmapMap(data: ArrayBuffer, filename: string): Promise<LoadedMap> {
  if (previousBitmapUrl) {
    URL.revokeObjectURL(previousBitmapUrl)
    previousBitmapUrl = null
  }

  const blob = new Blob([data], { type: mimeTypeFromFilename(filename) })
  const url = URL.createObjectURL(blob)
  previousBitmapUrl = url

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const bounds: MapBounds = {
        minX: 0, minY: 0,
        maxX: img.naturalWidth, maxY: img.naturalHeight,
        width: img.naturalWidth, height: img.naturalHeight,
      }
      resolve({ type: 'image', content: url, bounds })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      previousBitmapUrl = null
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

export async function loadPdfMap(data: ArrayBuffer): Promise<LoadedMap> {
  const pdfjs = await import('pdfjs-dist')
  // Worker must be set up — point to the bundled worker
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url,
    ).toString()
  }

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data).slice() }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 3 }) // 3× for crisp rendering

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, viewport }).promise

  const url = canvas.toDataURL('image/png')
  const bounds: MapBounds = {
    minX: 0, minY: 0,
    maxX: viewport.width, maxY: viewport.height,
    width: viewport.width, height: viewport.height,
  }

  return { type: 'image', content: url, bounds, renderScale: 3 }
}

export async function loadMap(data: ArrayBuffer, filename: string): Promise<LoadedMap> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'ocd') return loadOcadMap(data)
  if (ext === 'pdf') return loadPdfMap(data)
  return loadBitmapMap(data, filename)
}

function mimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    webp: 'image/webp',
  }
  return map[ext] ?? 'image/png'
}
