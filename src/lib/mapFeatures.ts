/**
 * Spatial index of OCAD map features for auto control descriptions.
 *
 * Parses the .ocd file into geojson (with applyCrs: false → raw OCAD units),
 * keeps only features whose ISOM symbol is in the mapping table, and indexes
 * them in a uniform grid for fast radius queries. Coordinates are converted
 * to MapPoint space (y-negated from raw geojson).
 */

import type { MapPoint } from '../types'
import { lookupIsom, isControlFeatureSym } from './isomToIof'
import type { IsomMapping } from './isomToIof'
import { distance } from './geometry'
import { getSymbol } from './iofSymbols'

// ── Types ──────────────────────────────────────────────────────────────────

export interface IndexedFeature {
  isom: number
  mapping: IsomMapping
  kind: 'point' | 'line' | 'area'
  /** For point: the position. For line: vertex array. For area: ring array. */
  coords: MapPoint[]
}

export interface Suggestion {
  code: string
  name: string
  distanceMm: number
  isom: number
  contained: boolean
}

export interface FeatureIndex {
  features: IndexedFeature[]
  query: (pos: MapPoint, radiusUnits: number) => IndexedFeature[]
  suggest: (pos: MapPoint, mapScale: number) => Suggestion[]
}

// ── Grid spatial index ─────────────────────────────────────────────────────

const CELL_SIZE = 200 // ~2 mm paper in OCAD units

function cellKey(cx: number, cy: number): number {
  // Pack two 16-bit signed ints into one 32-bit int
  return ((cx & 0xFFFF) << 16) | (cy & 0xFFFF)
}

function buildGrid(features: IndexedFeature[]): Map<number, number[]> {
  const grid = new Map<number, number[]>()
  function insert(cx: number, cy: number, idx: number) {
    const k = cellKey(cx, cy)
    const arr = grid.get(k)
    if (arr) arr.push(idx)
    else grid.set(k, [idx])
  }

  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    if (f.kind === 'point') {
      const cx = Math.floor(f.coords[0].x / CELL_SIZE)
      const cy = Math.floor(f.coords[0].y / CELL_SIZE)
      insert(cx, cy, i)
    } else {
      // Insert into every cell the bbox touches
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of f.coords) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      const cx0 = Math.floor(minX / CELL_SIZE)
      const cy0 = Math.floor(minY / CELL_SIZE)
      const cx1 = Math.floor(maxX / CELL_SIZE)
      const cy1 = Math.floor(maxY / CELL_SIZE)
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++)
          insert(cx, cy, i)
    }
  }
  return grid
}

// ── Geometry helpers ───────────────────────────────────────────────────────

function pointToSegmentDist(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

function pointToPolylineDist(p: MapPoint, pts: MapPoint[]): number {
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegmentDist(p, pts[i], pts[i + 1])
    if (d < min) min = d
  }
  return min
}

function pointInPolygon(p: MapPoint, ring: MapPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, yj = ring[j].y
    if ((yi > p.y) !== (yj > p.y)) {
      const xIntersect = ring[i].x + (p.y - yi) / (yj - yi) * (ring[j].x - ring[i].x)
      if (p.x < xIntersect) inside = !inside
    }
  }
  return inside
}

function featureDistance(p: MapPoint, f: IndexedFeature): { dist: number; contained: boolean } {
  switch (f.kind) {
    case 'point':
      return { dist: distance(p, f.coords[0]), contained: false }
    case 'line':
      return { dist: pointToPolylineDist(p, f.coords), contained: false }
    case 'area': {
      const inside = pointInPolygon(p, f.coords)
      return { dist: inside ? 0 : pointToPolylineDist(p, f.coords), contained: inside }
    }
  }
}

// ── Coordinate conversion ──────────────────────────────────────────────────

// ocad2geojson with applyCrs:false emits raw OCAD coordinates.
// ocad-to-svg.js does y → -y in path data, so MapPoint.y = -rawY.
function rawToMapPoint(raw: number[]): MapPoint {
  return { x: raw[0], y: -raw[1] }
}

// ── Index builder ──────────────────────────────────────────────────────────

