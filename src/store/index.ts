import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  Project, Control, ControlType, Course, CourseType, CourseControl,
  Annotation, AnnotationType, MapPoint, ActiveTool, Viewport, RaceClass,
  CircleGap, LegGap, AppearanceSettings, ScaleBar, TextLabel,
} from '../types'
import type { LoadedMap } from '../lib/mapLoader'
import { debouncedSave, clearSession as clearPersistedSession } from '../lib/persistence'
import { timeClone } from '../lib/perf'

const MAX_UNDO = 100

interface EditorState {
  activeTool: ActiveTool
  selectedControlId: string | null
  selectedCourseId: string | null
  selectedOverlayId: string | null
  viewport: Viewport
  mapSaturation: number
  gapSize: number // gap tool size in degrees (for circles) / fraction (for legs)
  appearance: AppearanceSettings
  // Annotation drawing in progress (forbidden_route, out_of_bounds)
  pendingAnnotationPoints: MapPoint[]
}

interface AppState {
  // Project
  project: Project | null
  // Raw map file bytes (not serialised into store, loaded on open)
  mapFileData: ArrayBuffer | null
  // Loaded map (SVG element / image URL) — not cloned for undo/redo
  loadedMap: LoadedMap | null
  // Undo/redo stacks (snapshots of project only)
  undoStack: Project[]
  redoStack: Project[]
  // Editor UI
  editor: EditorState
}

interface AppActions {
  // Project lifecycle
  createProject: (name: string, mapConfig: Project['map'], mapData: ArrayBuffer) => void
  loadProject: (project: Project, mapData: ArrayBuffer | null) => void
  updateProjectName: (name: string) => void

  // Map
  setMapScale: (scale: number, source: 'ocad' | 'manual') => void
  setMapScaleMeasurement: (p1: MapPoint, p2: MapPoint, realWorldMeters: number, renderScale?: number) => void
  /** Updates native map extent; does not push undo (synced from loaded map). */
  setMapDimensions: (width: number, height: number) => void

  // Controls
  addControl: (type: ControlType, position: MapPoint, code?: number) => Control
  beginMoveControl: () => void
  moveControl: (id: string, position: MapPoint) => void
  deleteControl: (id: string) => void
  updateControlCode: (id: string, code: number) => void
  updateControlLabel: (id: string, label: string) => void
  updateControlPoints: (id: string, points: number | undefined) => void
  updateControlDescription: (id: string, field: string, value: string | undefined) => void

  // Courses
  addCourse: (name: string, type?: CourseType) => Course
  deleteCourse: (id: string) => void
  updateCourseName: (id: string, name: string) => void
  updateCourseColor: (id: string, color: string) => void
  addControlToCourse: (courseId: string, controlId: string) => void
  addAllControlsToCourse: (courseId: string) => void
  addControlsToCourseByCode: (courseId: string, codes: number[]) => void
  removeControlFromCourse: (courseId: string, courseControlId: string) => void
  reorderCourseControls: (courseId: string, controls: CourseControl[]) => void
  updateScorePoints: (courseId: string, courseControlId: string, points: number) => void
  updateCourseClimb: (id: string, climb: number | undefined) => void
  updateCourseShowPoints: (id: string, showPoints: boolean) => void

  // Classes
  addClass: (name: string, courseId: string) => RaceClass
  deleteClass: (id: string) => void
  updateClassName: (id: string, name: string) => void
  updateClassCourse: (id: string, courseId: string) => void

  // Gaps
  addControlGap: (controlId: string, gap: CircleGap) => void
  removeControlGap: (controlId: string, index: number) => void
  clearControlGaps: (controlId: string) => void
  addLegGap: (courseId: string, courseControlId: string, gap: LegGap) => void
  removeLegGap: (courseId: string, courseControlId: string, index: number) => void
  clearLegGaps: (courseId: string, courseControlId: string) => void

  // Bend points
  addLegBendPoint: (courseId: string, courseControlId: string, point: MapPoint, index?: number) => void
  beginMoveLegBendPoint: () => void
  moveLegBendPoint: (courseId: string, courseControlId: string, index: number, position: MapPoint) => void
  removeLegBendPoint: (courseId: string, courseControlId: string, index: number) => void
  clearLegBendPoints: (courseId: string, courseControlId: string) => void

  // Course label offsets
  beginMoveCourseLabel: () => void
  moveCourseLabel: (courseId: string, courseControlId: string, offset: MapPoint) => void

