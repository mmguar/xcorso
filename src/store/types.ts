import type {
  Project, Control, ControlType, Course, CourseType, CourseControl,
  Annotation, AnnotationType, MapPoint, MapType, ActiveTool, RaceClass,
  CircleGap, LegGap, AppearanceSettings, ScaleBar, TextLabel, ImageOverlay, EventSpec, FinishType,
  CourseLayout, SubmapLayout, LayoutElementPosition, LayoutDefaults, MapGeoref, OverprintMode,
} from '../types'
import type { LoadedMap } from '../lib/mapLoader'
import type { CloudUser, VersionEntry, ShareRole } from '../lib/sync'

export interface EditorState {
  activeTool: ActiveTool
  selectedControlId: string | null
  selectedCourseId: string | null
  selectedVariationId: string | null
  selectedOverlayId: string | null
  selectedAnnotationId: string | null
  draggingControlId: string | null
  draggingLabelControlId: string | null
  mapSaturation: number
  gapSize: number
  appearance: AppearanceSettings
  pendingAnnotationPoints: MapPoint[]
  pendingImage: { dataUrl: string; filename: string; naturalWidth: number; naturalHeight: number } | null
  selectedSubmapIndex: number | null
  measureMode: boolean
  measureCourseId: string | null
  measureHiddenLegs: string[]   // legKeys hidden on screen in measure mode (empty = all shown)
  layoutMode: boolean
  layoutCourseId: string | null
  layoutSubmapIndex: number
  layoutSnapRequest: number
  gapRebuild: boolean
  // Pan-to-point request (seq bumps so repeat clicks on the same control re-fire).
  centerRequest: { point: MapPoint; seq: number } | null
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline'

export interface SyncConflict {
  cloudId: string
  serverVersion: number
  remoteProject: Project
}

export interface AppState {
  projectId: string | null
  project: Project | null
  mapFileData: ArrayBuffer | null
  loadedMap: LoadedMap | null
  undoStack: Project[]
  redoStack: Project[]
  editor: EditorState
  cloudUser: CloudUser | null
  syncStatus: SyncStatus
  syncConflict: SyncConflict | null
  versionHistory: VersionEntry[]
  projectRole: ShareRole
}

export interface AppActions {
  createProject: (name: string, mapConfig: Project['map'], mapData: ArrayBuffer, spec?: EventSpec) => void
  loadProject: (project: Project, mapData: ArrayBuffer | null, id?: string, role?: ShareRole) => void
  updateProjectName: (name: string) => void
  updateProjectSpec: (spec: EventSpec) => void

  setMapScale: (scale: number, source: 'ocad' | 'manual') => void
  setMapScaleMeasurement: (p1: MapPoint, p2: MapPoint, realWorldMeters: number, renderScale?: number) => void
  setMapDimensions: (width: number, height: number, originX: number, originY: number) => void
  setMapGeoref: (georef: MapGeoref) => void
  replaceMapFile: (filename: string, type: MapType, mapData: ArrayBuffer) => void

  addControl: (type: ControlType, position: MapPoint, code?: number) => Control
  beginMoveControl: () => void
  moveControl: (id: string, position: MapPoint) => void
  splitControl: (controlId: string, courseId: string, newPos: MapPoint, originPos: MapPoint) => Control
  beginMoveControlLabel: () => void
  moveControlLabel: (id: string, offset: MapPoint) => void
  deleteControl: (id: string) => void
  updateControlCode: (id: string, code: number) => void
  updateControlLabel: (id: string, label: string) => void
  updateControlPoints: (id: string, points: number | undefined) => void
  updateControlDescription: (id: string, field: string, value: string | undefined) => void
  updateSkipCodes: (codes: number[]) => void
  reassignControlIds: () => void

