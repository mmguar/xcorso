import { create } from 'zustand'
import type { Project } from '../types'
import type { Store, StoreHelpers } from './types'
import { defaultEditor } from './types'
import { debouncedSave, clearSession as clearPersistedSession } from '../lib/persistence'
import { timeClone } from '../lib/perf'
import { createControlsSlice } from './controlsSlice'
import { createCoursesSlice } from './coursesSlice'
import { createGapsSlice } from './gapsSlice'
import { createLegsSlice } from './legsSlice'
import { createAnnotationsSlice } from './annotationsSlice'
import { createOverlaysSlice } from './overlaysSlice'

const MAX_UNDO = 100

export const useStore = create<Store>((set, get) => {
  function pushUndoSnapshot() {
    const { project, undoStack } = get()
    if (!project) return
    set({
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), structuredClone(project)],
      redoStack: [],
    })
  }

  function mutateProject(fn: (p: Project) => void) {
    const { project } = get()
    if (!project) return
    pushUndoSnapshot()
    const p = timeClone('project', project)
    p.meta.updatedAt = new Date().toISOString()
    fn(p)
    set({ project: p })
  }

  function mutateProjectSilent(fn: (p: Project) => void) {
    const { project } = get()
    if (!project) return
    fn(project)
    set({ project: { ...project } as Project })
  }

  const h: StoreHelpers = { mutateProject, mutateProjectSilent, pushUndoSnapshot }

  return {
    project: null,
    mapFileData: null,
    loadedMap: null,
    undoStack: [],
    redoStack: [],
    editor: defaultEditor,

    // ── Project lifecycle ─────────────────────────────────────────────────

    createProject: (name, mapConfig, mapData, spec) => {
      const now = new Date().toISOString()
      const project: Project = {
        version: '1.0',
        meta: { name, createdAt: now, updatedAt: now },
        spec,
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

    updateProjectSpec: (spec) => {
      mutateProject(p => { p.spec = spec })
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
        p.map = { ...p.map, width, height }
      })
    },

    // ── Domain slices ────────────────────────────────────────────────────

    ...createControlsSlice(set, get, h),
    ...createCoursesSlice(set, get, h),
    ...createGapsSlice(set, get, h),
    ...createLegsSlice(set, get, h),
    ...createAnnotationsSlice(set, get, h),
    ...createOverlaysSlice(set, get, h),

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