  // Annotations
  addAnnotationPoint: (point: MapPoint) => void
  commitAnnotation: (type: AnnotationType) => void
  cancelAnnotation: () => void
  deleteAnnotation: (id: string) => void

  // Scale bars
  addScaleBar: (position: MapPoint, scale: number) => ScaleBar
  updateScaleBar: (id: string, updates: Partial<Omit<ScaleBar, 'id'>>) => void
  deleteScaleBar: (id: string) => void
  beginMoveOverlay: () => void
  moveScaleBar: (id: string, position: MapPoint) => void

  // Text labels
  addTextLabel: (position: MapPoint) => TextLabel
  updateTextLabel: (id: string, updates: Partial<Omit<TextLabel, 'id'>>) => void
  deleteTextLabel: (id: string) => void
  moveTextLabel: (id: string, position: MapPoint) => void

  // Map rendering
  setLoadedMap: (map: LoadedMap | null) => void

  // Editor UI
  setActiveTool: (tool: ActiveTool) => void
  setSelectedControl: (id: string | null) => void
  setSelectedCourse: (id: string | null) => void
  setSelectedOverlay: (id: string | null) => void
  setMapSaturation: (saturation: number) => void
  setGapSize: (size: number) => void
  setAppearance: (settings: Partial<AppearanceSettings>) => void

  // Session
  clearSession: () => void

  // Undo/redo
  undo: () => void
  redo: () => void
}

type Store = AppState & AppActions

const defaultAppearance: AppearanceSettings = {
  controlScale: 1,
  lineWidth: 1,
  color: '',
  outlineEnabled: false,
  outlineColor: '#ffffff',
  outlineWidth: 0.7,
}

const defaultEditor: EditorState = {
  activeTool: 'select',
  selectedControlId: null,
  selectedCourseId: null,
  selectedOverlayId: null,
  viewport: { x: 0, y: 0, scale: 1 },
  mapSaturation: 0.5,
  gapSize: 35,
  appearance: defaultAppearance,
  pendingAnnotationPoints: [],
}

function nextControlCode(controls: Control[]): number {
  const codes = controls.filter(c => c.type === 'control').map(c => c.code)
  if (codes.length === 0) return 31
  return Math.max(...codes) + 1
}

function nextTypeCode(controls: Control[], type: ControlType): number {
  const codes = controls.filter(c => c.type === type).map(c => c.code)
  if (codes.length === 0) return 1
  return Math.max(...codes) + 1
}

