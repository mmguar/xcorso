import type { ApiContext, ApiFunction } from '../../../_env'
import { getUser } from '../../../_auth'

export const onRequestPut: ApiFunction = async (ctx: ApiContext) => {
  const user = await getUser(ctx.request, ctx.env)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = ctx.params.id as string
  const body = await ctx.request.arrayBuffer()

  // Content-address: SHA-256 of the map bytes
  const hashBuf = await crypto.subtle.digest('SHA-256', body)
  const hash = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('')

  const key = `users/${user.sub}/projects/${projectId}/maps/${hash}.bin`

  // Skip if already exists (dedup)
  const existing = await ctx.env.BUCKET.head(key)
  if (!existing) {
    await ctx.env.BUCKET.put(key, body)
  }

  return Response.json({ hash, sizeBytes: body.byteLength })
}
