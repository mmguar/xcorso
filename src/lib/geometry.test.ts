import { describe, test, expect } from 'vitest'
import { distance, polylineLength, clipPolylineStart, clipPolylineEnd, clipPolyline, walkPath } from './geometry'

describe('distance', () => {
  test('zero for same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
  })
  test('horizontal', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3)
  })
  test('3-4-5 triangle', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('polylineLength', () => {
  test('empty and single point', () => {
    expect(polylineLength([])).toBe(0)
    expect(polylineLength([{ x: 1, y: 1 }])).toBe(0)
  })
  test('straight line', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(10)
  })
  test('multi-segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]
    expect(polylineLength(pts)).toBe(7)
  })
})

describe('clipPolylineStart', () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]

  test('clips into first segment', () => {
    const result = clipPolylineStart(line, 3)
    expect(result[0].x).toBeCloseTo(3)
    expect(result[0].y).toBeCloseTo(0)
    expect(result).toHaveLength(3)
  })
  test('clips into second segment', () => {
    const result = clipPolylineStart(line, 12)
    expect(result[0].x).toBeCloseTo(10)
    expect(result[0].y).toBeCloseTo(2)
    expect(result).toHaveLength(2)
  })
  test('clip exceeds total length returns last point', () => {
    const result = clipPolylineStart(line, 100)
    expect(result).toHaveLength(1)
  })
})

describe('clipPolylineEnd', () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]

  test('clips into last segment', () => {
    const result = clipPolylineEnd(line, 3)
    expect(result[result.length - 1].x).toBeCloseTo(10)
    expect(result[result.length - 1].y).toBeCloseTo(7)
  })
})

describe('clipPolyline', () => {
  test('clips both ends', () => {
    const line = [{ x: 0, y: 0 }, { x: 20, y: 0 }]
    const result = clipPolyline(line, 5, 5)
    expect(result).toHaveLength(2)
    expect(result[0].x).toBeCloseTo(5)
    expect(result[1].x).toBeCloseTo(15)
  })
  test('returns empty if over-clipped', () => {
    const line = [{ x: 0, y: 0 }, { x: 2, y: 0 }]
    expect(clipPolyline(line, 3, 3)).toHaveLength(0)
  })
})

describe('walkPath', () => {
  test('single segment produces evenly spaced marks', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    const marks = walkPath(pts, 25)
    expect(marks.length).toBeGreaterThanOrEqual(2)
    for (const m of marks) {
      expect(m.angle).toBeCloseTo(0)
      expect(m.y).toBeCloseTo(0)
    }
  })
  test('fewer than 2 points returns empty', () => {
    expect(walkPath([], 10)).toEqual([])
    expect(walkPath([{ x: 0, y: 0 }], 10)).toEqual([])
  })
})
