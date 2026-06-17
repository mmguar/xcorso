import type { Project } from '../types'

const API = '/api'

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface CloudUser {
  userId: string
  email: string
}

export async function fetchUser(): Promise<CloudUser | null> {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' })
    if (!res.ok) return null
    const { user } = await res.json() as { user: CloudUser | null }
    return user
  } catch { return null }
}

export async function sendCode(email: string): Promise<boolean> {
  const res = await fetch(`${API}/auth/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })
  return res.ok
}

export async function verifyCode(email: string, code: string): Promise<CloudUser | null> {
  const res = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, code }),
  })
  if (!res.ok) return null
  const data = await res.json() as { userId: string; email: string }
  return { userId: data.userId, email: data.email }
}

export async function logout(): Promise<void> {
  await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' })
}

export async function deleteAccount(): Promise<boolean> {
  const res = await fetch(`${API}/auth/account`, { method: 'DELETE', credentials: 'include' })
  return res.ok
}

// ── Cloud project list ────────────────────────────────────────────────────────

export interface CloudProjectMeta {
  id: string
  name: string
  updatedAt: string
  version: number
  mapHash: string
}

export async function fetchCloudProjects(): Promise<CloudProjectMeta[]> {
  const res = await fetch(`${API}/projects`, { credentials: 'include' })
  if (!res.ok) return []
  const { projects } = await res.json() as { projects: CloudProjectMeta[] }
  return projects
}

// ── Map hash ──────────────────────────────────────────────────────────────────

export async function hashMap(data: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Upload ────────────────────────────────────────────────────────────────────

export type SyncResult =
  | { status: 'ok'; version: number }
  | { status: 'conflict'; serverVersion: number }
  | { status: 'error'; message: string }

export async function uploadProject(
  cloudId: string,
  project: Project,
  mapData: ArrayBuffer | null,
  localMapHash: string | null,
  lastSyncedMapHash: string | null,
  syncVersion: number,
): Promise<SyncResult> {
  // Upload map if it changed
  let mapHash = localMapHash
  if (mapData && mapHash && mapHash !== lastSyncedMapHash) {
    const mapRes = await fetch(`${API}/projects/${cloudId}/map`, {
      method: 'PUT',
      credentials: 'include',
      body: mapData,
    })
    if (!mapRes.ok) return { status: 'error', message: 'Map upload failed' }
    const { hash } = await mapRes.json() as { hash: string }
    mapHash = hash
  }

  // Upload project JSON (include mapHash for server metadata)
  const payload = { ...project, meta: { ...project.meta, mapHash } }
  const res = await fetch(`${API}/projects/${cloudId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(syncVersion > 0 ? { 'If-Match': String(syncVersion) } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (res.status === 409) {
    const { serverVersion } = await res.json() as { serverVersion: number }
    return { status: 'conflict', serverVersion }
  }
  if (!res.ok) return { status: 'error', message: `Upload failed (${res.status})` }

  const { version } = await res.json() as { version: number }
  return { status: 'ok', version }
}

// ── Download ──────────────────────────────────────────────────────────────────

export interface DownloadResult {
  project: Project
  mapData: ArrayBuffer | null
  mapHash: string | null
  version: number
}

export async function downloadProject(
  cloudId: string,
  localMapHash: string | null,
): Promise<DownloadResult | null> {
  const res = await fetch(`${API}/projects/${cloudId}`, { credentials: 'include' })
  if (!res.ok) return null
  const project = await res.json() as Project & { meta: { mapHash?: string } }
  const serverMapHash = project.meta.mapHash ?? null

  let mapData: ArrayBuffer | null = null
  if (serverMapHash && serverMapHash !== localMapHash) {
    const mapRes = await fetch(`${API}/projects/${cloudId}/map/${serverMapHash}`, { credentials: 'include' })
    if (mapRes.ok) mapData = await mapRes.arrayBuffer()
  }

  // Clean the extra field before returning
  const cleanMeta = { ...project.meta }
  delete (cleanMeta as Record<string, unknown>).mapHash
  const cleanProject = { ...project, meta: cleanMeta } as Project

  return {
    project: cleanProject,
    mapData,
    mapHash: serverMapHash,
    version: (project as unknown as { version: number }).version,
  }
}

// ── Create cloud project ──────────────────────────────────────────────────────

export async function createCloudProject(name: string): Promise<string | null> {
  const res = await fetch(`${API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) return null
  const { id } = await res.json() as { id: string }
  return id
}

// ── Delete cloud project ──────────────────────────────────────────────────────

export async function deleteCloudProject(cloudId: string): Promise<boolean> {
  const res = await fetch(`${API}/projects/${cloudId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return res.ok
}

// ── Sync state (per-project, stored in IDB alongside the project) ─────────

export interface SyncMeta {
  cloudId: string
  syncVersion: number
  syncedAt: string
  mapHash: string | null
}
