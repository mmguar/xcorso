import { describe, test, expect } from 'vitest'
import { controlsById, defaultControlLabel, buildSequenceMap, formatSequenceLabel, computeSubmaps } from './courseUtils'
import type { Control, Course, CourseControl } from '../types'

function ctrl(id: string, type: 'start' | 'finish' | 'control', code: number): Control {
  return { id, type, code, position: { x: 0, y: 0 } }
}

function cc(id: string, controlId: string, exchange?: 'exchange' | 'flip'): CourseControl {
  return { id, controlId, ...(exchange ? { exchangeMode: exchange } : {}) }
}

describe('controlsById', () => {
  test('builds map by id', () => {
    const controls = [ctrl('a', 'start', 1), ctrl('b', 'control', 31)]
    const map = controlsById(controls)
    expect(map.get('a')?.code).toBe(1)
    expect(map.get('b')?.type).toBe('control')
    expect(map.size).toBe(2)
  })
})

describe('defaultControlLabel', () => {
  test('uses custom label if set', () => {
    expect(defaultControlLabel({ type: 'control', code: 31, label: 'X' })).toBe('X')
  })
  test('start prefixed with S', () => {
    expect(defaultControlLabel({ type: 'start', code: 1 })).toBe('S1')
  })
  test('finish prefixed with F', () => {
    expect(defaultControlLabel({ type: 'finish', code: 1 })).toBe('F1')
  })
  test('control is just the code', () => {
    expect(defaultControlLabel({ type: 'control', code: 42 })).toBe('42')
  })
})

describe('buildSequenceMap', () => {
  const controls = [ctrl('s', 'start', 1), ctrl('c1', 'control', 31), ctrl('c2', 'control', 32), ctrl('f', 'finish', 1)]
  const course: Course = {
    id: 't', name: 'T', type: 'linear', color: '#f00',
    controls: [cc('1', 's'), cc('2', 'c1'), cc('3', 'c2'), cc('4', 'f')],
  }

  test('assigns sequential numbers to controls only', () => {
    const map = buildSequenceMap(course, controls)
    expect(map.get('c1')).toEqual([1])
    expect(map.get('c2')).toEqual([2])
    expect(map.has('s')).toBe(false)
    expect(map.has('f')).toBe(false)
  })

  test('repeated control gets multiple sequences', () => {
    const course2: Course = {
      id: 't', name: 'T', type: 'linear', color: '#f00',
      controls: [cc('1', 's'), cc('2', 'c1'), cc('3', 'c2'), cc('4', 'c1'), cc('5', 'f')],
    }
    const map = buildSequenceMap(course2, controls)
    expect(map.get('c1')).toEqual([1, 3])
  })
})

describe('formatSequenceLabel', () => {
  test('single', () => expect(formatSequenceLabel([1])).toBe('1'))
  test('multi', () => expect(formatSequenceLabel([1, 3])).toBe('1/3'))
})

describe('computeSubmaps', () => {
  test('no exchanges → single submap', () => {
    const course: Course = {
      id: 't', name: 'T', type: 'linear', color: '#f00',
      controls: [cc('1', 's'), cc('2', 'c1'), cc('3', 'f')],
    }
    const result = computeSubmaps(course)
    expect(result).toHaveLength(1)
    expect(result[0].controls).toHaveLength(3)
  })

  test('one exchange → two submaps sharing the exchange control', () => {
    const course: Course = {
      id: 't', name: 'T', type: 'linear', color: '#f00',
      controls: [cc('1', 's'), cc('2', 'c1', 'exchange'), cc('3', 'c2'), cc('4', 'f')],
    }
    const result = computeSubmaps(course)
    expect(result).toHaveLength(2)
    expect(result[0].controls).toHaveLength(2)  // s, c1(exchange)
    expect(result[1].controls).toHaveLength(3)  // c1(exchange), c2, f
  })
})
