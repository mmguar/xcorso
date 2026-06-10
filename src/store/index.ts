import { create } from 'zustand'
import type { Project } from '../types'
import type { Store, StoreHelpers } from './types'
import { defaultEditor } from './types'
import { debouncedSave, clearSession as clearPersistedSession } from '../lib/persistence'
import { normalizeProject } from '../lib/projectFile'
import { timeClone } from '../lib/perf'
import { distance } from '../lib/geometry'
import { createControlsSlice } from './controlsSlice'
import { createCoursesSlice } from './coursesSlice'
import { createGapsSlice } from './gapsSlice'
import { createLegsSlice } from './legsSlice'
import { createMeasureSlice } from './measureSlice'
import { createAnnotationsSlice } from './annotationsSlice'
import { createOverlaysSlice } from './overlaysSlice'
import { createLayoutSlice } from './layoutSlice'

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
        imageOverlays: [],
        overprint: 1,
        overprintMode: 'simulated',
      }
      set({ project, mapFileData: mapData, loadedMap: null, undoStack: [], redoStack: [] })
    },

    loadProject: (project, mapData) => {
      // Session restores need the same migrations/defaults as .oco loads.
      // normalizeProject also validates; session data was written by us, so on
      // an unexpected failure keep the project as-is rather than losing it.
      try { project = normalizeProject(project) } catch { /* keep as-is */ }
      if (!project.scaleBars) project.scaleBars = []
      if (!project.textLabels) project.textLabels = []
      if (!project.imageOverlays) project.imageOverlays = []
      set({ project, mapFileData: mapData, loadedMap: null, undoStack: [], redoStack: [], editor: defaultEditor })
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
      const pixelDist = distance(p1, p2)
      const effectiveDist = renderScale ? pixelDist / renderScale : pixelDist
      mutateProject(p => {
        p.map.scaleMeasurement = { p1, p2, realWorldMeters }
        p.map.scaleSource = 'manual'
        p.map.scale = Math.round((realWorldMeters * 1000) / effectiveDist)
      })
    },

    setMapDimensions: (width, height, originX, originY) => {
      mutateProjectSilent(p => {
        p.map = { ...p.map, width, height, originX, originY }
      })
    },

    setMapGeoref: (georef) => {
      mutateProjectSilent(p => {
        p.map = { ...p.map, georef }
      })
    },

    replaceMapFile: (filename, type, mapData) => {
      mutateProject(p => {
        p.map.filename = filename
        p.map.type = type
      })
      set({ mapFileData: mapData, loadedMap: null })
    },

    // ── Domain slices ────────────────────────────────────────────────────

    ...createControlsSlice(set, get, h),
    ...createCoursesSlice(set, get, h),
    ...createGapsSlice(set, get, h),
    ...createLegsSlice(set, get, h),
    ...createMeasureSlice(set, get, h),
    ...createAnnotationsSlice(set, get, h),
    ...createOverlaysSlice(set, get, h),
    ...createLayoutSlice(set, get, h),

    // ── Map rendering ────────────────────────────────────────────────────

    setLoadedMap: (map) => set({ loadedMap: map }),

    // ── Editor UI ─────────────────────────────────────────────────────────

    setActiveTool: (tool) => {
      set(state => ({
        editor: { ...state.editor, activeTool: tool, pendingAnnotationPoints: [], gapRebuild: tool === 'gap' ? state.editor.gapRebuild : false },
      }))
    },

    setSelectedControl: (id) => {
      set(state => ({ editor: { ...state.editor, selectedControlId: id, selectedAnnotationId: id ? null : state.editor.selectedAnnotationId } }))
    },

    setDraggingControl: (id) => {
      set(state => ({ editor: { ...state.editor, draggingControlId: id } }))
    },

    setSelectedCourse: (id) => {
      set(state => {
        const tool = state.editor.activeTool
        const courseOnlyTool = tool === 'gap' || tool === 'bend'
        // Measure mode is bound to one course (enterMeasureMode keeps them in
        // sync); switching course must exit it or the measure overlay and
        // hit-testing stay on the old course while the canvas shows the new one.
        const leavingMeasure = state.editor.measureMode && id !== state.editor.measureCourseId
        return {
          editor: {
            ...state.editor,
            ...(leavingMeasure ? { measureMode: false, measureCourseId: null, measureHiddenLegs: [] } : {}),
            selectedCourseId: id,
            selectedVariationId: null,
            selectedSubmapIndex: null,
            selectedControlId: id ? null : state.editor.selectedControlId,
            selectedOverlayId: id ? null : state.editor.selectedOverlayId,
            selectedAnnotationId: id ? null : state.editor.selectedAnnotationId,
            activeTool: id ? (courseOnlyTool ? tool : 'select') : (courseOnlyTool ? 'select' : tool),
            pendingAnnotationPoints: id ? [] : state.editor.pendingAnnotationPoints,
          },
        }
      })
    },

    setSelectedSubmap: (index) => {
      set(state => ({ editor: { ...state.editor, selectedSubmapIndex: index } }))
    },

    enterMeasureMode: (courseId) => {
      set(state => ({
        editor: {
          ...state.editor,
          measureMode: true,
          measureCourseId: courseId,
          measureHiddenLegs: [],
          layoutMode: false,
          layoutCourseId: null,
          selectedCourseId: courseId,
          activeTool: 'select',
          selectedControlId: null,
          selectedAnnotationId: null,
          selectedOverlayId: null,
        },
      }))
    },

    exitMeasureMode: () => {
      set(state => ({ editor: { ...state.editor, measureMode: false, measureCourseId: null } }))
    },

    toggleMeasureLeg: (legKey) => {
      set(state => {
        const hidden = state.editor.measureHiddenLegs
        const next = hidden.includes(legKey) ? hidden.filter(k => k !== legKey) : [...hidden, legKey]
        return { editor: { ...state.editor, measureHiddenLegs: next } }
      })
    },

    setMeasureHiddenLegs: (legKeys) => {
      set(state => ({ editor: { ...state.editor, measureHiddenLegs: legKeys } }))
    },

    setSelectedOverlay: (id) => {
      set(state => ({
        editor: { ...state.editor, selectedOverlayId: id, selectedControlId: id ? null : state.editor.selectedControlId, selectedAnnotationId: id ? null : state.editor.selectedAnnotationId },
      }))
    },

    setMapSaturation: (saturation) => {
      set(state => ({ editor: { ...state.editor, mapSaturation: saturation } }))
    },

    setOverprint: (overprint) => {
      const v = Math.max(0, Math.min(1, overprint))
      mutateProjectSilent(p => { p.overprint = v })
    },

    setOverprintMode: (mode) => {
      mutateProjectSilent(p => { p.overprintMode = mode })
    },

    setGapSize: (size) => {
      set(state => ({ editor: { ...state.editor, gapSize: size } }))
    },

    setGapRebuild: (on) => {
      set(state => ({ editor: { ...state.editor, gapRebuild: on } }))
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
      const { undoStack, project, redoStack, editor } = get()
      if (undoStack.length === 0 || !project) return
      const prev = undoStack[undoStack.length - 1]
      set({
        project: prev,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, structuredClone(project)],
        // Re-snap the layout viewport onto the restored mapCenter (see MapCanvas).
        ...(editor.layoutMode ? { editor: { ...editor, layoutSnapRequest: editor.layoutSnapRequest + 1 } } : {}),
      })
    },

    redo: () => {
      const { redoStack, project, undoStack, editor } = get()
      if (redoStack.length === 0 || !project) return
      const next = redoStack[redoStack.length - 1]
      set({
        project: next,
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack, structuredClone(project)],
        ...(editor.layoutMode ? { editor: { ...editor, layoutSnapRequest: editor.layoutSnapRequest + 1 } } : {}),
      })
    },
  }
})

useStore.subscribe((state, prev) => {
  if (state.project && state.project !== prev.project) {
    debouncedSave(state.project, state.mapFileData)
  }
})
