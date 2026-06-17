import type { ApiContext, ApiFunction } from '../../../../_env'
import { getUser } from '../../../../_auth'

interface ProjectMeta {
  id: string
  name: string
  updatedAt: string
  projectSizeBytes: number
  mapHash: string
  mapSizeBytes: number
  version: number
  history: { version: number; timestamp: string; projectSizeBytes: number }[]
}

export const onRequestPost: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const version = ctx.params.version as string
  const prefix = `users/${user.sub}/projects/${projectId}`

  // Read the snapshot to restore
  const snapshotKey = `${prefix}/history/v${version.padStart(3, '0')}.json`
  const snapshot = await ctx.env.BUCKET.get(snapshotKey)
  if (!snapshot) return Response.json({ error: 'Version not found' }, { status: 404 })
  const snapshotBytes = await snapshot.arrayBuffer()

  // Snapshot current as a new history entry before overwriting
  const index = await ctx.env.KV.get(`users:${user.sub}:projects`, 'json') as ProjectMeta[] | null ?? []
  const meta = index.find(p => p.id === projectId)
  if (!meta) return Response.json({ error: 'Project not found' }, { status: 404 })

  const current = await ctx.env.BUCKET.get(`${prefix}/current.json`)
  if (current) {
    const archiveKey = `${prefix}/history/v${String(meta.version).padStart(3, '0')}.json`
    await ctx.env.BUCKET.put(archiveKey, await current.arrayBuffer(), {
      httpMetadata: { contentType: 'application/json' },
    })
  }

  // Write snapshot as new current
  await ctx.env.BUCKET.put(`${prefix}/current.json`, snapshotBytes, {
    httpMetadata: { contentType: 'application/json' },
  })

  // Update metadata
  const newVersion = meta.version + 1
  meta.version = newVersion
  meta.updatedAt = new Date().toISOString()
  meta.projectSizeBytes = snapshotBytes.byteLength
  meta.history = [
    { version: newVersion, timestamp: meta.updatedAt, projectSizeBytes: snapshotBytes.byteLength },
    ...meta.history,
  ].slice(0, 50)

  try {
    const parsed = JSON.parse(new TextDecoder().decode(snapshotBytes))
    meta.name = parsed.meta?.name ?? meta.name
    meta.mapHash = parsed.meta?.mapHash ?? meta.mapHash
  } catch { /* keep existing */ }

  await ctx.env.KV.put(`users:${user.sub}:projects`, JSON.stringify(index))

  return Response.json({ version: newVersion })
}