export async function buildFeatureIndex(mapFileData: ArrayBuffer): Promise<FeatureIndex> {
  const { readOcad, ocadToGeoJson } = await import('ocad2geojson')
  const { Buffer: PolyBuffer } = await import('buffer')

  // readOcad uses Buffer.isBuffer() — in the browser the polyfill Buffer is
  // global (set up by main.tsx), in Node/vitest we need a native Buffer.
  // Wrap with whichever Buffer the environment's isBuffer() recognizes.
  const buf = typeof globalThis.process !== 'undefined'
    ? globalThis.Buffer.from(mapFileData)   // Node native
    : PolyBuffer.from(mapFileData)          // browser polyfill
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ocadFile = await readOcad(buf as any)
  const gj = ocadToGeoJson(ocadFile, {
    applyCrs: false,
    generateSymbolElements: false,
    exportHidden: false,
  })

  const features: IndexedFeature[] = []

  for (const f of gj.features) {
    const sym: number = f.properties.sym
    if (!isControlFeatureSym(sym)) continue
    const mapping = lookupIsom(sym)!
    const geom = f.geometry

    if (geom.type === 'Point') {
      features.push({ isom: Math.floor(sym / 1000), mapping, kind: 'point', coords: [rawToMapPoint(geom.coordinates)] })
    } else if (geom.type === 'LineString') {
      features.push({ isom: Math.floor(sym / 1000), mapping, kind: 'line', coords: geom.coordinates.map(rawToMapPoint) })
    } else if (geom.type === 'Polygon' && geom.coordinates.length > 0) {
      features.push({ isom: Math.floor(sym / 1000), mapping, kind: 'area', coords: geom.coordinates[0].map(rawToMapPoint) })
    } else if (geom.type === 'MultiLineString') {
      for (const line of geom.coordinates)
        features.push({ isom: Math.floor(sym / 1000), mapping, kind: 'line', coords: line.map(rawToMapPoint) })
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates)
        if (poly.length > 0) features.push({ isom: Math.floor(sym / 1000), mapping, kind: 'area', coords: poly[0].map(rawToMapPoint) })
    }
  }

  const grid = buildGrid(features)

  function query(pos: MapPoint, radiusUnits: number): IndexedFeature[] {
    const cx0 = Math.floor((pos.x - radiusUnits) / CELL_SIZE)
    const cy0 = Math.floor((pos.y - radiusUnits) / CELL_SIZE)
    const cx1 = Math.floor((pos.x + radiusUnits) / CELL_SIZE)
    const cy1 = Math.floor((pos.y + radiusUnits) / CELL_SIZE)

    const seen = new Set<number>()
    const result: IndexedFeature[] = []
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = grid.get(cellKey(cx, cy))
        if (!bucket) continue
        for (const idx of bucket) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const { dist } = featureDistance(pos, features[idx])
          if (dist <= radiusUnits) result.push(features[idx])
        }
      }
    }
    return result
  }

  function getSymbolName(code: string): string {
    return getSymbol(code)?.name ?? code
  }

  function suggest(pos: MapPoint, _mapScale: number): Suggestion[] {
    // 2 mm on paper = 200 OCAD units (1 unit = 0.01 mm)
    const radiusUnits = 200
    const cx0 = Math.floor((pos.x - radiusUnits) / CELL_SIZE)
    const cy0 = Math.floor((pos.y - radiusUnits) / CELL_SIZE)
    const cx1 = Math.floor((pos.x + radiusUnits) / CELL_SIZE)
    const cy1 = Math.floor((pos.y + radiusUnits) / CELL_SIZE)

    const candidates: { code: string; dist: number; contained: boolean; isom: number }[] = []
    const seen = new Set<number>()

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = grid.get(cellKey(cx, cy))
        if (!bucket) continue
        for (const idx of bucket) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const f = features[idx]
          const { dist, contained } = featureDistance(pos, f)
          if (dist <= radiusUnits) {
            candidates.push({ code: f.mapping.code, dist, contained, isom: f.isom })
          }
        }
      }
    }

    // Rank: point features at distance ~0 first (the control is ON the feature),
    // then other close features by distance. Contained-in-area is a weak signal
    // (every control is inside some area); it beats proximity only when there's
    // no closer point/line feature.
    const POINT_THRESHOLD = 50 // 0.5 mm — close enough to count as "on it"
    candidates.sort((a, b) => {
      const aOnPoint = !a.contained && a.dist <= POINT_THRESHOLD
      const bOnPoint = !b.contained && b.dist <= POINT_THRESHOLD
      if (aOnPoint !== bOnPoint) return aOnPoint ? -1 : 1
      return a.dist - b.dist
    })

    // Deduplicate by code — keep the closest instance of each
    const byCode = new Map<string, typeof candidates[0]>()
    for (const c of candidates) {
      if (!byCode.has(c.code)) byCode.set(c.code, c)
    }

    return [...byCode.values()].map(c => ({
      code: c.code,
      name: getSymbolName(c.code),
      distanceMm: c.dist / 100, // OCAD units → mm on paper
      isom: c.isom,
      contained: c.contained,
    }))
  }

  return { features, query, suggest }
}
