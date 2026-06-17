import type { ApiContext, ApiFunction } from '../../../_env'
import { getUser } from '../../../_auth'

export const onRequestGet: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const hash = ctx.params.hash as string
  const key = `users/${user.sub}/projects/${projectId}/maps/${hash}.bin`

  const obj = await ctx.env.BUCKET.get(key)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}
