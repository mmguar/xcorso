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
  /** For OCAD: pre-rasterized image URL for fast pan/zoom */
  rasterUrl?: string
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

  // The patched ocad2geojson (see patches/) removes debug red circles that
  // corrupted the library's z-order sort and adds data-order attributes.
  // This is a defensive cleanup in case any stray debug circles remain.
  cleanupSvg(svgEl)

  const rasterUrl = await rasterizeSvg(svgEl, bounds)

  return { type: 'svg', content: svgEl, bounds, detectedScale, rasterUrl }
}

function cleanupSvg(svgEl: SVGElement) {
  const innerG = Array.from(svgEl.childNodes).find(
    n => n instanceof Element && n.tagName === 'g',
  ) as Element | undefined
  if (!innerG) return

  for (let i = innerG.childNodes.length - 1; i >= 0; i--) {
    const node = innerG.childNodes[i]
    if (node instanceof Element && node.tagName === 'circle' && node.getAttribute('fill') === 'red') {
      innerG.removeChild(node)
    }
  }
}

const MAX_RASTER_DIM = 8192

async function rasterizeSvg(svgEl: SVGElement, bounds: MapBounds): Promise<string | undefined> {
  try {
    const clone = svgEl.cloneNode(true) as SVGElement
    clone.setAttribute('width', String(bounds.width))
    clone.setAttribute('height', String(bounds.height))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    const xml = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const scale = Math.min(1, MAX_RASTER_DIM / Math.max(bounds.width, bounds.height))
    const w = Math.round(bounds.width * scale)
    const h = Math.round(bounds.height * scale)

    return await new Promise<string | undefined>((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(undefined)
      }
      img.src = url
    })
  } catch {
    return undefined
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
