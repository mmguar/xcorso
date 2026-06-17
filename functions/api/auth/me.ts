import type { ApiContext, ApiFunction } from '../_env'
import { getUser } from '../_auth'

export const onRequestGet: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ user: null })
  return Response.json({ user: { userId: user.sub, email: user.email } })
}
