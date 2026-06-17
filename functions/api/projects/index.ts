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

export const onRequestGet: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await ctx.env.KV.get(`users:${user.sub}:projects`, 'json') as ProjectMeta[] | null
  return Response.json({ projects: raw ?? [] })
}

export const onRequestPost: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await ctx.request.json() as { name?: string }
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const existing = await ctx.env.KV.get(`users:${user.sub}:projects`, 'json') as ProjectMeta[] | null ?? []
  existing.push({
    id,
    name: body.name ?? 'Untitled',
    updatedAt: now,
    projectSizeBytes: 0,
    mapHash: '',
    mapSizeBytes: 0,
    version: 0,
    history: [],
  })
  await ctx.env.KV.put(`users:${user.sub}:projects`, JSON.stringify(existing))

  return Response.json({ id }, { status: 201 })
}
