import type { EventSpec } from '../types'
export type { EventSpec }

export interface SymbolDims {
  baseScale: number
  controlR: number
  startSide: number
  finishROuter: number
  finishRInner: number
  strokeW: number
  legW: number
}

const ISOM_2017: SymbolDims = {
  baseScale: 15000,
  controlR: 2.5,
  startSide: 6.0,
  finishROuter: 2.5,
  finishRInner: 1.75,
  strokeW: 0.35,
  legW: 0.35,
}

const ISSPRM_2019: SymbolDims = {
  baseScale: 4000,
  controlR: 3.0,
  startSide: 7.0,
  finishROuter: 3.5,
  finishRInner: 2.5,
  strokeW: 0.35,
  legW: 0.35,
}

const SPECS: Record<EventSpec, SymbolDims> = {
  'isom-2017': ISOM_2017,
  'issprm-2019': ISSPRM_2019,
}

export const SPEC_LABELS: Record<EventSpec, string> = {
  'isom-2017': 'Regular (ISOM 2017-2)',
  'issprm-2019': 'Sprint (ISSprOM 2019-2)',
}

export function getSymbolDims(spec: EventSpec): SymbolDims {
  return SPECS[spec]
}

export function symbolScaleFactor(spec: EventSpec, printScale: number): number {
  return SPECS[spec].baseScale / printScale
}

export function resolveSpec(projectSpec?: EventSpec, courseSpec?: EventSpec): EventSpec {
  return courseSpec ?? projectSpec ?? 'isom-2017'
}

export const MM_TO_PT = 72 / 25.4

export interface AnnotationDims {
  routeLineW: number
  routeXArm: number
  routeXW: number
  routeXSpace: number
  crossW: number
  crossHalf: number
  crossH: number
  crossGap: number
  hatchSpace: number
  hatchW: number
  boundaryW: number
}

export function getAnnotationDims(scaleFactor: number): AnnotationDims {
  return {
    routeLineW:  0.35 * scaleFactor,
    routeXArm:   1.5  * scaleFactor,
    routeXW:     0.35 * scaleFactor,
    routeXSpace: 5.0  * scaleFactor,
    crossW:      0.2  * scaleFactor,
    crossHalf:   1.0  * scaleFactor,
    crossH:      1.5  * scaleFactor,
    crossGap:    0.6  * scaleFactor,
    hatchSpace:  1.2  * scaleFactor,
    hatchW:      0.2  * scaleFactor,
    boundaryW:   0.7  * scaleFactor,
  }
}
