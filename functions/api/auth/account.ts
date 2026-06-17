import type { ApiContext, ApiFunction } from '../_env'
import { getUser, tokenCookie } from '../_auth'

export const onRequestDelete: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { env } = ctx
  const userId = user.sub

  // Delete all R2 objects under this user's prefix
  const prefix = `users/${userId}/`
  let cursor: string | undefined
  do {
    const listed = await env.BUCKET.list({ prefix, cursor })
    if (listed.objects.length > 0) {
      await env.BUCKET.delete(listed.objects.map(o => o.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  // Delete KV entries
  await env.KV.delete(`users:${userId}:projects`)
  await env.KV.delete(`users:id:${userId}`)
  await env.KV.delete(`users:email:${user.email}`)

  return Response.json({ ok: true }, {
    headers: { 'Set-Cookie': tokenCookie('', 0) },
  })
}
