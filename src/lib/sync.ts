import type { Project } from '../types'

const API = '/api'

// ── Auth ──────────────────────────────────────────────────────────────────────

export const TERMS_VERSION = '2025-06-24'

export interface CloudUser {
  userId: string
  email: string
  termsVersion?: string
}

export async function fetchUser(): Promise<CloudUser | null> {
  try {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json() as { user: CloudUser | null; projects?: CloudProjectMeta[]; indexEtag?: string }
    if (data.projects && data.indexEtag) {
      indexCache = data.projects
      indexEtag = data.indexEtag
    }
    return data.user
  } catch { return null }
}

export async function sendCode(email: string, cfToken?: string): Promise<{ ok: boolean; throttled?: boolean; blocked?: boolean }> {
  const res = await fetch(`${API}/auth/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, cfToken }),
  })
  if (res.status === 429) return { ok: false, throttled: true }
  if (res.status === 403) return { ok: false, blocked: true }
  return { ok: res.ok }
}

export async function verifyCode(email: string, code: string, termsVersion: string): Promise<CloudUser | null> {
  const res = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, code, termsVersion }),
  })
  if (!res.ok) return null
  const data = await res.json() as { userId: string; email: string; termsVersion?: string }
  return { userId: data.userId, email: data.email, termsVersion: data.termsVersion }
}

export async function acceptTerms(termsVersion: string): Promise<boolean> {
  const res = await fetch(`${API}/auth/accept-terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ termsVersion }),
  })
  return res.ok
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

let indexEtag: string | null = null
let indexCache: CloudProjectMeta[] | null = null

export async function fetchCloudProjects(): Promise<CloudProjectMeta[]> {
  const headers: HeadersInit = {}
  if (indexEtag) headers['If-None-Match'] = indexEtag
  const res = await fetch(`${API}/projects`, { credentials: 'include', headers })
  if (res.status === 304 && indexCache) return indexCache
  if (!res.ok) return []
  indexEtag = res.headers.get('ETag')
  const { projects } = await res.json() as { projects: CloudProjectMeta[] }
  indexCache = projects
  return projects
}

// ── Map hash ──────────────────────────────────────────────────────────────────

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as ArrayBuffer)
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hashMap(data: ArrayBuffer): Promise<string> {
  return sha256Hex(data)
}

// ── Upload ────────────────────────────────────────────────────────────────────

export type SyncResult =
  | { status: 'ok'; version: number }
  | { status: 'conflict'; serverVersion: number }
  | { status: 'not-found' }   // cloud project deleted or access revoked
  | { status: 'error'; message: string }

export async function uploadProject(
  cloudId: string,
  project: Project,
  mapData: ArrayBuffer | null,
  localMapHash: string | null,
  lastSyncedMapHash: string | null,
  syncVersion: number,
  forceSnapshot?: boolean,
): Promise<SyncResult> {
  // Upload map if it changed
  let mapHash = localMapHash
  if (mapData && mapHash && mapHash !== lastSyncedMapHash) {
    const mapRes = await fetch(`${API}/projects/${cloudId}/map`, {
      method: 'PUT',
      credentials: 'include',
      body: mapData,
    })
    if (mapRes.status === 404) return { status: 'not-found' }
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
      ...(forceSnapshot ? { 'X-Snapshot': 'true' } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (res.status === 409) {
    const { serverVersion } = await res.json() as { serverVersion: number }
    return { status: 'conflict', serverVersion }
  }
  if (res.status === 404) return { status: 'not-found' }
  if (!res.ok) return { status: 'error', message: `Upload failed (${res.status})` }

  const data = await res.json() as { version: number; indexEtag?: string }
  if (data.indexEtag) indexEtag = data.indexEtag
  return { status: 'ok', version: data.version }
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
    // Sync version comes from the header — project.version is the format version "1.0".
    version: Number(res.headers.get('X-Version') ?? 0),
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

// ── Sharing ──────────────────────────────────────────────────────────────────

export type ShareRole = 'owner' | 'editor' | 'viewer'

export interface ShareEntry {
  userId: string
  email: string
  role: 'editor' | 'viewer'
}

export interface SharedProject {
  projectId: string
  ownerId: string
  ownerEmail: string
  role: 'editor' | 'viewer'
  name: string
  updatedAt: string
}

export async function addShare(cloudId: string, email: string, role: 'editor' | 'viewer'): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API}/projects/${cloudId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, role }),
  })
  if (!res.ok) {
    const data = await res.json() as { error?: string }
    return { ok: false, error: data.error ?? 'Failed to share' }
  }
  return { ok: true }
}

export async function removeShare(cloudId: string, userId: string): Promise<boolean> {
  // userId may be "pending:<email>" for not-yet-registered invitees
  const res = await fetch(`${API}/projects/${cloudId}/share/${encodeURIComponent(userId)}`, { method: 'DELETE', credentials: 'include' })
  return res.ok
}

export async function listShares(cloudId: string): Promise<{ shares: ShareEntry[]; role: ShareRole }> {
  const res = await fetch(`${API}/projects/${cloudId}/share`, { credentials: 'include' })
  if (!res.ok) return { shares: [], role: 'owner' }
  return await res.json() as { shares: ShareEntry[]; role: ShareRole }
}

export async function fetchSharedProjects(): Promise<SharedProject[]> {
  const res = await fetch(`${API}/shared`, { credentials: 'include' })
  if (!res.ok) return []
  const { projects } = await res.json() as { projects: SharedProject[] }
  return projects
}

// ── Version history ──────────────────────────────────────────────────────────

export interface VersionEntry {
  version: number
  timestamp: string
  projectSizeBytes: number
  editedBy?: string
}

export async function fetchHistory(cloudId: string): Promise<VersionEntry[]> {
  const res = await fetch(`${API}/projects/${cloudId}/history`, { credentials: 'include' })
  if (!res.ok) return []
  const { history } = await res.json() as { history: VersionEntry[] }
  return history
}

export async function restoreVersion(cloudId: string, version: number): Promise<number | null> {
  const res = await fetch(`${API}/projects/${cloudId}/history/${version}/restore`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) return null
  const { version: newVersion } = await res.json() as { version: number }
  return newVersion
}

// ── Sync state (per-project, stored in IDB alongside the project) ─────────

export interface SyncMeta {
  cloudId: string
  syncVersion: number
  syncedAt: string
  mapHash: string | null
  projectHash?: string
  /** Set when the project is shared with this user; absent = owned. */
  role?: 'editor' | 'viewer'
}

export function hashProject(project: Project): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(project)))
}

/**
 * Build a complete SyncMeta. Every writer must go through this so projectHash
 * is never missing — a missing hash defeats the "skip upload if unchanged"
 * check and causes phantom version bumps on other devices.
 * Pass the project as it lives in the store (post-normalization), since that
 * is what future syncs will hash and compare against.
 */
export async function makeSyncMeta(
  cloudId: string,
  syncVersion: number,
  mapHash: string | null,
  project: Project,
  role?: 'editor' | 'viewer',
): Promise<SyncMeta> {
  return {
    cloudId,
    syncVersion,
    syncedAt: new Date().toISOString(),
    mapHash,
    projectHash: await hashProject(project),
    ...(role ? { role } : {}),
  }
}
