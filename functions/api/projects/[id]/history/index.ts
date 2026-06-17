import type { ApiContext, ApiFunction } from '../../../_env'
import { getUser } from '../../../_auth'

export const onRequestGet: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const index = await ctx.env.KV.get(`users:${user.sub}:projects`, 'json') as { id: string; history: unknown[] }[] | null ?? []
  const meta = index.find(p => p.id === projectId)
  if (!meta) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({ history: meta.history ?? [] })
}
