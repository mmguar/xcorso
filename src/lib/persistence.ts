import type { Project } from '../types'
import type { SyncMeta } from './sync'

const DB_NAME = 'xcorso'
const DB_VERSION = 2
const PROJECTS_STORE = 'projects'
const MAPS_STORE = 'maps'
const META_STORE = 'meta'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  sync?: SyncMeta
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE)
      if (!db.objectStoreNames.contains(MAPS_STORE)) db.createObjectStore(MAPS_STORE)
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)

      // Migrate v1 → v2: move the single session into a project entry.
      if (req.transaction && db.objectStoreNames.contains('session')) {
        const tx = req.transaction
        const oldStore = tx.objectStore('session')
        const sessReq = oldStore.get('current')
        const mapReq = oldStore.get('current-map')
        let done = 0
        function tryMigrate() {
          if (++done < 2) return
          const sess = sessReq.result as { project?: Project; mapFileData?: ArrayBuffer | null } | undefined
          if (sess?.project) {
            const id = crypto.randomUUID()
            tx.objectStore(PROJECTS_STORE).put({ project: sess.project }, id)
            const mapData = sess.mapFileData ?? (mapReq.result as ArrayBuffer | undefined) ?? null
            tx.objectStore(MAPS_STORE).put(mapData, id)
            tx.objectStore(META_STORE).put(id, 'active')
          }
          db.deleteObjectStore('session')
        }
        sessReq.onsuccess = tryMigrate
        mapReq.onsuccess = tryMigrate
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(db: IDBDatabase, tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// ── Active project ID ──────────────────────────────────────────────────────

export async function getActiveId(): Promise<string | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(META_STORE, 'readonly')
    const req = tx.objectStore(META_STORE).get('active')
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve((req.result as string) ?? null) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch { return null }
}

export async function setActiveId(id: string | null): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(META_STORE, 'readwrite')
  if (id) tx.objectStore(META_STORE).put(id, 'active')
  else tx.objectStore(META_STORE).delete('active')
  return txDone(db, tx)
}

// ── Project CRUD ───────────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const db = await openDB()
    const tx = db.transaction(PROJECTS_STORE, 'readonly')
    const store = tx.objectStore(PROJECTS_STORE)
    const keysReq = store.getAllKeys()
    const valsReq = store.getAll()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close()
        const keys = keysReq.result as string[]
        const vals = valsReq.result as { project: Project; sync?: SyncMeta }[]
        const list: ProjectSummary[] = keys.map((id, i) => ({
          id,
          name: vals[i].project.meta.name,
          updatedAt: vals[i].project.meta.updatedAt,
          sync: vals[i].sync,
        }))
        list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        resolve(list)
      }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch { return [] }
}

// mapFileData: undefined = leave the stored map untouched; null = store "no map".
export async function saveProject(id: string, project: Project, mapFileData?: ArrayBuffer | null): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(mapFileData === undefined ? [PROJECTS_STORE] : [PROJECTS_STORE, MAPS_STORE], 'readwrite')
  const store = tx.objectStore(PROJECTS_STORE)
  const req = store.get(id)
  req.onsuccess = () => {
    const existing = req.result as { sync?: SyncMeta } | undefined
    store.put(existing?.sync ? { project, sync: existing.sync } : { project }, id)
  }
  if (mapFileData !== undefined) tx.objectStore(MAPS_STORE).put(mapFileData, id)
  return txDone(db, tx)
}

export async function loadProject(id: string): Promise<{ project: Project; mapFileData: ArrayBuffer | null } | null> {
  try {
    const db = await openDB()
    const tx = db.transaction([PROJECTS_STORE, MAPS_STORE], 'readonly')
    const projReq = tx.objectStore(PROJECTS_STORE).get(id)
    const mapReq = tx.objectStore(MAPS_STORE).get(id)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close()
        const sess = projReq.result as { project: Project } | undefined
        if (!sess) { resolve(null); return }
        const mapFileData = (mapReq.result as ArrayBuffer | undefined) ?? null
        lastSavedMaps.set(id, mapFileData)
        resolve({ project: sess.project, mapFileData })
      }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch { return null }
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction([PROJECTS_STORE, MAPS_STORE, META_STORE], 'readwrite')
  tx.objectStore(PROJECTS_STORE).delete(id)
  tx.objectStore(MAPS_STORE).delete(id)
  // If this was the active project, clear the active marker.
  const metaReq = tx.objectStore(META_STORE).get('active')
  metaReq.onsuccess = () => {
    if (metaReq.result === id) tx.objectStore(META_STORE).delete('active')
  }
  lastSavedMaps.delete(id)
  return txDone(db, tx)
}

// ── Sync metadata ─────────────────────────────────────────────────────────

export async function getSyncMeta(id: string): Promise<SyncMeta | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(PROJECTS_STORE, 'readonly')
    const req = tx.objectStore(PROJECTS_STORE).get(id)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve((req.result as { sync?: SyncMeta })?.sync ?? null) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch { return null }
}

export async function setSyncMeta(id: string, sync: SyncMeta): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(PROJECTS_STORE, 'readwrite')
  const store = tx.objectStore(PROJECTS_STORE)
  const req = store.get(id)
  req.onsuccess = () => {
    const entry = req.result as { project: Project; sync?: SyncMeta } | undefined
    if (entry) store.put({ ...entry, sync }, id)
  }
  return txDone(db, tx)
}

// ── Debounced autosave ─────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: { id: string; project: Project; mapFileData: ArrayBuffer | null } | null = null
const lastSavedMaps = new Map<string, ArrayBuffer | null | undefined>()
let saveErrorFired = false

let _onSaveError: (() => void) | null = null
export function setOnSaveError(fn: () => void) { _onSaveError = fn }

function handleSaveError(): void {
  if (saveErrorFired) return
  saveErrorFired = true
  _onSaveError?.()
}

function executeSave(id: string, project: Project, mapFileData: ArrayBuffer | null): Promise<void> {
  if (mapFileData !== lastSavedMaps.get(id)) {
    return saveProject(id, project, mapFileData)
      .then(() => { lastSavedMaps.set(id, mapFileData) })
  }
  return saveProject(id, project)
}

export function debouncedSave(id: string, project: Project, mapFileData: ArrayBuffer | null): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  pendingSave = { id, project, mapFileData }
  debounceTimer = setTimeout(() => {
    const s = pendingSave
    pendingSave = null
    debounceTimer = null
    if (s) executeSave(s.id, s.project, s.mapFileData).catch(handleSaveError)
  }, 500)
}

export async function flushSave(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const s = pendingSave
  pendingSave = null
  if (s) await executeSave(s.id, s.project, s.mapFileData).catch(handleSaveError)
}
