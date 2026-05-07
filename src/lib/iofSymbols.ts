/**
 * IOF Control Description symbols (IOF 2018 standard).
 *
 * Each symbol is defined by its IOF code, English name, column (C-H),
 * and SVG path data for rendering. All paths use a -100..100 coordinate
 * system (viewBox "-100 -100 200 200").
 */

export type IofColumn = 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

export interface SymbolDef {
  code: string
  name: string
  column: IofColumn
  /** SVG elements: stroked paths */
  paths?: string[]
  /** SVG elements: filled paths */
  fills?: string[]
  /** Stroked circles: [cx, cy, r][] */
  circles?: [number, number, number][]
  /** Filled circles: [cx, cy, r][] */
  filledCircles?: [number, number, number][]
  /** Stroked lines: [x1, y1, x2, y2][] */
  lines?: [number, number, number, number][]
}

import type { ControlDescription } from '../types'

export const columnFields: Record<IofColumn, keyof ControlDescription> = {
  C: 'whichOfSimilar',
  D: 'feature',
  E: 'appearance',
  F: 'dimensions',
  G: 'location',
  H: 'otherInfo',
}

// ─── Column C: Which of similar features ────────────────────────────

const colC: SymbolDef[] = [
  { code: '0.1N', name: 'Northern', column: 'C',
    lines: [[0, 65, 0, -65]], paths: ['M -30 -35 L 0 -65 L 30 -35'] },
  { code: '0.1E', name: 'Eastern', column: 'C',
    lines: [[-65, 0, 65, 0]], paths: ['M 35 -30 L 65 0 L 35 30'] },
  { code: '0.1S', name: 'Southern', column: 'C',
    lines: [[0, -65, 0, 65]], paths: ['M -30 35 L 0 65 L 30 35'] },
  { code: '0.1W', name: 'Western', column: 'C',
    lines: [[65, 0, -65, 0]], paths: ['M -35 -30 L -65 0 L -35 30'] },
  { code: '0.2NE', name: 'North-eastern', column: 'C',
    lines: [[-46, 46, 46, -46]], paths: ['M 18 -56 L 46 -46 L 56 -18'] },
  { code: '0.2SE', name: 'South-eastern', column: 'C',
    lines: [[-46, -46, 46, 46]], paths: ['M 56 18 L 46 46 L 18 56'] },
  { code: '0.2SW', name: 'South-western', column: 'C',
    lines: [[46, -46, -46, 46]], paths: ['M -18 56 L -46 46 L -56 18'] },
  { code: '0.2NW', name: 'North-western', column: 'C',
    lines: [[46, 46, -46, -46]], paths: ['M -56 -18 L -46 -46 L -18 -56'] },
  { code: '0.3', name: 'Upper', column: 'C',
    lines: [[-60, -30, 60, -30], [-60, 30, 60, 30]], filledCircles: [[0, -30, 12]] },
  { code: '0.4', name: 'Lower', column: 'C',
    lines: [[-60, -30, 60, -30], [-60, 30, 60, 30]], filledCircles: [[0, 30, 12]] },
  { code: '0.5', name: 'Middle', column: 'C',
    lines: [[-50, -50, -50, 50], [0, -50, 0, 50], [50, -50, 50, 50]], filledCircles: [[0, 0, 12]] },
]

// ─── Column D: Features ─────────────────────────────────────────────

