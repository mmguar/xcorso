import type { ApiContext, ApiFunction } from '../_env'

export const onRequestPost: ApiFunction = async (ctx: ApiContext) => {
  const { env } = ctx
  const body = await ctx.request.json() as { email?: string }
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'Invalid email' }, { status: 400 })
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  await env.KV.put(`auth:code:${email}`, code, { expirationTtl: 600 })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: email,
      subject: 'xcorso login code',
      text: `Your login code is: ${code}\n\nIt expires in 10 minutes.`,
    }),
  })

  if (!res.ok) {
    return Response.json({ error: 'Failed to send email' }, { status: 502 })
  }

  return Response.json({ ok: true })
}
