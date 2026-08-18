import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { buildFeatureIndex } from './mapFeatures'
import { lookupIsom } from './isomToIof'
import { getSymbol } from './iofSymbols'

const TEST_MAP = readFileSync('tests/diablo_valley_college_2025.ocd')

describe('isomToIof', () => {
  it('every mapped code resolves in iofSymbols', () => {
    const seen = new Set<string>()
    for (let sym = 100; sym < 700; sym++) {
      const m = lookupIsom(sym * 1000)
      if (m) seen.add(m.code)
    }
    for (const code of seen) {
      expect(getSymbol(code), `IOF code ${code} not found in iofSymbols`).toBeDefined()
    }
  })
})

describe('buildFeatureIndex', () => {
  it('extracts features from the test map', async () => {
    const index = await buildFeatureIndex(TEST_MAP.buffer.slice(TEST_MAP.byteOffset, TEST_MAP.byteOffset + TEST_MAP.byteLength))
    expect(index.features.length).toBeGreaterThan(100)

    const boulders = index.features.filter(f => f.isom === 204)
    expect(boulders.length).toBe(9)
    expect(boulders[0].kind).toBe('point')
  })

  it('converts coordinates: y is negated from raw geojson', async () => {
    const index = await buildFeatureIndex(TEST_MAP.buffer.slice(TEST_MAP.byteOffset, TEST_MAP.byteOffset + TEST_MAP.byteLength))

    // First tree (sym 418000) has raw coords (498, -3551) → MapPoint (498, 3551)
    const trees = index.features.filter(f => f.isom === 418 && f.kind === 'point')
    expect(trees.length).toBeGreaterThan(0)
    const firstTree = trees.find(t => Math.abs(t.coords[0].x - 498) < 1)
    expect(firstTree).toBeDefined()
    expect(firstTree!.coords[0].y).toBeCloseTo(3551, 0)
  })

  it('suggests a boulder when queried at a boulder position', async () => {
    const index = await buildFeatureIndex(TEST_MAP.buffer.slice(TEST_MAP.byteOffset, TEST_MAP.byteOffset + TEST_MAP.byteLength))

    const boulder = index.features.find(f => f.isom === 204)!
    const pos = boulder.coords[0]
    const suggestions = index.suggest(pos, 15000)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].code).toBe('2.4')
    expect(suggestions[0].distanceMm).toBeCloseTo(0, 1)
  })

  it('returns no suggestions far from any feature', async () => {
    const index = await buildFeatureIndex(TEST_MAP.buffer.slice(TEST_MAP.byteOffset, TEST_MAP.byteLength))

    // Way outside the map bounds
    const suggestions = index.suggest({ x: 999999, y: 999999 }, 15000)
    expect(suggestions).toHaveLength(0)
  })
})