  addCourse: (name: string, type?: CourseType) => Course
  duplicateCourse: (id: string) => Course | null
  deleteCourse: (id: string) => void
  updateCourseName: (id: string, name: string) => void
  updateCourseColor: (id: string, color: string) => void
  addControlToCourse: (courseId: string, controlId: string) => void
  addAllControlsToCourse: (courseId: string) => void
  addControlsToCourseByCode: (courseId: string, codes: (number | string)[]) => void
  removeControlFromCourse: (courseId: string, courseControlId: string) => void
  reorderCourseControls: (courseId: string, controls: CourseControl[]) => void
  updateScorePoints: (courseId: string, courseControlId: string, points: number) => void
  updateCourseClimb: (id: string, climb: number | undefined) => void
  setManualCourseLength: (id: string, metres: number | undefined) => void
  updateCourseFinishType: (id: string, finishType: FinishType) => void
  updateCourseShowPoints: (id: string, showPoints: boolean) => void
  updateCourseTextDescriptions: (id: string, textDescriptions: boolean) => void
  updateClueSheetFontSize: (size: number | undefined) => void
  updateClueSheetHideSubmapRestart: (hide: boolean) => void
  updateClueSheetSplitSubmaps: (split: boolean) => void
  updateClueSheetOverlayColor: (color: string | undefined) => void
  updateClueSheetSeparateColor: (color: string | undefined) => void
  updateLabelSubmapStart: (label: boolean) => void
  updateCourseSpec: (id: string, spec: EventSpec | undefined) => void

  setExchangeMode: (courseId: string, courseControlId: string, mode: 'exchange' | 'flip') => void
  toggleExchangeControl: (courseId: string, courseControlId: string) => void
  setSelectedSubmap: (index: number | null) => void
  requestCenterOnControl: (controlId: string) => void
  setDraggingLabel: (controlId: string | null) => void

  enterMeasureMode: (courseId: string) => void
  exitMeasureMode: () => void
  toggleMeasureLeg: (legKey: string) => void
  setMeasureHiddenLegs: (legKeys: string[]) => void
  addMeasurePoint: (fromControlId: string, toControlId: string, point: MapPoint, index?: number) => void
  beginMoveMeasurePoint: () => void
  moveMeasurePoint: (fromControlId: string, toControlId: string, index: number, position: MapPoint) => void
  removeMeasurePoint: (fromControlId: string, toControlId: string, index: number) => void
  clearMeasureLeg: (fromControlId: string, toControlId: string) => void

  toggleCourseLoop: (courseId: string, forkControlId: string) => void
  removeCourseLoop: (courseId: string, loopId: string) => void
  setSelectedVariation: (id: string | null) => void

  addClass: (name: string, courseId: string) => RaceClass
  deleteClass: (id: string) => void
  updateClassName: (id: string, name: string) => void
  updateClassCourse: (id: string, courseId: string) => void

  addControlGap: (controlId: string, gap: CircleGap) => void
  removeControlGap: (controlId: string, index: number) => void
  removeControlGapAtAngle: (controlId: string, angle: number) => void
  clearControlGaps: (controlId: string) => void
  addLegGap: (courseId: string, courseControlId: string, gap: LegGap) => void
  removeLegGap: (courseId: string, courseControlId: string, index: number) => void
  removeLegGapAtT: (courseId: string, courseControlId: string, t: number) => void
  clearLegGaps: (courseId: string, courseControlId: string) => void

  addLegBendPoint: (courseId: string, courseControlId: string, point: MapPoint, index?: number) => void
  beginMoveLegBendPoint: () => void
  moveLegBendPoint: (courseId: string, courseControlId: string, index: number, position: MapPoint) => void
  removeLegBendPoint: (courseId: string, courseControlId: string, index: number) => void
  clearLegBendPoints: (courseId: string, courseControlId: string) => void

  beginMoveCourseLabel: () => void
  moveCourseLabel: (courseId: string, courseControlId: string, offset: MapPoint) => void

  addAnnotationPoint: (point: MapPoint) => void
  commitAnnotation: (type: AnnotationType) => void
  cancelAnnotation: () => void
  movePendingAnnotationPoint: (index: number, position: MapPoint) => void
  deleteAnnotation: (id: string) => void
  updateAnnotation: (id: string, updates: Partial<Omit<Annotation, 'id'>>) => void
  beginMoveAnnotation: () => void
  moveAnnotation: (id: string, position: MapPoint) => void
  beginMoveAnnotationVertex: () => void
  moveAnnotationVertex: (id: string, vertexIndex: number, position: MapPoint) => void
  beginRotateAnnotation: () => void
  rotateAnnotation: (id: string, rotation: number) => void
  beginResizeAnnotation: () => void
  resizeAnnotation: (id: string, scale: number) => void
  beginElongateAnnotation: () => void
  elongateAnnotation: (id: string, elongation: number) => void
  setSelectedAnnotation: (id: string | null) => void

  addScaleBar: (position: MapPoint, scale: number) => ScaleBar
  updateScaleBar: (id: string, updates: Partial<Omit<ScaleBar, 'id'>>) => void
  deleteScaleBar: (id: string) => void
  beginMoveOverlay: () => void
  moveScaleBar: (id: string, position: MapPoint) => void

