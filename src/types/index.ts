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

export interface Control {
  id: string
  type: ControlType
  code: number               // control unit number (e.g. 31, 32, 33)
  label?: string             // custom display label (e.g. "S1", "Start A"); defaults to S{code}/F{code}/{code}
  points?: number            // point value for Score-O
  position: MapPoint
  description?: ControlDescription
}

// ─── Courses ────────────────────────────────────────────────────────────────

export type CourseType = 'linear' | 'score'

export interface CourseControl {
  id: string                 // UUID — unique per course-control instance (allows reuse)
  controlId: string          // references Control.id
  scorePoints?: number       // score-O only
  // Phase 3 placeholder:
  // branchId?: string
}

export interface Course {
  id: string
  name: string
  type: CourseType
  controls: CourseControl[]  // ordered for linear; unordered for score
  scoreTimeLimit?: number    // minutes, score-O only
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
