import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type {
  Project, Control, ControlType, Course, CourseType, CourseControl,
  Annotation, AnnotationType, MapPoint, ActiveTool, Viewport, RaceClass,
} from '../types'
import type { LoadedMap } from '../lib/mapLoader'

const MAX_UNDO = 100

interface EditorState {
  activeTool: ActiveTool
  selectedControlId: string | null
  selectedCourseId: string | null
  viewport: Viewport
  mapSaturation: number
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
  removeControlFromCourse: (courseId: string, courseControlId: string) => void
  reorderCourseControls: (courseId: string, controls: CourseControl[]) => void
  updateScorePoints: (courseId: string, courseControlId: string, points: number) => void
  updateCourseShowPoints: (id: string, showPoints: boolean) => void

  // Classes
  addClass: (name: string, courseId: string) => RaceClass
  deleteClass: (id: string) => void
  updateClassName: (id: string, name: string) => void
  updateClassCourse: (id: string, courseId: string) => void

  // Annotations
  addAnnotationPoint: (point: MapPoint) => void
  commitAnnotation: (type: AnnotationType) => void
  cancelAnnotation: () => void
  deleteAnnotation: (id: string) => void

  // Map rendering
  setLoadedMap: (map: LoadedMap | null) => void

  // Editor UI
  setActiveTool: (tool: ActiveTool) => void
  setSelectedControl: (id: string | null) => void
  setSelectedCourse: (id: string | null) => void
  setViewport: (viewport: Viewport) => void
  setMapSaturation: (saturation: number) => void

  // Undo/redo
  undo: () => void
  redo: () => void
}

type Store = AppState & AppActions

const defaultEditor: EditorState = {
  activeTool: 'select',
  selectedControlId: null,
  selectedCourseId: null,
  viewport: { x: 0, y: 0, scale: 1 },
  mapSaturation: 0.5,
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
    const snapshot = structuredClone(project)
    const p = structuredClone(project)
    p.meta.updatedAt = new Date().toISOString()
    fn(p)
    set({
      project: p,
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), snapshot],
      redoStack: [],
    })
  }

  function mutateProjectSilent(fn: (p: Project) => void) {
    set(state => {
      if (!state.project) return state
      const p = structuredClone(state.project)
      p.meta.updatedAt = new Date().toISOString()
      fn(p)
      return { project: p }
    })
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
      }
      set({ project, mapFileData: mapData, undoStack: [], redoStack: [] })
    },

    loadProject: (project, mapData) => {
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
        const c = p.controls.find(c => c.id === id)
        if (c) c.position = position
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
          activeTool: id ? 'select' : state.editor.activeTool,
          pendingAnnotationPoints: id ? [] : state.editor.pendingAnnotationPoints,
        },
      }))
    },

    setViewport: (viewport) => {
      set(state => ({ editor: { ...state.editor, viewport } }))
    },

    setMapSaturation: (saturation) => {
      set(state => ({ editor: { ...state.editor, mapSaturation: saturation } }))
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
