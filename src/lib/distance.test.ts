import { describe, test, expect } from 'vitest'
import { mapUnitsToMetres, formatDistance, formatScaleBarDistance, legKey, computeCourseDistances, resolveCourseLength } from './distance'
import type { MapConfig, Control, Course } from '../types'

const ocadMap: MapConfig = {
  type: 'ocad', filename: 'test.ocd', storage: { mode: 'embedded' },
  scale: 10000, width: 100000, height: 100000, scaleSource: 'ocad',
}

const bitmapMapWithMeasurement: MapConfig = {
  type: 'bitmap', filename: 'test.png', storage: { mode: 'embedded' },
  scale: 10000, width: 1000, height: 1000, scaleSource: 'manual',
  scaleMeasurement: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, realWorldMeters: 500 },
}

const bitmapMapNoMeasurement: MapConfig = {
  type: 'bitmap', filename: 'test.png', storage: { mode: 'embedded' },
  scale: 10000, width: 1000, height: 1000, scaleSource: 'manual',
}

describe('mapUnitsToMetres', () => {
  test('OCAD: 100000 units at 1:10000 = 10m', () => {
    expect(mapUnitsToMetres(100000, ocadMap)).toBeCloseTo(10000)
  })
  test('OCAD: 1 unit at 1:10000', () => {
    expect(mapUnitsToMetres(1, ocadMap)).toBeCloseTo(0.1)
  })
  test('bitmap with measurement', () => {
    // 100px = 500m, so 50px = 250m
    expect(mapUnitsToMetres(50, bitmapMapWithMeasurement)).toBeCloseTo(250)
  })
  test('bitmap without measurement returns 0', () => {
    expect(mapUnitsToMetres(50, bitmapMapNoMeasurement)).toBe(0)
  })
})

describe('legKey', () => {
  test('concatenates with __', () => {
    expect(legKey('a', 'b')).toBe('a__b')
  })
})

describe('formatDistance', () => {
  test('metres under 1000', () => {
    expect(formatDistance(450)).toBe('450 m')
    expect(formatDistance(123)).toBe('120 m') // rounds to nearest 10
  })
  test('km over 1000', () => {
    expect(formatDistance(2340)).toBe('2.3 km')
    expect(formatDistance(1000)).toBe('1.0 km')
  })
})

describe('formatScaleBarDistance', () => {
  test('exact metres below 1000', () => {
    expect(formatScaleBarDistance(250)).toBe('250 m')
  })
  test('km at 1000+', () => {
    expect(formatScaleBarDistance(1500)).toBe('1.5 km')
  })
})

describe('computeCourseDistances', () => {
  const controls: Control[] = [
    { id: 's', type: 'start', code: 1, position: { x: 0, y: 0 } },
    { id: 'c1', type: 'control', code: 31, position: { x: 30000, y: 40000 } },
    { id: 'f', type: 'finish', code: 1, position: { x: 30000, y: 40000 } },
  ]
  const course: Course = {
    id: 'test', name: 'Test', type: 'linear', color: '#ff0000',
    controls: [
      { id: 'cc1', controlId: 's' },
      { id: 'cc2', controlId: 'c1' },
      { id: 'cc3', controlId: 'f' },
    ],
  }

  test('straight-line course on OCAD map', () => {
    const result = computeCourseDistances(course, controls, ocadMap)
    // s→c1: distance(0,0 → 30000,40000) = 50000 units. At 1:10000, 50000 * 10000/100000 = 5000m
    expect(result.legs).toHaveLength(2)
    expect(result.legs[0]).toBeCloseTo(5000)
    expect(result.legs[1]).toBeCloseTo(0) // c1 and f are same position
    expect(result.total).toBeCloseTo(5000)
  })

  test('single control returns empty', () => {
    const short: Course = { id: 'x', name: 'X', type: 'linear', color: '#f00', controls: [{ id: 'cc1', controlId: 's' }] }
    const result = computeCourseDistances(short, controls, ocadMap)
    expect(result.legs).toEqual([])
    expect(result.total).toBe(0)
  })
})

describe('resolveCourseLength', () => {
  test('uses computed when no manual length', () => {
    const course = { manualLength: undefined } as unknown as Course
    expect(resolveCourseLength(course, { legs: [], total: 1234 })).toBe(1234)
  })
  test('uses manual length when set', () => {
    const course = { manualLength: 5000 } as unknown as Course
    expect(resolveCourseLength(course, { legs: [], total: 1234 })).toBe(5000)
  })
})
