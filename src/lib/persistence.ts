import type { Project } from '../types'

const DB_NAME = 'xcorso'
const DB_VERSION = 1
const STORE_NAME = 'session'
const SESSION_KEY = 'current'
// The map file is stored under its own key: it is immutable between map
// replacements and can be tens of MB, so the per-edit autosave must not
// rewrite it alongside the project JSON.
const MAP_KEY = 'current-map'

interface SavedSession {
  project: Project
  mapFileData: ArrayBuffer | null
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
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

export async function saveSession(project: Project, mapFileData: ArrayBuffer | null): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  store.put({ project }, SESSION_KEY)
  store.put(mapFileData, MAP_KEY)
  return txDone(db, tx)
}

async function saveProjectOnly(project: Project): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put({ project }, SESSION_KEY)
  return txDone(db, tx)
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const sessReq = store.get(SESSION_KEY)
    const mapReq = store.get(MAP_KEY)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close()
        const sess = sessReq.result as (SavedSession & { mapFileData?: ArrayBuffer | null }) | undefined
        if (!sess) { resolve(null); return }
        // Legacy single-key sessions stored the map inline with the project.
        const mapFileData = sess.mapFileData ?? (mapReq.result as ArrayBuffer | undefined) ?? null
        lastSavedMap = mapFileData
        resolve({ project: sess.project, mapFileData })
      }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(SESSION_KEY)
    tx.objectStore(STORE_NAME).delete(MAP_KEY)
    lastSavedMap = undefined
    return txDone(db, tx)
  } catch {
    // ignore
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
// Reference of the last map buffer written (or restored) — the buffer never
// mutates, so an identity check is enough to skip the multi-MB rewrite.
let lastSavedMap: ArrayBuffer | null | undefined

export function debouncedSave(project: Project, mapFileData: ArrayBuffer | null): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (mapFileData !== lastSavedMap) {
      saveSession(project, mapFileData)
        .then(() => { lastSavedMap = mapFileData })
        .catch(() => {})
    } else {
      saveProjectOnly(project).catch(() => {})
    }
  }, 500)
}
