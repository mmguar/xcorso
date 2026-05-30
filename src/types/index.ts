// ─── Coordinates ────────────────────────────────────────────────────────────
// Map-native coordinates.
// OCAD: world units (1/100 mm on paper at given scale)
// Bitmap: pixels
// PDF: PDF user-space points

export interface MapPoint {
  x: number
  y: number
}

// ─── Map ────────────────────────────────────────────────────────────────────

export type EventSpec = 'isom-2017' | 'issprm-2019'

export type MapType = 'ocad' | 'pdf' | 'bitmap'

export type MapStorage =
  | { mode: 'embedded' }               // file lives at map/<filename> in ZIP
  | { mode: 'reference'; path: string }

export interface ScaleMeasurement {
  p1: MapPoint
  p2: MapPoint
  realWorldMeters: number
}

export interface MapGeoref {
  easting: number
  northing: number
  utmZone: number
  hemisphere: 'N' | 'S'
  angleDeg: number  // OCAD ScalePar 'a' — paper rotation from grid north, in degrees
}

export interface MapConfig {
  type: MapType
  filename: string
  storage: MapStorage
  scale: number                        // denominator: 10000 → 1:10000
  /** Native map width in map units (matches LoadedMap.bounds.width). */
  width: number
  /** Native map height in map units (matches LoadedMap.bounds.height). */
  height: number
  /** ViewBox origin X in map units (matches LoadedMap.bounds.minX). 0 for bitmap/PDF. */
  originX?: number
  /** ViewBox origin Y in map units (matches LoadedMap.bounds.minY). 0 for bitmap/PDF. */
  originY?: number
  georef?: MapGeoref
  scaleSource: 'ocad' | 'manual'
  scaleMeasurement?: ScaleMeasurement  // present when scaleSource === 'manual'
}

// ─── Controls ───────────────────────────────────────────────────────────────

export type ControlType = 'start' | 'finish' | 'control'

// IOF description columns — model ready, UI deferred to Phase 3
export interface ControlDescription {
  whichOfSimilar?: string   // col C
  feature?: string          // col D
  appearance?: string       // col E
  dimensions?: string       // col F
  location?: string         // col G
  otherInfo?: string        // col H
}

export interface CircleGap {
  startAngle: number         // degrees, 0 = right, clockwise
  endAngle: number
}

export interface Control {
  id: string
  type: ControlType
  code: number               // control unit number (e.g. 31, 32, 33)
  label?: string             // custom display label (e.g. "S1", "Start A"); defaults to S{code}/F{code}/{code}
  points?: number            // point value for Score-O
  position: MapPoint
  description?: ControlDescription
  gaps?: CircleGap[]         // angular gaps in the control circle/triangle/finish
}

// ─── Courses ────────────────────────────────────────────────────────────────

export type CourseType = 'linear' | 'score'

export type FinishType = 'taped' | 'funnel' | 'navigate'

export interface LegGap {
  start: number              // normalized position along leg (0–1)
  end: number
}

export interface CourseControl {
  id: string                 // UUID — unique per course-control instance (allows reuse)
  controlId: string          // references Control.id
  scorePoints?: number       // score-O only
  legGaps?: LegGap[]         // gaps on the leg leading TO this control
  legBendPoints?: MapPoint[] // intermediate waypoints on the leg leading TO this control
  labelOffset?: MapPoint     // offset from control center to label anchor, in map units
  exchangeMode?: 'exchange' | 'flip'
}

// ─── Loops & Variations ────────────────────────────────────────────────────

export interface CourseLoop {
  id: string
  forkControlId: string      // references Control.id — must appear ≥ N+1 times for N branches
  branchNames: string[]      // label per branch in master order, e.g. ["A", "B", "C"]
}

export interface BranchPermutation {
  loopId: string             // references CourseLoop.id
  order: number[]            // indices into branchNames, e.g. [1, 0, 2] for "BAC"
}

export interface CourseVariation {
  id: string
  name: string               // e.g. "BAC" — auto-generated or user-set
  loopOrders: BranchPermutation[]
}

// ─── Course ────────────────────────────────────────────────────────────────

export interface Course {
  id: string
  name: string
  type: CourseType
  spec?: EventSpec           // per-course override (falls back to project.spec)
  controls: CourseControl[]  // ordered for linear; unordered for score
  scoreTimeLimit?: number    // minutes, score-O only
  climb?: number             // metres, manually set
  finishType?: FinishType    // IOF 16.1/16.2/16.3 — defaults to 'taped'
  color: string              // overprint color, default '#a626ff' (CMYK 35/85/0/0)
  showPoints?: boolean       // display [points] next to controls on map
  loops?: CourseLoop[]
  variations?: CourseVariation[]
  textDescriptions?: boolean
  layout?: CourseLayout
}

// ─── Classes ────────────────────────────────────────────────────────────────

export interface RaceClass {
  id: string
  name: string
  courseId: string              // references Course.id
}

