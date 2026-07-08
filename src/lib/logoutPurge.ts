/**
 * Sign-out purge: cloud-derived projects (owned-synced and shared editor
 * copies) are removed from this device on logout so the next browser user
 * can't browse them. Purely local projects are untouched.
 */
import { listProjects, loadProject, deleteProject, getSyncMeta, setSyncMeta, clearSyncMeta } from './persistence'
import { hashProject, hashMap, uploadProject, makeSyncMeta } from './sync'

export interface CloudCopy {
  id: string
  name: string
  unsynced: boolean
}

export async function listCloudCopies(): Promise<CloudCopy[]> {
  const all = await listProjects()
  const copies: CloudCopy[] = []
  for (const p of all) {
    if (!p.sync) continue
    // ponytail: map changes aren't hash-checked here (MBs per project);
    // the project hash covers everything users actually edit.
    let unsynced = true // legacy meta without projectHash: can't verify → warn
    if (p.sync.projectHash) {
      const saved = await loadProject(p.id)
      unsynced = !saved || await hashProject(saved.project) !== p.sync.projectHash
    }
    copies.push({ id: p.id, name: p.name, unsynced })
  }
  return copies
}

/** Upload one project straight from IDB (no store involvement). */
export async function syncCloudCopy(id: string): Promise<boolean> {
  const saved = await loadProject(id)
  const sync = await getSyncMeta(id)
  if (!saved || !sync) return false
  if (sync.role === 'viewer') return true
  const mapHash = saved.mapFileData ? await hashMap(saved.mapFileData) : null
  const result = await uploadProject(sync.cloudId, saved.project, saved.mapFileData, mapHash, sync.mapHash, sync.syncVersion)
  if (result.status !== 'ok') return false
  await setSyncMeta(id, await makeSyncMeta(sync.cloudId, result.version, mapHash, saved.project, sync.role))
  return true
}

/** Delete all cloud-derived local copies. Returns the purged project ids. */
export async function purgeCloudCopies(): Promise<string[]> {
  const cloud = (await listProjects()).filter(p => p.sync)
  for (const p of cloud) await deleteProject(p.id)
  return cloud.map(p => p.id)
}

/**
 * Detach all cloud-derived copies into ordinary local projects. Used after
 * account deletion: the cloud copies are gone, so the local ones are the only
 * surviving work — stripping the sync meta (and share role) keeps them usable
 * instead of destroying them like the logout purge does.
 */
export async function detachCloudCopies(): Promise<string[]> {
  const cloud = (await listProjects()).filter(p => p.sync)
  for (const p of cloud) await clearSyncMeta(p.id)
  return cloud.map(p => p.id)
}