const colD: SymbolDef[] = [
  // Landforms 1.x
  { code: '1.1', name: 'Terrace', column: 'D',
    paths: ['M -40 -60 C -20 -20, -20 20, -40 60', 'M 40 -60 C 40 -20, 0 0, 40 60'] },
  { code: '1.2', name: 'Spur', column: 'D',
    paths: ['M -40 -60 C -20 -20, -20 20, -40 60', 'M 40 -60 C 40 -20, 0 10, 40 60'] },
  { code: '1.3', name: 'Re-entrant', column: 'D',
    paths: ['M -50 60 C -50 -20, 0 -40, 50 60'] },
  { code: '1.4', name: 'Earth bank', column: 'D',
    paths: ['M -70 0 C -30 -40, 30 -40, 70 0'],
    lines: [[-50, 0, -50, 25], [-17, -15, -17, 15], [17, -15, 17, 15], [50, 0, 50, 25]] },
  { code: '1.5', name: 'Quarry', column: 'D',
    paths: ['M -60 50 L -60 -40 C -20 -60, 20 -60, 60 -40 L 60 50'],
    lines: [[-35, -48, -35, -20], [0, -55, 0, -25], [35, -48, 35, -20]] },
  { code: '1.6', name: 'Earth wall', column: 'D',
    lines: [[-70, 0, 70, 0], [-50, -20, -50, 20], [-17, -20, -17, 20], [17, -20, 17, 20], [50, -20, 50, 20]] },
  { code: '1.7', name: 'Erosion gully', column: 'D',
    paths: ['M -50 55 L 0 -55 L 50 55'] },
  { code: '1.8', name: 'Small erosion gully', column: 'D',
    lines: [[-45, -50, 45, 50], [-55, -40, 35, 60]],
    filledCircles: [[-30, -20, 6], [-15, 0, 6], [0, 20, 6], [-20, -30, 6], [15, 10, 6]] },
  { code: '1.9', name: 'Hill', column: 'D',
    paths: ['M 0 -48 C 41 -48, 75 -27, 75 0 C 75 27, 41 48, 0 48 C -41 48, -75 27, -75 0 C -75 -27, -41 -48, 0 -48'] },
  { code: '1.10', name: 'Knoll', column: 'D',
    filledCircles: [[0, 0, 30]] },
  { code: '1.11', name: 'Saddle', column: 'D',
    paths: ['M -55 -60 C -55 0, -20 30, -20 60', 'M 55 -60 C 55 0, 20 30, 20 60'] },
  { code: '1.12', name: 'Depression', column: 'D',
    paths: ['M 0 -48 C 41 -48, 75 -27, 75 0 C 75 27, 41 48, 0 48 C -41 48, -75 27, -75 0 C -75 -27, -41 -48, 0 -48'],
    lines: [[72, 0, 30, 0], [-72, 0, -30, 0]] },
  { code: '1.13', name: 'Small depression', column: 'D',
    paths: ['M -60 -20 C -20 30, 20 30, 60 -20'] },
  { code: '1.14', name: 'Pit', column: 'D',
    paths: ['M -50 -55 L 0 55 L 50 -55'] },
  { code: '1.15', name: 'Broken ground', column: 'D',
    paths: ['M -45 -15 C -25 10, 5 10, 25 -15', 'M -25 25 C -5 50, 25 50, 45 25', 'M 15 -55 C 35 -30, 55 -30, 70 -45'] },
  { code: '1.16', name: 'Ant hill', column: 'D',
    lines: [[-60, 0, 60, 0], [0, -60, 0, 60], [-42, -42, 42, 42], [-42, 42, 42, -42]] },

  // Rock 2.x
  { code: '2.1', name: 'Cliff', column: 'D',
    paths: ['M -60 -40 L 60 -40 L 60 40 M -60 40 L -60 -40'],
    lines: [[-20, -40, -20, -10], [20, -40, 20, -10]] },
  { code: '2.2', name: 'Rock pillar', column: 'D',
    fills: ['M 0 -65 L 35 65 L -35 65 Z'] },
  { code: '2.3', name: 'Cave', column: 'D',
    paths: ['M 35 -55 L 55 0 L 35 55', 'M -10 -55 L -10 55'] },
  { code: '2.4', name: 'Boulder', column: 'D',
    fills: ['M 0 -50 L 58 50 L -58 50 Z'] },
  { code: '2.5', name: 'Boulder field', column: 'D',
    fills: ['M -45 -20 L -30 -50 L -15 -20 Z', 'M 15 -20 L 30 -50 L 45 -20 Z',
            'M -15 25 L 0 -5 L 15 25 Z', 'M -55 50 L -40 20 L -25 50 Z', 'M 25 50 L 40 20 L 55 50 Z'] },
  { code: '2.6', name: 'Boulder cluster', column: 'D',
    fills: ['M 0 -55 L 50 45 L -50 45 Z'] },
  { code: '2.7', name: 'Stony ground', column: 'D',
    filledCircles: [
      [-60, -60, 5], [-30, -60, 5], [0, -60, 5], [30, -60, 5], [60, -60, 5],
      [-60, -30, 5], [-30, -30, 5], [0, -30, 5], [30, -30, 5], [60, -30, 5],
      [-60, 0, 5], [-30, 0, 5], [0, 0, 5], [30, 0, 5], [60, 0, 5],
      [-60, 30, 5], [-30, 30, 5], [0, 30, 5], [30, 30, 5], [60, 30, 5],
      [-60, 60, 5], [-30, 60, 5], [0, 60, 5], [30, 60, 5], [60, 60, 5],
    ] },
  { code: '2.8', name: 'Bare rock', column: 'D',
    lines: [[0, -70, 0, -25], [0, 25, 0, 70], [-70, 0, -25, 0], [25, 0, 70, 0],
            [-49, -49, -18, -18], [18, 18, 49, 49], [-49, 49, -18, 18], [18, -18, 49, -49]] },
  { code: '2.9', name: 'Narrow passage', column: 'D',
    paths: ['M -55 -50 L -20 -50 L -20 50 L -55 50', 'M 55 -50 L 20 -50 L 20 50 L 55 50'] },
  { code: '2.10', name: 'Trench', column: 'D',
    paths: ['M -70 -20 L -30 -20 L -30 30 L 30 30 L 30 -20 L 70 -20'] },

  // Water 3.x
  { code: '3.1', name: 'Lake', column: 'D',
    paths: ['M 0 -48 C 41 -48, 75 -27, 75 0 C 75 27, 41 48, 0 48 C -41 48, -75 27, -75 0 C -75 -27, -41 -48, 0 -48',
            'M -40 0 C -27 -12, -13 -12, 0 0 C 13 12, 27 12, 40 0'] },
  { code: '3.2', name: 'Pond', column: 'D',
    paths: ['M -60 -10 C -20 40, 20 40, 60 -10',
            'M -35 -35 C -23 -47, -12 -47, 0 -35 C 12 -23, 23 -23, 35 -35'] },
  { code: '3.3', name: 'Water hole', column: 'D',
    paths: ['M -50 -20 L 0 55 L 50 -20',
            'M -30 -45 C -20 -55, 20 -55, 30 -45'] },
  { code: '3.4', name: 'River, stream', column: 'D',
    paths: ['M -55 60 C -45 40, -35 50, -25 30 C -15 10, -5 20, 5 0 C 15 -20, 25 -10, 35 -30 C 45 -50, 55 -40, 55 -60'] },
  { code: '3.5', name: 'Ditch', column: 'D',
    paths: ['M -55 60 C -45 40, -35 50, -25 30 C -15 10, -5 20, 5 0 C 15 -20, 25 -10, 35 -30 C 45 -50, 55 -40, 55 -60'],
    lines: [[-40, 25, -25, 40], [-10, -10, 5, 5], [25, -45, 40, -30]] },
  { code: '3.6', name: 'Narrow marsh', column: 'D',
    filledCircles: [[-40, 40, 7], [-20, 20, 7], [0, 0, 7], [20, -20, 7], [40, -40, 7]] },
  { code: '3.7', name: 'Marsh', column: 'D',
    lines: [[-64, 0, 64, 0], [-48, -32, 48, -32], [-48, 32, 48, 32], [-32, -64, 32, -64], [-32, 64, 32, 64]] },
  { code: '3.8', name: 'Firm ground in marsh', column: 'D',
    lines: [[-64, 0, -20, 0], [20, 0, 64, 0], [-48, -32, -10, -32], [10, -32, 48, -32],
            [-48, 32, -10, 32], [10, 32, 48, 32], [-32, -64, 32, -64], [-32, 64, 32, 64]] },
  { code: '3.9', name: 'Well', column: 'D',
    circles: [[0, -15, 30]],
    paths: ['M -35 40 C -23 28, -12 28, 0 40 C 12 52, 23 52, 35 40'] },
  { code: '3.10', name: 'Spring', column: 'D',
    paths: ['M 30 0 C 30 -40, -30 -40, -30 0 C -30 20, -10 30, 10 50',
            'M 10 50 C 20 40, 30 50, 40 60'] },
  { code: '3.11', name: 'Water tank', column: 'D',
    paths: ['M -45 -10 L -45 50 L 45 50 L 45 -10',
            'M -30 -30 C -20 -42, 20 -42, 30 -30'] },

  // Vegetation 4.x
  { code: '4.1', name: 'Open land', column: 'D',
    paths: ['M 0 -60 L 60 0 L 0 60 L -60 0 Z'] },
  { code: '4.2', name: 'Semi-open land', column: 'D',
    filledCircles: [
      [0, -55, 6], [25, -42, 6], [42, -25, 6], [55, 0, 6], [42, 25, 6], [25, 42, 6],
      [0, 55, 6], [-25, 42, 6], [-42, 25, 6], [-55, 0, 6], [-42, -25, 6], [-25, -42, 6],
    ] },
  { code: '4.3', name: 'Forest corner', column: 'D',
    paths: ['M 0 -60 L 60 0 L 0 60 L -60 0 Z'],
    lines: [[0, 0, 60, 0]] },
  { code: '4.4', name: 'Clearing', column: 'D',
    filledCircles: [
      [0, -45, 5], [22, -39, 5], [39, -22, 5], [45, 0, 5], [39, 22, 5], [22, 39, 5],
      [0, 45, 5], [-22, 39, 5], [-39, 22, 5], [-45, 0, 5], [-39, -22, 5], [-22, -39, 5],
    ] },
  { code: '4.5', name: 'Thicket', column: 'D',
    lines: [[-50, -50, 50, 50], [-50, 0, 50, 0], [-50, 50, 50, -50],
            [0, -50, 0, 50], [50, -50, -50, 50], [50, 50, -50, -50]] },
  { code: '4.6', name: 'Linear thicket', column: 'D',
    circles: [[-35, 35, 12], [0, 0, 12], [35, -35, 12]],
    lines: [[-50, 50, -45, 45], [-25, 25, 10, -10], [25, -25, 50, -50]] },
  { code: '4.7', name: 'Vegetation boundary', column: 'D',
    filledCircles: [[-50, 50, 6], [-37, 37, 6], [-25, 25, 6], [-12, 12, 6], [0, 0, 6],
                    [12, -12, 6], [25, -25, 6], [37, -37, 6], [50, -50, 6]] },
  { code: '4.8', name: 'Copse', column: 'D',
    paths: ['M -50 45 L -25 -45 L 0 15 L 25 -45 L 50 45'] },
  { code: '4.9', name: 'Prominent tree', column: 'D',
    paths: ['M -30 -10 L 0 -55 L 30 -10 Z'],
    lines: [[0, -10, 0, 55]] },
  { code: '4.10', name: 'Tree stump', column: 'D',
    circles: [[0, 0, 35]],
    lines: [[-25, -25, 25, 25], [-25, 25, 25, -25]] },

  // Man-made 5.x
  { code: '5.1', name: 'Road', column: 'D',
    paths: ['M -55 55 L 55 -55'] },
  { code: '5.2', name: 'Track, Path', column: 'D',
    lines: [[-55, 55, -25, 25], [-10, 10, 10, -10], [25, -25, 55, -55]] },
  { code: '5.3', name: 'Ride', column: 'D',
    filledCircles: [
      [-50, 50, 5], [-35, 35, 5], [-20, 20, 5], [-5, 5, 5], [10, -10, 5], [25, -25, 5],
      [-40, 55, 5], [-25, 40, 5], [-10, 25, 5], [5, 10, 5], [20, -5, 5], [35, -20, 5],
    ] },
  { code: '5.4', name: 'Bridge', column: 'D',
    lines: [[-60, 40, -20, 0], [20, 0, 60, -40]],
    paths: ['M -20 -15 L -20 15', 'M 20 -15 L 20 15'] },
  { code: '5.5', name: 'Power line', column: 'D',
    lines: [[-55, 55, 55, -55], [-30, 20, -20, 40], [-30, 40, -20, 20], [0, -10, 10, 10], [0, 10, 10, -10], [30, -40, 40, -20], [30, -20, 40, -40]] },
  { code: '5.6', name: 'Power line pylon', column: 'D',
    lines: [[-55, 55, 55, -55], [-30, 20, -20, 40], [-30, 40, -20, 20], [30, -40, 40, -20], [30, -20, 40, -40]],
    circles: [[0, 0, 15]] },
  { code: '5.7', name: 'Tunnel', column: 'D',
    lines: [[-50, -40, 50, -40], [-50, 40, 50, 40]],
    paths: ['M -30 -50 L -50 -40 L -50 40 L -30 50', 'M 30 -50 L 50 -40 L 50 40 L 30 50'] },
  { code: '5.8', name: 'Stone wall', column: 'D',
    lines: [[-55, 55, 55, -55]],
    filledCircles: [[-35, 35, 8], [0, 0, 8], [35, -35, 8]] },
  { code: '5.9', name: 'Fence', column: 'D',
    lines: [[-55, 55, 55, -55], [-40, 30, -30, 50], [-20, 10, -10, 30], [0, -10, 10, 10], [20, -30, 30, -10]] },
  { code: '5.10', name: 'Crossing point', column: 'D',
    lines: [[-50, -40, 50, -40], [-50, 40, 50, 40]],
    paths: ['M -20 -40 L -40 40', 'M 20 -40 L 40 40'] },
  { code: '5.11', name: 'Building', column: 'D',
    fills: ['M -50 -50 L 50 -50 L 50 50 L -50 50 Z'] },
  { code: '5.12', name: 'Paved area', column: 'D',
    paths: ['M -50 -50 L 50 -50 L 50 50 L -50 50 Z'],
    lines: [[-50, -20, -20, -50], [-50, 15, 15, -50], [-50, 50, 50, -50], [-15, 50, 50, -15], [20, 50, 50, 20]] },
  { code: '5.13', name: 'Ruin', column: 'D',
    lines: [[-50, -50, -25, -50], [-50, -50, -50, -25],
            [50, -50, 25, -50], [50, -50, 50, -25],
            [-50, 50, -25, 50], [-50, 50, -50, 25],
            [50, 50, 25, 50], [50, 50, 50, 25]] },
  { code: '5.14', name: 'Pipeline', column: 'D',
    lines: [[-55, 55, 55, -55]],
    paths: ['M -30 25 L -25 35 L -20 30', 'M 0 -5 L 5 5 L 10 0', 'M 25 -30 L 30 -20 L 35 -25'] },
  { code: '5.15', name: 'Tower', column: 'D',
    lines: [[0, -30, 0, 50], [-30, -30, 30, -30]] },
  { code: '5.16', name: 'Shooting platform', column: 'D',
    lines: [[-30, -30, -30, 50], [-30, -30, 30, -30]] },
  { code: '5.17', name: 'Boundary stone, Cairn', column: 'D',
    circles: [[0, 0, 50]], filledCircles: [[0, 0, 10]] },
  { code: '5.18', name: 'Fodder rack', column: 'D',
    lines: [[0, -60, 0, 40], [-25, 40, 25, 40]],
    paths: ['M -15 -60 L 0 -75 L 15 -60'] },
  { code: '5.19', name: 'Charcoal burning ground', column: 'D',
    circles: [[0, 0, 50]],
    paths: ['M 0 -28 L 25 14 L -25 14 Z'] },
  { code: '5.20', name: 'Monument or statue', column: 'D',
    paths: ['M -40 50 L 0 -50 L 40 50'],
    lines: [[-50, 50, 50, 50]] },
  { code: '5.23', name: 'Building pass-through', column: 'D',
    lines: [[-50, -50, 50, -50], [-50, -50, -50, 50], [50, -50, 50, 50]] },
  { code: '5.24', name: 'Stairway', column: 'D',
    paths: ['M -50 50 L -50 20 L -20 20 L -20 -10 L 10 -10 L 10 -40 L 50 -40'] },
  { code: '5.25', name: 'Flower bed', column: 'D',
    paths: ['M -50 -50 L 50 -50 L 50 50 L -50 50 Z',
            'M 0 -30 C 15 -25, 25 -15, 30 0 C 25 15, 15 25, 0 30 C -15 25, -25 15, -30 0 C -25 -15, -15 -25, 0 -30'],
    filledCircles: [[0, 0, 6]] },
  { code: '5.26', name: 'Railway', column: 'D',
    lines: [[-55, 45, 55, -45], [-55, 55, 55, -35],
            [-40, 40, -30, 50], [-15, 15, -5, 25], [10, -10, 20, 0], [35, -35, 45, -25]] },

  // Special 6.x
  { code: '6.1', name: 'Special item (X)', column: 'D',
    lines: [[-50, -50, 50, 50], [-50, 50, 50, -50]] },
  { code: '6.2', name: 'Special item (O)', column: 'D',
    circles: [[0, 0, 50]] },
]

