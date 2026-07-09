import { create } from 'zustand'
import type { Project } from '../types'
import type { EditorState, Store, StoreHelpers, UndoEntry } from './types'
import { defaultEditor } from './types'
import { debouncedSave, loadProject as loadPersistedProject, setActiveId, flushSave, getSyncMeta, setSyncMeta, clearSyncMeta } from '../lib/persistence'
import * as persistence from '../lib/persistence'
import { uploadProject, downloadProject, createCloudProject, hashMap, hashProject, makeSyncMeta, fetchHistory, restoreVersion as restoreCloudVersion, fetchCloudProjects, fetchSharedProjects } from '../lib/sync'
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

// ── Per-project web lock: detects the same project open in two tabs ────────
// ponytail: detection only, editing is not blocked; and the flag doesn't
// clear if the other tab closes later — refresh does. Real multi-tab
// coordination (BroadcastChannel) only if users actually hit this.
let releaseTabLock: (() => void) | null = null
let heldLockId: string | null = null

function acquireTabLock(id: string) {
  if (!('locks' in navigator)) return
  if (heldLockId === id) return
  releaseTabLock?.()
  releaseTabLock = null
  heldLockId = null
  navigator.locks.request(`xcorso-project-${id}`, { ifAvailable: true }, lock => {
    if (!lock) {
      useStore.setState({ tabConflict: true })
      return
    }
    heldLockId = id
    useStore.setState({ tabConflict: false })
    // Hold until the next acquireTabLock or tab close.
    return new Promise<void>(resolve => { releaseTabLock = resolve })
  }).catch(() => {})
}

