import type { ApiContext, ApiFunction } from '../_env'
import { getUser } from '../_auth'

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

function r2Prefix(userId: string, projectId: string) {
  return `users/${userId}/projects/${projectId}`
}

export const onRequestGet: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const obj = await ctx.env.BUCKET.get(`${r2Prefix(user.sub, projectId)}/current.json`)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json' },
  })
}

export const onRequestPut: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const prefix = r2Prefix(user.sub, projectId)

  // Load project index
  const index = await ctx.env.KV.get(`users:${user.sub}:projects`, 'json') as ProjectMeta[] | null ?? []
  let meta = index.find(p => p.id === projectId)
  if (!meta) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Version check
  const ifMatch = ctx.request.headers.get('If-Match')
  if (ifMatch && Number(ifMatch) !== meta.version) {
    return Response.json({ error: 'Conflict', serverVersion: meta.version }, { status: 409 })
  }

  // Snapshot current version to history
  if (meta.version > 0) {
    const current = await ctx.env.BUCKET.get(`${prefix}/current.json`)
    if (current) {
      const vKey = `${prefix}/history/v${String(meta.version).padStart(3, '0')}.json`
      await ctx.env.BUCKET.put(vKey, await current.arrayBuffer(), {
        httpMetadata: { contentType: 'application/json' },
      })
    }
  }

  // Write new current
  const body = await ctx.request.arrayBuffer()
  await ctx.env.BUCKET.put(`${prefix}/current.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  })

  // Parse project JSON for metadata
  let name = meta.name
  let mapHash = meta.mapHash
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body))
    name = parsed.meta?.name ?? name
    mapHash = parsed.meta?.mapHash ?? mapHash
  } catch { /* keep existing metadata */ }

  // Update index
  const newVersion = meta.version + 1
  meta.version = newVersion
  meta.name = name
  meta.mapHash = mapHash
  meta.updatedAt = new Date().toISOString()
  meta.projectSizeBytes = body.byteLength
  meta.history = [
    { version: newVersion, timestamp: meta.updatedAt, projectSizeBytes: body.byteLength },
    ...meta.history,
  ].slice(0, 50)

  await ctx.env.KV.put(`users:${user.sub}:projects`, JSON.stringify(index))

  return Response.json({ version: newVersion })
}

export const onRequestDelete: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const prefix = r2Prefix(user.sub, projectId)

  // Delete all R2 objects under this prefix
  const listed = await ctx.env.BUCKET.list({ prefix: `${prefix}/` })
  if (listed.objects.length > 0) {
    await ctx.env.BUCKET.delete(listed.objects.map(o => o.key))
  }

  // Remove from index
  const index = await ctx.env.KV.get(`users:${user.sub}:projects`, 'json') as ProjectMeta[] | null ?? []
  const filtered = index.filter(p => p.id !== projectId)
  await ctx.env.KV.put(`users:${user.sub}:projects`, JSON.stringify(filtered))

  return Response.json({ ok: true })
}
