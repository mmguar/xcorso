/**
 * Map loading pipeline.
 *
 * Returns a rendered SVG string (for OCAD) or an object URL (for bitmap/PDF)
 * that can be placed in the MapLayer.
 *
 * Also returns the map's native bounding box in map units for viewport setup.
 */

import { Buffer } from 'buffer'
import { applyMapOverprint } from './overprint'

export interface MapBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface MapGeorefInfo {
  easting: number
  northing: number
  utmZone: number
  hemisphere: 'N' | 'S'
  angleDeg: number
}

export interface LoadedMap {
  type: 'svg' | 'image' | 'pdf-canvas'
  /** SVG element (OCAD) or object URL (bitmap) */
  content: SVGElement | string
  bounds: MapBounds
  /** For OCAD: scale extracted from file header (denominator, e.g. 10000) */
  detectedScale?: number
  /** For OCAD: georeferencing info extracted from ScalePar */
  detectedGeoref?: MapGeorefInfo
  /** For PDF: render upscale factor (coordinates are in upscaled pixels, not PDF points) */
  renderScale?: number
  /** For OCAD: pre-rasterized image URL for fast pan/zoom */
  rasterUrl?: string
  /**
   * For OCAD: rgb() strings of the "top" map colours (black, brown 100%, blue
   * 100%) that should stay above course ink in the 'below' overprint mode.
   * Empty/absent when the map has no identifiable such colours.
   */
  topOverprintColors?: string[]
}

/**
 * Pick the OCAD colours that course ink should sit *below* — black, full brown,
 * and full blue — matched by the standard ISOM/ISSprOM colour names (with a
 * black-by-CMYK fallback). Returns their `rgb(r, g, b)` strings as used in the
 * generated SVG's fill/stroke styles.
 */
function extractTopOverprintColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return []
  const fullShade = (n: string) => {
    const m = n.match(/(\d+)\s*%/)
    return !m || Number(m[1]) >= 100
  }
  const out: string[] = []
  for (const c of colors) {
    if (!c || typeof c.rgb !== 'string') continue
    const name = typeof c.name === 'string' ? c.name.toLowerCase() : ''
    const cmyk = Array.isArray(c.cmyk) ? c.cmyk.map(Number) : [0, 0, 0, 0]
    const isBlack = (name.includes('black') && fullShade(name)) || (cmyk[0] === 0 && cmyk[1] === 0 && cmyk[2] === 0 && cmyk[3] >= 100)
    const isBrown = name.includes('brown') && fullShade(name)
    const isBlue = name.includes('blue') && fullShade(name)
    if ((isBlack || isBrown || isBlue) && !out.includes(c.rgb)) out.push(c.rgb)
  }
  return out
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

  // OCAD parameter-string values are strings (e.g. "4000.000000"). Coerce to a
  // finite positive number so map.scale is never persisted as a string — a
  // string scale survives the editing session (JS coerces it in arithmetic) but
  // is silently discarded by validateProject on reopen.
  if (detectedScale != null) {
    const n = Number(detectedScale)
    detectedScale = Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
  }

  let detectedGeoref: MapGeorefInfo | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crs = (ocadFile as any).getCrs?.()
  if (crs?.easting && crs?.northing && crs?.code) {
    const epsg = Number(crs.code)
    const angleDeg = params?.[1039]?.[0]?.a ? Number(params[1039][0].a) : 0
    // EPSG 326xx = UTM North, 327xx = UTM South
    if (epsg >= 32601 && epsg <= 32660) {
      detectedGeoref = { easting: crs.easting, northing: crs.northing, utmZone: epsg - 32600, hemisphere: 'N', angleDeg }
    } else if (epsg >= 32701 && epsg <= 32760) {
      detectedGeoref = { easting: crs.easting, northing: crs.northing, utmZone: epsg - 32700, hemisphere: 'S', angleDeg }
    }
  }

  // ocad2geojson >= 2.1.21 removed the debug red circles that used to corrupt
  // the library's z-order sort (so the old patch is gone). This stays as a
  // defensive cleanup in case any stray debug circles reappear upstream.
  cleanupSvg(svgEl)

  const rasterUrl = await rasterizeSvg(svgEl, bounds)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topOverprintColors = extractTopOverprintColors((ocadFile as any).colors)

  return { type: 'svg', content: svgEl, bounds, detectedScale, detectedGeoref, rasterUrl, topOverprintColors }
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
let previousRasterUrl: string | null = null

async function rasterizeSvg(svgEl: SVGElement, bounds: MapBounds): Promise<string | undefined> {
  if (previousRasterUrl) {
    URL.revokeObjectURL(previousRasterUrl)
    previousRasterUrl = null
  }

  try {
    const clone = svgEl.cloneNode(true) as SVGElement
    clone.setAttribute('width', String(bounds.width))
    clone.setAttribute('height', String(bounds.height))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    const xml = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)

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
        URL.revokeObjectURL(svgUrl)
        canvas.toBlob(blob => {
          if (!blob) { resolve(undefined); return }
          const blobUrl = URL.createObjectURL(blob)
          previousRasterUrl = blobUrl
          resolve(blobUrl)
        }, 'image/png')
      }
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl)
        resolve(undefined)
      }
      img.src = svgUrl
    })
  } catch {
    return undefined
  }
}

/**
 * Rasterise an OCAD map SVG with spot-ink overprint simulation baked in
 * (see {@link applyMapOverprint}). Used for the on-screen overprint preview when
 * the map is in raster mode. The caller owns the returned blob URL and must
 * revoke it; unlike {@link rasterizeSvg} this keeps no module-level slot.
 */
export async function rasterizeSvgOverprint(svgEl: SVGElement, bounds: MapBounds): Promise<string | undefined> {
  try {
    const clone = svgEl.cloneNode(true) as SVGElement
    clone.setAttribute('width', String(bounds.width))
    clone.setAttribute('height', String(bounds.height))
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    applyMapOverprint(clone, bounds)

    const xml = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)

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
        URL.revokeObjectURL(svgUrl)
        canvas.toBlob(blob => {
          resolve(blob ? URL.createObjectURL(blob) : undefined)
        }, 'image/png')
      }
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl)
        resolve(undefined)
      }
      img.src = svgUrl
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
  // Use the legacy bundle for better compatibility with older Safari/iPad WebKit.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Worker must be set up — point to the bundled worker
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
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

  const bounds: MapBounds = {
    minX: 0, minY: 0,
    maxX: viewport.width, maxY: viewport.height,
    width: viewport.width, height: viewport.height,
  }

  const url = await new Promise<string>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Failed to rasterize PDF')); return }
      resolve(URL.createObjectURL(blob))
    }, 'image/png')
  })

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