// Undo/redo swap the project wholesale, so editor selections and modes can be
// left pointing at objects the restored project no longer contains (undo of
// "Add course" while it's selected, redo of a delete). Null out anything
// dangling — render code guards against these ids, but acting on them mints
// phantom mutations.
function reconcileEditorSelections(project: Project, editor: EditorState): EditorState {
  const patch: Partial<EditorState> = {}
  if (editor.selectedControlId && !project.controls.some(c => c.id === editor.selectedControlId)) {
    patch.selectedControlId = null
  }
  const course = editor.selectedCourseId ? project.courses.find(c => c.id === editor.selectedCourseId) : undefined
  if (editor.selectedCourseId && !course) {
    patch.selectedCourseId = null
    patch.selectedVariationId = null
    patch.selectedSubmapIndex = null
    if (editor.courseViewMode === 'single') patch.courseViewMode = 'all-controls'
    if (editor.activeTool === 'gap' || editor.activeTool === 'bend') patch.activeTool = 'select'
  } else if (editor.selectedVariationId && course && !course.variations?.some(v => v.id === editor.selectedVariationId)) {
    patch.selectedVariationId = null
  }
  if (editor.selectedOverlayId) {
    const id = editor.selectedOverlayId
    if (!project.scaleBars.some(s => s.id === id)
        && !project.textLabels.some(t => t.id === id)
        && !project.imageOverlays.some(o => o.id === id)) {
      patch.selectedOverlayId = null
    }
  }
  if (editor.selectedAnnotationId && !project.annotations.some(a => a.id === editor.selectedAnnotationId)) {
    patch.selectedAnnotationId = null
  }
  if (editor.measureMode && editor.measureCourseId && !project.courses.some(c => c.id === editor.measureCourseId)) {
    patch.measureMode = false
    patch.measureCourseId = null
    patch.measureHiddenLegs = []
  }
  if (editor.layoutMode && editor.layoutCourseId && !project.courses.some(c => c.id === editor.layoutCourseId)) {
    patch.layoutMode = false
    patch.layoutCourseId = null
    patch.layoutSubmapIndex = 0
    patch.selectedSubmapIndex = null
  }
  return Object.keys(patch).length > 0 ? { ...editor, ...patch } : editor
}

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
  // Same viewer/locked guard as the mutation helpers — a snapshot whose
  // mutations get swallowed is a phantom undo entry.
  function pushUndoSnapshotCore(label = 'Edit', skipLock = false) {
    const { project, undoStack, projectRole } = get()
    if (!project || projectRole === 'viewer' || (!skipLock && project.locked)) return
    set({
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), { project: cloneProject(project), label }],
      redoStack: [],
    })
  }
  const pushUndoSnapshot = (label?: string) => pushUndoSnapshotCore(label)
  const pushUndoSnapshotLayout = (label?: string) => pushUndoSnapshotCore(label, true)

  function mutateProjectCore(fn: (p: Project) => void | false, label = 'Edit', skipLock = false): boolean {
    const { project, projectRole, undoStack } = get()
    if (!project || projectRole === 'viewer' || (!skipLock && project.locked)) return false
    const p = cloneProject(project)
    // fn returning false signals "nothing to change" — drop the clone so a
    // stale-id call doesn't push an undo entry or dirty the project.
    if (fn(p) === false) return false
    p.meta.updatedAt = new Date().toISOString()
    // The replaced project object is frozen from here on (in-place mutations
    // only ever touch the current one), so the undo stack holds it by reference.
    set({
      project: p,
      projectRevision: get().projectRevision + 1,
      syncStatus: 'idle',
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), { project, label }],
      redoStack: [],
    })
    return true
  }

  function mutateProjectSilentCore(fn: (p: Project) => void | false, skipLock = false): boolean {
    const { project, projectRole } = get()
    if (!project || projectRole === 'viewer' || (!skipLock && project.locked)) return false
    // Silent callbacks must guard before mutating: the current project is
    // edited in place, so a false return can't roll anything back.
    if (fn(project) === false) return false
    // Bump updatedAt so drag-only sessions still sort/display as modified
    // (sync dirty-checks use content hashes, not this timestamp). Safe to
    // mutate in place: the current project is never aliased into the stacks.
    project.meta.updatedAt = new Date().toISOString()
    set({ project: { ...project } as Project, projectRevision: get().projectRevision + 1, syncStatus: 'idle' })
    return true
  }

  const mutateProject = (fn: (p: Project) => void | false, label?: string) => mutateProjectCore(fn, label)
  const mutateProjectSilent = (fn: (p: Project) => void | false) => mutateProjectSilentCore(fn)
  // Layout mutations bypass the lock — layout editing is allowed while locked.
  const mutateProjectLayout = (fn: (p: Project) => void | false, label?: string) => mutateProjectCore(fn, label, true)
  const mutateProjectLayoutSilent = (fn: (p: Project) => void | false) => mutateProjectSilentCore(fn, true)

  const h: StoreHelpers = { mutateProject, mutateProjectSilent, pushUndoSnapshot }
  const layoutH: StoreHelpers = { mutateProject: mutateProjectLayout, mutateProjectSilent: mutateProjectLayoutSilent, pushUndoSnapshot: pushUndoSnapshotLayout }

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
    tabConflict: false,

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
      // An auto-sync armed for the previous project must not fire on this one
      // — it could even first-sync-create a cloud copy uninvited.
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
      setActiveId(id).catch(() => {})
      acquireTabLock(id)
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
      // An auto-sync armed for the previous project must not fire on this one
      // — it could even first-sync-create a cloud copy uninvited.
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
      setActiveId(projectId).catch(() => {})
      acquireTabLock(projectId)
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
      const { project, projectRole, undoStack, redoStack, projectRevision } = get()
      if (!project || projectRole === 'viewer' || project.locked) return
      // Not undoable: the map bytes aren't in the undo snapshots, so restoring
      // an older map config would desync it from mapFileData. Instead, graft
      // the new file identity onto every history entry — undo keeps working
      // across the replacement and never reverts the map itself.
      const retarget = (p: Project): Project => ({ ...p, map: { ...p.map, filename, type } })
      const cur = retarget(project)
      cur.meta = { ...cur.meta, updatedAt: new Date().toISOString() }
      set({
        project: cur,
        mapFileData: mapData,
        loadedMap: null,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        undoStack: undoStack.map(e => ({ ...e, project: retarget(e.project) })),
        redoStack: redoStack.map(e => ({ ...e, project: retarget(e.project) })),
      })
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

    toggleAllCoursesHidden: (courseId) => {
      set(state => {
        const h = state.editor.allCoursesHidden
        const next = h.includes(courseId) ? h.filter(id => id !== courseId) : [...h, courseId]
        return { editor: { ...state.editor, allCoursesHidden: next } }
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
      // Silent per slider tick; the slider pushes one beginEdit snapshot per drag.
      mutateProjectSilent(p => { p.overprint = v })
    },

    setOverprintMode: (mode) => {
      mutateProject(p => {
        if (p.overprintMode === mode) return false
        p.overprintMode = mode
      }, 'Change overprint mode')
    },

    beginEdit: (label) => pushUndoSnapshot(label),

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
      const syncMeta = await getSyncMeta(id)
      get().loadProject(saved.project, saved.mapFileData, id, syncMeta?.role)
      // The IDB copy may be stale — pull remote if it advanced (the
      // welcome-screen switch path already does this; the header switcher
      // lands here).
      get().checkForRemoteUpdate()
    },

    // ── Cloud sync ───────────────────────────────────────────────────────

    setCloudUser: (user) => set({ cloudUser: user }),

    syncProject: async () => {
      const { project, projectId, mapFileData, cloudUser, projectRole, syncStatus, syncConflict } = get()
      if (!project || !projectId || !cloudUser || projectRole === 'viewer') return
      // Re-entry guard: the 5-min auto-sync timer can fire mid-manual-sync or
      // while the conflict dialog is open; the loser of two concurrent uploads
      // 409s and raises a phantom conflict with identical content. Set
      // 'syncing' before the first await so the guard has no gap.
      if (syncStatus === 'syncing' || syncConflict) return
      set({ syncStatus: 'syncing' })

      await flushSave()
      try {
        let syncMeta: SyncMeta | null = await getSyncMeta(projectId)

        // First sync: create cloud project. Owned projects only — creating one
        // for a shared project would silently fork it into this user's account.
        if (!syncMeta) {
          if (projectRole !== 'owner') { set({ syncStatus: 'error' }); return }
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
            ...(syncMeta.role ? { role: syncMeta.role } : {}),
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
        } else if (result.status === 'not-found') {
          // The cloud project vanished — deleted on another device, or share
          // access revoked. A dangling cloudId means every future sync 404s
          // with no way out, so detach and recover here.
          await clearSyncMeta(projectId)
          if (syncMeta.role) {
            // Shared copy: the share is gone, so this becomes an ordinary
            // local project owned by this user. Next sync uploads it as such.
            set({ syncStatus: 'idle', projectRole: 'owner' })
          } else {
            // Owned: re-create in the cloud and re-upload (no recursion — a
            // fresh project can legitimately 404 only on server breakage).
            const cloudId = await createCloudProject(project.meta.name)
            if (!cloudId) { set({ syncStatus: 'error' }); return }
            const retry = await uploadProject(cloudId, project, mapFileData, localMapHash, null, 0)
            if (retry.status === 'ok') {
              await setSyncMeta(projectId, await makeSyncMeta(cloudId, retry.version, localMapHash, project))
              set({ syncStatus: 'synced' })
            } else {
              set({ syncStatus: 'error' })
            }
          }
        } else {
          set({ syncStatus: 'error' })
        }
      } catch {
        set({ syncStatus: navigator.onLine ? 'error' : 'offline' })
      }
    },

    saveSnapshot: async () => {
      const { project, projectId, mapFileData, cloudUser, projectRole, syncStatus, syncConflict } = get()
      if (!project || !projectId || !cloudUser || projectRole === 'viewer') return
      // Same re-entry guard as syncProject.
      if (syncStatus === 'syncing' || syncConflict) return
      set({ syncStatus: 'syncing' })

      await flushSave()
      try {
        let syncMeta: SyncMeta | null = await getSyncMeta(projectId)
        if (!syncMeta) {
          if (projectRole !== 'owner') { set({ syncStatus: 'error' }); return }
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
          await setSyncMeta(projectId, await makeSyncMeta(syncMeta.cloudId, result.version, localMapHash, project, syncMeta.role))
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

      get().loadProject(remote.project, remote.mapData ?? mapFileData, projectId, syncMeta.role)
      // Hash the store's project (loadProject normalizes it), not remote.project.
      await setSyncMeta(projectId, await makeSyncMeta(syncMeta.cloudId, remote.version, remote.mapHash, get().project!, syncMeta.role))
      set({ syncStatus: 'synced' })
      await get().fetchVersionHistory()
    },

    resolveConflict: async (keep) => {
      const { syncConflict, projectId, project, mapFileData } = get()
      if (!syncConflict || !projectId) return

      try {
        let ok = false
        const role = (await getSyncMeta(projectId))?.role
        if (keep === 'remote') {
          const remote = await downloadProject(syncConflict.cloudId, null)
          if (remote) {
            get().loadProject(remote.project, remote.mapData ?? mapFileData, projectId, role)
            // remote.version, not syncConflict.serverVersion: the server may have
            // advanced since the 409, and recording the stale version makes the
            // next sync 409 again with identical content.
            await setSyncMeta(projectId, await makeSyncMeta(syncConflict.cloudId, remote.version, remote.mapHash, get().project!, role))
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
            await setSyncMeta(projectId, await makeSyncMeta(syncConflict.cloudId, result.version, localMapHash, project, role))
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
      const { projectId, cloudUser, mapFileData, syncStatus, syncConflict } = get()
      if (!projectId || !cloudUser) return
      // Don't race an in-flight sync or stack onto an open conflict dialog.
      if (syncStatus === 'syncing' || syncConflict) return
      const syncMeta = await getSyncMeta(projectId)
      if (!syncMeta) return

      try {
        // Shared projects live in the owner's index, not this user's, so their
        // version comes from the shared-with-me list.
        const remoteVersion = syncMeta.role
          ? (await fetchSharedProjects()).find(p => p.projectId === syncMeta.cloudId)?.version
          : (await fetchCloudProjects()).find(p => p.id === syncMeta.cloudId)?.version
        if (remoteVersion == null || remoteVersion < syncMeta.syncVersion) return

        const { project } = get()
        // Dirty check by content hash — robust regardless of updatedAt
        // semantics; the timestamp compare survives only as a legacy fallback
        // for sync meta written before projectHash existed.
        const dirty = project != null && (syncMeta.projectHash
          ? await hashProject(project) !== syncMeta.projectHash
          : project.meta.updatedAt > syncMeta.syncedAt) // legacy meta without hash

        if (remoteVersion === syncMeta.syncVersion) {
          // "Synced" disarms the unsaved-changes guards, so only claim it when
          // local content actually matches what was last synced.
          if (!dirty) set({ syncStatus: 'synced' })
          return
        }

        if (project && dirty) {
          // Local unsynced edits + remote newer = conflict
          const remote = await downloadProject(syncMeta.cloudId, syncMeta.mapHash)
          if (remote) {
            set({
              syncConflict: {
                cloudId: syncMeta.cloudId,
                serverVersion: remoteVersion,
                remoteProject: remote.project,
              },
            })
          }
          return
        }

        const remote = await downloadProject(syncMeta.cloudId, syncMeta.mapHash)
        if (!remote) return
        get().loadProject(remote.project, remote.mapData ?? mapFileData, projectId, syncMeta.role)
        await setSyncMeta(projectId, await makeSyncMeta(syncMeta.cloudId, remote.version, remote.mapHash, get().project!, syncMeta.role))
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
      let ed = reconcileEditorSelections(entry.project, editor)
      if (ed.layoutMode) ed = { ...ed, layoutSnapRequest: ed.layoutSnapRequest + 1 }
      set({
        project: entry.project,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        undoStack: undoStack.slice(0, -1),
        // Ref, not clone: the outgoing project stops being current right here,
        // and only the current project is ever mutated in place.
        redoStack: [...redoStack, { project, label: entry.label }],
        ...(ed !== editor ? { editor: ed } : {}),
      })
    },

    redo: () => {
      const { redoStack, project, undoStack, editor, projectRevision } = get()
      if (redoStack.length === 0 || !project) return
      const entry = redoStack[redoStack.length - 1]
      let ed = reconcileEditorSelections(entry.project, editor)
      if (ed.layoutMode) ed = { ...ed, layoutSnapRequest: ed.layoutSnapRequest + 1 }
      set({
        project: entry.project,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        redoStack: redoStack.slice(0, -1),
        undoStack: [...undoStack, { project, label: entry.label }],
        ...(ed !== editor ? { editor: ed } : {}),
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
      let ed = reconcileEditorSelections(undoStack[index].project, editor)
      if (ed.layoutMode) ed = { ...ed, layoutSnapRequest: ed.layoutSnapRequest + 1 }
      set({
        project: undoStack[index].project,
        projectRevision: projectRevision + 1,
        syncStatus: 'idle',
        undoStack: undoStack.slice(0, index),
        redoStack: newRedo,
        ...(ed !== editor ? { editor: ed } : {}),
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