  addTextLabel: (position: MapPoint) => TextLabel
  updateTextLabel: (id: string, updates: Partial<Omit<TextLabel, 'id'>>) => void
  deleteTextLabel: (id: string) => void
  moveTextLabel: (id: string, position: MapPoint) => void

  addImageOverlay: (position: MapPoint, dataUrl: string, filename: string, naturalWidth: number, naturalHeight: number) => ImageOverlay
  updateImageOverlay: (id: string, updates: Partial<Omit<ImageOverlay, 'id'>>) => void
  deleteImageOverlay: (id: string) => void
  moveImageOverlay: (id: string, position: MapPoint) => void
  resizeImageOverlay: (id: string, widthMm: number, heightMm: number) => void
  setPendingImage: (data: { dataUrl: string; filename: string; naturalWidth: number; naturalHeight: number } | null) => void

  setLoadedMap: (map: LoadedMap | null) => void

  setActiveTool: (tool: ActiveTool) => void
  setSelectedControl: (id: string | null) => void
  setDraggingControl: (id: string | null) => void
  setSelectedCourse: (id: string | null) => void
  setSelectedOverlay: (id: string | null) => void
  setMapSaturation: (saturation: number) => void
  setOverprint: (overprint: number) => void
  setOverprintMode: (mode: OverprintMode) => void
  setGapSize: (size: number) => void
  setGapRebuild: (on: boolean) => void
  setAppearance: (settings: Partial<AppearanceSettings>) => void

  enterLayoutMode: (courseId: string) => void
  exitLayoutMode: () => void
  setLayoutSubmap: (index: number) => void
  updateCourseLayout: (courseId: string, updates: Partial<SubmapLayout & Pick<CourseLayout, 'included' | 'descMode'>>, submapIndex?: number) => void
  moveCourseLayout: (courseId: string, updates: Partial<SubmapLayout>, submapIndex?: number) => void
  updateLayoutDefaults: (updates: Partial<LayoutDefaults>) => void
  ensureAllCourseLayouts: () => void
  beginLayoutDrag: () => void
  setLayoutMapCenter: (courseId: string, center: MapPoint, submapIndex?: number) => void
  updateLayoutElement: (courseId: string, element: string, pos: Partial<LayoutElementPosition>, submapIndex?: number) => void
  addClueSheetBreak: (courseId: string, controlIndex: number, submapIndex?: number) => void
  removeClueSheetBreak: (courseId: string, breakIndex: number, submapIndex?: number) => void
  requestLayoutSnap: () => void
  setLayoutOverlayPosition: (courseId: string, overlayId: string, position: MapPoint, submapIndex?: number) => void

  switchProject: (id: string) => Promise<void>

  setCloudUser: (user: CloudUser | null) => void
  syncProject: () => Promise<void>
  saveSnapshot: () => Promise<void>
  fetchVersionHistory: () => Promise<void>
  restoreVersion: (version: number) => Promise<void>
  resolveConflict: (keep: 'local' | 'remote') => Promise<void>

  undo: () => void
  redo: () => void
}

export type Store = AppState & AppActions

export interface StoreHelpers {
  mutateProject: (fn: (p: Project) => void) => void
  mutateProjectSilent: (fn: (p: Project) => void) => void
  pushUndoSnapshot: () => void
}

export type SetState = (partial: Partial<Store> | ((state: Store) => Partial<Store>)) => void
export type GetState = () => Store

export const defaultAppearance: AppearanceSettings = {
  controlScale: 1,
  lineWidth: 1,
  color: '',
  outlineEnabled: false,
  outlineColor: '#ffffff',
  outlineWidth: 0.7,
}

export const defaultEditor: EditorState = {
  activeTool: 'select',
  selectedControlId: null,
  selectedCourseId: null,
  selectedVariationId: null,
  selectedOverlayId: null,
  selectedAnnotationId: null,
  draggingControlId: null,
  draggingLabelControlId: null,
  mapSaturation: 0.5,
  gapSize: 35,
  appearance: defaultAppearance,
  pendingAnnotationPoints: [],
  pendingImage: null,
  selectedSubmapIndex: null,
  measureMode: false,
  measureCourseId: null,
  measureHiddenLegs: [],
  layoutMode: false,
  layoutCourseId: null,
  layoutSubmapIndex: 0,
  layoutSnapRequest: 0,
  gapRebuild: false,
  centerRequest: null,
}
