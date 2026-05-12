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

export type MapType = 'ocad' | 'pdf' | 'bitmap'

export type MapStorage =
  | { mode: 'embedded' }               // file lives at map/<filename> in ZIP
  | { mode: 'reference'; path: string }

export interface ScaleMeasurement {
  p1: MapPoint
  p2: MapPoint
  realWorldMeters: number
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
  // Phase 3 placeholder:
  // branchId?: string
}

export interface Course {
  id: string
  name: string
  type: CourseType
  controls: CourseControl[]  // ordered for linear; unordered for score
  scoreTimeLimit?: number    // minutes, score-O only
  climb?: number             // metres, manually set
  color: string              // overprint color, default '#7B2FBE'
  showPoints?: boolean       // display [points] next to controls on map
  // Phase 3 placeholder:
  // variations?: CourseVariation[]
}

// ─── Classes ────────────────────────────────────────────────────────────────

export interface RaceClass {
  id: string
  name: string
  courseId: string              // references Course.id
}

// ─── Annotations ────────────────────────────────────────────────────────────

export type AnnotationType = 'forbidden_route' | 'crossing_point' | 'out_of_bounds'

export interface Annotation {
  id: string
  type: AnnotationType
  points: MapPoint[]         // polyline for routes/bounds; single point for crossing_point
  rotation?: number          // degrees, for crossing_point
  color?: string
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
  map: MapConfig
  controls: Control[]
  courses: Course[]
  classes: RaceClass[]
  annotations: Annotation[]
  scaleBars: ScaleBar[]
  textLabels: TextLabel[]
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
  | 'place-scalebar'
  | 'place-text'

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
