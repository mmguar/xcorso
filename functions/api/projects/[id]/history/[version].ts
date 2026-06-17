import type { ApiContext, ApiFunction } from '../../../_env'
import { getUser } from '../../../_auth'

export const onRequestGet: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const version = ctx.params.version as string
  const key = `users/${user.sub}/projects/${projectId}/history/v${version.padStart(3, '0')}.json`

  const obj = await ctx.env.BUCKET.get(key)
  if (!obj) return Response.json({ error: 'Not found' }, { status: 404 })

  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json' },
  })
}