// ─── Column E: Appearance ───────────────────────────────────────────

const colE: SymbolDef[] = [
  { code: '8.1', name: 'Low', column: 'E',
    paths: ['M -70 10 C -30 -20, 30 -20, 70 10'] },
  { code: '8.2', name: 'Shallow', column: 'E',
    paths: ['M -70 0 C -30 40, 30 40, 70 0'] },
  { code: '8.3', name: 'Deep', column: 'E',
    paths: ['M -55 -45 L -55 40 C -20 60, 20 60, 55 40 L 55 -45'] },
  { code: '8.4', name: 'Overgrown', column: 'E',
    lines: [[-55, -50, 55, -50], [-55, -17, 55, -17], [-55, 17, 55, 17], [-55, 50, 55, 50],
            [-50, -55, -50, 55], [-17, -55, -17, 55], [17, -55, 17, 55], [50, -55, 50, 55]] },
  { code: '8.5', name: 'Open', column: 'E',
    filledCircles: [
      [-40, -55, 5], [0, -55, 5], [40, -55, 5],
      [-40, -18, 5], [0, -18, 5], [40, -18, 5],
      [-40, 18, 5], [0, 18, 5], [40, 18, 5],
      [-40, 55, 5], [0, 55, 5], [40, 55, 5],
    ] },
  { code: '8.6', name: 'Rocky, stony', column: 'E',
    fills: ['M -40 20 L -20 -20 L 0 20 Z', 'M 0 20 L 20 -20 L 40 20 Z', 'M -20 60 L 0 20 L 20 60 Z'] },
  { code: '8.7', name: 'Marshy', column: 'E',
    lines: [[-45, -30, 45, -30], [-45, 0, 45, 0], [-45, 30, 45, 30]] },
  { code: '8.8', name: 'Sandy', column: 'E',
    filledCircles: [
      [-60, -50, 3], [-20, -60, 3], [30, -55, 3], [55, -40, 3], [-45, -30, 3],
      [5, -35, 3], [45, -15, 3], [-60, -5, 3], [-25, 0, 3], [15, -5, 3],
      [-50, 25, 3], [-10, 20, 3], [40, 15, 3], [60, 30, 3], [-35, 45, 3],
      [10, 40, 3], [50, 50, 3], [-55, 60, 3], [-15, 55, 3], [25, 60, 3],
    ] },
  { code: '8.9', name: 'Needle-leaved', column: 'E',
    fills: ['M -30 30 L 0 -55 L 30 30 Z'],
    lines: [[0, 30, 0, 60]] },
  { code: '8.10', name: 'Broad-leaved', column: 'E',
    paths: ['M 0 -50 C 20 -55, 45 -35, 35 -15 C 55 -5, 50 25, 30 25 C 25 45, 5 50, 0 40 C -5 50, -25 45, -30 25 C -50 25, -55 -5, -35 -15 C -45 -35, -20 -55, 0 -50'],
    lines: [[0, 40, 0, 60]] },
  { code: '8.11', name: 'Ruined', column: 'E',
    lines: [[-55, 40, -55, -30], [-55, -30, 40, -30]],
    paths: ['M -55 40 C -20 20, 10 -10, 40 -30'] },
]

