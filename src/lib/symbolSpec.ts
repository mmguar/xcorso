import type { EventSpec, ControlType, MapPoint } from '../types'
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

export const SPEC_LABEL_KEYS: Record<EventSpec, string> = {
  'isom-2017': 'spec.isom-2017',
  'issprm-2019': 'spec.issprm-2019',
}

export function getSymbolDims(spec: EventSpec): SymbolDims {
  return SPECS[spec]
}

export function symbolScaleFactor(spec: EventSpec, printScale: number): number {
  return SPECS[spec].baseScale / printScale
}

// Bounding circumradius of a control symbol in spec mm (before upm / scaleFactor).
// Single source of truth for hit-testing and PDF clipping radii — keep in sync with
// the shapes drawn in ControlsLayer.tsx / pdfExport.ts.
export function controlSymbolRadiusMm(type: ControlType, dims: SymbolDims): number {
  if (type === 'start') return dims.startSide * Math.sqrt(3) / 2 * (2 / 3)
  if (type === 'finish') return dims.finishROuter
  return dims.controlR
}

// Default offset of a control's code label from the symbol centre. `scale` is the
// multiplier already applied to the symbol dimensions (upm*controlScale*sf on the
// canvas, sf for the PDF where 1 unit = 1 mm). Single source of truth for the label
// placement in ControlsLayer, pdfExport, and hit-testing — keep call sites passing
// the matching scale.
export function symbolLabelOffset(type: ControlType, dims: SymbolDims, scale: number): MapPoint {
  if (type === 'start') {
    const side = dims.startSide * scale
    return { x: (side / 2) * 1.1, y: -(side * Math.sqrt(3) / 2) * 0.4 }
  }
  if (type === 'finish') {
    const r = dims.finishROuter * scale
    return { x: r * 1.3, y: -r * 1.1 }
  }
  const cr = dims.controlR * scale
  return { x: cr * 1.1, y: -cr * 1.1 }
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
  northArrowH: number
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
    northArrowH: 8.0  * scaleFactor,
  }
}