export const useStore = create<Store>((set, get) => {
  function mutateProject(fn: (p: Project) => void) {
    const { project, undoStack } = get()
    if (!project) return
    const p = timeClone('project', project)
    p.meta.updatedAt = new Date().toISOString()
    fn(p)
    set({
      project: p,
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), project],
      redoStack: [],
    })
  }

  function mutateProjectSilent(fn: (p: Project) => void) {
    const { project } = get()
    if (!project) return
    fn(project)
    project.meta.updatedAt = new Date().toISOString()
    set({ project: { ...project } as Project })
  }

  return {
    project: null,
    mapFileData: null,
    loadedMap: null,
    undoStack: [],
    redoStack: [],
    editor: defaultEditor,

    // ── Project lifecycle ─────────────────────────────────────────────────

    createProject: (name, mapConfig, mapData) => {
      const now = new Date().toISOString()
      const project: Project = {
        version: '1.0',
        meta: { name, createdAt: now, updatedAt: now },
        map: mapConfig,
        controls: [],
        courses: [],
        classes: [],
        annotations: [],
        scaleBars: [],
        textLabels: [],
      }
      set({ project, mapFileData: mapData, undoStack: [], redoStack: [] })
    },

    loadProject: (project, mapData) => {
      if (!project.scaleBars) project.scaleBars = []
      if (!project.textLabels) project.textLabels = []
      set({ project, mapFileData: mapData, undoStack: [], redoStack: [], editor: defaultEditor })
    },

    updateProjectName: (name) => {
      mutateProject(p => { p.meta.name = name })
    },

    // ── Map ──────────────────────────────────────────────────────────────

    setMapScale: (scale, source) => {
      mutateProject(p => { p.map.scale = scale; p.map.scaleSource = source })
    },

    setMapScaleMeasurement: (p1, p2, realWorldMeters, renderScale) => {
      const dx = p2.x - p1.x; const dy = p2.y - p1.y
      const pixelDist = Math.sqrt(dx * dx + dy * dy)
      const effectiveDist = renderScale ? pixelDist / renderScale : pixelDist
      mutateProject(p => {
        p.map.scaleMeasurement = { p1, p2, realWorldMeters }
        p.map.scaleSource = 'manual'
        p.map.scale = Math.round((realWorldMeters * 1000) / effectiveDist)
      })
    },

    setMapDimensions: (width, height) => {
      mutateProjectSilent(p => {
        p.map.width = width
        p.map.height = height
      })
    },

    // ── Controls ─────────────────────────────────────────────────────────

    addControl: (type, position, code) => {
      const { project } = get()
      if (!project) throw new Error('No project')
      let finalCode = code ?? 0
      if (type === 'control' && !code) finalCode = nextControlCode(project.controls)
      if (type === 'start' && !code) finalCode = nextTypeCode(project.controls, 'start')
      if (type === 'finish' && !code) finalCode = nextTypeCode(project.controls, 'finish')
      const control: Control = { id: uuidv4(), type, code: finalCode, position }
      mutateProject(p => { p.controls.push(control) })
      return control
    },

    beginMoveControl: () => {
      const { project, undoStack } = get()
      if (!project) return
      set({
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), structuredClone(project)],
        redoStack: [],
      })
    },

    moveControl: (id, position) => {
      mutateProjectSilent(p => {
        const i = p.controls.findIndex(c => c.id === id)
        if (i === -1) return
        p.controls = p.controls.map((c, j) => (j === i ? { ...c, position } : c))
      })
    },

    deleteControl: (id) => {
      mutateProject(p => {
        p.controls = p.controls.filter(c => c.id !== id)
        // Remove from all courses
        p.courses.forEach(course => {
          course.controls = course.controls.filter(cc => cc.controlId !== id)
        })
      })
    },

    updateControlCode: (id, code) => {
      const { project } = get()
      if (!project) return
      const existing = project.controls.find(c => c.id !== id && c.code === code && c.type === 'control')
      if (existing) return
      mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (c) c.code = code
      })
    },

    updateControlLabel: (id, label) => {
      mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (c) c.label = label || undefined
      })
    },

    updateControlPoints: (id, points) => {
      mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (c) c.points = points
      })
    },

    updateControlDescription: (id, field, value) => {
      mutateProject(p => {
        const c = p.controls.find(c => c.id === id)
        if (!c) return
        if (!c.description) c.description = {}
        ;(c.description as any)[field] = value
        if (Object.values(c.description).every(v => v === undefined)) {
          c.description = undefined
        }
      })
    },

    // ── Courses ───────────────────────────────────────────────────────────

    addCourse: (name, type = 'linear') => {
      const { project } = get()
      const controls: CourseControl[] = []
      if (project) {
        const starts = project.controls.filter(c => c.type === 'start')
        const finishes = project.controls.filter(c => c.type === 'finish')
        if (starts.length === 1) controls.push({ id: uuidv4(), controlId: starts[0].id })
        if (finishes.length === 1) controls.push({ id: uuidv4(), controlId: finishes[0].id })
      }
      const course: Course = {
        id: uuidv4(), name, type, controls,
        color: '#7B2FBE',
      }
      mutateProject(p => { p.courses.push(course) })
      set(state => ({
        editor: {
          ...state.editor,
          selectedCourseId: course.id,
          selectedControlId: null,
          activeTool: 'select',
          pendingAnnotationPoints: [],
        },
      }))
      return course
    },

    deleteCourse: (id) => {
      mutateProject(p => {
        p.courses = p.courses.filter(c => c.id !== id)
        p.classes = p.classes.filter(c => c.courseId !== id)
      })
      set(state => ({
        editor: {
          ...state.editor,
          selectedCourseId: state.editor.selectedCourseId === id ? null : state.editor.selectedCourseId,
        },
      }))
    },

    updateCourseName: (id, name) => {
      mutateProject(p => {
        const c = p.courses.find(c => c.id === id); if (c) c.name = name
      })
    },

    updateCourseColor: (id, color) => {
      mutateProject(p => {
        const c = p.courses.find(c => c.id === id); if (c) c.color = color
      })
    },

    addControlToCourse: (courseId, controlId) => {
      const { project } = get()
      if (!project) return
      const control = project.controls.find(c => c.id === controlId)
      if (!control) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return

      const getType = (id: string) => project.controls.find(c => c.id === id)?.type

      if (control.type === 'start') {
        const existing = course.controls.find(cc => getType(cc.controlId) === 'start')
        if (existing?.controlId === controlId) return
        mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          c.controls = c.controls.filter(cc => getType(cc.controlId) !== 'start')
          c.controls.unshift({ id: uuidv4(), controlId })
        })
        return
      }

      if (control.type === 'finish') {
        const existing = course.controls.find(cc => getType(cc.controlId) === 'finish')
        if (existing?.controlId === controlId) return
        mutateProject(p => {
          const c = p.courses.find(c => c.id === courseId)
          if (!c) return
          c.controls = c.controls.filter(cc => getType(cc.controlId) !== 'finish')
          c.controls.push({ id: uuidv4(), controlId })
        })
        return
      }

      // Regular control — insert before finish if present
      const finishIdx = course.controls.findIndex(cc => getType(cc.controlId) === 'finish')
      const insertIdx = finishIdx >= 0 ? finishIdx : course.controls.length
      const prev = insertIdx > 0 ? course.controls[insertIdx - 1] : null
      if (prev && prev.controlId === controlId) return

      mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        const fi = c.controls.findIndex(cc => getType(cc.controlId) === 'finish')
        const ii = fi >= 0 ? fi : c.controls.length
        c.controls.splice(ii, 0, { id: uuidv4(), controlId })
      })
    },

    addAllControlsToCourse: (courseId) => {
      const { project } = get()
      if (!project) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return
      const regularControls = project.controls
        .filter(c => c.type === 'control')
        .sort((a, b) => a.code - b.code)
      if (regularControls.length === 0) return
      mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        const getType = (id: string) => p.controls.find(ctrl => ctrl.id === id)?.type
        const finishIdx = c.controls.findIndex(cc => getType(cc.controlId) === 'finish')
        const insertIdx = finishIdx >= 0 ? finishIdx : c.controls.length
        const newEntries = regularControls.map(ctrl => ({ id: uuidv4(), controlId: ctrl.id }))
        c.controls.splice(insertIdx, 0, ...newEntries)
      })
    },

    addControlsToCourseByCode: (courseId, codes) => {
      const { project } = get()
      if (!project) return
      const course = project.courses.find(c => c.id === courseId)
      if (!course) return
      const controlsByCode = new Map(project.controls.filter(c => c.type === 'control').map(c => [c.code, c]))
      const validControls = codes.map(code => controlsByCode.get(code)).filter((c): c is Control => c != null)
      if (validControls.length === 0) return
      mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (!c) return
        const getType = (id: string) => p.controls.find(ctrl => ctrl.id === id)?.type
        const finishIdx = c.controls.findIndex(cc => getType(cc.controlId) === 'finish')
        const insertIdx = finishIdx >= 0 ? finishIdx : c.controls.length
        const newEntries = validControls.map(ctrl => ({ id: uuidv4(), controlId: ctrl.id }))
        c.controls.splice(insertIdx, 0, ...newEntries)
      })
    },

    removeControlFromCourse: (courseId, courseControlId) => {
      mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (c) c.controls = c.controls.filter(cc => cc.id !== courseControlId)
      })
    },

    reorderCourseControls: (courseId, controls) => {
      mutateProject(p => {
        const c = p.courses.find(c => c.id === courseId)
        if (c) c.controls = controls
      })
    },

    updateScorePoints: (courseId, courseControlId, points) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.scorePoints = points
      })
    },

    updateCourseClimb: (id, climb) => {
      mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.climb = climb
      })
    },

    updateCourseShowPoints: (id, showPoints) => {
      mutateProject(p => {
        const c = p.courses.find(c => c.id === id)
        if (c) c.showPoints = showPoints
      })
    },

    // ── Classes ──────────────────────────────────────────────────────────

    addClass: (name, courseId) => {
      const rc: RaceClass = { id: uuidv4(), name, courseId }
      mutateProject(p => { p.classes.push(rc) })
      return rc
    },

    deleteClass: (id) => {
      mutateProject(p => { p.classes = p.classes.filter(c => c.id !== id) })
    },

    updateClassName: (id, name) => {
      mutateProject(p => {
        const c = p.classes.find(c => c.id === id)
        if (c) c.name = name
      })
    },

    updateClassCourse: (id, courseId) => {
      mutateProject(p => {
        const c = p.classes.find(c => c.id === id)
        if (c) c.courseId = courseId
      })
    },

    // ── Gaps ──────────────────────────────────────────────────────────────

    addControlGap: (controlId, gap) => {
      mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c) return
        if (!c.gaps) c.gaps = []
        c.gaps.push(gap)
      })
    },

    removeControlGap: (controlId, index) => {
      mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (!c || !c.gaps) return
        c.gaps.splice(index, 1)
        if (c.gaps.length === 0) c.gaps = undefined
      })
    },

    clearControlGaps: (controlId) => {
      mutateProject(p => {
        const c = p.controls.find(c => c.id === controlId)
        if (c) c.gaps = undefined
      })
    },

    addLegGap: (courseId, courseControlId, gap) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return
        if (!cc.legGaps) cc.legGaps = []
        cc.legGaps.push(gap)
      })
    },

    removeLegGap: (courseId, courseControlId, index) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc || !cc.legGaps) return
        cc.legGaps.splice(index, 1)
        if (cc.legGaps.length === 0) cc.legGaps = undefined
      })
    },

    clearLegGaps: (courseId, courseControlId) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.legGaps = undefined
      })
    },

    // ── Bend points ─────────────────────────────────────────────────────────

    addLegBendPoint: (courseId, courseControlId, point, index) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc) return
        if (!cc.legBendPoints) cc.legBendPoints = []
        if (index !== undefined) {
          cc.legBendPoints.splice(index, 0, point)
        } else {
          cc.legBendPoints.push(point)
        }
      })
    },

    beginMoveLegBendPoint: () => {
      const { project, undoStack } = get()
      if (!project) return
      set({
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), structuredClone(project)],
        redoStack: [],
      })
    },

    moveLegBendPoint: (courseId, courseControlId, index, position) => {
      mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return
        const cc = course.controls[cci]
        if (!cc.legBendPoints?.[index]) return
        const legBendPoints = cc.legBendPoints.map((pt, j) => (j === index ? position : pt))
        const newCc = { ...cc, legBendPoints }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },

    removeLegBendPoint: (courseId, courseControlId, index) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (!cc?.legBendPoints) return
        cc.legBendPoints.splice(index, 1)
        if (cc.legBendPoints.length === 0) cc.legBendPoints = undefined
      })
    },

    clearLegBendPoints: (courseId, courseControlId) => {
      mutateProject(p => {
        const course = p.courses.find(c => c.id === courseId)
        if (!course) return
        const cc = course.controls.find(cc => cc.id === courseControlId)
        if (cc) cc.legBendPoints = undefined
      })
    },

    // ── Course label offsets ─────────────────────────────────────────────

    beginMoveCourseLabel: () => {
      const { project, undoStack } = get()
      if (!project) return
      set({
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), structuredClone(project)],
        redoStack: [],
      })
    },

    moveCourseLabel: (courseId, courseControlId, offset) => {
      mutateProjectSilent(p => {
        const ci = p.courses.findIndex(c => c.id === courseId)
        if (ci === -1) return
        const course = p.courses[ci]
        const cci = course.controls.findIndex(cc => cc.id === courseControlId)
        if (cci === -1) return
        const cc = course.controls[cci]
        const newCc = { ...cc, labelOffset: offset }
        const newControls = course.controls.map((c, j) => (j === cci ? newCc : c))
        p.courses = p.courses.map((c, j) => (j === ci ? { ...course, controls: newControls } : c))
      })
    },

    // ── Annotations ───────────────────────────────────────────────────────

    addAnnotationPoint: (point) => {
      set(state => ({
        editor: {
          ...state.editor,
          pendingAnnotationPoints: [...state.editor.pendingAnnotationPoints, point],
        },
      }))
    },

    commitAnnotation: (type) => {
      const { editor } = get()
      const points = editor.pendingAnnotationPoints
      if (points.length === 0) return
      const annotation: Annotation = { id: uuidv4(), type, points }
      mutateProject(p => { p.annotations.push(annotation) })
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    cancelAnnotation: () => {
      set(state => ({ editor: { ...state.editor, pendingAnnotationPoints: [] } }))
    },

    deleteAnnotation: (id) => {
      mutateProject(p => { p.annotations = p.annotations.filter(a => a.id !== id) })
    },

    // ── Scale bars ───────────────────────────────────────────────────────

    addScaleBar: (position, scale) => {
      const sb: ScaleBar = {
        id: uuidv4(), position, segments: 3, segmentLengthM: 100, bgAlpha: 0.8, scale,
      }
      mutateProject(p => { p.scaleBars.push(sb) })
      set(state => ({ editor: { ...state.editor, selectedOverlayId: sb.id } }))
      return sb
    },

    updateScaleBar: (id, updates) => {
      mutateProject(p => {
        const sb = p.scaleBars.find(s => s.id === id)
        if (sb) Object.assign(sb, updates)
      })
    },

    deleteScaleBar: (id) => {
      mutateProject(p => { p.scaleBars = p.scaleBars.filter(s => s.id !== id) })
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: state.editor.selectedOverlayId === id ? null : state.editor.selectedOverlayId },
      }))
    },

    beginMoveOverlay: () => {
      const { project, undoStack } = get()
      if (!project) return
      set({
        undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), structuredClone(project)],
        redoStack: [],
      })
    },

    moveScaleBar: (id, position) => {
      mutateProjectSilent(p => {
        const i = p.scaleBars.findIndex(s => s.id === id)
        if (i === -1) return
        p.scaleBars = p.scaleBars.map((s, j) => (j === i ? { ...s, position } : s))
      })
    },

    // ── Text labels ──────────────────────────────────────────────────────

    addTextLabel: (position) => {
      const tl: TextLabel = {
        id: uuidv4(), position, text: 'Text', fontSizeMm: 4, color: '#000000',
      }
      mutateProject(p => { p.textLabels.push(tl) })
      set(state => ({ editor: { ...state.editor, selectedOverlayId: tl.id } }))
      return tl
    },

    updateTextLabel: (id, updates) => {
      mutateProject(p => {
        const tl = p.textLabels.find(t => t.id === id)
        if (tl) Object.assign(tl, updates)
      })
    },

    deleteTextLabel: (id) => {
      mutateProject(p => { p.textLabels = p.textLabels.filter(t => t.id !== id) })
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: state.editor.selectedOverlayId === id ? null : state.editor.selectedOverlayId },
      }))
    },

    moveTextLabel: (id, position) => {
      mutateProjectSilent(p => {
        const i = p.textLabels.findIndex(t => t.id === id)
        if (i === -1) return
        p.textLabels = p.textLabels.map((t, j) => (j === i ? { ...t, position } : t))
      })
    },

    // ── Map rendering ────────────────────────────────────────────────────

    setLoadedMap: (map) => set({ loadedMap: map }),

    // ── Editor UI ─────────────────────────────────────────────────────────

    setActiveTool: (tool) => {
      set(state => ({
        editor: { ...state.editor, activeTool: tool, pendingAnnotationPoints: [] },
      }))
    },

    setSelectedControl: (id) => {
      set(state => ({ editor: { ...state.editor, selectedControlId: id } }))
    },

    setSelectedCourse: (id) => {
      set(state => ({
        editor: {
          ...state.editor,
          selectedCourseId: id,
          selectedControlId: id ? null : state.editor.selectedControlId,
          selectedOverlayId: id ? null : state.editor.selectedOverlayId,
          activeTool: id ? (state.editor.activeTool === 'gap' || state.editor.activeTool === 'bend' ? state.editor.activeTool : 'select') : state.editor.activeTool,
          pendingAnnotationPoints: id ? [] : state.editor.pendingAnnotationPoints,
        },
      }))
    },

    setSelectedOverlay: (id) => {
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: id, selectedControlId: id ? null : state.editor.selectedControlId },
      }))
    },

    setMapSaturation: (saturation) => {
      set(state => ({ editor: { ...state.editor, mapSaturation: saturation } }))
    },

    setGapSize: (size) => {
      set(state => ({ editor: { ...state.editor, gapSize: size } }))
    },

    setAppearance: (settings) => {
      set(state => ({ editor: { ...state.editor, appearance: { ...state.editor.appearance, ...settings } } }))
    },

    // ── Session ──────────────────────────────────────────────────────────

    clearSession: () => {
      clearPersistedSession()
      set({ project: null, mapFileData: null, loadedMap: null, undoStack: [], redoStack: [], editor: defaultEditor })
    },

    // ── Undo / Redo ───────────────────────────────────────────────────────

    undo: () => {
      const { undoStack, project, redoStack } = get()
      if (undoStack.length === 0 || !project) return
      const prev = undoStack[undoStack.length - 1]
      set({
        project: prev,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, structuredClone(project)],
      })
    },

    redo: () => {
      const { redoStack, project, undoStack } = get()
      if (redoStack.length === 0 || !project) return
      const next = redoStack[redoStack.length - 1]
      set({
        project: next,
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack, structuredClone(project)],
      })
    },
  }
})

useStore.subscribe((state, prev) => {
  if (state.project && state.project !== prev.project) {
    debouncedSave(state.project, state.mapFileData)
  }
})