// ─── Column F: Dimensions/Combinations ──────────────────────────────

const colF: SymbolDef[] = [
  { code: '10.1', name: 'Crossing', column: 'F',
    lines: [[-50, -50, 50, 50], [-50, 50, 50, -50]] },
  { code: '10.2', name: 'Junction', column: 'F',
    lines: [[-45, 50, 0, -10], [0, -10, 45, -50], [0, -10, 0, 50]] },
  { code: '11.7', name: 'Bend', column: 'F',
    paths: ['M 50 -50 L -20 0 L 50 50'] },
]

// ─── Column G: Location ─────────────────────────────────────────────

function makeSideSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number][] = [
    ['N', 'North', 0, -65], ['NE', 'North-east', 46, -46], ['E', 'East', 65, 0],
    ['SE', 'South-east', 46, 46], ['S', 'South', 0, 65], ['SW', 'South-west', -46, 46],
    ['W', 'West', -65, 0], ['NW', 'North-west', -46, -46],
  ]
  return dirs.map(([d, name, dx, dy]) => ({
    code: `11.1${d}`, name: `${name} side`, column: 'G' as IofColumn,
    circles: [[0, dy > 0 ? -20 : dy < 0 ? 20 : 0, 55] as [number, number, number]],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

function makeEdgeSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number][] = [
    ['N', 'North', 0, -65], ['NE', 'North-east', 30, -55], ['E', 'East', 40, 0],
    ['SE', 'South-east', 30, 55], ['S', 'South', 0, 65], ['SW', 'South-west', -30, 55],
    ['W', 'West', -40, 0], ['NW', 'North-west', -30, -55],
  ]
  return dirs.map(([d, name, dx, dy]) => ({
    code: `11.2${d}`, name: `${name} edge`, column: 'G' as IofColumn,
    lines: [[-10, -60, -10, 60], [10, -60, 10, 60]] as [number, number, number, number][],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

function makePartSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number][] = [
    ['N', 'North', 0, -45], ['NE', 'North-east', 40, -35], ['E', 'East', 50, 0],
    ['SE', 'South-east', 40, 35], ['S', 'South', 0, 45], ['SW', 'South-west', -40, 35],
    ['W', 'West', -50, 0], ['NW', 'North-west', -40, -35],
  ]
  return dirs.map(([d, name, dx, dy]) => ({
    code: `11.3${d}`, name: `${name} part`, column: 'G' as IofColumn,
    paths: ['M -55 -30 L 55 -30 L 55 30 L -55 30 Z'],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

function makeCornerInsideSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number, string][] = [
    ['N', 'North', 0, -25, 'M -50 20 L 0 20 L 0 70'],
    ['NE', 'North-east', 30, -20, 'M -50 30 L 10 30 L 10 -70'],
    ['E', 'East', 30, 0, 'M -20 -50 L -20 0 L 60 0'],
    ['SE', 'South-east', 30, 25, 'M 10 -50 L 10 -10 L -60 -10'],
    ['S', 'South', 0, 25, 'M 0 -50 L 0 0 L 50, 0'],
    ['SW', 'South-west', -30, 25, 'M 60 -10 L -10 -10 L -10 -60'],
    ['W', 'West', -30, 0, 'M 20 -50 L 20 0 L -60 0'],
    ['NW', 'North-west', -30, -20, 'M 50 30 L -10 30 L -10 -60'],
  ]
  return dirs.map(([d, name, dx, dy, path]) => ({
    code: `11.4${d}`, name: `${name} corner (inside)`, column: 'G' as IofColumn,
    paths: [path],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

function makeCornerOutsideSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number, string][] = [
    ['N', 'North', 0, -55, 'M -50 20 L 0 20 L 0 70'],
    ['NE', 'North-east', 40, -40, 'M -50 30 L 10 30 L 10 -70'],
    ['E', 'East', 55, 0, 'M -20 -50 L -20 0 L 60 0'],
    ['SE', 'South-east', 40, 40, 'M 10 -50 L 10 -10 L -60 -10'],
    ['S', 'South', 0, 55, 'M 0 -50 L 0 0 L 50 0'],
    ['SW', 'South-west', -40, 40, 'M 60 -10 L -10 -10 L -10 -60'],
    ['W', 'West', -55, 0, 'M 20 -50 L 20 0 L -60 0'],
    ['NW', 'North-west', -40, -40, 'M 50 30 L -10 30 L -10 -60'],
  ]
  return dirs.map(([d, name, dx, dy, path]) => ({
    code: `11.5${d}`, name: `${name} corner (outside)`, column: 'G' as IofColumn,
    paths: [path],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

function makeTipSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number, string][] = [
    ['N', 'North', 0, -55, 'M -40 50 L 0 -30 L 40 50'],
    ['NE', 'North-east', 35, -45, 'M -50 10 L 15 -20 L -10 50'],
    ['E', 'East', 55, 0, 'M -50 -35 L 30 0 L -50 35'],
    ['SE', 'South-east', 35, 45, 'M 10 -50 L 15 20 L -50 -10'],
    ['S', 'South', 0, 55, 'M -40 -50 L 0 30 L 40 -50'],
    ['SW', 'South-west', -35, 45, 'M 50 -10 L -15 20 L 10 -50'],
    ['W', 'West', -55, 0, 'M 50 -35 L -30 0 L 50 35'],
    ['NW', 'North-west', -35, -45, 'M -10 50 L -15 -20 L 50 10'],
  ]
  return dirs.map(([d, name, dx, dy, path]) => ({
    code: `11.6${d}`, name: `${name} tip`, column: 'G' as IofColumn,
    paths: [path],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

function makeEndSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number, string, string][] = [
    ['N', 'North', 0, 0, 'M 0 60 L 0 -40', 'M -30 -40 L 30 -40'],
    ['NE', 'North-east', 0, 0, 'M -35 40 L 35 -40', 'M 15 -55 L 55 -15'],
    ['E', 'East', 0, 0, 'M -60 0 L 40 0', 'M 40 -30 L 40 30'],
    ['SE', 'South-east', 0, 0, 'M -35 -40 L 35 40', 'M 15 55 L 55 15'],
    ['S', 'South', 0, 0, 'M 0 -60 L 0 40', 'M -30 40 L 30 40'],
    ['SW', 'South-west', 0, 0, 'M 35 -40 L -35 40', 'M -55 15 L -15 55'],
    ['W', 'West', 0, 0, 'M 60 0 L -40 0', 'M -40 -30 L -40 30'],
    ['NW', 'North-west', 0, 0, 'M 35 40 L -35 -40', 'M -55 -15 L -15 -55'],
  ]
  return dirs.map(([d, name, _dx, _dy, path1, path2]) => ({
    code: `11.8${d}`, name: `${name} end`, column: 'G' as IofColumn,
    paths: [path1, path2],
  }))
}

function makeFootSymbols(): SymbolDef[] {
  const dirs: [string, string, number, number][] = [
    ['N', 'North', 0, -50], ['NE', 'North-east', 35, -35], ['E', 'East', 50, 0],
    ['SE', 'South-east', 35, 35], ['S', 'South', 0, 50], ['SW', 'South-west', -35, 35],
    ['W', 'West', -50, 0], ['NW', 'North-west', -35, -35],
  ]
  return dirs.map(([d, name, dx, dy]) => ({
    code: `11.14${d}`, name: `${name} foot`, column: 'G' as IofColumn,
    lines: [[0, -60, 0, 60], [-40, 60, 40, 60]] as [number, number, number, number][],
    filledCircles: [[dx, dy, 12] as [number, number, number]],
  }))
}

const colG: SymbolDef[] = [
  ...makeSideSymbols(),
  ...makeEdgeSymbols(),
  ...makePartSymbols(),
  ...makeCornerInsideSymbols(),
  ...makeCornerOutsideSymbols(),
  ...makeTipSymbols(),
  ...makeEndSymbols(),
  { code: '11.9', name: 'Upper part', column: 'G',
    lines: [[-15, -60, -15, 60], [15, -60, 15, 60]], filledCircles: [[0, -35, 12]] },
  { code: '11.10', name: 'Lower part', column: 'G',
    lines: [[-15, -60, -15, 60], [15, -60, 15, 60]], filledCircles: [[0, 35, 12]] },
  { code: '11.11', name: 'Top', column: 'G',
    paths: ['M -40 50 L -40 -30 L 40 -30 L 40 50'], filledCircles: [[0, -55, 12]] },
  { code: '11.12', name: 'Beneath', column: 'G',
    paths: ['M -40 -50 L -40 30 L 40 30 L 40 -50'], filledCircles: [[0, 55, 12]] },
  { code: '11.13', name: 'Foot', column: 'G',
    lines: [[0, -60, 0, 60], [-40, 60, 40, 60]], filledCircles: [[0, 50, 12]] },
  ...makeFootSymbols(),
  { code: '11.15', name: 'Between', column: 'G',
    lines: [[-60, -25, 60, -25], [-60, 25, 60, 25]], filledCircles: [[0, 0, 12]] },
]

// ─── Column H: Other information ────────────────────────────────────

const colH: SymbolDef[] = [
  { code: '12.1', name: 'First aid post', column: 'H',
    fills: ['M -20 -60 L 20 -60 L 20 -20 L 60 -20 L 60 20 L 20 20 L 20 60 L -20 60 L -20 20 L -60 20 L -60 -20 L -20 -20 Z'] },
  { code: '12.2', name: 'Refreshment point', column: 'H',
    paths: ['M -35 -55 L -15 30 L 15 30 L 35 -55', 'M -15 30 C -15 50, 15 50, 15 30'],
    lines: [[-20, -55, 20, -55]] },
  { code: '12.4', name: 'Manned control', column: 'H',
    paths: ['M -30 50 L 0 -10 L 30 50'],
    lines: [[0, -10, 0, -40], [-25, -45, 0, -25], [0, -25, 25, -45]], filledCircles: [[0, -55, 10]] },
]

// ─── Combined catalog ───────────────────────────────────────────────

export const allSymbols: SymbolDef[] = [
  ...colC, ...colD, ...colE, ...colF, ...colG, ...colH,
]

const symbolMap = new Map(allSymbols.map(s => [s.code, s]))

export function getSymbol(code: string): SymbolDef | undefined {
  return symbolMap.get(code)
}

export function getColumnSymbols(column: IofColumn): SymbolDef[] {
  return allSymbols.filter(s => s.column === column)
}

export const columns: { id: IofColumn; label: string }[] = [
  { id: 'C', label: 'Which' },
  { id: 'D', label: 'Feature' },
  { id: 'E', label: 'Appearance' },
  { id: 'F', label: 'Comb.' },
  { id: 'G', label: 'Location' },
  { id: 'H', label: 'Other' },
]