// ─── Annotations ────────────────────────────────────────────────────────────

export type AnnotationType = 'forbidden_route' | 'crossing_point' | 'out_of_bounds' | 'north_arrow'

export interface Annotation {
  id: string
  type: AnnotationType
  points: MapPoint[]         // polyline for routes/bounds; single point for crossing_point/north_arrow
  rotation?: number          // degrees, for crossing_point
  scale?: number             // size multiplier, for north_arrow (default 1)
  elongation?: number        // extra half-height in mm, for crossing_point (default 0)
  color?: string             // fill color (north_arrow)
  textColor?: string         // text color (north_arrow, default white)
}

// ─── Course Layout ─────────────────────────────────────────────────────────

export type PageSizeKey = 'a4' | 'a3' | 'letter' | 'legal'

export type DescMode = 'none' | 'separate' | 'on-map' | 'both'

export interface LayoutElementPosition {
  x: number              // mm from page top-left
  y: number
  visible: boolean
}

export interface LayoutDefaults {
  pageSize: PageSizeKey
  orientation: 'portrait' | 'landscape'
  printScale: number
  mapOpacity: number
  mapRendering: 'vector' | 'raster'
  rasterDpi: number
  mapBorder?: MapBorder
}

export interface MapBorder {
  color: string
  strokeWidth: number  // mm on paper
  x: number            // mm from page left
  y: number            // mm from page top
  width: number        // mm
  height: number       // mm
}

export interface CourseLayout {
  pageSize: PageSizeKey
  orientation: 'portrait' | 'landscape'
  printScale: number
  mapCenter: MapPoint
  clueSheet: LayoutElementPosition
  clueSheetBreaks?: number[]
  clueSheetParts?: LayoutElementPosition[]
  overlayPositions?: Record<string, MapPoint>
  included?: boolean
  descMode?: DescMode
  tiling?: boolean
  mapBorder?: MapBorder
}

// ─── Overlays ───────────────────────────────────────────────────────────────

export interface ScaleBar {
  id: string
  position: MapPoint         // top-left corner in map coordinates
  segments: number           // number of segments (e.g. 3)
  segmentLengthM: number     // real-world length per segment in metres (e.g. 100)
  bgAlpha: number            // 0 = transparent, 1 = opaque white
  scale: number              // scale for the bar
}

export interface TextLabel {
  id: string
  position: MapPoint         // anchor point in map coordinates
  text: string
  fontSizeMm: number         // font size in mm on paper (e.g. 3)
  color: string              // hex color
  bgAlpha: number            // 0 = transparent, 1 = opaque white
}

export interface ImageOverlay {
  id: string
  position: MapPoint         // top-left corner in map coordinates
  widthMm: number            // width in mm on paper
  heightMm: number           // height in mm on paper
  dataUrl: string            // base64 data URL
  filename: string           // original filename for display
  bgAlpha: number            // 0 = transparent, 1 = opaque white
}

// ─── Project ────────────────────────────────────────────────────────────────

export interface ProjectMeta {
  name: string
  createdAt: string          // ISO 8601
  updatedAt: string
}

export interface Project {
  version: '1.0'
  meta: ProjectMeta
  spec?: EventSpec
  map: MapConfig
  controls: Control[]
  courses: Course[]
  classes: RaceClass[]
  annotations: Annotation[]
  scaleBars: ScaleBar[]
  textLabels: TextLabel[]
  imageOverlays: ImageOverlay[]
  layoutDefaults?: LayoutDefaults
  /** Overprint level for course/annotation ink: 0 = solid knockout, 1 = full multiply overprint. Default 1. */
  overprint?: number
}

// ─── Appearance ──────────���──────────────────────���───────────────────────────

export interface AppearanceSettings {
  controlScale: number       // multiplier for control symbol size (1 = standard)
  lineWidth: number          // multiplier for stroke width (1 = standard 0.35mm)
  color: string              // override color (empty = use course/default color)
  outlineEnabled: boolean
  outlineColor: string
  outlineWidth: number       // mm on paper
}

// ─── Editor UI ──────────────────────────────────────────────────────────────

export type ActiveTool =
  | 'select'
  | 'place-start'
  | 'place-finish'
  | 'place-control'
  | 'forbidden-route'
  | 'crossing-point'
  | 'out-of-bounds'
  | 'measure-scale'
  | 'delete'
  | 'gap'
  | 'bend'
  | 'place-north-arrow'
  | 'place-scalebar'
  | 'place-text'
  | 'place-image'

export interface Viewport {
  x: number       // pan offset x (screen px)
  y: number       // pan offset y (screen px)
  scale: number   // zoom level (1.0 = fit-to-screen)
}

// ─── Computed ───────────────────────────────────────────────────────────────

// Distance in metres between two map points, given scale denominator and map type.
// Returned per-leg and total.
export interface CourseDistances {
  legs: number[]   // metres per leg
  total: number    // metres total
}
