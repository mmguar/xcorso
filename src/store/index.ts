import { create } from 'zustand'
import type { Project } from '../types'
import type { Store, StoreHelpers, UndoEntry } from './types'
import { defaultEditor } from './types'
import { debouncedSave, loadProject as loadPersistedProject, setActiveId, flushSave, getSyncMeta, setSyncMeta } from '../lib/persistence'
import * as persistence from '../lib/persistence'
import { uploadProject, downloadProject, createCloudProject, hashMap, hashProject, fetchHistory, restoreVersion as restoreCloudVersion, fetchCloudProjects } from '../lib/sync'
import type { SyncMeta } from '../lib/sync'
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

// structuredClone copies string bytes, and imageOverlay dataUrls can be MBs.
// Strings are immutable, so every clone (undo snapshots included) shares them.
function cloneProject(project: Project): Project {
  const overlays = project.imageOverlays
  if (!overlays?.length) return timeClone('project', project)
  const clone = timeClone('project', { ...project, imageOverlays: overlays.map(o => ({ ...o, dataUrl: '' })) })
  clone.imageOverlays.forEach((o, i) => { o.dataUrl = overlays[i].dataUrl })
  return clone
}

export const useStore = create<Store>((set, get) => {
  // Standalone snapshots (drag starts) must clone: silent mutations then edit
  // the current project in place, and the snapshot has to stay frozen.
  function pushUndoSnapshot(label = 'Edit') {
    const { project, undoStack } = get()
    if (!project) return
    set({
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), { project: cloneProject(project), label }],
      redoStack: [],
    })
  }

  function mutateProjectCore(fn: (p: Project) => void, label = 'Edit', skipLock = false) {
    const { project, projectRole, undoStack } = get()
    if (!project || projectRole === 'viewer' || (!skipLock && project.locked)) return
    const p = cloneProject(project)
    p.meta.updatedAt = new Date().toISOString()
    fn(p)
    // The replaced project object is frozen from here on (in-place mutations
    // only ever touch the current one), so the undo stack holds it by reference.
    set({
      project: p,
      projectRevision: get().projectRevision + 1,
      syncStatus: 'idle',
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), { project, label }],
      redoStack: [],
    })
  }

  function mutateProjectSilentCore(fn: (p: Project) => void, skipLock = false) {
    const { project, projectRole } = get()
    if (!project || projectRole === 'viewer' || (!skipLock && project.locked)) return
    fn(project)
    set({ project: { ...project } as Project, projectRevision: get().projectRevision + 1, syncStatus: 'idle' })
  }

  const mutateProject = (fn: (p: Project) => void, label?: string) => mutateProjectCore(fn, label)
  const mutateProjectSilent = (fn: (p: Project) => void) => mutateProjectSilentCore(fn)
  // Layout mutations bypass the lock — layout editing is allowed while locked.
  const mutateProjectLayout = (fn: (p: Project) => void, label?: string) => mutateProjectCore(fn, label, true)
  const mutateProjectLayoutSilent = (fn: (p: Project) => void) => mutateProjectSilentCore(fn, true)

  const h: StoreHelpers = { mutateProject, mutateProjectSilent, pushUndoSnapshot }
  const layoutH: StoreHelpers = { mutateProject: mutateProjectLayout, mutateProjectSilent: mutateProjectLayoutSilent, pushUndoSnapshot }

  return {
    projectId: null,
    project: null,
    projectRevision: 0,
    loadedRevision: 0,
    mapFileData: null,
    loadedMap: null,
    undoStack: [],
    redoStack: [],
    editor: defaultEditor,
    cloudUser: null,
    syncStatus: 'idle',
    syncConflict: null,
    versionHistory: [],
    projectRole: 'owner' as const,
    localSaveFailed: false,

    // ── Project lifecycle ─────────────────────────────────────────────────

    createProject: (name, mapConfig, mapData, spec) => {
      const id = crypto.randomUUID()
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
      const rev = get().projectRevision + 1
      set({ projectId: id, project, mapFileData: mapData, loadedMap: null, undoStack: [], redoStack: [], projectRevision: rev, loadedRevision: rev })
      setActiveId(id).catch(() => {})
    },

    loadProject: (project, mapData, id, role) => {
      // Session restores need the same migrations/defaults as .oco loads.
      // normalizeProject also validates; session data was written by us, so on
      // an unexpected failure keep the project as-is rather than losing it.
      try { project = normalizeProject(project) } catch { /* keep as-is */ }
      if (!project.scaleBars) project.scaleBars = []
      if (!project.textLabels) project.textLabels = []
      if (!project.imageOverlays) project.imageOverlays = []
      const projectId = id ?? get().projectId ?? crypto.randomUUID()
      const rev = get().projectRevision + 1
      set({ projectId, project, mapFileData: mapData, loadedMap: null, undoStack: [], redoStack: [], editor: defaultEditor, syncStatus: 'idle', syncConflict: null, projectRole: role ?? 'owner', projectRevision: rev, loadedRevision: rev })
      setActiveId(projectId).catch(() => {})
    },

    updateProjectName: (name) => {
      mutateProject(p => { p.meta.name = name }, `Rename project → "${name}"`)
    },

    updateProjectSpec: (spec) => {
      mutateProject(p => { p.spec = spec }, 'Update event spec')
    },

    // ── Map ──────────────────────────────────────────────────────────────

    setMapScale: (scale, source) => {
      mutateProject(p => { p.map.scale = scale; p.map.scaleSource = source }, `Set scale 1:${scale}`)
    },

    setMapScaleMeasurement: (p1, p2, realWorldMeters, renderScale) => {
      const pixelDist = distance(p1, p2)
      const effectiveDist = renderScale ? pixelDist / renderScale : pixelDist
      mutateProject(p => {
        p.map.scaleMeasurement = { p1, p2, realWorldMeters }
        p.map.scaleSource = 'manual'
        p.map.scale = Math.round((realWorldMeters * 1000) / effectiveDist)
      }, 'Calibrate map scale')
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
      }, 'Replace map file')
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
    ...createLayoutSlice(set, get, layoutH),

    // ── Map rendering ────────────────────────────────────────────────────

    setLoadedMap: (map) => set({ loadedMap: map }),

    // ── Editor UI ─────────────────────────────────────────────────────────

    toggleLocked: () => {
      mutateProjectLayout(p => { p.locked = !p.locked }, 'Toggle lock')
    },

    toggleIgnoreCriterion: (criterionId) => {
      set(s => {
        const arr = s.editor.validationIgnoredCriteria
        const next = arr.includes(criterionId) ? arr.filter(x => x !== criterionId) : [...arr, criterionId]
        return { editor: { ...s.editor, validationIgnoredCriteria: next } }
      })
    },

    toggleIgnoreInstance: (instanceKey) => {
      set(s => {
        const arr = s.editor.validationIgnoredInstances
        const next = arr.includes(instanceKey) ? arr.filter(x => x !== instanceKey) : [...arr, instanceKey]
        return { editor: { ...s.editor, validationIgnoredInstances: next } }
      })
    },

    setActiveTool: (tool) => {
      set(state => ({
        editor: { ...state.editor, activeTool: tool, pendingAnnotationPoints: [], gapRebuild: tool === 'gap' ? state.editor.gapRebuild : false },
      }))
    },

    setSelectedControl: (id) => {
      set(state => ({ editor: { ...state.editor, selectedControlId: id, selectedOverlayId: id ? null : state.editor.selectedOverlayId, selectedAnnotationId: id ? null : state.editor.selectedAnnotationId } }))
    },

    setDraggingControl: (id) => {
      set(state => ({ editor: { ...state.editor, draggingControlId: id } }))
    },

    setDraggingLabel: (controlId) => {
      set(state => ({ editor: { ...state.editor, draggingLabelControlId: controlId } }))
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
            courseViewMode: id ? 'single' : 'all-controls',
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

    setAllCoursesView: () => {
      set(state => {
        const tool = state.editor.activeTool
        const courseOnlyTool = tool === 'gap' || tool === 'bend'
        const leavingMeasure = state.editor.measureMode
        return {
          editor: {
            ...state.editor,
            ...(leavingMeasure ? { measureMode: false, measureCourseId: null, measureHiddenLegs: [] } : {}),
            selectedCourseId: null,
            courseViewMode: 'all-courses',
            selectedVariationId: null,
            selectedSubmapIndex: null,
            activeTool: courseOnlyTool ? 'select' : tool,
            pendingAnnotationPoints: [],
          },
        }
      })
    },

    setSelectedSubmap: (index) => {
      set(state => ({ editor: { ...state.editor, selectedSubmapIndex: index } }))
    },

    requestCenterOnControl: (controlId) => {
      const ctrl = get().project?.controls.find(c => c.id === controlId)
      if (!ctrl) return
      set(state => ({
        editor: {
          ...state.editor,
          centerRequest: { point: { ...ctrl.position }, seq: (state.editor.centerRequest?.seq ?? 0) + 1 },
        },
      }))
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
          courseViewMode: 'single',
          activeTool: 'select',
          selectedControlId: null,
          selectedAnnotationId: null,
          selectedOverlayId: null,
        },
      }))
    },

    exitMeasureMode: () => {
      set(state => ({ editor: { ...state.editor, measureMode: false, measureCourseId: null, measureHiddenLegs: [] } }))
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

    switchProject: async (id) => {
      await flushSave()
      const saved = await loadPersistedProject(id)
      if (!saved) return
      get().loadProject(saved.project, saved.mapFileData, id)
    },

    // ── Cloud sync ───────────────────────────────────────────────────────

    setCloudUser: (user) => set({ cloudUser: user }),

    syncProject: async () => {
      const { project, projectId, mapFileData, cloudUser } = get()
      if (!project || !projectId || !cloudUser) return

      await flushSave()
      set({ syncStatus: 'syncing' })
      try {
        let syncMeta: SyncMeta | null = await getSyncMeta(projectId)

        // First sync: create cloud project
        if (!syncMeta) {
          const cloudId = await createCloudProject(project.meta.name)
          if (!cloudId) { set({ syncStatus: 'error' }); return }
          syncMeta = { cloudId, syncVersion: 0, syncedAt: '', mapHash: null }
        }

        const localMapHash = mapFileData ? await hashMap(mapFileData) : null
        const localProjectHash = await hashProject(project)

        // ponytail: skip upload if nothing changed since last sync
        if (syncMeta.syncVersion > 0 && localProjectHash === syncMeta.projectHash && localMapHash === syncMeta.mapHash) {
          set({ syncStatus: 'synced' })
          return
        }

        const result = await uploadProject(
          syncMeta.cloudId, project, mapFileData,
          localMapHash, syncMeta.mapHash, syncMeta.syncVersion,
        )

        if (result.status === 'ok') {
          const updated: SyncMeta = {
            cloudId: syncMeta.cloudId,
            syncVersion: result.version,
            syncedAt: new Date().toISOString(),
            mapHash: localMapHash,
            projectHash: localProjectHash,
          }
          await setSyncMeta(projectId, updated)
          set({ syncStatus: 'synced' })
        } else if (result.status === 'conflict') {
          const remote = await downloadProject(syncMeta.cloudId, syncMeta.mapHash)
          if (remote) {
            set({
              syncStatus: 'idle',
              syncConflict: {
                cloudId: syncMeta.cloudId,
                serverVersion: result.serverVersion,
                remoteProject: remote.project,
              },
            })
          } else {
            set({ syncStatus: 'error' })
          }
        } else {
          set({ syncStatus: 'error' })
        }
      } catch {
        set({ syncStatus: navigator.onLine ? 'error' : 'offline' })
      }
    },

    saveSnapshot: async () => {
      const { project, projectId, mapFileData, cloudUser } = get()
      if (!project || !projectId || !cloudUser) return

      await flushSave()
      set({ syncStatus: 'syncing' })
      try {
        let syncMeta: SyncMeta | null = await getSyncMeta(projectId)
        if (!syncMeta) {
          const cloudId = await createCloudProject(project.meta.name)
          if (!cloudId) { set({ syncStatus: 'error' }); return }
          syncMeta = { cloudId, syncVersion: 0, syncedAt: '', mapHash: null }
        }

        const localMapHash = mapFileData ? await hashMap(mapFileData) : null
        const result = await uploadProject(
          syncMeta.cloudId, project, mapFileData,
          localMapHash, syncMeta.mapHash, syncMeta.syncVersion, true,
        )

        if (result.status === 'ok') {
          await setSyncMeta(projectId, {
            cloudId: syncMeta.cloudId, syncVersion: result.version,
            syncedAt: new Date().toISOString(), mapHash: localMapHash,
          })
          set({ syncStatus: 'synced' })
          await get().fetchVersionHistory()
        } else if (result.status === 'conflict') {
          set({ syncStatus: 'error' })
        } else {
          set({ syncStatus: 'error' })
        }
      } catch {
        set({ syncStatus: navigator.onLine ? 'error' : 'offline' })
      }
    },

    fetchVersionHistory: async () => {
      const { projectId } = get()
      if (!projectId) return
      const syncMeta = await getSyncMeta(projectId)
      if (!syncMeta) { set({ versionHistory: [] }); return }
      const history = await fetchHistory(syncMeta.cloudId)
      set({ versionHistory: history })
    },

    restoreVersion: async (version) => {
      const { projectId, mapFileData } = get()
      if (!projectId) return
      const syncMeta = await getSyncMeta(projectId)
      if (!syncMeta) return

      const newVersion = await restoreCloudVersion(syncMeta.cloudId, version)
      if (newVersion == null) return

      const remote = await downloadProject(syncMeta.cloudId, syncMeta.mapHash)
      if (!remote) return

      get().loadProject(remote.project, remote.mapData ?? mapFileData)
      await setSyncMeta(projectId, {
        cloudId: syncMeta.cloudId, syncVersion: remote.version,
        syncedAt: new Date().toISOString(), mapHash: remote.mapHash,
      })
      set({ syncStatus: 'synced' })
      await get().fetchVersionHistory()
    },

    resolveConflict: async (keep) => {
      const { syncConflict, projectId, project, mapFileData } = get()
      if (!syncConflict || !projectId) return

      try {
        let ok = false
        if (keep === 'remote') {
          const remote = await downloadProject(syncConflict.cloudId, null)
          if (remote) {
            get().loadProject(remote.project, remote.mapData ?? mapFileData)
            await setSyncMeta(projectId, {
              cloudId: syncConflict.cloudId,
              syncVersion: syncConflict.serverVersion,
              syncedAt: new Date().toISOString(),
              mapHash: remote.mapHash,
            })
            ok = true
          }
        } else if (keep === 'local' && project) {
          await flushSave()
          const localMapHash = mapFileData ? await hashMap(mapFileData) : null
          // Overwrite the server version we saw in the conflict — the server
          // requires If-Match, so a still-newer push surfaces as a fresh conflict.
          const result = await uploadProject(
            syncConflict.cloudId, project, mapFileData,
            localMapHash, null, syncConflict.serverVersion,
          )
          if (result.status === 'ok') {
            await setSyncMeta(projectId, {
              cloudId: syncConflict.cloudId,
              syncVersion: result.version,
              syncedAt: new Date().toISOString(),
              mapHash: localMapHash,
            })
            ok = true
          }
        }
        set({ syncConflict: null, syncStatus: ok ? 'synced' : 'error' })
      } catch (e) {
        console.error('resolveConflict failed:', e)
        set({ syncConflict: null, syncStatus: 'error' })
      }
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
    },

    checkForRemoteUpdate: async () => {
      const { projectId, cloudUser, mapFileData } = get()
      if (!projectId || !cloudUser) return
      const syncMeta = await getSyncMeta(projectId)
      if (!syncMeta) return

      try {
        const cloudProjects = await fetchCloudProjects()
        const cp = cloudProjects.find(p => p.id === syncMeta.cloudId)
        if (!cp) return
        if (cp.version === syncMeta.syncVersion) { set({ syncStatus: 'synced' }); return }
        if (cp.version < syncMeta.syncVersion) return

        const { project } = get()
        if (project && project.meta.updatedAt > syncMeta.syncedAt) {
          // Local unsynced edits + remote newer = conflict
          const remote = await downloadProject(syncMeta.cloudId, syncMeta.mapHash)
          if (remote) {
            set({
              syncConflict: {
                cloudId: syncMeta.cloudId,
                serverVersion: cp.version,
                remoteProject: remote.project,
              },
            })
          }
          return
        }

        const remote = await downloadProject(syncMeta.cloudId, syncMeta.mapHash)
        if (!remote) return
        get().loadProject(remote.project, remote.mapData ?? mapFileData, projectId)
        await setSyncMeta(projectId, {
          cloudId: syncMeta.cloudId,
          syncVersion: remote.version,
          syncedAt: new Date().toISOString(),
          mapHash: remote.mapHash,
        })
        set({ syncStatus: 'synced' })
      } catch {
        // Silently fail — local version is still usable
      }
    },

    // ── Undo / Redo ───────────────────────────────────────────────────────

    undo: () => {
      const { undoStack, project, redoStack, editor, projectRevision } = get()
      if (undoStack.length === 0 || !project) return
      const entry = undoStack[undoStack.length - 1]
      set({
        project: entry.project,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        undoStack: undoStack.slice(0, -1),
        // Ref, not clone: the outgoing project stops being current right here,
        // and only the current project is ever mutated in place.
        redoStack: [...redoStack, { project, label: entry.label }],
        ...(editor.layoutMode ? { editor: { ...editor, layoutSnapRequest: editor.layoutSnapRequest + 1 } } : {}),
      })
    },

    redo: () => {
      const { redoStack, project, undoStack, editor, projectRevision } = get()
      if (redoStack.length === 0 || !project) return
      const entry = redoStack[redoStack.length - 1]
      set({
        project: entry.project,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack, { project, label: entry.label }],
        ...(editor.layoutMode ? { editor: { ...editor, layoutSnapRequest: editor.layoutSnapRequest + 1 } } : {}),
      })
    },

    jumpToHistory: (index: number) => {
      const { undoStack, project, editor, projectRevision } = get()
      if (!project || index < 0 || index >= undoStack.length) return
      // Entries being sliced out of undoStack are already independent clones,
      // so move them directly to redo — redo() clones when it pops.
      const newRedo: UndoEntry[] = []
      newRedo.push({ project, label: undoStack[undoStack.length - 1].label })
      for (let i = undoStack.length - 1; i > index + 1; i--) {
        newRedo.push({ project: undoStack[i].project, label: undoStack[i - 1].label })
      }
      if (index + 1 < undoStack.length) {
        newRedo.push({ project: undoStack[index + 1].project, label: undoStack[index].label })
      }
      set({
        project: undoStack[index].project,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        undoStack: undoStack.slice(0, index),
        redoStack: newRedo,
        ...(editor.layoutMode ? { editor: { ...editor, layoutSnapRequest: editor.layoutSnapRequest + 1 } } : {}),
      })
    },
  }
})

persistence.setOnSaveError(() => useStore.setState({ localSaveFailed: true }))

let syncTimer: ReturnType<typeof setTimeout> | null = null

useStore.subscribe((state, prev) => {
  if (state.project && state.projectId && state.project !== prev.project && state.projectRole !== 'viewer') {
    debouncedSave(state.projectId, state.project, state.mapFileData)

    // Auto-sync to cloud after 5 minutes of inactivity — but not on initial load
    // (project just loaded from IDB/cloud, nothing to push back).
    const isProjectSwitch = !prev.project || state.projectId !== prev.projectId
    if (state.cloudUser && !isProjectSwitch && state.project.map.type === 'ocad') {
      if (syncTimer) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => { syncTimer = null; state.syncProject() }, 300_000)
    }
  }
})
