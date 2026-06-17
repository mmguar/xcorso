import type { ApiContext, ApiFunction } from '../_env'
import { createToken, tokenCookie } from '../_auth'

export const onRequestPost: ApiFunction = async (ctx: ApiContext) => {
  const { env } = ctx
  const body = await ctx.request.json() as { email?: string; code?: string }
  const email = body.email?.trim().toLowerCase()
  const code = body.code?.trim()
  if (!email || !code) {
    return Response.json({ error: 'Missing email or code' }, { status: 400 })
  }

  const stored = await env.KV.get(`auth:code:${email}`)
  if (!stored || stored !== code) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 })
  }
  await env.KV.delete(`auth:code:${email}`)

  // Find or create user
  let user = await env.KV.get(`users:email:${email}`, 'json') as { userId: string; createdAt: string } | null
  if (!user) {
    const userId = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    user = { userId, createdAt }
    await env.KV.put(`users:email:${email}`, JSON.stringify(user))
    await env.KV.put(`users:id:${userId}`, JSON.stringify({ email, createdAt }))
  }

  const token = await createToken(env, user.userId, email)
  return Response.json({ ok: true, userId: user.userId, email }, {
    headers: { 'Set-Cookie': tokenCookie(token) },
  })
}
