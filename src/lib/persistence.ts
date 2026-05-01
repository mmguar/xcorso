import type { Project } from '../types'

const DB_NAME = 'xcorso'
const DB_VERSION = 1
const STORE_NAME = 'session'
const SESSION_KEY = 'current'

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

export async function saveSession(project: Project, mapFileData: ArrayBuffer | null): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const data: SavedSession = { project, mapFileData }
  store.put(data, SESSION_KEY)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(SESSION_KEY)
    return new Promise((resolve, reject) => {
      req.onsuccess = () => { db.close(); resolve(req.result ?? null) }
      req.onerror = () => { db.close(); reject(req.error) }
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
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  } catch {
    // ignore
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function debouncedSave(project: Project, mapFileData: ArrayBuffer | null): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    saveSession(project, mapFileData).catch(() => {})
  }, 500)
}
